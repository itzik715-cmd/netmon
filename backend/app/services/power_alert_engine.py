"""
Power Alert Engine - Evaluates Power aggregate alert rules.
Computes aggregate metrics (total power, load, temperature) across all PDUs
over configurable time windows and fires alerts accordingly.
"""
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional
from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_
from app.models.power_alert import PowerAlertRule
from app.models.alert import AlertEvent
from app.models.pdu import PduMetric
from app.models.device import Device
from app.models.settings import SystemSetting
import httpx

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


async def compute_power_aggregates(db: AsyncSession, lookback_minutes: int) -> dict:
    """Compute aggregate power metrics over the given time window."""
    # Get all active PDU device IDs
    result = await db.execute(
        select(Device.id).where(Device.device_type == "pdu", Device.is_active == True)
    )
    pdu_ids = [row[0] for row in result.all()]
    if not pdu_ids:
        return {}

    since = datetime.now(timezone.utc) - timedelta(minutes=lookback_minutes)

    result = await db.execute(
        select(PduMetric)
        .where(
            PduMetric.device_id.in_(pdu_ids),
            PduMetric.timestamp >= since,
        )
        .order_by(PduMetric.timestamp.asc())
    )
    metrics = result.scalars().all()

    if not metrics:
        return {}

    # Bucket by minute and sum power_watts across PDUs
    buckets: dict[str, dict] = defaultdict(lambda: {"power_watts": 0.0})
    load_values: list[float] = []
    temp_values: list[float] = []

    for m in metrics:
        ts = m.timestamp.replace(second=0, microsecond=0).isoformat()
        buckets[ts]["power_watts"] += m.power_watts or 0

        if m.load_pct is not None:
            load_values.append(m.load_pct)
        if m.temperature_c is not None:
            temp_values.append(m.temperature_c)

    # Total power = latest bucket (most recent aggregate)
    all_power = [b["power_watts"] for b in buckets.values()]
    total_power = all_power[-1] if all_power else 0.0

    avg_load = sum(load_values) / len(load_values) if load_values else 0.0
    max_load = max(load_values) if load_values else 0.0
    avg_temp = sum(temp_values) / len(temp_values) if temp_values else 0.0
    max_temp = max(temp_values) if temp_values else 0.0

    # Fetch power_budget_watts from settings
    budget_pct = 0.0
    setting_result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "power_budget_watts")
    )
    setting = setting_result.scalar_one_or_none()
    if setting and setting.value:
        try:
            budget_watts = float(setting.value)
            if budget_watts > 0:
                budget_pct = (total_power / budget_watts) * 100
        except (ValueError, TypeError):
            pass

    return {
        "total_power": total_power,
        "avg_load": avg_load,
        "max_load": max_load,
        "max_temp": max_temp,
        "avg_temp": avg_temp,
        "budget_pct": budget_pct,
    }


def _evaluate_severity(value: float, condition: str, rule: PowerAlertRule) -> Optional[str]:
    """Returns highest breached severity or None."""
    if rule.critical_threshold is not None:
        if evaluate_condition(value, condition, rule.critical_threshold):
            return "critical"
    if rule.warning_threshold is not None:
        if evaluate_condition(value, condition, rule.warning_threshold):
            return "warning"
    return None


def _breached_threshold(rule: PowerAlertRule, severity: str) -> float:
    if severity == "critical" and rule.critical_threshold is not None:
        return rule.critical_threshold
    if severity == "warning" and rule.warning_threshold is not None:
        return rule.warning_threshold
    return 0.0


METRIC_LABELS = {
    "total_power": "Total Power",
    "avg_load": "Avg Load",
    "max_load": "Max Load",
    "max_temp": "Max Temperature",
    "avg_temp": "Avg Temperature",
    "budget_pct": "Budget %",
}

METRIC_UNITS = {
    "total_power": "W",
    "avg_load": "%",
    "max_load": "%",
    "max_temp": "°C",
    "avg_temp": "°C",
    "budget_pct": "%",
}


def _format_lookback(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes}m"
    if minutes < 1440:
        return f"{minutes // 60}h"
    return f"{minutes // 1440}d"


def _format_value(metric: str, value: float) -> str:
    unit = METRIC_UNITS.get(metric, "")
    if metric == "total_power":
        if value >= 1000:
            return f"{value / 1000:.2f} kW"
        return f"{value:.0f} W"
    return f"{value:.1f}{unit}"


