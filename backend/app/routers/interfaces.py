from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from collections import defaultdict
import math
from app.database import get_db
from app.models.interface import Interface, InterfaceMetric
from app.models.device import Device
from app.models.settings import SystemSetting
from app.models.port_state import PortStateChange
from app.middleware.rbac import get_current_user
from app.schemas.interface import InterfaceResponse, InterfaceMetricResponse
from app.models.user import User

router = APIRouter(prefix="/api/interfaces", tags=["Interfaces"])


@router.get("/device/{device_id}", response_model=List[InterfaceResponse])
async def get_device_interfaces(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Interface).where(Interface.device_id == device_id)
    )
    return result.scalars().all()


@router.get("/device/{device_id}/utilization")
async def get_device_interfaces_utilization(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return the latest utilization for every interface of a device."""
    # Subquery: latest metric timestamp per interface
    latest_ts = (
        select(
            InterfaceMetric.interface_id,
            sqlfunc.max(InterfaceMetric.timestamp).label("max_ts"),
        )
        .join(Interface, Interface.id == InterfaceMetric.interface_id)
        .where(Interface.device_id == device_id)
        .group_by(InterfaceMetric.interface_id)
        .subquery()
    )
    # Join back to get the full metric row
    result = await db.execute(
        select(InterfaceMetric)
        .join(
            latest_ts,
            (InterfaceMetric.interface_id == latest_ts.c.interface_id)
            & (InterfaceMetric.timestamp == latest_ts.c.max_ts),
        )
    )
    metrics = result.scalars().all()
    return {
        m.interface_id: {
            "utilization_in": round(m.utilization_in or 0, 2),
            "utilization_out": round(m.utilization_out or 0, 2),
            "in_bps": m.in_bps or 0,
            "out_bps": m.out_bps or 0,
        }
        for m in metrics
    }


@router.get("/wan/list")
async def get_wan_interfaces(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List all interfaces marked as WAN, enriched with device hostname."""
    result = await db.execute(
        select(Interface).where(Interface.is_wan == True)
    )
    interfaces = result.scalars().all()
    device_ids = {i.device_id for i in interfaces}
    device_map: dict[int, str] = {}
    if device_ids:
        dev_result = await db.execute(select(Device).where(Device.id.in_(device_ids)))
        device_map = {d.id: d.hostname for d in dev_result.scalars().all()}

    # Fetch latest metric per WAN interface for utilization
    iface_ids = [i.id for i in interfaces]
    util_map: dict[int, dict] = {}
    if iface_ids:
        # Subquery: max timestamp per interface
        latest_ts = (
            select(
                InterfaceMetric.interface_id,
                sqlfunc.max(InterfaceMetric.timestamp).label("max_ts"),
            )
            .where(InterfaceMetric.interface_id.in_(iface_ids))
            .group_by(InterfaceMetric.interface_id)
            .subquery()
        )
        latest_rows = (await db.execute(
            select(InterfaceMetric)
            .join(latest_ts, (InterfaceMetric.interface_id == latest_ts.c.interface_id) & (InterfaceMetric.timestamp == latest_ts.c.max_ts))
        )).scalars().all()
        for m in latest_rows:
            util_map[m.interface_id] = {
                "utilization_in": m.utilization_in,
                "utilization_out": m.utilization_out,
                "in_bps": m.in_bps,
                "out_bps": m.out_bps,
            }

    return [
        {
            "id": i.id,
            "device_id": i.device_id,
            "device_hostname": device_map.get(i.device_id),
            "name": i.name,
            "alias": i.alias,
            "speed": i.speed,
            "admin_status": i.admin_status,
            "oper_status": i.oper_status,
            "is_wan": i.is_wan,
            "utilization_in": util_map.get(i.id, {}).get("utilization_in", 0),
            "utilization_out": util_map.get(i.id, {}).get("utilization_out", 0),
            "in_bps": util_map.get(i.id, {}).get("in_bps", 0),
            "out_bps": util_map.get(i.id, {}).get("out_bps", 0),
        }
        for i in interfaces
    ]


@router.get("/wan/metrics")
async def get_wan_metrics(
    hours: int = 24,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Aggregate metrics for all WAN interfaces.
    Returns time-series of combined in/out bps and 95th percentile values.
    """
    # Get WAN interface IDs and total speed
    result = await db.execute(
        select(Interface.id, Interface.speed).where(Interface.is_wan == True)
    )
    wan_ifaces = result.all()
    if not wan_ifaces:
        return {"timeseries": [], "p95_in_bps": 0, "p95_out_bps": 0, "total_speed_bps": 0, "wan_count": 0}

    wan_ids = [row[0] for row in wan_ifaces]
    total_speed = sum((row[1] or 0) for row in wan_ifaces)

    # Build time filter
    if start:
        since = datetime.fromisoformat(start)
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        until = None
        if end:
            until = datetime.fromisoformat(end)
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
    else:
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        until = None

    time_where = [InterfaceMetric.interface_id.in_(wan_ids), InterfaceMetric.timestamp >= since]
    if until:
        time_where.append(InterfaceMetric.timestamp <= until)
    result = await db.execute(
        select(InterfaceMetric)
        .where(*time_where)
        .order_by(InterfaceMetric.timestamp.asc())
    )
    metrics = result.scalars().all()

    # Bucket metrics by timestamp (rounded to nearest minute)
    buckets: dict[str, dict] = defaultdict(lambda: {"in_bps": 0.0, "out_bps": 0.0})
    for m in metrics:
        # Round to minute for aggregation
        ts = m.timestamp.replace(second=0, microsecond=0).isoformat()
        buckets[ts]["in_bps"] += m.in_bps or 0
        buckets[ts]["out_bps"] += m.out_bps or 0

    timeseries = []
    all_in = []
    all_out = []
    for ts in sorted(buckets.keys()):
        b = buckets[ts]
        in_bps = b["in_bps"]
        out_bps = b["out_bps"]
        util_in = (in_bps / total_speed * 100) if total_speed > 0 else 0
        util_out = (out_bps / total_speed * 100) if total_speed > 0 else 0
        timeseries.append({
            "timestamp": ts,
            "in_bps": round(in_bps, 2),
            "out_bps": round(out_bps, 2),
            "utilization_in": round(util_in, 2),
            "utilization_out": round(util_out, 2),
        })
        all_in.append(in_bps)
        all_out.append(out_bps)

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

    p95_in = percentile_95(all_in)
    p95_out = percentile_95(all_out)

    # Fetch commitment_bps from settings
    commitment_bps = None
    setting_result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "wan_commitment_bps")
    )
    setting = setting_result.scalar_one_or_none()
    if setting and setting.value:
        try:
            commitment_bps = float(setting.value)
        except (ValueError, TypeError):
            pass

    return {
        "timeseries": timeseries,
        "p95_in_bps": round(p95_in, 2),
        "p95_out_bps": round(p95_out, 2),
        "total_speed_bps": total_speed,
        "wan_count": len(wan_ids),
        "commitment_bps": commitment_bps,
    }


@router.get("/device/{device_id}/port-summary")
async def get_port_summary(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Return per-interface summary for a device's ports:
    latest bps, utilization, error/discard deltas (current - previous),
    oper_status, last_change.  Used by the enhanced Ports tab.
    """
    # Get all interfaces for this device
    ifaces = (await db.execute(
        select(Interface).where(Interface.device_id == device_id)
    )).scalars().all()
    if not ifaces:
        return []

    iface_ids = [i.id for i in ifaces]

    # Flap detection: count state changes per interface in last 10 minutes
    flap_cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
    flap_q = (await db.execute(
        select(
            PortStateChange.interface_id,
            sqlfunc.count(PortStateChange.id).label("flap_count"),
        )
        .where(
            PortStateChange.interface_id.in_(iface_ids),
            PortStateChange.changed_at >= flap_cutoff,
        )
        .group_by(PortStateChange.interface_id)
    )).all()
    flap_map = {r.interface_id: r.flap_count for r in flap_q}

    # Get latest 2 metrics per interface using a window function
    from sqlalchemy import text
    # Use raw SQL for the window function — cleaner than SQLAlchemy for ROW_NUMBER
    sql = text("""
        SELECT * FROM (
            SELECT
                interface_id, timestamp,
                in_bps, out_bps,
                utilization_in, utilization_out,
                in_errors, out_errors,
                in_discards, out_discards,
                in_octets, out_octets,
                oper_status,
                ROW_NUMBER() OVER (PARTITION BY interface_id ORDER BY timestamp DESC) as rn
            FROM interface_metrics
            WHERE interface_id = ANY(:ids)
              AND timestamp > NOW() - interval '1 hour'
        ) sub WHERE rn <= 2
    """)
    rows = (await db.execute(sql, {"ids": iface_ids})).mappings().all()

    # Group by interface_id: latest and previous
    by_iface: dict[int, list] = {}
    for r in rows:
        by_iface.setdefault(r["interface_id"], []).append(r)

    iface_map = {i.id: i for i in ifaces}
    result = []

    for iface in ifaces:
        metrics = by_iface.get(iface.id, [])
        # Sort by rn to ensure order (rn=1 is latest)
        metrics.sort(key=lambda r: r["rn"])
        latest = metrics[0] if len(metrics) >= 1 else None
        prev = metrics[1] if len(metrics) >= 2 else None

        # Compute deltas (current counter - previous counter)
        def delta(curr, prev_val):
            if curr is None or prev_val is None:
                return 0
            d = curr - prev_val
            return max(0, d)  # handle counter wraps gracefully

        err_in_delta = delta(latest["in_errors"], prev["in_errors"]) if latest and prev else 0
        err_out_delta = delta(latest["out_errors"], prev["out_errors"]) if latest and prev else 0
        disc_in_delta = delta(latest["in_discards"], prev["in_discards"]) if latest and prev else 0
        disc_out_delta = delta(latest["out_discards"], prev["out_discards"]) if latest and prev else 0

        result.append({
            "interface_id": iface.id,
            "name": iface.name,
            "alias": iface.alias,
            "if_index": iface.if_index,
            "speed": iface.speed,
            "admin_status": iface.admin_status,
            "oper_status": latest["oper_status"] if latest else iface.oper_status,
            "duplex": iface.duplex,
            "vlan_id": iface.vlan_id,
            "ip_address": iface.ip_address,
            "mac_address": iface.mac_address,
            "is_uplink": iface.is_uplink,
            "is_monitored": iface.is_monitored,
            "last_change": iface.last_change.isoformat() if iface.last_change else None,
            "in_bps": latest["in_bps"] or 0 if latest else 0,
            "out_bps": latest["out_bps"] or 0 if latest else 0,
            "utilization_in": round(latest["utilization_in"] or 0, 2) if latest else 0,
            "utilization_out": round(latest["utilization_out"] or 0, 2) if latest else 0,
            "in_errors_delta": err_in_delta,
            "out_errors_delta": err_out_delta,
            "in_discards_delta": disc_in_delta,
            "out_discards_delta": disc_out_delta,
            "in_errors_total": latest["in_errors"] or 0 if latest else 0,
            "out_errors_total": latest["out_errors"] or 0 if latest else 0,
            "in_discards_total": latest["in_discards"] or 0 if latest else 0,
            "out_discards_total": latest["out_discards"] or 0 if latest else 0,
            "in_broadcast_pps": round(latest.get("in_broadcast_pps") or 0, 1) if latest else 0,
            "in_multicast_pps": round(latest.get("in_multicast_pps") or 0, 1) if latest else 0,
            "flap_count": flap_map.get(iface.id, 0),
            "is_flapping": flap_map.get(iface.id, 0) > 5,
        })

    return result


@router.get("/{interface_id}", response_model=InterfaceResponse)
async def get_interface(
    interface_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Interface).where(Interface.id == interface_id))
    iface = result.scalar_one_or_none()
    if not iface:
        raise HTTPException(status_code=404, detail="Interface not found")
    return iface


@router.get("/{interface_id}/metrics", response_model=List[InterfaceMetricResponse])
async def get_interface_metrics(
    interface_id: int,
    hours: int = 24,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get historical metrics for an interface (default last 24h)."""
    if start:
        since = datetime.fromisoformat(start)
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
    else:
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
    time_where = [InterfaceMetric.interface_id == interface_id, InterfaceMetric.timestamp >= since]
    if start and end:
        until = datetime.fromisoformat(end)
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        time_where.append(InterfaceMetric.timestamp <= until)
    result = await db.execute(
        select(InterfaceMetric)
        .where(*time_where)
        .order_by(InterfaceMetric.timestamp.asc())
        .limit(2000)
    )
    return result.scalars().all()


@router.get("/{interface_id}/latest")
async def get_interface_latest(
    interface_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get the most recent metric for an interface."""
    result = await db.execute(
        select(InterfaceMetric)
        .where(InterfaceMetric.interface_id == interface_id)
        .order_by(InterfaceMetric.timestamp.desc())
        .limit(1)
    )
    metric = result.scalar_one_or_none()
    if not metric:
        return None
    return InterfaceMetricResponse.model_validate(metric)


@router.patch("/{interface_id}/toggle-monitor")
async def toggle_monitoring(
    interface_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Interface).where(Interface.id == interface_id))
    iface = result.scalar_one_or_none()
    if not iface:
        raise HTTPException(status_code=404, detail="Interface not found")

    iface.is_monitored = not iface.is_monitored
    await db.commit()
    return {"interface_id": interface_id, "is_monitored": iface.is_monitored}


@router.patch("/{interface_id}/toggle-wan")
async def toggle_wan(
    interface_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Interface).where(Interface.id == interface_id))
    iface = result.scalar_one_or_none()
    if not iface:
        raise HTTPException(status_code=404, detail="Interface not found")

    iface.is_wan = not iface.is_wan
    await db.commit()
    return {"interface_id": interface_id, "is_wan": iface.is_wan}


