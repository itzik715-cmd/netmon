"""
Topology API — returns network nodes and edges for the topology map.
Also exposes LLDP discovery endpoint and device metric history.
"""
from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List

from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models.device import Device, DeviceLink, DeviceMetricHistory, DeviceLocation
from app.models.interface import Interface
from app.models.rack_item import RackItem
from app.middleware.rbac import get_current_user, require_operator_or_above
from app.models.user import User

router = APIRouter(prefix="/api/topology", tags=["Topology"])


@router.get("/")
async def get_topology(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Return network topology as {nodes, edges}.
    Nodes = active devices, edges = DeviceLink records (LLDP/manual).
    """
    dev_result = await db.execute(
        select(Device).where(Device.is_active == True)
    )
    devices = dev_result.scalars().all()

    # Preload locations
    loc_result = await db.execute(select(DeviceLocation))
    loc_map: dict[int, DeviceLocation] = {loc.id: loc for loc in loc_result.scalars().all()}

    # Interface count per device
    iface_counts: dict[int, int] = {}
    for device in devices:
        cnt = await db.execute(
            select(func.count(Interface.id)).where(Interface.device_id == device.id)
        )
        iface_counts[device.id] = cnt.scalar() or 0

    nodes = []
    for d in devices:
        loc = loc_map.get(d.location_id) if d.location_id else None
        nodes.append({
            "id": d.id,
            "hostname": d.hostname,
            "ip_address": d.ip_address,
            "device_type": d.device_type or "unknown",
            "layer": d.layer,
            "vendor": d.vendor,
            "status": d.status,
            "location_id": d.location_id,
            "location_name": loc.name if loc else None,
            "datacenter": loc.datacenter if loc else None,
            "rack": loc.rack if loc else None,
            "cpu_usage": d.cpu_usage,
            "memory_usage": d.memory_usage,
            "interface_count": iface_counts.get(d.id, 0),
            "last_seen": d.last_seen.isoformat() if d.last_seen else None,
        })

    link_result = await db.execute(select(DeviceLink))
    links = link_result.scalars().all()

    device_ids = {d.id for d in devices}
    edges = [
        {
            "id": lnk.id,
            "source": lnk.source_device_id,
            "target": lnk.target_device_id,
            "source_if": lnk.source_if,
            "target_if": lnk.target_if,
            "link_type": lnk.link_type,
        }
        for lnk in links
        if lnk.source_device_id in device_ids and lnk.target_device_id in device_ids
    ]

    return {"nodes": nodes, "edges": edges}


@router.post("/discover")
async def discover_all_lldp(
    background_tasks: BackgroundTasks,
    _: User = Depends(require_operator_or_above),
):
    """Trigger LLDP discovery on all active devices (background)."""
    background_tasks.add_task(_run_lldp_discovery_all)
    return {"message": "LLDP discovery started for all active devices"}


async def _run_lldp_discovery_all():
    from app.database import AsyncSessionLocal
    from app.services.snmp_poller import discover_lldp_neighbors
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Device).where(Device.is_active == True, Device.polling_enabled == True)
        )
        devices = result.scalars().all()
        for device in devices:
            try:
                await discover_lldp_neighbors(device, db)
            except Exception:
                pass


@router.post("/link")
async def add_manual_link(
    source_id: int,
    target_id: int,
    source_if: str = "",
    target_if: str = "",
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    """Add a manual link between two devices."""
    db.add(DeviceLink(
        source_device_id=source_id,
        target_device_id=target_id,
        source_if=source_if or None,
        target_if=target_if or None,
        link_type="manual",
    ))
    await db.commit()
    return {"message": "Link added"}


@router.delete("/link/{link_id}", status_code=204)
async def delete_link(
    link_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    """Remove a topology link."""
    result = await db.execute(select(DeviceLink).where(DeviceLink.id == link_id))
    link = result.scalar_one_or_none()
    if link:
        await db.delete(link)
        await db.commit()


# ─── Device metric history ────────────────────────────────────────────────────

@router.get("/device/{device_id}/metrics")
async def get_device_metrics(
    device_id: int,
    hours: int = 24,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return CPU/memory history for a device over the last N hours."""
    from datetime import datetime, timezone, timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(DeviceMetricHistory)
        .where(
            DeviceMetricHistory.device_id == device_id,
            DeviceMetricHistory.timestamp >= cutoff,
        )
        .order_by(DeviceMetricHistory.timestamp.asc())
    )
    rows = result.scalars().all()
    return [
        {
            "timestamp": r.timestamp.isoformat(),
            "cpu_usage": r.cpu_usage,
            "memory_usage": r.memory_usage,
            "uptime": r.uptime,
        }
        for r in rows
    ]


# ─── Rack Store Items ─────────────────────────────────────────────────────────

class RackItemCreate(BaseModel):
    rack_location: str
    item_type: str
    label: str
    u_slot: int
    u_size: int = 1
    color: Optional[str] = None

class RackItemUpdate(BaseModel):
    label: Optional[str] = None
    u_slot: Optional[int] = None
    color: Optional[str] = None


@router.get("/rack-items")
async def list_rack_items(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(RackItem).order_by(RackItem.rack_location, RackItem.u_slot))
    items = result.scalars().all()
    return [
        {
            "id": i.id,
            "rack_location": i.rack_location,
            "item_type": i.item_type,
            "label": i.label,
            "u_slot": i.u_slot,
            "u_size": i.u_size,
            "color": i.color,
        }
        for i in items
    ]


@router.post("/rack-items", status_code=201)
async def create_rack_item(
    payload: RackItemCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above()),
):
    item = RackItem(
        rack_location=payload.rack_location,
        item_type=payload.item_type,
        label=payload.label,
        u_slot=payload.u_slot,
        u_size=payload.u_size,
        color=payload.color,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return {
        "id": item.id,
        "rack_location": item.rack_location,
        "item_type": item.item_type,
        "label": item.label,
        "u_slot": item.u_slot,
        "u_size": item.u_size,
        "color": item.color,
    }


@router.put("/rack-items/{item_id}")
async def update_rack_item(
    item_id: int,
    payload: RackItemUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above()),
):
    result = await db.execute(select(RackItem).where(RackItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Item not found")
    if payload.label is not None:
        item.label = payload.label
    if payload.u_slot is not None:
        item.u_slot = payload.u_slot
    if payload.color is not None:
        item.color = payload.color
    await db.commit()
    return {
        "id": item.id,
        "rack_location": item.rack_location,
        "item_type": item.item_type,
        "label": item.label,
        "u_slot": item.u_slot,
        "u_size": item.u_size,
        "color": item.color,
    }


@router.delete("/rack-items/{item_id}", status_code=204)
async def delete_rack_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above()),
):
    result = await db.execute(select(RackItem).where(RackItem.id == item_id))
    item = result.scalar_one_or_none()
    if item:
        await db.delete(item)
        await db.commit()
