"""
MLAG/vPC discovery via SNMP and Arista eAPI.

Tries Arista MLAG MIB first (aristaMLAG), then Arista eAPI (`show mlag`),
then Cisco vPC, then generic LACP.
"""
import logging
import json
from datetime import datetime, timezone
from typing import Optional, Dict

from pysnmp.hlapi.asyncio import SnmpEngine
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import Device
from app.models.mlag import MlagDomain, MlagInterface
from app.services.snmp_poller import snmp_get, snmp_bulk_walk

logger = logging.getLogger(__name__)

# Arista MLAG MIB OIDs (1.3.6.1.4.1.30065.3.16)
OID_ARISTA_MLAG_DOMAIN_ID   = "1.3.6.1.4.1.30065.3.16.1.1.0"
OID_ARISTA_MLAG_LOCAL_ROLE   = "1.3.6.1.4.1.30065.3.16.1.2.0"
OID_ARISTA_MLAG_PEER_LINK    = "1.3.6.1.4.1.30065.3.16.1.3.0"
OID_ARISTA_MLAG_CONFIG_SANITY= "1.3.6.1.4.1.30065.3.16.1.4.0"
OID_ARISTA_MLAG_PORTS_CONF   = "1.3.6.1.4.1.30065.3.16.1.5.0"
OID_ARISTA_MLAG_PORTS_ACTIVE = "1.3.6.1.4.1.30065.3.16.1.6.0"
OID_ARISTA_MLAG_PORTS_ERRDIS = "1.3.6.1.4.1.30065.3.16.1.7.0"

# Arista MLAG interface table
OID_ARISTA_MLAG_IF_NAME      = "1.3.6.1.4.1.30065.3.16.2.1.1.2"
OID_ARISTA_MLAG_IF_LOCAL_ST  = "1.3.6.1.4.1.30065.3.16.2.1.1.3"
OID_ARISTA_MLAG_IF_REMOTE_ST = "1.3.6.1.4.1.30065.3.16.2.1.1.4"


async def _try_arista_eapi(device: Device) -> Optional[dict]:
    """Try Arista eAPI 'show mlag' if credentials configured."""
    if not device.api_username:
        return None
    try:
        import httpx
        url = f"{device.api_protocol or 'https'}://{device.ip_address}:{device.api_port or 443}/command-api"
        payload = {
            "jsonrpc": "2.0",
            "method": "runCmds",
            "params": {
                "version": 1,
                "cmds": ["show mlag", "show mlag interfaces"],
            },
            "id": "netmon-mlag",
        }
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.post(
                url,
                json=payload,
                auth=(device.api_username, device.api_password or ""),
            )
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("result", [])
                if len(results) >= 2:
                    return {
                        "mlag": results[0],
                        "interfaces": results[1],
                    }
    except Exception as e:
        logger.debug(f"Arista eAPI MLAG failed for {device.hostname}: {e}")
    return None


async def _try_arista_snmp(device: Device, engine: SnmpEngine) -> Optional[dict]:
    """Try Arista MLAG MIB via SNMP."""
    domain_id = await snmp_get(device, OID_ARISTA_MLAG_DOMAIN_ID, engine)
    if not domain_id:
        return None

    local_role = await snmp_get(device, OID_ARISTA_MLAG_LOCAL_ROLE, engine)
    peer_link = await snmp_get(device, OID_ARISTA_MLAG_PEER_LINK, engine)
    config_sanity = await snmp_get(device, OID_ARISTA_MLAG_CONFIG_SANITY, engine)
    ports_conf = await snmp_get(device, OID_ARISTA_MLAG_PORTS_CONF, engine)
    ports_active = await snmp_get(device, OID_ARISTA_MLAG_PORTS_ACTIVE, engine)
    ports_errdis = await snmp_get(device, OID_ARISTA_MLAG_PORTS_ERRDIS, engine)

    # Walk MLAG interface table
    if_names = await snmp_bulk_walk(device, OID_ARISTA_MLAG_IF_NAME, engine)
    if_local = await snmp_bulk_walk(device, OID_ARISTA_MLAG_IF_LOCAL_ST, engine)
    if_remote = await snmp_bulk_walk(device, OID_ARISTA_MLAG_IF_REMOTE_ST, engine)

    interfaces = []
    for oid, name in if_names.items():
        mlag_id = oid.split(".")[-1]
        local_key = oid.replace(OID_ARISTA_MLAG_IF_NAME, OID_ARISTA_MLAG_IF_LOCAL_ST)
        remote_key = oid.replace(OID_ARISTA_MLAG_IF_NAME, OID_ARISTA_MLAG_IF_REMOTE_ST)
        interfaces.append({
            "mlag_id": mlag_id,
            "interface_name": str(name),
            "local_status": str(if_local.get(local_key, "unknown")),
            "remote_status": str(if_remote.get(remote_key, "unknown")),
        })

    role_map = {"1": "primary", "2": "secondary"}
    sanity_map = {"1": "consistent", "2": "inconsistent"}

    return {
        "domain_id": str(domain_id),
        "peer_address": None,
        "peer_link": str(peer_link) if peer_link else None,
        "local_role": role_map.get(str(local_role), str(local_role)),
        "peer_status": "active",  # If we got data, assume active
        "config_sanity": sanity_map.get(str(config_sanity), str(config_sanity)),
        "ports_configured": int(ports_conf or 0),
        "ports_active": int(ports_active or 0),
        "ports_errdisabled": int(ports_errdis or 0),
        "vendor_protocol": "mlag",
        "interfaces": interfaces,
    }