@router.get("/{interface_id}/forecast")
async def get_forecast(
    interface_id: int,
    days_history: int = Query(90, ge=7, le=365),
    forecast_days: int = Query(90, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Forecast bandwidth utilization using linear regression on daily peaks.
    Returns historical daily peaks, trend line, projections, and days until 80%.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_history)

    # Get all metrics for this interface over the history period
    result = await db.execute(
        select(InterfaceMetric.timestamp, InterfaceMetric.utilization_in, InterfaceMetric.utilization_out)
        .where(
            InterfaceMetric.interface_id == interface_id,
            InterfaceMetric.timestamp >= cutoff,
        )
        .order_by(InterfaceMetric.timestamp)
    )
    metrics = result.all()

    if len(metrics) < 10:
        return {"error": "Insufficient data for forecasting", "data_points": len(metrics)}

    # Downsample to daily peaks
    daily_peaks: dict[str, dict] = {}
    for ts, util_in, util_out in metrics:
        day = ts.strftime("%Y-%m-%d")
        if day not in daily_peaks:
            daily_peaks[day] = {"in": 0, "out": 0}
        daily_peaks[day]["in"] = max(daily_peaks[day]["in"], util_in or 0)
        daily_peaks[day]["out"] = max(daily_peaks[day]["out"], util_out or 0)

    if len(daily_peaks) < 3:
        return {"error": "Insufficient daily data for forecasting", "data_points": len(daily_peaks)}

    # Sort by date and assign day numbers (0, 1, 2, ...)
    sorted_days = sorted(daily_peaks.keys())
    base_date = datetime.strptime(sorted_days[0], "%Y-%m-%d")
    x_vals = [(datetime.strptime(d, "%Y-%m-%d") - base_date).days for d in sorted_days]
    y_in = [daily_peaks[d]["in"] for d in sorted_days]
    y_out = [daily_peaks[d]["out"] for d in sorted_days]

    # Pure Python linear regression: y = slope * x + intercept
    def linear_regression(x: list, y: list):
        n = len(x)
        if n == 0:
            return 0, 0, 0
        sum_x = sum(x)
        sum_y = sum(y)
        sum_xy = sum(xi * yi for xi, yi in zip(x, y))
        sum_x2 = sum(xi ** 2 for xi in x)
        denom = n * sum_x2 - sum_x ** 2
        if denom == 0:
            return 0, sum_y / n if n else 0, 0
        slope = (n * sum_xy - sum_x * sum_y) / denom
        intercept = (sum_y - slope * sum_x) / n

        # R-squared
        y_mean = sum_y / n
        ss_tot = sum((yi - y_mean) ** 2 for yi in y)
        ss_res = sum((yi - (slope * xi + intercept)) ** 2 for xi, yi in zip(x, y))
        r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0

        return slope, intercept, r_squared

    slope_in, intercept_in, r2_in = linear_regression(x_vals, y_in)
    slope_out, intercept_out, r2_out = linear_regression(x_vals, y_out)

    # Project at +30, +60, +90 days from last data point
    last_x = x_vals[-1]
    projections = {}
    for delta in [30, 60, 90]:
        proj_x = last_x + delta
        projections[f"+{delta}d"] = {
            "utilization_in": round(max(0, min(100, slope_in * proj_x + intercept_in)), 1),
            "utilization_out": round(max(0, min(100, slope_out * proj_x + intercept_out)), 1),
        }

    # Days until 80% utilization
    def days_until_threshold(slope, intercept, threshold=80.0):
        if slope <= 0:
            return None
        x_target = (threshold - intercept) / slope
        days_from_last = x_target - last_x
        return max(0, round(days_from_last))

    days_until_80_in = days_until_threshold(slope_in, intercept_in)
    days_until_80_out = days_until_threshold(slope_out, intercept_out)

    # Build historical daily array
    historical = [
        {
            "date": d,
            "peak_in": round(daily_peaks[d]["in"], 1),
            "peak_out": round(daily_peaks[d]["out"], 1),
            "trend_in": round(max(0, slope_in * x + intercept_in), 1),
            "trend_out": round(max(0, slope_out * x + intercept_out), 1),
        }
        for d, x in zip(sorted_days, x_vals)
    ]

    return {
        "historical_daily": historical,
        "trend": {
            "in": {"slope": round(slope_in, 4), "intercept": round(intercept_in, 2)},
            "out": {"slope": round(slope_out, 4), "intercept": round(intercept_out, 2)},
        },
        "projections": projections,
        "days_until_80_in": days_until_80_in,
        "days_until_80_out": days_until_80_out,
        "r_squared": {"in": round(r2_in, 3), "out": round(r2_out, 3)},
        "data_points": len(daily_peaks),
    }


@router.get("/{interface_id}/state-history")
async def get_state_history(
    interface_id: int,
    hours: int = Query(24, ge=1, le=720),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return port state change history for flap detection timeline."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(PortStateChange)
        .where(
            PortStateChange.interface_id == interface_id,
            PortStateChange.changed_at >= cutoff,
        )
        .order_by(PortStateChange.changed_at.desc())
    )
    changes = result.scalars().all()
    return [
        {
            "id": c.id,
            "old_status": c.old_status,
            "new_status": c.new_status,
            "changed_at": c.changed_at.isoformat() if c.changed_at else None,
        }
        for c in changes
    ]
