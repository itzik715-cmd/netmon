"""
PDU Power Management API
Endpoints for PDU dashboard, device metrics, outlets, rack detail, and outlet control.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, extract, text
from typing import Optional
from datetime import datetime, timedelta, timezone
from app.database import get_db
from app.models.pdu import PduMetric, PduOutlet
from app.models.device import Device, DeviceLocation
from app.models.alert import AlertEvent
from app.models.user import User
from app.middleware.rbac import get_current_user, require_admin
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pdu", tags=["PDU Power"])


def _time_since(hours: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=hours)


@router.get("/dashboard")
async def pdu_dashboard(
    hours: int = 1,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Aggregated power data for all PDUs, grouped by rack."""
    since = _time_since(hours)

    # 1. Get all PDU devices with their locations
    pdu_rows = (await db.execute(
        select(Device, DeviceLocation)
        .outerjoin(DeviceLocation, Device.location_id == DeviceLocation.id)
        .where(Device.device_type == "pdu", Device.is_active == True)  # noqa: E712
    )).all()

    if not pdu_rows:
        return {
            "total_power_watts": 0, "total_power_kw": 0, "total_energy_kwh": 0,
            "avg_load_pct": 0, "pdu_count": 0, "rack_count": 0, "alerts_active": 0,
            "racks": [], "timeline": [],
        }

    device_ids = [d.id for d, _ in pdu_rows]

    # 2. Get latest metric per PDU (subquery for max timestamp per device)
    latest_sub = (
        select(PduMetric.device_id, func.max(PduMetric.timestamp).label("max_ts"))
        .where(PduMetric.device_id.in_(device_ids))
        .group_by(PduMetric.device_id)
        .subquery()
    )
    latest_rows = (await db.execute(
        select(PduMetric)
        .join(latest_sub, (PduMetric.device_id == latest_sub.c.device_id) & (PduMetric.timestamp == latest_sub.c.max_ts))
    )).scalars().all()
    latest_by_device = {m.device_id: m for m in latest_rows}

    # 3. Aggregate totals
    total_watts = 0.0
    total_kwh = 0.0
    load_values = []

    # 4. Build rack structure
    racks_map: dict[int, dict] = {}
    for device, location in pdu_rows:
        loc_id = location.id if location else 0
        loc_name = location.name if location else "Unassigned"

        if loc_id not in racks_map:
            racks_map[loc_id] = {
                "location_id": loc_id,
                "location_name": loc_name,
                "total_watts": 0,
                "total_kw": 0,
                "avg_load_pct": 0,
                "temperature_c": None,
                "pdus": [],
                "_load_values": [],
            }

        m = latest_by_device.get(device.id)
        pdu_watts = m.power_watts if m and m.power_watts else 0
        pdu_load = m.load_pct if m and m.load_pct else 0
        pdu_temp = m.temperature_c if m else None

        racks_map[loc_id]["total_watts"] += pdu_watts
        racks_map[loc_id]["pdus"].append({
            "device_id": device.id,
            "hostname": device.hostname,
            "ip_address": device.ip_address,
            "power_watts": pdu_watts,
            "load_pct": pdu_load,
            "status": device.status or "unknown",
            "temperature_c": pdu_temp,
        })
        if pdu_load > 0:
            racks_map[loc_id]["_load_values"].append(pdu_load)

        total_watts += pdu_watts
        if m and m.energy_kwh:
            total_kwh += m.energy_kwh
        if pdu_load > 0:
            load_values.append(pdu_load)
        if pdu_temp is not None and racks_map[loc_id]["temperature_c"] is None:
            racks_map[loc_id]["temperature_c"] = pdu_temp

    # Finalize rack aggregates
    racks = []
    for rack in racks_map.values():
        rack["total_kw"] = round(rack["total_watts"] / 1000, 2)
        loads = rack.pop("_load_values")
        rack["avg_load_pct"] = round(sum(loads) / len(loads), 1) if loads else 0
        racks.append(rack)
    racks.sort(key=lambda r: r["location_name"])

    avg_load = round(sum(load_values) / len(load_values), 1) if load_values else 0

    # 5. Active PDU-related alerts count
    alerts_count = 0
    try:
        alerts_row = (await db.execute(
            select(func.count(AlertEvent.id))
            .where(
                AlertEvent.device_id.in_(device_ids),
                AlertEvent.status.in_(["open", "acknowledged"]),
            )
        )).scalar()
        alerts_count = int(alerts_row or 0)
    except Exception:
        pass

    # 6. Aggregate timeline: sum power_watts per time bucket
    if hours <= 6:
        bucket_seconds = 300
    elif hours <= 24:
        bucket_seconds = 900
    else:
        bucket_seconds = 3600

    epoch = extract("epoch", PduMetric.timestamp)
    bucket_ts = func.to_timestamp(func.floor(epoch / bucket_seconds) * bucket_seconds).label("bucket")

    tl_rows = (await db.execute(
        select(
            bucket_ts,
            func.sum(PduMetric.power_watts).label("total_watts"),
        )
        .where(PduMetric.device_id.in_(device_ids), PduMetric.timestamp >= since)
        .group_by("bucket")
        .order_by("bucket")
    )).all()

    timeline = [
        {
            "timestamp": r.bucket.isoformat() if hasattr(r.bucket, "isoformat") else str(r.bucket),
            "total_watts": round(float(r.total_watts or 0), 1),
        }
        for r in tl_rows
    ]

    return {
        "total_power_watts": round(total_watts, 1),
        "total_power_kw": round(total_watts / 1000, 2),
        "total_energy_kwh": round(total_kwh, 1),
        "avg_load_pct": avg_load,
        "pdu_count": len(device_ids),
        "rack_count": len(racks),
        "alerts_active": alerts_count,
        "racks": racks,
        "timeline": timeline,
    }


