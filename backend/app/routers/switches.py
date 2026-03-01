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
from app.models.environment import DeviceEnvironment, DeviceEnvMetric
from app.models.vlan import DeviceVlan
from app.models.ping import PingMetric
from app.models.mlag import MlagDomain, MlagInterface
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

    # Aggregate per device: total traffic, error port count, broadcast storm ports
    device_traffic: dict[int, float] = {}
    device_error_ports: dict[int, int] = {}
    device_bcast_storm_ports: dict[int, int] = {}
    for m in latest_metrics:
        did = iface_to_device.get(m.interface_id)
        if did is None:
            continue
        device_traffic[did] = device_traffic.get(did, 0) + (m.in_bps or 0) + (m.out_bps or 0)
        if (m.in_errors or 0) > 0 or (m.out_errors or 0) > 0:
            device_error_ports[did] = device_error_ports.get(did, 0) + 1
        bcast_pps = getattr(m, 'in_broadcast_pps', None) or 0
        if bcast_pps > 1000:
            device_bcast_storm_ports[did] = device_bcast_storm_ports.get(did, 0) + 1

    # 4. Max temperature per device
    temp_q = (await db.execute(
        select(
            DeviceEnvironment.device_id,
            sqlfunc.max(DeviceEnvironment.value).label("max_temp"),
        )
        .where(
            DeviceEnvironment.device_id.in_(device_ids),
            DeviceEnvironment.sensor_type == "temperature",
        )
        .group_by(DeviceEnvironment.device_id)
    )).all()
    device_max_temp = {r.device_id: r.max_temp for r in temp_q}

    # 5. Build response
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
            "max_temperature": round(device_max_temp[device.id], 1) if device.id in device_max_temp else None,
            "rtt_ms": round(device.rtt_ms, 1) if device.rtt_ms is not None else None,
            "packet_loss_pct": round(device.packet_loss_pct, 1) if device.packet_loss_pct is not None else None,
        })

    grand_bcast_storm = sum(device_bcast_storm_ports.values())

    return {
        "total": len(rows),
        "up": total_up,
        "down": total_down,
        "degraded": total_degraded,
        "total_ports": grand_total_ports,
        "error_ports": grand_error_ports,
        "broadcast_storm_ports": grand_bcast_storm,
        "avg_cpu": round(sum(cpu_vals) / len(cpu_vals), 1) if cpu_vals else 0,
        "avg_memory": round(sum(mem_vals) / len(mem_vals), 1) if mem_vals else 0,
        "switches": switches,
    }


