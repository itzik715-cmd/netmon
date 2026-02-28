"""Switch monitoring dashboard & MAC/ARP table endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc, case, and_, literal_column, or_
from typing import Optional
from datetime import datetime, timedelta, timezone

from app.database import get_db
from app.models.device import Device, DeviceLocation
from app.models.interface import Interface, InterfaceMetric
from app.models.mac_entry import MacAddressEntry
from app.middleware.rbac import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/switches", tags=["Switches"])

# Device types considered "switch"
SWITCH_TYPES = (
    "spine", "leaf", "tor", "switch", "access", "distribution", "core", "router",
)


def _is_switch_filter():
    """SQLAlchemy filter for switch-type devices."""
    return Device.device_type.in_(SWITCH_TYPES)


@router.get("/dashboard")
async def switches_dashboard(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Return aggregated switch fleet data:
    - stat card counters (total, up, down, degraded, total ports, error ports, avg cpu/mem)
    - per-switch table rows with port counts and traffic
    """
    # 1. Get all switch devices with locations
    rows = (await db.execute(
        select(Device, DeviceLocation)
        .outerjoin(DeviceLocation, Device.location_id == DeviceLocation.id)
        .where(Device.is_active == True, _is_switch_filter())  # noqa: E712
        .order_by(Device.hostname)
    )).all()

    if not rows:
        return {
            "total": 0, "up": 0, "down": 0, "degraded": 0,
            "total_ports": 0, "error_ports": 0,
            "avg_cpu": 0, "avg_memory": 0,
            "switches": [],
        }

    device_ids = [d.id for d, _ in rows]

    # 2. Port counts per device: total, up, admin_down
    port_stats_q = (await db.execute(
        select(
            Interface.device_id,
            sqlfunc.count(Interface.id).label("total"),
            sqlfunc.sum(case((Interface.oper_status == "up", 1), else_=0)).label("up"),
            sqlfunc.sum(case((Interface.admin_status == "down", 1), else_=0)).label("admin_down"),
        )
        .where(Interface.device_id.in_(device_ids))
        .group_by(Interface.device_id)
    )).all()
    port_stats = {r.device_id: {"total": r.total, "up": r.up, "admin_down": r.admin_down} for r in port_stats_q}

    # 3. Latest metrics per interface (for traffic + errors)
    #    Subquery: max timestamp per interface for these devices
    iface_ids_sub = select(Interface.id).where(Interface.device_id.in_(device_ids)).subquery()
    latest_ts = (
        select(
            InterfaceMetric.interface_id,
            sqlfunc.max(InterfaceMetric.timestamp).label("max_ts"),
        )
        .where(InterfaceMetric.interface_id.in_(select(iface_ids_sub)))
        .group_by(InterfaceMetric.interface_id)
        .subquery()
    )
    latest_metrics = (await db.execute(
        select(InterfaceMetric)
        .join(latest_ts,
              (InterfaceMetric.interface_id == latest_ts.c.interface_id)
              & (InterfaceMetric.timestamp == latest_ts.c.max_ts))
    )).scalars().all()

    # Map interface_id → device_id
    iface_to_device = {}
    iface_rows = (await db.execute(
        select(Interface.id, Interface.device_id).where(Interface.device_id.in_(device_ids))
    )).all()
    for iid, did in iface_rows:
        iface_to_device[iid] = did

    # Aggregate per device: total traffic, error port count
    device_traffic: dict[int, float] = {}
    device_error_ports: dict[int, int] = {}
    for m in latest_metrics:
        did = iface_to_device.get(m.interface_id)
        if did is None:
            continue
        device_traffic[did] = device_traffic.get(did, 0) + (m.in_bps or 0) + (m.out_bps or 0)
        if (m.in_errors or 0) > 0 or (m.out_errors or 0) > 0:
            device_error_ports[did] = device_error_ports.get(did, 0) + 1

    # 4. Build response
    switches = []
    total_up = total_down = total_degraded = 0
    cpu_vals = []
    mem_vals = []
    grand_total_ports = 0
    grand_error_ports = 0

    for device, location in rows:
        if device.status == "up":
            total_up += 1
        elif device.status == "down":
            total_down += 1
        elif device.status == "degraded":
            total_degraded += 1

        ps = port_stats.get(device.id, {"total": 0, "up": 0, "admin_down": 0})
        ep = device_error_ports.get(device.id, 0)
        grand_total_ports += ps["total"]
        grand_error_ports += ep

        if device.cpu_usage is not None:
            cpu_vals.append(device.cpu_usage)
        if device.memory_usage is not None:
            mem_vals.append(device.memory_usage)

        switches.append({
            "id": device.id,
            "hostname": device.hostname,
            "ip_address": device.ip_address,
            "device_type": device.device_type,
            "vendor": device.vendor,
            "model": device.model,
            "status": device.status or "unknown",
            "location": location.name if location else None,
            "uptime": device.uptime,
            "cpu_usage": round(device.cpu_usage, 1) if device.cpu_usage is not None else None,
            "memory_usage": round(device.memory_usage, 1) if device.memory_usage is not None else None,
            "ports_total": ps["total"],
            "ports_up": ps["up"],
            "ports_admin_down": ps["admin_down"],
            "error_ports": ep,
            "total_traffic_bps": round(device_traffic.get(device.id, 0), 0),
        })

    return {
        "total": len(rows),
        "up": total_up,
        "down": total_down,
        "degraded": total_degraded,
        "total_ports": grand_total_ports,
        "error_ports": grand_error_ports,
        "avg_cpu": round(sum(cpu_vals) / len(cpu_vals), 1) if cpu_vals else 0,
        "avg_memory": round(sum(mem_vals) / len(mem_vals), 1) if mem_vals else 0,
        "switches": switches,
    }


