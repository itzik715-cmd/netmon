"""
SNMP Poller Service
Polls devices via SNMP for interface metrics and device health.
"""
import asyncio
import ipaddress
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from pysnmp.hlapi.asyncio import (
    get_cmd, bulk_walk_cmd, SnmpEngine, CommunityData, UsmUserData,
    UdpTransportTarget, ContextData, ObjectType, ObjectIdentity,
    usmHMACMD5AuthProtocol, usmHMACSHAAuthProtocol,
    usmDESPrivProtocol, usmAesCfb128Protocol,
)
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select, update, delete
from app.config import settings
from app.models.device import Device, DeviceRoute, DeviceMetricHistory, DeviceLink
from app.models.interface import Interface, InterfaceMetric
import json

logger = logging.getLogger(__name__)

# Standard SNMP OIDs — system
OID_SYS_DESCR    = "1.3.6.1.2.1.1.1.0"
OID_SYS_UPTIME   = "1.3.6.1.2.1.1.3.0"
OID_SYS_NAME     = "1.3.6.1.2.1.1.5.0"
OID_SYS_OBJECT   = "1.3.6.1.2.1.1.2.0"

# Interface OIDs
OID_CPU_5MIN        = "1.3.6.1.4.1.9.2.1.58.0"
OID_IF_TABLE        = "1.3.6.1.2.1.2.2"
OID_IF_DESCR        = "1.3.6.1.2.1.2.2.1.2"
OID_IF_TYPE         = "1.3.6.1.2.1.2.2.1.3"
OID_IF_SPEED        = "1.3.6.1.2.1.2.2.1.5"
OID_IF_ADMIN        = "1.3.6.1.2.1.2.2.1.7"
OID_IF_OPER         = "1.3.6.1.2.1.2.2.1.8"
OID_IF_IN_OCTETS    = "1.3.6.1.2.1.2.2.1.10"
OID_IF_IN_UCAST     = "1.3.6.1.2.1.2.2.1.11"
OID_IF_IN_ERRORS    = "1.3.6.1.2.1.2.2.1.14"
OID_IF_IN_DISCARDS  = "1.3.6.1.2.1.2.2.1.13"
OID_IF_OUT_OCTETS   = "1.3.6.1.2.1.2.2.1.16"
OID_IF_OUT_UCAST    = "1.3.6.1.2.1.2.2.1.17"
OID_IF_OUT_ERRORS   = "1.3.6.1.2.1.2.2.1.20"
OID_IF_OUT_DISCARDS = "1.3.6.1.2.1.2.2.1.19"
OID_IF_ALIAS        = "1.3.6.1.2.1.31.1.1.1.18"
OID_IF_HIGH_SPEED   = "1.3.6.1.2.1.31.1.1.1.15"
OID_IF_HC_IN_OCTETS  = "1.3.6.1.2.1.31.1.1.1.6"
OID_IF_HC_OUT_OCTETS = "1.3.6.1.2.1.31.1.1.1.10"

# Routing table OIDs — ipCidrRouteTable (RFC 2096)
OID_IP_CIDR_DEST   = "1.3.6.1.2.1.4.24.4.1.1"
OID_IP_CIDR_MASK   = "1.3.6.1.2.1.4.24.4.1.2"
OID_IP_CIDR_NHOP   = "1.3.6.1.2.1.4.24.4.1.4"
OID_IP_CIDR_PROTO  = "1.3.6.1.2.1.4.24.4.1.7"
OID_IP_CIDR_METRIC = "1.3.6.1.2.1.4.24.4.1.11"

# Routing table OIDs — classic ipRouteTable (RFC 1213) fallback
OID_IP_ROUTE_DEST   = "1.3.6.1.2.1.4.21.1.1"
OID_IP_ROUTE_MASK   = "1.3.6.1.2.1.4.21.1.11"
OID_IP_ROUTE_NHOP   = "1.3.6.1.2.1.4.21.1.7"
OID_IP_ROUTE_PROTO  = "1.3.6.1.2.1.4.21.1.9"
OID_IP_ROUTE_METRIC = "1.3.6.1.2.1.4.21.1.3"

# LLDP OIDs
OID_LLDP_REM_SYS_NAME = "1.0.8802.1.1.2.1.4.1.1.9"   # lldpRemSysName
OID_LLDP_REM_PORT_ID  = "1.0.8802.1.1.2.1.4.1.1.7"   # lldpRemPortId
OID_LLDP_REM_MAN_ADDR = "1.0.8802.1.1.2.1.4.2.1.4"   # lldpRemManAddr (IP)
OID_LLDP_LOC_PORT_ID  = "1.0.8802.1.1.2.1.3.7.1.3"   # lldpLocPortId