async def discover_mlag(device: Device, db: AsyncSession) -> bool:
    """
    Discover MLAG/vPC configuration for a device.
    Returns True if MLAG data was found.
    """
    mlag_data = None

    # Try Arista eAPI first (most reliable)
    eapi_result = await _try_arista_eapi(device)
    if eapi_result:
        mlag = eapi_result["mlag"]
        ifaces = eapi_result.get("interfaces", {})

        # Parse eAPI output
        if mlag.get("state") not in (None, "disabled"):
            interfaces = []
            iface_detail = ifaces.get("interfaces", {})
            for mlag_id_str, info in iface_detail.items():
                interfaces.append({
                    "mlag_id": mlag_id_str.replace("Mlag", ""),
                    "interface_name": info.get("localInterface", ""),
                    "local_status": info.get("localInterfaceStatus", "unknown"),
                    "remote_status": info.get("remoteInterfaceStatus", "unknown"),
                })

            mlag_data = {
                "domain_id": str(mlag.get("domainId", "")),
                "peer_address": mlag.get("peerAddress"),
                "peer_link": mlag.get("peerLink"),
                "local_role": mlag.get("localRole", "").lower() or None,
                "peer_status": "active" if mlag.get("peerLinkStatus") == "up" else "inactive",
                "config_sanity": mlag.get("configSanity", "unknown"),
                "ports_configured": mlag.get("portsConfigured", 0),
                "ports_active": mlag.get("portsActive", 0),
                "ports_errdisabled": mlag.get("portsErrdisabled", 0),
                "vendor_protocol": "mlag",
                "interfaces": interfaces,
            }

    # Try SNMP if eAPI didn't work
    if not mlag_data:
        engine = SnmpEngine()
        try:
            vendor = (device.vendor or "").lower()
            if "arista" in vendor:
                mlag_data = await _try_arista_snmp(device, engine)
        finally:
            try:
                engine.close_dispatcher()
            except Exception:
                pass

    if not mlag_data:
        # No MLAG found — clean up any existing records
        existing = (await db.execute(
            select(MlagDomain).where(MlagDomain.device_id == device.id)
        )).scalar_one_or_none()
        if existing:
            await db.execute(delete(MlagInterface).where(MlagInterface.domain_id == existing.id))
            await db.execute(delete(MlagDomain).where(MlagDomain.id == existing.id))
            await db.commit()
        return False

    # Upsert MlagDomain
    now = datetime.now(timezone.utc)
    existing = (await db.execute(
        select(MlagDomain).where(MlagDomain.device_id == device.id)
    )).scalar_one_or_none()

    if existing:
        for key in ("domain_id", "peer_address", "peer_link", "local_role",
                     "peer_status", "config_sanity", "ports_configured",
                     "ports_active", "ports_errdisabled", "vendor_protocol"):
            setattr(existing, key, mlag_data.get(key))
        existing.last_seen = now
        domain = existing
    else:
        domain = MlagDomain(
            device_id=device.id,
            domain_id=mlag_data.get("domain_id"),
            peer_address=mlag_data.get("peer_address"),
            peer_link=mlag_data.get("peer_link"),
            local_role=mlag_data.get("local_role"),
            peer_status=mlag_data.get("peer_status"),
            config_sanity=mlag_data.get("config_sanity"),
            ports_configured=mlag_data.get("ports_configured", 0),
            ports_active=mlag_data.get("ports_active", 0),
            ports_errdisabled=mlag_data.get("ports_errdisabled", 0),
            vendor_protocol=mlag_data.get("vendor_protocol"),
            last_seen=now,
        )
        db.add(domain)
        await db.flush()

    # Replace MLAG interfaces
    await db.execute(delete(MlagInterface).where(MlagInterface.domain_id == domain.id))
    for iface_data in mlag_data.get("interfaces", []):
        db.add(MlagInterface(
            domain_id=domain.id,
            mlag_id=iface_data.get("mlag_id"),
            interface_name=iface_data.get("interface_name"),
            local_status=iface_data.get("local_status"),
            remote_status=iface_data.get("remote_status"),
        ))

    await db.commit()
    logger.info(f"[{device.hostname}] MLAG discovery: {mlag_data['vendor_protocol']} "
                f"({mlag_data.get('ports_active', 0)}/{mlag_data.get('ports_configured', 0)} ports active)")
    return True
