from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from collections import defaultdict
import math
from app.database import get_db
from app.models.interface import Interface, InterfaceMetric
from app.models.device import Device
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

    return {
        "timeseries": timeseries,
        "p95_in_bps": round(p95_in, 2),
        "p95_out_bps": round(p95_out, 2),
        "total_speed_bps": total_speed,
        "wan_count": len(wan_ids),
    }


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