# Cisco CPU OIDs
OID_CPU_5MIN_CISCO    = "1.3.6.1.4.1.9.2.1.58.0"      # Cisco: 5-min CPU avg
OID_CPU_PROC_CISCO    = "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1"  # Cisco: process CPU
OID_MEM_USED_CISCO    = "1.3.6.1.4.1.9.2.1.8.0"       # Cisco: mem used
OID_MEM_FREE_CISCO    = "1.3.6.1.4.1.9.2.1.6.0"       # Cisco: mem free
# Arista CPU
OID_CPU_ARISTA        = "1.3.6.1.2.1.25.3.3.1.2.1"    # HOST-RESOURCES-MIB: hrProcessorLoad
OID_MEM_TOTAL_HRM     = "1.3.6.1.2.1.25.2.2.0"        # hrMemorySize (KB)
OID_MEM_STORAGE_TABLE = "1.3.6.1.2.1.25.2.3"          # hrStorageTable
OID_MEM_STORAGE_USED  = "1.3.6.1.2.1.25.2.3.1.6"      # hrStorageUsed
OID_MEM_STORAGE_SIZE  = "1.3.6.1.2.1.25.2.3.1.5"      # hrStorageSize

# Protocol code → name mapping (RFC 1354 / RFC 2096)
ROUTE_PROTO_MAP = {
    "1": "other", "2": "local", "3": "static", "4": "icmp",
    "5": "egp", "6": "ggp", "7": "hello", "8": "rip",
    "9": "is-is", "10": "es-is", "11": "eigrp", "12": "igrp",
    "13": "ospf", "14": "bgp", "15": "idpr", "16": "eigrp",
}

# Vendor patterns in sysDescr
VENDOR_PATTERNS = [
    ("cisco",    "Cisco"),
    ("arista",   "Arista"),
    ("juniper",  "Juniper"),
    ("junos",    "Juniper"),
    ("mikrotik", "MikroTik"),
    ("routeros", "MikroTik"),
    ("huawei",   "Huawei"),
    ("fortinet", "Fortinet"),
    ("fortigate","Fortinet"),
    ("palo alto","Palo Alto"),
    ("procurve", "HP/Aruba"),
    ("aruba",    "HP/Aruba"),
    ("hp ",      "HP/Aruba"),
    ("dell",     "Dell"),
    ("extreme",  "Extreme"),
    ("brocade",  "Brocade"),
    ("ubiquiti", "Ubiquiti"),
]


def _close_engine(engine: SnmpEngine) -> None:
    """Close an SnmpEngine and release its UDP socket."""
    try:
        engine.transportDispatcher.closeDispatcher()
    except Exception:
        pass


def make_auth_data(device: Device):
    from app.crypto import decrypt_value
    if device.snmp_version == "3":
        auth_proto = usmHMACSHAAuthProtocol if device.snmp_v3_auth_protocol == "SHA" else usmHMACMD5AuthProtocol
        priv_proto = usmAesCfb128Protocol if device.snmp_v3_priv_protocol == "AES" else usmDESPrivProtocol
        return UsmUserData(
            device.snmp_v3_username or "admin",
            authKey=decrypt_value(device.snmp_v3_auth_key),
            privKey=decrypt_value(device.snmp_v3_priv_key),
            authProtocol=auth_proto,
            privProtocol=priv_proto,
        )
    community = decrypt_value(device.snmp_community) if device.snmp_community else "public"
    return CommunityData(community, mpModel=1 if device.snmp_version == "2c" else 0)


async def snmp_get(device: Device, oid: str, engine: Optional[SnmpEngine] = None) -> Optional[Any]:
    """Perform SNMP GET for a single OID.
    If *engine* is provided the caller owns its lifecycle; otherwise a
    temporary engine is created and closed inside this function.
    """
    _own_engine = engine is None
    if _own_engine:
        engine = SnmpEngine()
    try:
        auth_data = make_auth_data(device)
        transport = await UdpTransportTarget.create(
            (device.ip_address, device.snmp_port or 161),
            timeout=settings.SNMP_TIMEOUT,
            retries=settings.SNMP_RETRIES,
        )
        error_indication, error_status, error_index, var_binds = await get_cmd(
            engine, auth_data, transport, ContextData(),
            ObjectType(ObjectIdentity(oid)),
        )
        if error_indication or error_status:
            return None
        return var_binds[0][1].prettyPrint() if var_binds else None
    except Exception as e:
        logger.debug(f"SNMP GET error for {device.ip_address}/{oid}: {e}")
        return None
    finally:
        if _own_engine:
            _close_engine(engine)


