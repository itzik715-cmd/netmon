"""
SNMP Poller Service
Polls devices via SNMP for interface metrics and device health.
"""
import asyncio
import ipaddress
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from pysnmp.hlapi.asyncio import (
    getCmd, bulkCmd, SnmpEngine, CommunityData, UsmUserData,
    UdpTransportTarget, ContextData, ObjectType, ObjectIdentity,
)
from pysnmp.hlapi import (
    usmHMACMD5AuthProtocol, usmHMACSHAAuthProtocol,
    usmDESPrivProtocol, usmAesCfb128Protocol,
)
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select, update, delete
from app.config import settings
from app.models.device import Device, DeviceRoute
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


def make_auth_data(device: Device):
    if device.snmp_version == "3":
        auth_proto = usmHMACSHAAuthProtocol if device.snmp_v3_auth_protocol == "SHA" else usmHMACMD5AuthProtocol
        priv_proto = usmAesCfb128Protocol if device.snmp_v3_priv_protocol == "AES" else usmDESPrivProtocol
        return UsmUserData(
            device.snmp_v3_username or "admin",
            authKey=device.snmp_v3_auth_key,
            privKey=device.snmp_v3_priv_key,
            authProtocol=auth_proto,
            privProtocol=priv_proto,
        )
    return CommunityData(device.snmp_community or "public", mpModel=1 if device.snmp_version == "2c" else 0)


async def snmp_get(device: Device, oid: str) -> Optional[Any]:
    """Perform SNMP GET for a single OID."""
    try:
        engine = SnmpEngine()
        auth_data = make_auth_data(device)
        transport = UdpTransportTarget(
            (device.ip_address, device.snmp_port or 161),
            timeout=settings.SNMP_TIMEOUT,
            retries=settings.SNMP_RETRIES,
        )
        error_indication, error_status, error_index, var_binds = await getCmd(
            engine, auth_data, transport, ContextData(),
            ObjectType(ObjectIdentity(oid)),
        )
        if error_indication or error_status:
            return None
        return var_binds[0][1].prettyPrint() if var_binds else None
    except Exception as e:
        logger.debug(f"SNMP GET error for {device.ip_address}/{oid}: {e}")
        return None


async def snmp_bulk_walk(device: Device, oid: str) -> Dict[str, Any]:
    """SNMP BULK walk of an OID table."""
    results = {}
    try:
        engine = SnmpEngine()
        auth_data = make_auth_data(device)
        transport = UdpTransportTarget(
            (device.ip_address, device.snmp_port or 161),
            timeout=settings.SNMP_TIMEOUT,
            retries=settings.SNMP_RETRIES,
        )
        async for (error_indication, error_status, error_index, var_binds) in bulkCmd(
            engine, auth_data, transport, ContextData(),
            0, 20,
            ObjectType(ObjectIdentity(oid)),
            lexicographicMode=False,
        ):
            if error_indication or error_status:
                break
            for var_bind in var_binds:
                key = str(var_bind[0])
                results[key] = var_bind[1].prettyPrint()
    except Exception as e:
        logger.debug(f"SNMP WALK error for {device.ip_address}/{oid}: {e}")
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
    sys_name = await snmp_get(device, OID_SYS_NAME)
    sys_descr = await snmp_get(device, OID_SYS_DESCR)

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

    # --- Try ipCidrRouteTable first ---
    dest_walk = await snmp_bulk_walk(device, OID_IP_CIDR_DEST)
    if dest_walk:
        mask_walk  = await snmp_bulk_walk(device, OID_IP_CIDR_MASK)
        nhop_walk  = await snmp_bulk_walk(device, OID_IP_CIDR_NHOP)
        proto_walk = await snmp_bulk_walk(device, OID_IP_CIDR_PROTO)
        metric_walk = await snmp_bulk_walk(device, OID_IP_CIDR_METRIC)

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
        dest_walk = await snmp_bulk_walk(device, OID_IP_ROUTE_DEST)
        if dest_walk:
            mask_walk  = await snmp_bulk_walk(device, OID_IP_ROUTE_MASK)
            nhop_walk  = await snmp_bulk_walk(device, OID_IP_ROUTE_NHOP)
            proto_walk = await snmp_bulk_walk(device, OID_IP_ROUTE_PROTO)
            metric_walk = await snmp_bulk_walk(device, OID_IP_ROUTE_METRIC)

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


