"""
WAN Alert Engine - Evaluates WAN aggregate alert rules.
Computes aggregate metrics (p95, max, avg) across all WAN interfaces
over configurable time windows and fires alerts accordingly.
"""
import logging
import asyncio
import math
from datetime import datetime, timezone, timedelta
from typing import Optional
from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_
from app.models.wan_alert import WanAlertRule
from app.models.alert import AlertEvent
from app.models.interface import Interface, InterfaceMetric
from app.models.settings import SystemSetting
import httpx

logger = logging.getLogger(__name__)


def percentile_95(data: list[float]) -> float:
    if not data:
        return 0.0
    s = sorted(data)
    k = (len(s) - 1) * 0.95
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] * (c - k) + s[c] * (k - f)


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


async def compute_wan_aggregates(db: AsyncSession, lookback_minutes: int) -> dict:
    """Compute aggregate WAN metrics over the given time window."""
    # Get WAN interface IDs
    result = await db.execute(
        select(Interface.id, Interface.speed).where(Interface.is_wan == True)
    )
    wan_ifaces = result.all()
    if not wan_ifaces:
        return {}

    wan_ids = [row[0] for row in wan_ifaces]
    total_speed = sum((row[1] or 0) for row in wan_ifaces)

    since = datetime.now(timezone.utc) - timedelta(minutes=lookback_minutes)

    result = await db.execute(
        select(InterfaceMetric)
        .where(
            InterfaceMetric.interface_id.in_(wan_ids),
            InterfaceMetric.timestamp >= since,
        )
        .order_by(InterfaceMetric.timestamp.asc())
    )
    metrics = result.scalars().all()

    if not metrics:
        return {}

    # Bucket by minute and sum across WAN interfaces
    buckets: dict[str, dict] = defaultdict(lambda: {"in_bps": 0.0, "out_bps": 0.0})
    for m in metrics:
        ts = m.timestamp.replace(second=0, microsecond=0).isoformat()
        buckets[ts]["in_bps"] += m.in_bps or 0
        buckets[ts]["out_bps"] += m.out_bps or 0

    all_in = [b["in_bps"] for b in buckets.values()]
    all_out = [b["out_bps"] for b in buckets.values()]

    p95_in = percentile_95(all_in)
    p95_out = percentile_95(all_out)
    p95_max = max(p95_in, p95_out)

    max_in = max(all_in) if all_in else 0.0
    max_out = max(all_out) if all_out else 0.0
    avg_in = sum(all_in) / len(all_in) if all_in else 0.0
    avg_out = sum(all_out) / len(all_out) if all_out else 0.0

    # Fetch commitment_bps from settings
    commitment_pct = 0.0
    setting_result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "wan_commitment_bps")
    )
    setting = setting_result.scalar_one_or_none()
    if setting and setting.value:
        try:
            commitment_bps = float(setting.value)
            if commitment_bps > 0:
                commitment_pct = (p95_max / commitment_bps) * 100
        except (ValueError, TypeError):
            pass

    return {
        "p95_in": p95_in,
        "p95_out": p95_out,
        "p95_max": p95_max,
        "max_in": max_in,
        "max_out": max_out,
        "avg_in": avg_in,
        "avg_out": avg_out,
        "commitment_pct": commitment_pct,
        "total_speed_bps": total_speed,
    }


def _evaluate_severity(value: float, condition: str, rule: WanAlertRule) -> Optional[str]:
    """Returns highest breached severity or None."""
    if rule.critical_threshold is not None:
        if evaluate_condition(value, condition, rule.critical_threshold):
            return "critical"
    if rule.warning_threshold is not None:
        if evaluate_condition(value, condition, rule.warning_threshold):
            return "warning"
    return None


def _breached_threshold(rule: WanAlertRule, severity: str) -> float:
    if severity == "critical" and rule.critical_threshold is not None:
        return rule.critical_threshold
    if severity == "warning" and rule.warning_threshold is not None:
        return rule.warning_threshold
    return 0.0


METRIC_LABELS = {
    "p95_in": "95th Percentile In",
    "p95_out": "95th Percentile Out",
    "p95_max": "95th Percentile Max",
    "max_in": "Max In",
    "max_out": "Max Out",
    "avg_in": "Average In",
    "avg_out": "Average Out",
    "commitment_pct": "Commitment %",
}