async def snmp_bulk_walk(device: Device, oid: str, engine: Optional[SnmpEngine] = None) -> Dict[str, Any]:
    """SNMP BULK walk of an OID table.
    If *engine* is provided the caller owns its lifecycle; otherwise a
    temporary engine is created and closed inside this function.
    """
    results = {}
    _own_engine = engine is None
    if _own_engine:
        engine = SnmpEngine()
    try:
        auth_data = make_auth_data(device)
        transport = await UdpTransportTarget.create(
            (device.ip_address, device.snmp_port or 161),
            timeout=settings.SNMP_TIMEOUT,
            retries=settings.SNMP_RETRIES,
        )
        async for (error_indication, error_status, error_index, var_binds) in bulk_walk_cmd(
            engine, auth_data, transport, ContextData(),
            0, 20,
            ObjectType(ObjectIdentity(oid)),
            lexicographicMode=False,
        ):
            if error_indication or error_status:
                break
            for var_bind in var_binds:
                # Always store as numeric dotted OID so _oid_rebase lookups work
                key = '.'.join(str(x) for x in var_bind[0])
                results[key] = var_bind[1].prettyPrint()
        logger.debug(f"SNMP WALK {device.ip_address}/{oid}: {len(results)} results")
    except Exception as e:
        logger.debug(f"SNMP WALK error for {device.ip_address}/{oid}: {e}")
    finally:
        if _own_engine:
            _close_engine(engine)
    return results


def _mask_to_prefix_len(mask: str) -> Optional[int]:
    """Convert dotted subnet mask to prefix length."""
    try:
        return bin(int(ipaddress.ip_address(mask))).count("1")
    except Exception:
        return None


def _oid_rebase(oid_str: str, old_base: str, new_base: str) -> str:
    """Replace OID column prefix, preserving the row index suffix."""
    if oid_str.startswith(old_base + "."):
        return new_base + oid_str[len(old_base):]
    return new_base + "." + oid_str.split(".")[-1]


async def enrich_device_info(device: Device, db: AsyncSession) -> None:
    """
    Query SNMP for sysDescr and sysName, then update device with
    vendor, OS version, and hostname (if hostname is just an IP).
    """
    engine = SnmpEngine()
    try:
        sys_name = await snmp_get(device, OID_SYS_NAME, engine)
        sys_descr = await snmp_get(device, OID_SYS_DESCR, engine)
    finally:
        _close_engine(engine)

    updates: Dict[str, Any] = {}

    # Update hostname from sysName if currently set to IP address
    if sys_name:
        clean_name = sys_name.strip()
        if clean_name and (device.hostname == device.ip_address or not device.hostname):
            updates["hostname"] = clean_name

    if sys_descr:
        descr_lower = sys_descr.lower()

        # Detect vendor if not already set
        if not device.vendor:
            for pattern, vendor_name in VENDOR_PATTERNS:
                if pattern in descr_lower:
                    updates["vendor"] = vendor_name
                    break

        # Store full sysDescr as os_version if not already set
        if not device.os_version:
            updates["os_version"] = sys_descr[:200].strip()

    if updates:
        await db.execute(update(Device).where(Device.id == device.id).values(**updates))
        await db.commit()
        logger.info(f"Device {device.ip_address} enriched: {list(updates.keys())}")


