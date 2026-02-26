"""
Alert Engine - Evaluates alert rules against current metrics.
Supports multi-threshold rules (warning + critical in one rule).
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


def evaluate_severity(value: float, condition: str, rule: AlertRule) -> Optional[str]:
    """
    Returns the highest severity whose threshold is breached, or None.
    Priority: critical > warning > legacy single-threshold.
    """
    if rule.critical_threshold is not None:
        if evaluate_condition(value, condition, rule.critical_threshold):
            return "critical"
    if rule.warning_threshold is not None:
        if evaluate_condition(value, condition, rule.warning_threshold):
            return "warning"
    # Legacy single-threshold path
    if rule.threshold is not None:
        if evaluate_condition(value, condition, rule.threshold):
            return rule.severity
    return None


def _breached_threshold_for(rule: AlertRule, severity: str) -> float:
    """Return the specific threshold value that produced the given severity."""
    if severity == "critical" and rule.critical_threshold is not None:
        return rule.critical_threshold
    if severity == "warning" and rule.warning_threshold is not None:
        return rule.warning_threshold
    return rule.threshold or 0.0


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
        if not device or device.cpu_usage is None:
            return None
        return float(device.cpu_usage)

    elif metric == "memory_usage":
        if not rule.device_id:
            return None
        result = await db.execute(select(Device).where(Device.id == rule.device_id))
        device = result.scalar_one_or_none()
        if not device or device.memory_usage is None:
            return None
        return float(device.memory_usage)

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


async def get_all_device_metric_values(metric: str, db: AsyncSession) -> list:
    """Get metric values for ALL active devices. Returns list of (device, value) tuples."""
    result = await db.execute(select(Device).where(Device.status != "unknown"))
    devices = result.scalars().all()
    values = []
    for device in devices:
        if metric == "device_status":
            values.append((device, 0.0 if device.status == "up" else 1.0))
        elif metric == "cpu_usage" and device.cpu_usage is not None:
            values.append((device, float(device.cpu_usage)))
        elif metric == "memory_usage" and device.memory_usage is not None:
            values.append((device, float(device.memory_usage)))
    return values


async def evaluate_rules(db: AsyncSession):
    """Evaluate all active alert rules."""
    result = await db.execute(select(AlertRule).where(AlertRule.is_active == True))
    rules = result.scalars().all()

    for rule in rules:
        try:
            # Global device-level rules (no device_id): evaluate against ALL devices
            if not rule.device_id and rule.metric in ("device_status", "cpu_usage", "memory_usage"):
                device_values = await get_all_device_metric_values(rule.metric, db)
                for device, value in device_values:
                    active_severity = evaluate_severity(value, rule.condition, rule)
                    if active_severity:
                        await handle_alert_trigger(rule, value, db, device=device,
                                                   severity=active_severity)
                    else:
                        await handle_alert_resolve(rule, db, device_id=device.id)
                continue

            value = await get_metric_value(rule, db)
            if value is None:
                continue

            active_severity = evaluate_severity(value, rule.condition, rule)
            if active_severity:
                # If only warning is active, resolve any lingering critical events
                if active_severity == "warning":
                    await handle_alert_resolve(rule, db, severity="critical")
                await handle_alert_trigger(rule, value, db, severity=active_severity)
            else:
                await handle_alert_resolve(rule, db)

        except Exception as e:
            logger.error(f"Error evaluating rule {rule.id}: {e}")


async def handle_alert_trigger(
    rule: AlertRule,
    value: float,
    db: AsyncSession,
    device: Optional[Device] = None,
    severity: Optional[str] = None,
):
    """Create or update alert event when threshold is exceeded.

    Each rule+device+severity combination has at most ONE active event.
    If an open/acknowledged event already exists, update its metric value
    and message instead of creating a duplicate.
    """
    if severity is None:
        severity = rule.severity

    breached_threshold = _breached_threshold_for(rule, severity)
    alert_device_id = device.id if device else rule.device_id

    # Check for any existing open/acknowledged event for this rule+device+severity
    existing_filters = [
        AlertEvent.rule_id == rule.id,
        AlertEvent.severity == severity,
        AlertEvent.status.in_(["open", "acknowledged"]),
    ]
    if alert_device_id:
        existing_filters.append(AlertEvent.device_id == alert_device_id)
    result = await db.execute(
        select(AlertEvent).where(and_(*existing_filters))
    )
    existing = result.scalar_one_or_none()

    # Resolve device name for the message
    device_name = "Unknown"
    if device:
        device_name = device.hostname or str(device.id)
    elif rule.device_id:
        d = await db.execute(select(Device).where(Device.id == rule.device_id))
        dev = d.scalar_one_or_none()
        device_name = dev.hostname if dev else str(rule.device_id)

    message = (
        f"Alert: {rule.name} | Device: {device_name} | "
        f"Metric: {rule.metric} = {value:.2f} {rule.condition} {breached_threshold}"
    )

    if existing:
        # Update the existing event with latest metric value
        existing.metric_value = value
        existing.threshold_value = breached_threshold
        existing.message = message
        await db.commit()
        return

    # Create new alert event (first occurrence)
    event = AlertEvent(
        rule_id=rule.id,
        device_id=alert_device_id,
        interface_id=rule.interface_id,
        severity=severity,
        status="open",
        message=message,
        metric_value=value,
        threshold_value=breached_threshold,
    )
    db.add(event)
    await db.commit()

    logger.warning(f"ALERT TRIGGERED [{severity.upper()}]: {message}")

    # Send notifications only on first trigger, not on updates
    if rule.notification_email:
        asyncio.create_task(send_email_notification(rule, event, message, severity))
    if rule.notification_webhook:
        asyncio.create_task(send_webhook_notification(rule, event, message, severity))


async def handle_alert_resolve(
    rule: AlertRule,
    db: AsyncSession,
    severity: Optional[str] = None,
    device_id: Optional[int] = None,
):
    """Auto-resolve open alerts when condition clears. Optionally filter by severity/device."""
    now = datetime.now(timezone.utc)
    filters = [
        AlertEvent.rule_id == rule.id,
        AlertEvent.status == "open",
    ]
    if severity:
        filters.append(AlertEvent.severity == severity)
    if device_id:
        filters.append(AlertEvent.device_id == device_id)

    await db.execute(
        update(AlertEvent)
        .where(and_(*filters))
        .values(status="resolved", resolved_at=now)
    )
    await db.commit()


async def send_webhook_notification(rule: AlertRule, event: AlertEvent, message: str, severity: str = ""):
    """Send alert notification to webhook."""
    payload = {
        "alert_id": event.id,
        "rule_name": rule.name,
        "severity": severity or event.severity,
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


async def send_email_notification(rule: AlertRule, event: AlertEvent, message: str, severity: str = ""):
    """Send alert email notification via configured SMTP."""
    from app.database import AsyncSessionLocal
    from app.services.email_sender import send_email
    sev = severity or event.severity
    try:
        async with AsyncSessionLocal() as db:
            subject = f"[NetMon Alert] {sev.upper()}: {rule.name}"
            body = f"""<h2>NetMon Alert Triggered</h2>
            <p><strong>Rule:</strong> {rule.name}</p>
            <p><strong>Severity:</strong> {sev}</p>
            <p><strong>Message:</strong> {message}</p>
            <p><strong>Value:</strong> {event.metric_value} (threshold: {event.threshold_value})</p>
            <p><strong>Time:</strong> {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}</p>"""
            await send_email(db, rule.notification_email, subject, body)
    except Exception as e:
        logger.error(f"Failed to send alert email: {e}")