@router.get("/{device_id}/environment")
async def get_environment(
    device_id: int,
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return current environment sensors + temperature time-series for a device."""
    # Current sensor states
    sensors_result = await db.execute(
        select(DeviceEnvironment)
        .where(DeviceEnvironment.device_id == device_id)
        .order_by(DeviceEnvironment.sensor_type, DeviceEnvironment.sensor_name)
    )
    sensors = sensors_result.scalars().all()

    # Temperature time-series
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    metrics_result = await db.execute(
        select(DeviceEnvMetric)
        .where(
            DeviceEnvMetric.device_id == device_id,
            DeviceEnvMetric.sensor_type == "temperature",
            DeviceEnvMetric.timestamp >= cutoff,
        )
        .order_by(DeviceEnvMetric.timestamp)
    )
    metrics = metrics_result.scalars().all()

    return {
        "sensors": [
            {
                "id": s.id,
                "sensor_name": s.sensor_name,
                "sensor_type": s.sensor_type,
                "value": s.value,
                "status": s.status,
                "unit": s.unit,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            }
            for s in sensors
        ],
        "metrics": [
            {
                "sensor_name": m.sensor_name,
                "value": m.value,
                "timestamp": m.timestamp.isoformat() if m.timestamp else None,
            }
            for m in metrics
        ],
    }


@router.get("/{device_id}/vlans")
async def get_vlans(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return discovered VLANs for a switch with MAC count per VLAN."""
    import json as _json

    vlans = (await db.execute(
        select(DeviceVlan)
        .where(DeviceVlan.device_id == device_id)
        .order_by(DeviceVlan.vlan_id)
    )).scalars().all()

    # Get MAC count per VLAN
    mac_counts = (await db.execute(
        select(
            MacAddressEntry.vlan_id,
            sqlfunc.count(MacAddressEntry.id).label("cnt"),
        )
        .where(
            MacAddressEntry.device_id == device_id,
            MacAddressEntry.vlan_id.isnot(None),
        )
        .group_by(MacAddressEntry.vlan_id)
    )).all()
    mac_count_map = {r.vlan_id: r.cnt for r in mac_counts}

    return [
        {
            "id": v.id,
            "vlan_id": v.vlan_id,
            "vlan_name": v.vlan_name,
            "status": v.status,
            "tagged_ports": _json.loads(v.tagged_ports) if v.tagged_ports else [],
            "untagged_ports": _json.loads(v.untagged_ports) if v.untagged_ports else [],
            "mac_count": mac_count_map.get(v.vlan_id, 0),
            "updated_at": v.updated_at.isoformat() if v.updated_at else None,
        }
        for v in vlans
    ]


@router.get("/{device_id}/mlag")
async def get_mlag(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return MLAG domain and interface info for a device."""
    domain = (await db.execute(
        select(MlagDomain).where(MlagDomain.device_id == device_id)
    )).scalar_one_or_none()

    if not domain:
        return {"domain": None, "interfaces": []}

    interfaces = (await db.execute(
        select(MlagInterface).where(MlagInterface.domain_id == domain.id)
    )).scalars().all()

    return {
        "domain": {
            "id": domain.id,
            "domain_id": domain.domain_id,
            "peer_address": domain.peer_address,
            "peer_link": domain.peer_link,
            "local_role": domain.local_role,
            "peer_status": domain.peer_status,
            "config_sanity": domain.config_sanity,
            "ports_configured": domain.ports_configured,
            "ports_active": domain.ports_active,
            "ports_errdisabled": domain.ports_errdisabled,
            "vendor_protocol": domain.vendor_protocol,
            "last_seen": domain.last_seen.isoformat() if domain.last_seen else None,
        },
        "interfaces": [
            {
                "id": i.id,
                "mlag_id": i.mlag_id,
                "interface_name": i.interface_name,
                "local_status": i.local_status,
                "remote_status": i.remote_status,
            }
            for i in interfaces
        ],
    }


@router.get("/{device_id}/ping-metrics")
async def get_ping_metrics(
    device_id: int,
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return ICMP ping time-series for a device."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(PingMetric)
        .where(PingMetric.device_id == device_id, PingMetric.timestamp >= cutoff)
        .order_by(PingMetric.timestamp)
    )
    metrics = result.scalars().all()
    return [
        {
            "timestamp": m.timestamp.isoformat() if m.timestamp else None,
            "rtt_avg_ms": m.rtt_avg_ms,
            "rtt_min_ms": m.rtt_min_ms,
            "rtt_max_ms": m.rtt_max_ms,
            "packet_loss_pct": m.packet_loss_pct,
            "status": m.status,
        }
        for m in metrics
    ]


@router.get("/{device_id}/mac-vendors")
async def get_mac_vendors(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return distinct vendor names for a device's MAC entries."""
    result = await db.execute(
        select(MacAddressEntry.vendor)
        .where(MacAddressEntry.device_id == device_id)
        .where(MacAddressEntry.vendor.isnot(None))
        .where(MacAddressEntry.vendor != "")
        .distinct()
        .order_by(MacAddressEntry.vendor)
    )
    return [row[0] for row in result.all()]


@router.get("/{device_id}/mac-table")
async def get_mac_table(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    q: Optional[str] = Query(None, description="Search MAC, IP, hostname, vendor"),
    vendor: Optional[str] = Query(None, description="Filter by vendor name"),
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
    if vendor:
        query = query.where(MacAddressEntry.vendor == vendor)
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