async def discover_routes(device: Device, db: AsyncSession) -> int:
    """
    Discover routing table entries via SNMP for L3 devices.
    Tries ipCidrRouteTable (RFC 2096) first, falls back to ipRouteTable (RFC 1213).
    Stores results in device_routes table.
    """
    routes: List[Dict[str, Any]] = []

    engine = SnmpEngine()
    try:
        # --- Try ipCidrRouteTable first ---
        dest_walk = await snmp_bulk_walk(device, OID_IP_CIDR_DEST, engine)
        if dest_walk:
            mask_walk   = await snmp_bulk_walk(device, OID_IP_CIDR_MASK, engine)
            nhop_walk   = await snmp_bulk_walk(device, OID_IP_CIDR_NHOP, engine)
            proto_walk  = await snmp_bulk_walk(device, OID_IP_CIDR_PROTO, engine)
            metric_walk = await snmp_bulk_walk(device, OID_IP_CIDR_METRIC, engine)

            for oid_str, dest in dest_walk.items():
                try:
                    mask_key   = _oid_rebase(oid_str, OID_IP_CIDR_DEST, OID_IP_CIDR_MASK)
                    nhop_key   = _oid_rebase(oid_str, OID_IP_CIDR_DEST, OID_IP_CIDR_NHOP)
                    proto_key  = _oid_rebase(oid_str, OID_IP_CIDR_DEST, OID_IP_CIDR_PROTO)
                    metric_key = _oid_rebase(oid_str, OID_IP_CIDR_DEST, OID_IP_CIDR_METRIC)

                    mask     = mask_walk.get(mask_key, "")
                    next_hop = nhop_walk.get(nhop_key, "")
                    proto_v  = str(proto_walk.get(proto_key, "1")).strip()
                    metric   = int(metric_walk.get(metric_key, 0) or 0)
                    prefix_len = _mask_to_prefix_len(mask) if mask else None

                    routes.append({
                        "destination": dest.strip(),
                        "mask": mask.strip(),
                        "prefix_len": prefix_len,
                        "next_hop": next_hop.strip(),
                        "protocol": ROUTE_PROTO_MAP.get(proto_v, "other"),
                        "metric": metric,
                    })
                except Exception as e:
                    logger.debug(f"ipCidrRoute parse error: {e}")

        # --- Fallback: classic ipRouteTable ---
        if not routes:
            dest_walk = await snmp_bulk_walk(device, OID_IP_ROUTE_DEST, engine)
            if dest_walk:
                mask_walk   = await snmp_bulk_walk(device, OID_IP_ROUTE_MASK, engine)
                nhop_walk   = await snmp_bulk_walk(device, OID_IP_ROUTE_NHOP, engine)
                proto_walk  = await snmp_bulk_walk(device, OID_IP_ROUTE_PROTO, engine)
                metric_walk = await snmp_bulk_walk(device, OID_IP_ROUTE_METRIC, engine)

                for oid_str, dest in dest_walk.items():
                    try:
                        mask_key   = _oid_rebase(oid_str, OID_IP_ROUTE_DEST, OID_IP_ROUTE_MASK)
                        nhop_key   = _oid_rebase(oid_str, OID_IP_ROUTE_DEST, OID_IP_ROUTE_NHOP)
                        proto_key  = _oid_rebase(oid_str, OID_IP_ROUTE_DEST, OID_IP_ROUTE_PROTO)
                        metric_key = _oid_rebase(oid_str, OID_IP_ROUTE_DEST, OID_IP_ROUTE_METRIC)

                        mask     = mask_walk.get(mask_key, "")
                        next_hop = nhop_walk.get(nhop_key, "")
                        proto_v  = str(proto_walk.get(proto_key, "1")).strip()
                        metric   = int(metric_walk.get(metric_key, 0) or 0)
                        prefix_len = _mask_to_prefix_len(mask) if mask else None

                        routes.append({
                            "destination": dest.strip(),
                            "mask": mask.strip(),
                            "prefix_len": prefix_len,
                            "next_hop": next_hop.strip(),
                            "protocol": ROUTE_PROTO_MAP.get(proto_v, "other"),
                            "metric": metric,
                        })
                    except Exception as e:
                        logger.debug(f"ipRoute parse error: {e}")
    finally:
        _close_engine(engine)

    if not routes:
        logger.info(f"No routes found for {device.hostname} ({device.ip_address})")
        return 0

    # Replace existing routes for this device
    await db.execute(delete(DeviceRoute).where(DeviceRoute.device_id == device.id))
    for r in routes:
        db.add(DeviceRoute(device_id=device.id, **r))
    await db.commit()
    logger.info(f"Stored {len(routes)} routes for {device.hostname} ({device.ip_address})")
    return len(routes)