def _format_lookback(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes}m"
    if minutes < 1440:
        return f"{minutes // 60}h"
    return f"{minutes // 1440}d"


def _format_value(metric: str, value: float) -> str:
    if metric == "commitment_pct":
        return f"{value:.1f}%"
    if value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.2f} Gbps"
    if value >= 1_000_000:
        return f"{value / 1_000_000:.2f} Mbps"
    return f"{value:.0f} bps"


async def evaluate_wan_rules(db: AsyncSession):
    """Evaluate all active WAN alert rules."""
    result = await db.execute(
        select(WanAlertRule).where(WanAlertRule.is_active == True)
    )
    rules = result.scalars().all()
    if not rules:
        return

    # Group rules by lookback to avoid recomputing the same aggregates
    lookback_groups: dict[int, list[WanAlertRule]] = defaultdict(list)
    for rule in rules:
        lookback_groups[rule.lookback_minutes].append(rule)

    aggregates_cache: dict[int, dict] = {}

    for lookback, group_rules in lookback_groups.items():
        try:
            if lookback not in aggregates_cache:
                aggregates_cache[lookback] = await compute_wan_aggregates(db, lookback)

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
                        # If only warning, resolve lingering critical
                        if severity == "warning":
                            await _resolve_events(db, rule, severity="critical")
                        await _trigger_event(db, rule, value, severity)
                    else:
                        await _resolve_events(db, rule)

                except Exception as e:
                    logger.error(f"Error evaluating WAN rule {rule.id}: {e}")

        except Exception as e:
            logger.error(f"Error computing WAN aggregates for {lookback}m window: {e}")


async def _trigger_event(
    db: AsyncSession,
    rule: WanAlertRule,
    value: float,
    severity: str,
):
    """Create or update a WAN alert event."""
    threshold = _breached_threshold(rule, severity)
    lookback_label = _format_lookback(rule.lookback_minutes)
    metric_label = METRIC_LABELS.get(rule.metric, rule.metric)
    value_str = _format_value(rule.metric, value)
    threshold_str = _format_value(rule.metric, threshold)

    message = (
        f"WAN Alert: {rule.name} | {metric_label} ({lookback_label}) = "
        f"{value_str} {rule.condition} {threshold_str}"
    )

    # Check for existing open/acknowledged event
    result = await db.execute(
        select(AlertEvent).where(and_(
            AlertEvent.wan_rule_id == rule.id,
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
        wan_rule_id=rule.id,
        severity=severity,
        status="open",
        message=message,
        metric_value=value,
        threshold_value=threshold,
    )
    db.add(event)
    await db.commit()

    logger.warning(f"WAN ALERT TRIGGERED [{severity.upper()}]: {message}")

    # Notifications
    if rule.notification_email:
        asyncio.create_task(_send_email(rule, event, message, severity))
    if rule.notification_webhook:
        asyncio.create_task(_send_webhook(rule, event, message, severity))


async def _resolve_events(
    db: AsyncSession,
    rule: WanAlertRule,
    severity: Optional[str] = None,
):
    """Auto-resolve open WAN alert events."""
    now = datetime.now(timezone.utc)
    filters = [
        AlertEvent.wan_rule_id == rule.id,
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


async def _send_webhook(rule: WanAlertRule, event: AlertEvent, message: str, severity: str):
    payload = {
        "alert_id": event.id,
        "rule_name": rule.name,
        "type": "wan_aggregate",
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
        logger.error(f"WAN alert webhook failed: {e}")


async def _send_email(rule: WanAlertRule, event: AlertEvent, message: str, severity: str):
    from app.database import AsyncSessionLocal
    from app.services.email_sender import send_email
    try:
        async with AsyncSessionLocal() as db:
            subject = f"[NetMon WAN Alert] {severity.upper()}: {rule.name}"
            body = f"""<h2>WAN Aggregate Alert Triggered</h2>
            <p><strong>Rule:</strong> {rule.name}</p>
            <p><strong>Severity:</strong> {severity}</p>
            <p><strong>Message:</strong> {message}</p>
            <p><strong>Value:</strong> {event.metric_value} (threshold: {event.threshold_value})</p>
            <p><strong>Time:</strong> {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}</p>"""
            await send_email(db, rule.notification_email, subject, body)
    except Exception as e:
        logger.error(f"WAN alert email failed: {e}")