@router.get("/{device_id}/mac-table")
async def get_mac_table(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    q: Optional[str] = Query(None, description="Search MAC, IP, hostname, vendor"),
    vlan: Optional[int] = Query(None),
    interface_id: Optional[int] = Query(None),
    entry_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """List MAC address entries for a switch with optional filters."""
    query = (
        select(MacAddressEntry, Interface.name.label("interface_name"))
        .outerjoin(Interface, MacAddressEntry.interface_id == Interface.id)
        .where(MacAddressEntry.device_id == device_id)
    )

    if q:
        like = f"%{q}%"
        query = query.where(or_(
            MacAddressEntry.mac_address.ilike(like),
            MacAddressEntry.ip_address.ilike(like),
            MacAddressEntry.hostname.ilike(like),
            MacAddressEntry.vendor.ilike(like),
        ))
    if vlan is not None:
        query = query.where(MacAddressEntry.vlan_id == vlan)
    if interface_id is not None:
        query = query.where(MacAddressEntry.interface_id == interface_id)
    if entry_type:
        query = query.where(MacAddressEntry.entry_type == entry_type)

    # Get total count
    count_q = select(sqlfunc.count()).select_from(
        query.with_only_columns(MacAddressEntry.id).subquery()
    )
    total = (await db.execute(count_q)).scalar() or 0

    # Get paginated results
    rows = (await db.execute(
        query.order_by(MacAddressEntry.last_seen.desc())
        .limit(limit).offset(offset)
    )).all()

    entries = []
    for mac_entry, iface_name in rows:
        entries.append({
            "id": mac_entry.id,
            "mac_address": mac_entry.mac_address,
            "ip_address": mac_entry.ip_address,
            "hostname": mac_entry.hostname,
            "vendor": mac_entry.vendor,
            "interface_id": mac_entry.interface_id,
            "interface_name": iface_name,
            "vlan_id": mac_entry.vlan_id,
            "entry_type": mac_entry.entry_type,
            "first_seen": mac_entry.first_seen.isoformat() if mac_entry.first_seen else None,
            "last_seen": mac_entry.last_seen.isoformat() if mac_entry.last_seen else None,
        })

    return {"total": total, "entries": entries}


@router.get("/{device_id}/arp-table")
async def get_arp_table(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List ARP entries (MAC entries that have IP addresses) for a device."""
    rows = (await db.execute(
        select(MacAddressEntry, Interface.name.label("interface_name"))
        .outerjoin(Interface, MacAddressEntry.interface_id == Interface.id)
        .where(
            MacAddressEntry.device_id == device_id,
            MacAddressEntry.ip_address.isnot(None),
        )
        .order_by(MacAddressEntry.ip_address)
    )).all()

    return [
        {
            "mac_address": m.mac_address,
            "ip_address": m.ip_address,
            "hostname": m.hostname,
            "vendor": m.vendor,
            "interface_name": iface_name,
            "vlan_id": m.vlan_id,
            "last_seen": m.last_seen.isoformat() if m.last_seen else None,
        }
        for m, iface_name in rows
    ]


@router.post("/{device_id}/discover-mac")
async def trigger_mac_discovery(
    device_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Trigger immediate MAC table discovery for a device."""
    device = (await db.execute(
        select(Device).where(Device.id == device_id)
    )).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    from app.services.mac_discovery import discover_mac_table
    from app.database import AsyncSessionLocal

    async def _run_discovery():
        async with AsyncSessionLocal() as session:
            dev = (await session.execute(
                select(Device).where(Device.id == device_id)
            )).scalar_one_or_none()
            if dev:
                await discover_mac_table(dev, session)

    background_tasks.add_task(_run_discovery)
    return {"status": "discovery_started", "device_id": device_id}


@router.get("/mac-search")
async def mac_search(
    q: str = Query(..., min_length=2),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Search MAC/IP/hostname across ALL switches."""
    like = f"%{q}%"
    rows = (await db.execute(
        select(MacAddressEntry, Interface.name.label("interface_name"), Device.hostname.label("switch_hostname"))
        .outerjoin(Interface, MacAddressEntry.interface_id == Interface.id)
        .join(Device, MacAddressEntry.device_id == Device.id)
        .where(or_(
            MacAddressEntry.mac_address.ilike(like),
            MacAddressEntry.ip_address.ilike(like),
            MacAddressEntry.hostname.ilike(like),
        ))
        .order_by(MacAddressEntry.last_seen.desc())
        .limit(50)
    )).all()

    return [
        {
            "mac_address": m.mac_address,
            "ip_address": m.ip_address,
            "hostname": m.hostname,
            "vendor": m.vendor,
            "switch_id": m.device_id,
            "switch_hostname": switch_hostname,
            "interface_name": iface_name,
            "vlan_id": m.vlan_id,
            "entry_type": m.entry_type,
            "last_seen": m.last_seen.isoformat() if m.last_seen else None,
        }
        for m, iface_name, switch_hostname in rows
    ]