async def poll_device(device: Device, db: AsyncSession,
                      engine: Optional[SnmpEngine] = None) -> bool:
    """Poll a single device and update metrics.

    *engine* — optional shared SnmpEngine supplied by the caller.  When
    provided the caller owns its lifecycle (no close on exit).  When omitted
    a temporary engine is created and closed here.  Passing a shared engine
    is preferred: it reuses one UDP socket for the entire polling cycle
    instead of opening a new socket per device.
    """
    _own_engine = engine is None
    if _own_engine:
        engine = SnmpEngine()
    try:
        logger.info(f"Polling device: {device.hostname} ({device.ip_address})")

        uptime_raw = await snmp_get(device, OID_SYS_UPTIME, engine)
        now = datetime.now(timezone.utc)

        if uptime_raw is not None:
            try:
                uptime_centiseconds = int(
                    uptime_raw.replace("Timeticks:", "").strip()
                    .split(" ")[0].replace("(", "").replace(")", "")
                )
                uptime_seconds = uptime_centiseconds // 100
            except Exception:
                uptime_seconds = None

            await db.execute(
                update(Device)
                .where(Device.id == device.id)
                .values(status="up", last_seen=now, uptime=uptime_seconds)
            )
        else:
            await db.execute(
                update(Device).where(Device.id == device.id).values(status="down", last_seen=now)
            )
            await db.commit()
            return False

        # Poll CPU / memory
        cpu, mem = await _poll_cpu_mem(device, engine)
        if cpu is not None or mem is not None:
            await db.execute(
                update(Device)
                .where(Device.id == device.id)
                .values(cpu_usage=cpu, memory_usage=mem)
            )
            db.add(DeviceMetricHistory(
                device_id=device.id,
                timestamp=now,
                cpu_usage=cpu,
                memory_usage=mem,
                uptime=uptime_seconds,
            ))

        await poll_interfaces(device, db, now, engine)
        await db.commit()
        return True

    except Exception as e:
        logger.error(f"Error polling device {device.hostname}: {e}")
        return False
    finally:
        if _own_engine:
            _close_engine(engine)


async def poll_interfaces(device: Device, db: AsyncSession, now: datetime,
                          engine: Optional[SnmpEngine] = None):
    """Poll interface counters and store metrics."""
    _own_engine = engine is None
    if _own_engine:
        engine = SnmpEngine()
    try:
        result = await db.execute(
            select(Interface).where(Interface.device_id == device.id, Interface.is_monitored == True)
        )
        interfaces = result.scalars().all()
        if_by_index = {iface.if_index: iface for iface in interfaces if iface.if_index}

        in_octets    = await snmp_bulk_walk(device, OID_IF_HC_IN_OCTETS, engine)
        out_octets   = await snmp_bulk_walk(device, OID_IF_HC_OUT_OCTETS, engine)
        oper_status  = await snmp_bulk_walk(device, OID_IF_OPER, engine)
        admin_status = await snmp_bulk_walk(device, OID_IF_ADMIN, engine)
        speeds       = await snmp_bulk_walk(device, OID_IF_HIGH_SPEED, engine)
        aliases      = await snmp_bulk_walk(device, OID_IF_ALIAS, engine)

        if not in_octets:
            in_octets = await snmp_bulk_walk(device, OID_IF_IN_OCTETS, engine)
        if not out_octets:
            out_octets = await snmp_bulk_walk(device, OID_IF_OUT_OCTETS, engine)

        for oid_str, in_val in in_octets.items():
            try:
                if_index = int(oid_str.split(".")[-1])
                out_val  = out_octets.get(oid_str.replace(OID_IF_HC_IN_OCTETS, OID_IF_HC_OUT_OCTETS), 0)
                oper_key  = _oid_rebase(oid_str, OID_IF_HC_IN_OCTETS, OID_IF_OPER)
                admin_key = _oid_rebase(oid_str, OID_IF_HC_IN_OCTETS, OID_IF_ADMIN)
                speed_key = _oid_rebase(oid_str, OID_IF_HC_IN_OCTETS, OID_IF_HIGH_SPEED)
                oper      = oper_status.get(oper_key, "1")
                admin     = admin_status.get(admin_key, "1")
                speed_mbps = int(speeds.get(speed_key, 0) or 0)
                speed_bps  = speed_mbps * 1_000_000

                if if_index not in if_by_index:
                    continue

                iface = if_by_index[if_index]
                prev_result = await db.execute(
                    select(InterfaceMetric)
                    .where(InterfaceMetric.interface_id == iface.id)
                    .order_by(InterfaceMetric.timestamp.desc())
                    .limit(1)
                )
                prev = prev_result.scalar_one_or_none()

                in_octets_val  = int(in_val) if in_val else 0
                out_octets_val = int(out_val) if out_val else 0
                in_bps = out_bps = utilization_in = utilization_out = 0.0

                if prev and prev.in_octets and prev.timestamp:
                    delta_secs = (now - prev.timestamp.replace(tzinfo=timezone.utc)).total_seconds()
                    if delta_secs > 0:
                        in_delta  = in_octets_val - prev.in_octets
                        out_delta = out_octets_val - prev.out_octets
                        if in_delta < 0:
                            in_delta += 2**64
                        if out_delta < 0:
                            out_delta += 2**64
                        in_bps  = (in_delta * 8) / delta_secs
                        out_bps = (out_delta * 8) / delta_secs
                        if speed_bps > 0:
                            utilization_in  = min(100.0, (in_bps / speed_bps) * 100)
                            utilization_out = min(100.0, (out_bps / speed_bps) * 100)

                oper_str  = "up" if str(oper) == "1" else "down"
                admin_str = "up" if str(admin) == "1" else "down"
                db.add(InterfaceMetric(
                    interface_id=iface.id, timestamp=now,
                    in_octets=in_octets_val, out_octets=out_octets_val,
                    in_bps=in_bps, out_bps=out_bps,
                    utilization_in=utilization_in, utilization_out=utilization_out,
                    oper_status=oper_str,
                ))
                # Keep speed, alias, and admin/oper status in sync with live SNMP data
                alias_key = _oid_rebase(oid_str, OID_IF_HC_IN_OCTETS, OID_IF_ALIAS)
                alias_val = str(aliases.get(alias_key, "")).strip() or None
                iface_updates: dict = {"oper_status": oper_str, "admin_status": admin_str}
                if speed_bps:
                    iface_updates["speed"] = speed_bps
                if alias_val:
                    iface_updates["alias"] = alias_val
                await db.execute(
                    update(Interface).where(Interface.id == iface.id).values(**iface_updates)
                )
            except Exception as e:
                logger.debug(f"Interface metric error for index {if_index}: {e}")
    finally:
        if _own_engine:
            _close_engine(engine)


