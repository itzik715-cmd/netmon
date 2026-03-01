"""
Subnet Scanner Service
Scans a CIDR subnet for SNMP-responsive devices and auto-adds them.
"""
import asyncio
import ipaddress
import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy import select

logger = logging.getLogger(__name__)


@dataclass
class _ProbeDevice:
    """Minimal device-like object for SNMP probing during subnet scans."""
    ip_address: str
    snmp_community: str
    snmp_version: str
    snmp_port: int
    snmp_v3_username: Optional[str] = None
    snmp_v3_auth_protocol: Optional[str] = None
    snmp_v3_auth_key: Optional[str] = None
    snmp_v3_priv_protocol: Optional[str] = None
    snmp_v3_priv_key: Optional[str] = None


async def _snmp_probe(ip: str, community: str, version: str, port: int) -> Optional[str]:
    """Quick SNMP GET for sysDescr; returns description string or None."""
    try:
        from pysnmp.hlapi.asyncio import (
            get_cmd, SnmpEngine, CommunityData, UdpTransportTarget,
            ContextData, ObjectType, ObjectIdentity,
        )
        engine = SnmpEngine()
        mp_model = 1 if version == "2c" else 0
        auth = CommunityData(community, mpModel=mp_model)
        transport = await UdpTransportTarget.create((ip, port), timeout=1, retries=0)
        error_indication, error_status, _, var_binds = await get_cmd(
            engine, auth, transport, ContextData(),
            ObjectType(ObjectIdentity("1.3.6.1.2.1.1.1.0")),  # sysDescr
        )
        if error_indication or error_status:
            return None
        return var_binds[0][1].prettyPrint() if var_binds else None
    except Exception:
        return None


async def scan_subnet(
    subnet: str,
    snmp_community: str,
    snmp_version: str,
    snmp_port: int,
    device_type: Optional[str],
    layer: Optional[str],
    location_id: Optional[int],
    session_factory: async_sessionmaker,
) -> Dict[str, Any]:
    """
    Scan all hosts in a CIDR subnet via SNMP.
    Creates new Device records for responsive hosts not yet in the DB.
    Triggers enrich + discover for each new device.
    """
    try:
        network = ipaddress.ip_network(subnet, strict=False)
    except ValueError as e:
        return {"error": str(e), "subnet": subnet, "total_hosts": 0,
                "responsive": 0, "new_devices": 0, "existing_devices": 0, "ips_found": []}

    hosts = list(network.hosts())
    if not hosts:
        return {"subnet": subnet, "total_hosts": 0, "responsive": 0,
                "new_devices": 0, "existing_devices": 0, "ips_found": []}

    semaphore = asyncio.Semaphore(50)
    responsive: List[str] = []

    async def probe(ip: str):
        async with semaphore:
            result = await _snmp_probe(ip, snmp_community, snmp_version, snmp_port)
            if result is not None:
                responsive.append(ip)

    await asyncio.gather(*[probe(str(h)) for h in hosts], return_exceptions=True)

    if not responsive:
        return {"subnet": subnet, "total_hosts": len(hosts),
                "responsive": 0, "new_devices": 0, "existing_devices": 0, "ips_found": []}

    new_devices = 0
    existing_devices = 0

    from app.models.device import Device
    from app.models.owned_subnet import OwnedSubnet

    # Auto-register scanned subnet as owned so flow analysis works on fresh installs
    cidr = str(ipaddress.ip_network(subnet, strict=False))
    async with session_factory() as db:
        existing_subnet = await db.execute(
            select(OwnedSubnet).where(OwnedSubnet.subnet == cidr)
        )
        if not existing_subnet.scalar_one_or_none():
            db.add(OwnedSubnet(
                subnet=cidr, source="learned",
                is_active=True, note="Auto-added from subnet scan",
            ))
            await db.commit()
            logger.info("Auto-registered owned subnet %s from scan", cidr)

    async with session_factory() as db:
        for ip in responsive:
            existing = await db.execute(select(Device).where(Device.ip_address == ip))
            if existing.scalar_one_or_none():
                existing_devices += 1
                continue

            device = Device(
                hostname=ip,   # will be updated by enrich_device_info via sysName
                ip_address=ip,
                snmp_community=snmp_community,
                snmp_version=snmp_version,
                snmp_port=snmp_port,
                device_type=device_type,
                layer=layer,
                location_id=location_id,
                status="unknown",
                polling_enabled=True,
            )
            db.add(device)
            await db.commit()
            await db.refresh(device)
            new_devices += 1

            # Fire-and-forget: enrich + discover in background
            asyncio.create_task(_enrich_and_discover(device.id, session_factory))

    logger.info(
        f"Subnet scan {subnet}: {len(hosts)} hosts, "
        f"{len(responsive)} responsive, {new_devices} new, {existing_devices} existing"
    )

    return {
        "subnet": subnet,
        "total_hosts": len(hosts),
        "responsive": len(responsive),
        "new_devices": new_devices,
        "existing_devices": existing_devices,
        "ips_found": responsive,
    }


async def _enrich_and_discover(device_id: int, session_factory: async_sessionmaker):
    """Background task: enrich device info, discover interfaces, routes, and LLDP."""
    from app.models.device import Device
    from app.services.snmp_poller import enrich_device_info, discover_interfaces, poll_device, discover_routes, discover_lldp_neighbors
    from sqlalchemy import select

    SWITCH_TYPES = ("spine", "leaf", "tor", "switch", "access", "distribution", "core", "router")

    async with session_factory() as db:
        result = await db.execute(select(Device).where(Device.id == device_id))
        device = result.scalar_one_or_none()
        if not device:
            return
        await enrich_device_info(device, db)
        await db.refresh(device)

        # Skip full discovery for PDUs — they don't have interfaces/routes
        if device.device_type == "pdu":
            return

        await discover_interfaces(device, db)
        await poll_device(device, db)

        # Discover routes for L3 devices
        if device.layer in ("L3", "L2/L3") or device.device_type in ("router", "spine", "leaf"):
            await discover_routes(device, db)

        # Discover LLDP neighbors for switch-type devices
        if device.device_type in SWITCH_TYPES:
            try:
                await discover_lldp_neighbors(device, db)
            except Exception as e:
                logger.warning("LLDP discovery failed for %s: %s", device.ip_address, e)
