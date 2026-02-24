"""
Arista eAPI integration service.
Uses JSON-RPC 2.0 over HTTPS to interact with Arista EOS switches.
"""
import logging
import re
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.models.device import Device, DeviceBlock

logger = logging.getLogger(__name__)


async def arista_eapi(device: Device, commands: list[str], format: str = "json") -> list[dict]:
    """
    Execute one or more EOS commands via Arista eAPI (JSON-RPC 2.0).
    Returns a list of per-command result dicts.
    Raises httpx.HTTPStatusError or ValueError on failure.
    """
    from app.crypto import decrypt_value
    if not device.api_username or not device.api_password:
        raise ValueError(f"Device {device.hostname} has no eAPI credentials configured")

    api_password = decrypt_value(device.api_password)
    protocol = device.api_protocol or "https"
    port = device.api_port or 443
    url = f"{protocol}://{device.ip_address}:{port}/command-api"

    payload = {
        "jsonrpc": "2.0",
        "method": "runCmds",
        "params": {
            "version": 1,
            "cmds": commands,
            "format": format,
        },
        "id": "netmon-1",
    }

    from app.config import settings as _settings
    async with httpx.AsyncClient(verify=_settings.DEVICE_SSL_VERIFY, timeout=15.0) as client:
        resp = await client.post(
            url,
            json=payload,
            auth=(device.api_username, api_password),
        )
        resp.raise_for_status()
        data = resp.json()

    if "error" in data:
        raise ValueError(f"eAPI error from {device.hostname}: {data['error']}")

    return data.get("result", [])


async def fetch_null_routes(device: Device) -> list[str]:
    """
    Retrieve all null-route prefixes from the device.
    Runs 'show ip route static' (JSON) and filters for routes whose via
    interface is Null0.  Works on Arista EOS 4.32+.
    Returns list of CIDR prefix strings.
    """
    try:
        results = await arista_eapi(device, ["show ip route static"])
    except Exception as exc:
        logger.warning("fetch_null_routes failed for %s: %s", device.hostname, exc)
        return []

    prefixes: list[str] = []
    try:
        routes_dict = results[0].get("vrfs", {}).get("default", {}).get("routes", {})
        for prefix, route_info in routes_dict.items():
            # EOS represents Null0 routes as routeAction=drop / routeType=dropRoute
            # with an empty vias list, OR with a via pointing to Null0 interface
            route_action = route_info.get("routeAction", "")
            route_type = route_info.get("routeType", "")
            if route_action == "drop" or route_type == "dropRoute":
                prefixes.append(prefix)
                continue
            via_list = route_info.get("vias", [])
            for via in via_list:
                iface = via.get("interface", "")
                nexthop = via.get("nexthopAddr", "")
                if "Null" in iface or (nexthop == "0.0.0.0" and iface == ""):
                    prefixes.append(prefix)
                    break
    except (KeyError, AttributeError, TypeError) as exc:
        logger.warning("Parsing null routes for %s: %s", device.hostname, exc)

    return prefixes


async def fetch_flowspec_blocks(device: Device) -> list[str]:
    """
    Retrieve BGP flowspec rules from the device.
    Runs 'show bgp flow-spec ipv4' (text) and extracts destination prefixes.
    Works on Arista EOS 4.32+.
    Returns list of CIDR prefix strings.
    """
    try:
        results = await arista_eapi(device, ["show bgp flow-spec ipv4"], format="text")
    except Exception as exc:
        logger.warning("fetch_flowspec_blocks failed for %s: %s", device.hostname, exc)
        return []

    prefixes: list[str] = []
    try:
        text = results[0].get("output", "")
        # Pattern: lines starting with " Dst: x.x.x.x/yy" or "destination x.x.x.x/yy"
        for match in re.finditer(r"[Dd]st(?:ination)?[:\s]+(\d+\.\d+\.\d+\.\d+/\d+)", text):
            prefix = match.group(1)
            if prefix not in prefixes:
                prefixes.append(prefix)
    except (KeyError, AttributeError, TypeError) as exc:
        logger.warning("Parsing flowspec for %s: %s", device.hostname, exc)

    return prefixes


async def apply_null_route(device: Device, prefix: str) -> bool:
    """
    Install a null-route for *prefix* on the device via eAPI config mode.
    Returns True on success.
    """
    try:
        await arista_eapi(device, [
            "enable",
            "configure",
            f"ip route {prefix} Null0",
            "end",
        ])
        logger.info("Applied null route %s on %s", prefix, device.hostname)
        return True
    except Exception as exc:
        logger.error("apply_null_route %s on %s failed: %s", prefix, device.hostname, exc)
        return False


async def remove_null_route(device: Device, prefix: str) -> bool:
    """
    Remove the null-route for *prefix* from the device via eAPI config mode.
    Returns True on success.
    """
    try:
        await arista_eapi(device, [
            "enable",
            "configure",
            f"no ip route {prefix} Null0",
            "end",
        ])
        logger.info("Removed null route %s on %s", prefix, device.hostname)
        return True
    except Exception as exc:
        logger.error("remove_null_route %s on %s failed: %s", prefix, device.hostname, exc)
        return False


async def sync_device_blocks(device: Device, db: AsyncSession) -> dict[str, int]:
    """
    Pull current null-route and flowspec blocks from the device and sync
    them to the DeviceBlock table.  Returns counts.
    """
    null_prefixes = await fetch_null_routes(device)
    flow_prefixes = await fetch_flowspec_blocks(device)

    now = datetime.now(timezone.utc)

    # Load existing blocks for this device
    result = await db.execute(
        select(DeviceBlock).where(DeviceBlock.device_id == device.id)
    )
    existing: list[DeviceBlock] = list(result.scalars().all())

    existing_map: dict[tuple[str, str], DeviceBlock] = {
        (b.prefix, b.block_type): b for b in existing
    }

    seen: set[tuple[str, str]] = set()

    def _upsert(prefix: str, block_type: str) -> None:
        key = (prefix, block_type)
        seen.add(key)
        if key in existing_map:
            existing_map[key].is_active = True
            existing_map[key].synced_at = now
        else:
            db.add(DeviceBlock(
                device_id=device.id,
                prefix=prefix,
                block_type=block_type,
                is_active=True,
                synced_at=now,
            ))

    for p in null_prefixes:
        _upsert(p, "null_route")
    for p in flow_prefixes:
        _upsert(p, "flowspec")

    # Mark blocks no longer present on device as inactive
    for key, block in existing_map.items():
        if key not in seen:
            block.is_active = False
            block.synced_at = now

    await db.commit()

    return {
        "null_routes_synced": len(null_prefixes),
        "flowspec_synced": len(flow_prefixes),
        "total_active": len(seen),
    }