async def evaluate_power_rules(db: AsyncSession):
    """Evaluate all active power alert rules."""
    result = await db.execute(
        select(PowerAlertRule).where(PowerAlertRule.is_active == True)
    )
    rules = result.scalars().all()
    if not rules:
        return

    # Group rules by lookback to avoid recomputing the same aggregates
    lookback_groups: dict[int, list[PowerAlertRule]] = defaultdict(list)
    for rule in rules:
        lookback_groups[rule.lookback_minutes].append(rule)

    aggregates_cache: dict[int, dict] = {}

    for lookback, group_rules in lookback_groups.items():
        try:
            if lookback not in aggregates_cache:
                aggregates_cache[lookback] = await compute_power_aggregates(db, lookback)

            agg = aggregates_cache[lookback]
            if not agg:
                continue

            for rule in group_rules:
                try:
                    value = agg.get(rule.metric)
                    if value is None:
                        continue

                    severity = _evaluate_severity(value, rule.condition, rule)
                    if severity:
                        if severity == "warning":
                            await _resolve_events(db, rule, severity="critical")
                        await _trigger_event(db, rule, value, severity)
                    else:
                        await _resolve_events(db, rule)

                except Exception as e:
                    logger.error(f"Error evaluating power rule {rule.id}: {e}")

        except Exception as e:
            logger.error(f"Error computing power aggregates for {lookback}m window: {e}")


async def _trigger_event(
    db: AsyncSession,
    rule: PowerAlertRule,
    value: float,
    severity: str,
):
    """Create or update a power alert event."""
    threshold = _breached_threshold(rule, severity)
    lookback_label = _format_lookback(rule.lookback_minutes)
    metric_label = METRIC_LABELS.get(rule.metric, rule.metric)
    value_str = _format_value(rule.metric, value)
    threshold_str = _format_value(rule.metric, threshold)

    message = (
        f"Power Alert: {rule.name} | {metric_label} ({lookback_label}) = "
        f"{value_str} {rule.condition} {threshold_str}"
    )

    # Check for existing open/acknowledged event
    result = await db.execute(
        select(AlertEvent).where(and_(
            AlertEvent.power_rule_id == rule.id,
            AlertEvent.severity == severity,
            AlertEvent.status.in_(["open", "acknowledged"]),
        ))
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.metric_value = value
        existing.threshold_value = threshold
        existing.message = message
        await db.commit()
        return

    event = AlertEvent(
        power_rule_id=rule.id,
        severity=severity,
        status="open",
        message=message,
        metric_value=value,
        threshold_value=threshold,
    )
    db.add(event)
    await db.commit()

    logger.warning(f"POWER ALERT TRIGGERED [{severity.upper()}]: {message}")

    # Notifications
    if rule.notification_email:
        asyncio.create_task(_send_email(rule, event, message, severity))
    if rule.notification_webhook:
        asyncio.create_task(_send_webhook(rule, event, message, severity))


async def _resolve_events(
    db: AsyncSession,
    rule: PowerAlertRule,
    severity: Optional[str] = None,
):
    """Auto-resolve open power alert events."""
    now = datetime.now(timezone.utc)
    filters = [
        AlertEvent.power_rule_id == rule.id,
        AlertEvent.status == "open",
    ]
    if severity:
        filters.append(AlertEvent.severity == severity)

    await db.execute(
        update(AlertEvent)
        .where(and_(*filters))
        .values(status="resolved", resolved_at=now)
    )
    await db.commit()


async def _send_webhook(rule: PowerAlertRule, event: AlertEvent, message: str, severity: str):
    payload = {
        "alert_id": event.id,
        "rule_name": rule.name,
        "type": "power_aggregate",
        "severity": severity,
        "message": message,
        "metric_value": event.metric_value,
        "threshold": event.threshold_value,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(rule.notification_webhook, json=payload)
    except Exception as e:
        logger.error(f"Power alert webhook failed: {e}")


async def _send_email(rule: PowerAlertRule, event: AlertEvent, message: str, severity: str):
    from app.database import AsyncSessionLocal
    from app.services.email_sender import send_email
    try:
        async with AsyncSessionLocal() as db:
            subject = f"[NetMon Power Alert] {severity.upper()}: {rule.name}"
            body = f"""<h2>Power Aggregate Alert Triggered</h2>
            <p><strong>Rule:</strong> {rule.name}</p>
            <p><strong>Severity:</strong> {severity}</p>
            <p><strong>Message:</strong> {message}</p>
            <p><strong>Value:</strong> {event.metric_value} (threshold: {event.threshold_value})</p>
            <p><strong>Time:</strong> {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}</p>"""
            await send_email(db, rule.notification_email, subject, body)
    except Exception as e:
        logger.error(f"Power alert email failed: {e}")
