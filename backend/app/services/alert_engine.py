"""
Alert Engine - Evaluates alert rules against current metrics.
"""
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_
from app.models.alert import AlertRule, AlertEvent
from app.models.device import Device
from app.models.interface import Interface, InterfaceMetric
import httpx
import json

logger = logging.getLogger(__name__)


def evaluate_condition(value: float, condition: str, threshold: float) -> bool:
    ops = {
        "gt": lambda v, t: v > t,
        "gte": lambda v, t: v >= t,
        "lt": lambda v, t: v < t,
        "lte": lambda v, t: v <= t,
        "eq": lambda v, t: v == t,
        "ne": lambda v, t: v != t,
    }
    fn = ops.get(condition)
    return fn(value, threshold) if fn else False


async def get_metric_value(rule: AlertRule, db: AsyncSession) -> Optional[float]:
    """Get current value for the metric defined in rule."""
    metric = rule.metric

    if metric == "device_status":
        if not rule.device_id:
            return None
        result = await db.execute(select(Device).where(Device.id == rule.device_id))
        device = result.scalar_one_or_none()
        if not device:
            return None
        return 0.0 if device.status == "up" else 1.0

    elif metric == "cpu_usage":
        if not rule.device_id:
            return None
        result = await db.execute(select(Device).where(Device.id == rule.device_id))
        device = result.scalar_one_or_none()
        return device.cpu_usage if device else None

    elif metric == "memory_usage":
        if not rule.device_id:
            return None
        result = await db.execute(select(Device).where(Device.id == rule.device_id))
        device = result.scalar_one_or_none()
        return device.memory_usage if device else None

    elif metric in ("if_utilization_in", "if_utilization_out", "if_status", "if_errors"):
        if not rule.interface_id:
            return None
        result = await db.execute(
            select(InterfaceMetric)
            .where(InterfaceMetric.interface_id == rule.interface_id)
            .order_by(InterfaceMetric.timestamp.desc())
            .limit(1)
        )
        m = result.scalar_one_or_none()
        if not m:
            return None
        if metric == "if_utilization_in":
            return m.utilization_in
        elif metric == "if_utilization_out":
            return m.utilization_out
        elif metric == "if_status":
            return 0.0 if m.oper_status == "up" else 1.0
        elif metric == "if_errors":
            return float((m.in_errors or 0) + (m.out_errors or 0))

    return None


async def evaluate_rules(db: AsyncSession):
    """Evaluate all active alert rules."""
    result = await db.execute(select(AlertRule).where(AlertRule.is_active == True))
    rules = result.scalars().all()

    for rule in rules:
        try:
            value = await get_metric_value(rule, db)
            if value is None:
                continue

            triggered = evaluate_condition(value, rule.condition, rule.threshold)

            if triggered:
                await handle_alert_trigger(rule, value, db)
            else:
                await handle_alert_resolve(rule, db)

        except Exception as e:
            logger.error(f"Error evaluating rule {rule.id}: {e}")


async def handle_alert_trigger(rule: AlertRule, value: float, db: AsyncSession):
    """Create or update alert event when threshold is exceeded."""
    # Check cooldown - don't re-alert within cooldown window
    cooldown_cutoff = datetime.now(timezone.utc) - timedelta(minutes=rule.cooldown_minutes)
    result = await db.execute(
        select(AlertEvent).where(
            and_(
                AlertEvent.rule_id == rule.id,
                AlertEvent.status.in_(["open", "acknowledged"]),
                AlertEvent.triggered_at > cooldown_cutoff,
            )
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        return  # Already have an active alert within cooldown

    # Create new alert event
    device_name = "Unknown"
    if rule.device_id:
        d = await db.execute(select(Device).where(Device.id == rule.device_id))
        dev = d.scalar_one_or_none()
        device_name = dev.hostname if dev else str(rule.device_id)

    message = (
        f"Alert: {rule.name} | Device: {device_name} | "
        f"Metric: {rule.metric} = {value:.2f} {rule.condition} {rule.threshold}"
    )

    event = AlertEvent(
        rule_id=rule.id,
        device_id=rule.device_id,
        interface_id=rule.interface_id,
        severity=rule.severity,
        status="open",
        message=message,
        metric_value=value,
        threshold_value=rule.threshold,
    )
    db.add(event)
    await db.commit()

    logger.warning(f"ALERT TRIGGERED: {message}")

    # Send notifications
    if rule.notification_email:
        asyncio.create_task(send_email_notification(rule, event, message))
    if rule.notification_webhook:
        asyncio.create_task(send_webhook_notification(rule, event, message))


async def handle_alert_resolve(rule: AlertRule, db: AsyncSession):
    """Auto-resolve open alerts when condition clears."""
    now = datetime.now(timezone.utc)
    await db.execute(
        update(AlertEvent)
        .where(
            and_(
                AlertEvent.rule_id == rule.id,
                AlertEvent.status == "open",
            )
        )
        .values(status="resolved", resolved_at=now)
    )
    await db.commit()


async def send_webhook_notification(rule: AlertRule, event: AlertEvent, message: str):
    """Send alert notification to webhook."""
    payload = {
        "alert_id": event.id,
        "rule_name": rule.name,
        "severity": rule.severity,
        "message": message,
        "metric_value": event.metric_value,
        "threshold": event.threshold_value,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(rule.notification_webhook, json=payload)
    except Exception as e:
        logger.error(f"Webhook notification failed: {e}")


async def send_email_notification(rule: AlertRule, event: AlertEvent, message: str):
    """Placeholder for email notification."""
    logger.info(f"Email notification to {rule.notification_email}: {message}")