async def poll_device(device: Device, db: AsyncSession) -> bool:
    """Poll a single device and update metrics."""
    try:
        logger.info(f"Polling device: {device.hostname} ({device.ip_address})")

        uptime_raw = await snmp_get(device, OID_SYS_UPTIME)
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

        await poll_interfaces(device, db, now)
        await db.commit()
        return True

    except Exception as e:
        logger.error(f"Error polling device {device.hostname}: {e}")
        return False


async def poll_interfaces(device: Device, db: AsyncSession, now: datetime):
    """Poll interface counters and store metrics."""
    result = await db.execute(
        select(Interface).where(Interface.device_id == device.id, Interface.is_monitored == True)
    )
    interfaces = result.scalars().all()
    if_by_index = {iface.if_index: iface for iface in interfaces if iface.if_index}

    in_octets   = await snmp_bulk_walk(device, OID_IF_HC_IN_OCTETS)
    out_octets  = await snmp_bulk_walk(device, OID_IF_HC_OUT_OCTETS)
    oper_status = await snmp_bulk_walk(device, OID_IF_OPER)
    speeds      = await snmp_bulk_walk(device, OID_IF_HIGH_SPEED)

    if not in_octets:
        in_octets = await snmp_bulk_walk(device, OID_IF_IN_OCTETS)
    if not out_octets:
        out_octets = await snmp_bulk_walk(device, OID_IF_OUT_OCTETS)

    for oid_str, in_val in in_octets.items():
        try:
            if_index = int(oid_str.split(".")[-1])
            out_val  = out_octets.get(oid_str.replace(OID_IF_HC_IN_OCTETS, OID_IF_HC_OUT_OCTETS), 0)
            oper     = oper_status.get(oid_str.replace(OID_IF_HC_IN_OCTETS, OID_IF_OPER), "1")
            speed_mbps = int(speeds.get(oid_str.replace(OID_IF_HC_IN_OCTETS, OID_IF_HIGH_SPEED), 0) or 0)
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

            oper_str = "up" if str(oper) == "1" else "down"
            db.add(InterfaceMetric(
                interface_id=iface.id, timestamp=now,
                in_octets=in_octets_val, out_octets=out_octets_val,
                in_bps=in_bps, out_bps=out_bps,
                utilization_in=utilization_in, utilization_out=utilization_out,
                oper_status=oper_str,
            ))
            await db.execute(
                update(Interface).where(Interface.id == iface.id).values(oper_status=oper_str)
            )
        except Exception as e:
            logger.debug(f"Interface metric error for index {if_index}: {e}")


async def discover_interfaces(device: Device, db: AsyncSession) -> int:
    """Discover and create interface records for a device."""
    descr_walk = await snmp_bulk_walk(device, OID_IF_DESCR)
    speed_walk = await snmp_bulk_walk(device, OID_IF_HIGH_SPEED)
    admin_walk = await snmp_bulk_walk(device, OID_IF_ADMIN)
    oper_walk  = await snmp_bulk_walk(device, OID_IF_OPER)
    alias_walk = await snmp_bulk_walk(device, OID_IF_ALIAS)

    created = 0
    for oid_str, descr in descr_walk.items():
        try:
            if_index   = int(oid_str.split(".")[-1])
            speed_mbps = int(speed_walk.get(oid_str.replace(OID_IF_DESCR, OID_IF_HIGH_SPEED), 0) or 0)
            admin      = admin_walk.get(oid_str.replace(OID_IF_DESCR, OID_IF_ADMIN), "2")
            oper       = oper_walk.get(oid_str.replace(OID_IF_DESCR, OID_IF_OPER), "2")
            alias      = alias_walk.get(oid_str.replace(OID_IF_DESCR, OID_IF_ALIAS), "")

            existing = await db.execute(
                select(Interface).where(Interface.device_id == device.id, Interface.if_index == if_index)
            )
            if existing.scalar_one_or_none():
                continue

            db.add(Interface(
                device_id=device.id,
                if_index=if_index,
                name=str(descr),
                alias=str(alias) if alias else None,
                speed=speed_mbps * 1_000_000 if speed_mbps else None,
                admin_status="up" if str(admin) == "1" else "down",
                oper_status="up" if str(oper) == "1" else "down",
                is_monitored=True,
            ))
            created += 1
        except Exception as e:
            logger.debug(f"Interface discovery error: {e}")

    await db.commit()
    return created
