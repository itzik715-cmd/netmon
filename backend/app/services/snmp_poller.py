"""
SNMP Poller Service
Polls devices via SNMP for interface metrics and device health.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from pysnmp.hlapi.asyncio import (
    getCmd, bulkCmd, SnmpEngine, CommunityData, UsmUserData,
    UdpTransportTarget, ContextData, ObjectType, ObjectIdentity,
    usmHMACMD5AuthProtocol, usmHMACSHAAuthProtocol,
    usmDESPrivProtocol, usmAesCfb128Protocol,
)
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select, update
from app.config import settings
from app.models.device import Device
from app.models.interface import Interface, InterfaceMetric
import json

logger = logging.getLogger(__name__)

# Standard SNMP OIDs
OID_SYS_DESCR = "1.3.6.1.2.1.1.1.0"
OID_SYS_UPTIME = "1.3.6.1.2.1.1.3.0"
OID_SYS_NAME = "1.3.6.1.2.1.1.5.0"
OID_CPU_5MIN = "1.3.6.1.4.1.9.2.1.58.0"        # Cisco CPU
OID_IF_TABLE = "1.3.6.1.2.1.2.2"
OID_IF_DESCR = "1.3.6.1.2.1.2.2.1.2"
OID_IF_TYPE = "1.3.6.1.2.1.2.2.1.3"
OID_IF_SPEED = "1.3.6.1.2.1.2.2.1.5"
OID_IF_ADMIN = "1.3.6.1.2.1.2.2.1.7"
OID_IF_OPER = "1.3.6.1.2.1.2.2.1.8"
OID_IF_IN_OCTETS = "1.3.6.1.2.1.2.2.1.10"
OID_IF_IN_UCAST = "1.3.6.1.2.1.2.2.1.11"
OID_IF_IN_ERRORS = "1.3.6.1.2.1.2.2.1.14"
OID_IF_IN_DISCARDS = "1.3.6.1.2.1.2.2.1.13"
OID_IF_OUT_OCTETS = "1.3.6.1.2.1.2.2.1.16"
OID_IF_OUT_UCAST = "1.3.6.1.2.1.2.2.1.17"
OID_IF_OUT_ERRORS = "1.3.6.1.2.1.2.2.1.20"
OID_IF_OUT_DISCARDS = "1.3.6.1.2.1.2.2.1.19"
OID_IF_ALIAS = "1.3.6.1.2.1.31.1.1.1.18"
OID_IF_HIGH_SPEED = "1.3.6.1.2.1.31.1.1.1.15"
OID_IF_HC_IN_OCTETS = "1.3.6.1.2.1.31.1.1.1.6"
OID_IF_HC_OUT_OCTETS = "1.3.6.1.2.1.31.1.1.1.10"


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


async def poll_device(device: Device, db: AsyncSession) -> bool:
    """Poll a single device and update metrics."""
    try:
        logger.info(f"Polling device: {device.hostname} ({device.ip_address})")

        # Get system info
        uptime_raw = await snmp_get(device, OID_SYS_UPTIME)
        sys_name = await snmp_get(device, OID_SYS_NAME)

        now = datetime.now(timezone.utc)
        device_status = "down"

        if uptime_raw is not None:
            device_status = "up"
            try:
                uptime_centiseconds = int(uptime_raw.replace("Timeticks:", "").strip().split(" ")[0].replace("(", "").replace(")", ""))
                uptime_seconds = uptime_centiseconds // 100
            except Exception:
                uptime_seconds = None

            await db.execute(
                update(Device)
                .where(Device.id == device.id)
                .values(
                    status="up",
                    last_seen=now,
                    uptime=uptime_seconds,
                )
            )
        else:
            await db.execute(
                update(Device)
                .where(Device.id == device.id)
                .values(status="down", last_seen=now)
            )
            await db.commit()
            return False

        # Poll interfaces
        await poll_interfaces(device, db, now)
        await db.commit()
        return True

    except Exception as e:
        logger.error(f"Error polling device {device.hostname}: {e}")
        return False


async def poll_interfaces(device: Device, db: AsyncSession, now: datetime):
    """Poll interface counters and store metrics."""
    # Get existing interfaces from DB
    result = await db.execute(
        select(Interface).where(Interface.device_id == device.id, Interface.is_monitored == True)
    )
    interfaces = result.scalars().all()
    if_by_index = {iface.if_index: iface for iface in interfaces if iface.if_index}

    # Walk HC (64-bit) counters
    in_octets = await snmp_bulk_walk(device, OID_IF_HC_IN_OCTETS)
    out_octets = await snmp_bulk_walk(device, OID_IF_HC_OUT_OCTETS)
    oper_status = await snmp_bulk_walk(device, OID_IF_OPER)
    speeds = await snmp_bulk_walk(device, OID_IF_HIGH_SPEED)

    # Fall back to 32-bit if HC not available
    if not in_octets:
        in_octets = await snmp_bulk_walk(device, OID_IF_IN_OCTETS)
    if not out_octets:
        out_octets = await snmp_bulk_walk(device, OID_IF_OUT_OCTETS)

    for oid_str, in_val in in_octets.items():
        try:
            # Extract interface index from OID
            if_index = int(oid_str.split(".")[-1])
            out_val = out_octets.get(oid_str.replace(OID_IF_HC_IN_OCTETS, OID_IF_HC_OUT_OCTETS), 0)
            oper = oper_status.get(oid_str.replace(OID_IF_HC_IN_OCTETS, OID_IF_OPER), "1")
            speed_mbps = int(speeds.get(oid_str.replace(OID_IF_HC_IN_OCTETS, OID_IF_HIGH_SPEED), 0) or 0)
            speed_bps = speed_mbps * 1_000_000

            if if_index not in if_by_index:
                continue

            iface = if_by_index[if_index]

            # Get previous metric to calculate deltas
            prev_result = await db.execute(
                select(InterfaceMetric)
                .where(InterfaceMetric.interface_id == iface.id)
                .order_by(InterfaceMetric.timestamp.desc())
                .limit(1)
            )
            prev = prev_result.scalar_one_or_none()

            in_octets_val = int(in_val) if in_val else 0
            out_octets_val = int(out_val) if out_val else 0

            in_bps = 0.0
            out_bps = 0.0
            utilization_in = 0.0
            utilization_out = 0.0

            if prev and prev.in_octets and prev.timestamp:
                delta_secs = (now - prev.timestamp.replace(tzinfo=timezone.utc)).total_seconds()
                if delta_secs > 0:
                    in_delta = in_octets_val - prev.in_octets
                    out_delta = out_octets_val - prev.out_octets
                    # Handle counter wrap
                    if in_delta < 0:
                        in_delta += 2**64
                    if out_delta < 0:
                        out_delta += 2**64
                    in_bps = (in_delta * 8) / delta_secs
                    out_bps = (out_delta * 8) / delta_secs
                    if speed_bps > 0:
                        utilization_in = min(100.0, (in_bps / speed_bps) * 100)
                        utilization_out = min(100.0, (out_bps / speed_bps) * 100)

            oper_str = "up" if str(oper) == "1" else "down"

            metric = InterfaceMetric(
                interface_id=iface.id,
                timestamp=now,
                in_octets=in_octets_val,
                out_octets=out_octets_val,
                in_bps=in_bps,
                out_bps=out_bps,
                utilization_in=utilization_in,
                utilization_out=utilization_out,
                oper_status=oper_str,
            )
            db.add(metric)

            # Update interface status
            await db.execute(
                update(Interface)
                .where(Interface.id == iface.id)
                .values(oper_status=oper_str)
            )

        except Exception as e:
            logger.debug(f"Interface metric error for index {if_index}: {e}")
            continue


async def discover_interfaces(device: Device, db: AsyncSession) -> int:
    """Discover and create interface records for a device."""
    descr_walk = await snmp_bulk_walk(device, OID_IF_DESCR)
    speed_walk = await snmp_bulk_walk(device, OID_IF_HIGH_SPEED)
    admin_walk = await snmp_bulk_walk(device, OID_IF_ADMIN)
    oper_walk = await snmp_bulk_walk(device, OID_IF_OPER)
    alias_walk = await snmp_bulk_walk(device, OID_IF_ALIAS)

    created = 0
    for oid_str, descr in descr_walk.items():
        try:
            if_index = int(oid_str.split(".")[-1])
            speed_mbps = int(speed_walk.get(oid_str.replace(OID_IF_DESCR, OID_IF_HIGH_SPEED), 0) or 0)
            admin = admin_walk.get(oid_str.replace(OID_IF_DESCR, OID_IF_ADMIN), "2")
            oper = oper_walk.get(oid_str.replace(OID_IF_DESCR, OID_IF_OPER), "2")
            alias = alias_walk.get(oid_str.replace(OID_IF_DESCR, OID_IF_ALIAS), "")

            # Check if already exists
            existing = await db.execute(
                select(Interface).where(
                    Interface.device_id == device.id,
                    Interface.if_index == if_index
                )
            )
            if existing.scalar_one_or_none():
                continue

            iface = Interface(
                device_id=device.id,
                if_index=if_index,
                name=str(descr),
                alias=str(alias) if alias else None,
                speed=speed_mbps * 1_000_000 if speed_mbps else None,
                admin_status="up" if str(admin) == "1" else "down",
                oper_status="up" if str(oper) == "1" else "down",
                is_monitored=True,
            )
            db.add(iface)
            created += 1
        except Exception as e:
            logger.debug(f"Interface discovery error: {e}")

    await db.commit()
    return created