async def discover_interfaces(device: Device, db: AsyncSession) -> int:
    """Discover and create interface records for a device."""
    engine = SnmpEngine()
    try:
        descr_walk  = await snmp_bulk_walk(device, OID_IF_DESCR, engine)
        speed_walk  = await snmp_bulk_walk(device, OID_IF_HIGH_SPEED, engine)
        # Fallback: basic 32-bit ifSpeed (bps) when ifHighSpeed unavailable
        speed32_walk = await snmp_bulk_walk(device, OID_IF_SPEED, engine)
        admin_walk  = await snmp_bulk_walk(device, OID_IF_ADMIN, engine)
        oper_walk   = await snmp_bulk_walk(device, OID_IF_OPER, engine)
        alias_walk  = await snmp_bulk_walk(device, OID_IF_ALIAS, engine)
    finally:
        _close_engine(engine)

    created = updated = 0
    for oid_str, descr in descr_walk.items():
        try:
            if_index = int(oid_str.split(".")[-1])

            # Resolve cross-table OID keys
            speed_key  = _oid_rebase(oid_str, OID_IF_DESCR, OID_IF_HIGH_SPEED)
            speed32_key = _oid_rebase(oid_str, OID_IF_DESCR, OID_IF_SPEED)
            admin_key  = _oid_rebase(oid_str, OID_IF_DESCR, OID_IF_ADMIN)
            oper_key   = _oid_rebase(oid_str, OID_IF_DESCR, OID_IF_OPER)
            alias_key  = _oid_rebase(oid_str, OID_IF_DESCR, OID_IF_ALIAS)

            # Speed: prefer ifHighSpeed (Mbps), fall back to ifSpeed (bps)
            speed_mbps = int(speed_walk.get(speed_key, 0) or 0)
            if speed_mbps > 0:
                speed_bps = speed_mbps * 1_000_000
            else:
                speed32_raw = int(speed32_walk.get(speed32_key, 0) or 0)
                speed_bps = speed32_raw if speed32_raw > 0 else None

            admin     = admin_walk.get(admin_key, "1")   # default up when unknown
            oper      = oper_walk.get(oper_key, "2")
            alias     = alias_walk.get(alias_key, "")

            admin_str = "up" if str(admin) == "1" else "down"
            oper_str  = "up" if str(oper) == "1" else "down"
            alias_val = str(alias).strip() if alias else None
            name_val  = str(descr).strip()

            existing = await db.execute(
                select(Interface).where(Interface.device_id == device.id, Interface.if_index == if_index)
            )
            iface = existing.scalar_one_or_none()

            if iface:
                await db.execute(
                    update(Interface)
                    .where(Interface.id == iface.id)
                    .values(
                        name=name_val,
                        alias=alias_val,
                        speed=speed_bps,
                        admin_status=admin_str,
                        oper_status=oper_str,
                    )
                )
                updated += 1
            else:
                db.add(Interface(
                    device_id=device.id,
                    if_index=if_index,
                    name=name_val,
                    alias=alias_val,
                    speed=speed_bps,
                    admin_status=admin_str,
                    oper_status=oper_str,
                    is_monitored=True,
                ))
                created += 1
        except Exception as e:
            logger.debug(f"Interface discovery error: {e}")

    await db.commit()
    logger.info(
        f"Interface discovery for {device.hostname} ({device.ip_address}): "
        f"{created} new, {updated} updated (of {len(descr_walk)} found in walk)"
    )
    return created