@router.get("/device/{device_id}/metrics")
async def pdu_device_metrics(
    device_id: int,
    hours: int = 24,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Time-series metrics for a specific PDU."""
    since = _time_since(hours)

    # Verify device exists and is a PDU
    device = (await db.execute(
        select(Device).where(Device.id == device_id)
    )).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # Get latest metric
    latest = (await db.execute(
        select(PduMetric)
        .where(PduMetric.device_id == device_id)
        .order_by(PduMetric.timestamp.desc())
        .limit(1)
    )).scalar_one_or_none()

    # Get timeseries
    metrics = (await db.execute(
        select(PduMetric)
        .where(PduMetric.device_id == device_id, PduMetric.timestamp >= since)
        .order_by(PduMetric.timestamp)
    )).scalars().all()

    def _metric_dict(m: PduMetric) -> dict:
        return {
            "timestamp": m.timestamp.isoformat() if m.timestamp else None,
            "power_watts": m.power_watts,
            "energy_kwh": m.energy_kwh,
            "apparent_power_va": m.apparent_power_va,
            "power_factor": m.power_factor,
            "phase1_current_amps": m.phase1_current_amps,
            "phase1_voltage_v": m.phase1_voltage_v,
            "phase1_power_watts": m.phase1_power_watts,
            "phase2_current_amps": m.phase2_current_amps,
            "phase2_voltage_v": m.phase2_voltage_v,
            "phase2_power_watts": m.phase2_power_watts,
            "phase3_current_amps": m.phase3_current_amps,
            "phase3_voltage_v": m.phase3_voltage_v,
            "phase3_power_watts": m.phase3_power_watts,
            "temperature_c": m.temperature_c,
            "humidity_pct": m.humidity_pct,
            "load_pct": m.load_pct,
            "rated_power_watts": m.rated_power_watts,
            "near_overload_watts": m.near_overload_watts,
            "overload_watts": m.overload_watts,
        }

    return {
        "device_id": device_id,
        "hostname": device.hostname,
        "latest": _metric_dict(latest) if latest else None,
        "timeseries": [_metric_dict(m) for m in metrics],
    }


@router.get("/device/{device_id}/outlets")
async def pdu_outlets(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Current outlet states for a specific PDU."""
    outlets = (await db.execute(
        select(PduOutlet)
        .where(PduOutlet.device_id == device_id)
        .order_by(PduOutlet.outlet_number)
    )).scalars().all()

    return [
        {
            "outlet_number": o.outlet_number,
            "name": o.name,
            "state": o.state,
            "current_amps": o.current_amps,
            "power_watts": o.power_watts,
        }
        for o in outlets
    ]


@router.get("/rack/{location_id}")
async def pdu_rack_detail(
    location_id: int,
    hours: int = 24,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Detailed power data for all PDUs in a rack."""
    since = _time_since(hours)

    # Get location
    location = (await db.execute(
        select(DeviceLocation).where(DeviceLocation.id == location_id)
    )).scalar_one_or_none()
    loc_name = location.name if location else "Unknown"

    # Get PDU devices at this location
    devices = (await db.execute(
        select(Device)
        .where(Device.location_id == location_id, Device.device_type == "pdu", Device.is_active == True)  # noqa: E712
    )).scalars().all()

    total_watts = 0.0
    pdus = []

    for device in devices:
        # Latest metric
        latest = (await db.execute(
            select(PduMetric)
            .where(PduMetric.device_id == device.id)
            .order_by(PduMetric.timestamp.desc())
            .limit(1)
        )).scalar_one_or_none()

        # Timeseries
        ts_rows = (await db.execute(
            select(PduMetric)
            .where(PduMetric.device_id == device.id, PduMetric.timestamp >= since)
            .order_by(PduMetric.timestamp)
        )).scalars().all()

        # Outlets
        outlets = (await db.execute(
            select(PduOutlet)
            .where(PduOutlet.device_id == device.id)
            .order_by(PduOutlet.outlet_number)
        )).scalars().all()

        pdu_watts = latest.power_watts if latest and latest.power_watts else 0
        total_watts += pdu_watts

        def _ts_dict(m: PduMetric) -> dict:
            return {
                "timestamp": m.timestamp.isoformat() if m.timestamp else None,
                "power_watts": m.power_watts,
                "energy_kwh": m.energy_kwh,
                "phase1_current_amps": m.phase1_current_amps,
                "phase1_voltage_v": m.phase1_voltage_v,
                "phase2_current_amps": m.phase2_current_amps,
                "phase2_voltage_v": m.phase2_voltage_v,
                "phase3_current_amps": m.phase3_current_amps,
                "phase3_voltage_v": m.phase3_voltage_v,
                "temperature_c": m.temperature_c,
                "load_pct": m.load_pct,
            }

        pdus.append({
            "device_id": device.id,
            "hostname": device.hostname,
            "ip_address": device.ip_address,
            "latest": _ts_dict(latest) if latest else None,
            "timeseries": [_ts_dict(m) for m in ts_rows],
            "outlets": [
                {
                    "outlet_number": o.outlet_number,
                    "name": o.name,
                    "state": o.state,
                    "current_amps": o.current_amps,
                    "power_watts": o.power_watts,
                }
                for o in outlets
            ],
        })

    return {
        "location_id": location_id,
        "location_name": loc_name,
        "total_watts": round(total_watts, 1),
        "total_kw": round(total_watts / 1000, 2),
        "pdus": pdus,
    }


@router.post("/device/{device_id}/outlet/{outlet_number}/toggle")
async def toggle_outlet(
    device_id: int,
    outlet_number: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin()),
):
    """Toggle a PDU outlet on/off via SNMP SET. Admin only."""
    # 1. Get device
    device = (await db.execute(
        select(Device).where(Device.id == device_id)
    )).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # 2. Get current outlet state
    outlet = (await db.execute(
        select(PduOutlet)
        .where(PduOutlet.device_id == device_id, PduOutlet.outlet_number == outlet_number)
    )).scalar_one_or_none()
    if not outlet:
        raise HTTPException(status_code=404, detail="Outlet not found")

    # 3. Determine new state
    current_state = outlet.state
    if current_state == "on":
        new_cmd = 2   # off
        new_state = "off"
    else:
        new_cmd = 1   # on
        new_state = "on"

    # 4. SNMP SET
    from app.services.pdu_poller import snmp_set_pdu, OID_PDU2_OUTLET_STATE
    oid = f"{OID_PDU2_OUTLET_STATE}.{outlet_number}"
    success = await snmp_set_pdu(device, oid, Integer32(new_cmd))

    if not success:
        raise HTTPException(status_code=500, detail="SNMP SET failed — outlet may not be switched")

    # 5. Update DB
    outlet.state = new_state
    await db.flush()

    return {"success": True, "outlet_number": outlet_number, "new_state": new_state}