async def _poll_cpu_mem(device: Device, engine: Optional[SnmpEngine] = None) -> tuple[Optional[float], Optional[float]]:
    """
    Query CPU and memory utilization.
    Tries HOST-RESOURCES-MIB (universal) first, then Cisco-specific OIDs.
    Returns (cpu_pct, mem_pct) — either may be None.
    """
    _own_engine = engine is None
    if _own_engine:
        engine = SnmpEngine()
    cpu: Optional[float] = None
    mem: Optional[float] = None
    try:
        # HOST-RESOURCES-MIB hrProcessorLoad (works on Arista, many others)
        cpu_val = await snmp_get(device, OID_CPU_ARISTA, engine)
        if cpu_val is not None:
            try:
                cpu = float(cpu_val)
            except ValueError:
                pass

        # Cisco CPU
        if cpu is None:
            cisco_cpu = await snmp_get(device, OID_CPU_5MIN_CISCO, engine)
            if cisco_cpu is not None:
                try:
                    cpu = float(cisco_cpu)
                except ValueError:
                    pass

        # Memory via Cisco OIDs
        mem_used_raw = await snmp_get(device, OID_MEM_USED_CISCO, engine)
        mem_free_raw = await snmp_get(device, OID_MEM_FREE_CISCO, engine)
        if mem_used_raw is not None and mem_free_raw is not None:
            try:
                used = float(mem_used_raw)
                free = float(mem_free_raw)
                total = used + free
                if total > 0:
                    mem = round((used / total) * 100.0, 1)
            except ValueError:
                pass

        # HOST-RESOURCES hrMemorySize fallback
        if mem is None:
            mem_total_raw = await snmp_get(device, OID_MEM_TOTAL_HRM, engine)
            if mem_total_raw is not None:
                try:
                    total_kb = float(mem_total_raw)
                    # Walk hrStorageTable to find RAM
                    storage_used = await snmp_bulk_walk(device, OID_MEM_STORAGE_USED, engine)
                    storage_size = await snmp_bulk_walk(device, OID_MEM_STORAGE_SIZE, engine)
                    for oid_key, size_val in storage_size.items():
                        used_key = oid_key.replace(OID_MEM_STORAGE_SIZE, OID_MEM_STORAGE_USED)
                        used_val = storage_used.get(used_key)
                        if used_val and size_val:
                            sz = float(size_val)
                            us = float(used_val)
                            if sz > 0:
                                mem = round((us / sz) * 100.0, 1)
                                break
                except Exception:
                    pass
    finally:
        if _own_engine:
            _close_engine(engine)

    return cpu, mem


async def discover_lldp_neighbors(device: Device, db: AsyncSession) -> int:
    """
    Walk LLDP-MIB on the device, discover neighbors, and store/update DeviceLink records.
    Returns number of links discovered.
    """
    engine = SnmpEngine()
    try:
        sys_names    = await snmp_bulk_walk(device, OID_LLDP_REM_SYS_NAME, engine)
        rem_port_ids = await snmp_bulk_walk(device, OID_LLDP_REM_PORT_ID, engine)
        loc_port_ids = await snmp_bulk_walk(device, OID_LLDP_LOC_PORT_ID, engine)
    finally:
        _close_engine(engine)

    if not sys_names:
        return 0

    # Build a map of local port index → local port id string
    loc_ports: dict[str, str] = {}
    for oid_str, val in loc_port_ids.items():
        idx = oid_str.split(".")[-1]
        loc_ports[idx] = str(val)

    # Load all known devices (to match neighbors by hostname)
    result = await db.execute(select(Device).where(Device.is_active == True))
    all_devices = {d.hostname.lower(): d for d in result.scalars().all()}
    all_devices_by_ip = {d.ip_address: d for d in all_devices.values()}

    # Load existing links from this device
    existing = await db.execute(
        select(DeviceLink).where(DeviceLink.source_device_id == device.id)
    )
    existing_links: dict[int, DeviceLink] = {lnk.target_device_id: lnk for lnk in existing.scalars().all()}
    seen_targets: set[int] = set()

    links_found = 0
    for oid_str, rem_sys_name in sys_names.items():
        # OID format: 1.0.8802.1.1.2.1.4.1.1.9.<time_mark>.<local_if_idx>.<rem_idx>
        parts = oid_str.split(".")
        # last 3 parts: time_mark.local_if_idx.rem_idx
        try:
            local_if_idx = parts[-2]
        except IndexError:
            local_if_idx = "0"

        rem_name = str(rem_sys_name).strip().lower()
        # Match to known device
        neighbor: Optional[Device] = all_devices.get(rem_name)

        if neighbor is None or neighbor.id == device.id:
            continue

        # Get local/remote port names
        src_if = loc_ports.get(local_if_idx, f"if{local_if_idx}")
        rem_port_key = oid_str.replace(OID_LLDP_REM_SYS_NAME, OID_LLDP_REM_PORT_ID)
        tgt_if = str(rem_port_ids.get(rem_port_key, "")).strip() or None

        target_id = neighbor.id
        seen_targets.add(target_id)

        if target_id in existing_links:
            lnk = existing_links[target_id]
            lnk.source_if = src_if
            lnk.target_if = tgt_if
        else:
            db.add(DeviceLink(
                source_device_id=device.id,
                target_device_id=target_id,
                source_if=src_if,
                target_if=tgt_if,
                link_type="lldp",
            ))
        links_found += 1

    await db.commit()
    return links_found


async def cleanup_old_metrics(db: AsyncSession) -> None:
    """
    Delete interface_metrics and device_metric_history rows older than
    the configured max_metric_age_days setting (default 90 days).
    Also prune flow_records older than max_flow_age_days (default 30 days).
    This runs periodically to prevent unbounded table growth that causes
    slow queries and eventual backend crashes.
    """
    from sqlalchemy import text
    from app.models.settings import SystemSetting

    # Read retention settings from DB (fall back to safe defaults)
    try:
        metric_age_row = await db.execute(
            select(SystemSetting).where(SystemSetting.key == "max_metric_age_days")
        )
        metric_age_setting = metric_age_row.scalar_one_or_none()
        metric_days = int(metric_age_setting.value) if metric_age_setting else 90

        flow_age_row = await db.execute(
            select(SystemSetting).where(SystemSetting.key == "max_flow_age_days")
        )
        flow_age_setting = flow_age_row.scalar_one_or_none()
        flow_days = int(flow_age_setting.value) if flow_age_setting else 30
    except Exception:
        metric_days, flow_days = 90, 30

    now = datetime.now(timezone.utc)
    metric_cutoff = now - timedelta(days=metric_days)
    flow_cutoff   = now - timedelta(days=flow_days)

    try:
        # interface_metrics — largest table, most important to prune
        result = await db.execute(
            text("DELETE FROM interface_metrics WHERE timestamp < :cutoff"),
            {"cutoff": metric_cutoff},
        )
        im_deleted = result.rowcount

        # device_metric_history
        result = await db.execute(
            text("DELETE FROM device_metric_history WHERE timestamp < :cutoff"),
            {"cutoff": metric_cutoff},
        )
        dmh_deleted = result.rowcount

        # flow_records (if table exists)
        result = await db.execute(
            text("DELETE FROM flow_records WHERE timestamp < :cutoff"),
            {"cutoff": flow_cutoff},
        )
        flow_deleted = result.rowcount

        await db.commit()
        logger.info(
            "Metrics cleanup: removed %d interface metrics, %d device metrics, "
            "%d flow records (cutoff: %dd / %dd)",
            im_deleted, dmh_deleted, flow_deleted, metric_days, flow_days,
        )
    except Exception as e:
        logger.warning("Metrics cleanup error: %s", e)
        await db.rollback()
