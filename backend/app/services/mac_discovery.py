"""
MAC Address Table and ARP Table discovery via SNMP.

Walks BRIDGE-MIB / Q-BRIDGE-MIB for MAC→port mappings and
IP-MIB for ARP (IP→MAC) resolution.  Stores results in the
mac_address_entries table.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Optional

from pysnmp.hlapi.asyncio import SnmpEngine
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import Device
from app.models.interface import Interface
from app.models.mac_entry import MacAddressEntry
from app.services.snmp_poller import snmp_bulk_walk, make_auth_data

logger = logging.getLogger(__name__)

# ── SNMP OIDs ──────────────────────────────────────────────────────

# Q-BRIDGE-MIB (VLAN-aware, preferred)
OID_DOT1Q_TP_FDB_PORT = "1.3.6.1.2.1.17.7.1.2.2.1.2"  # dot1qTpFdbPort

# BRIDGE-MIB (fallback)
OID_DOT1D_TP_FDB_ADDRESS = "1.3.6.1.2.1.17.4.3.1.1"  # dot1dTpFdbAddress
OID_DOT1D_TP_FDB_PORT = "1.3.6.1.2.1.17.4.3.1.2"     # dot1dTpFdbPort
OID_DOT1D_TP_FDB_STATUS = "1.3.6.1.2.1.17.4.3.1.3"   # dot1dTpFdbStatus

# Bridge port → ifIndex mapping
OID_DOT1D_BASE_PORT_IFINDEX = "1.3.6.1.2.1.17.1.4.1.2"  # dot1dBasePortIfIndex

# ARP (IP-MIB)
OID_IP_NET_TO_MEDIA_PHYS = "1.3.6.1.2.1.4.22.1.2"     # ipNetToMediaPhysAddress
OID_IP_NET_TO_MEDIA_NET = "1.3.6.1.2.1.4.22.1.3"       # ipNetToMediaNetAddress

# Top OUI prefixes (first 3 bytes of MAC) → vendor name
# This is a compact set of the most common vendors in datacenter/enterprise
OUI_PREFIXES: Dict[str, str] = {
    "00:00:0C": "Cisco",
    "00:01:42": "Cisco",
    "00:0C:29": "VMware",
    "00:0D:3A": "Microsoft",
    "00:10:18": "Broadcom",
    "00:12:43": "Cisco",
    "00:14:22": "Dell",
    "00:15:5D": "Microsoft Hyper-V",
    "00:17:0E": "Cisco",
    "00:1A:A0": "Dell",
    "00:1B:21": "Intel",
    "00:1C:73": "Arista",
    "00:1D:E5": "Cisco",
    "00:1E:67": "Intel",
    "00:22:19": "Dell",
    "00:23:04": "Cisco",
    "00:25:90": "Super Micro",
    "00:26:88": "Juniper",
    "00:30:48": "Super Micro",
    "00:50:56": "VMware",
    "00:E0:4C": "Realtek",
    "02:42:AC": "Docker",
    "08:00:27": "VirtualBox",
    "0C:C4:7A": "Super Micro",
    "0C:73:EB": "Cisco",
    "14:18:77": "Dell",
    "18:03:73": "Dell",
    "18:66:DA": "Dell",
    "1C:1B:0D": "Dell",
    "20:67:7C": "Dell",
    "24:6E:96": "Dell",
    "28:99:3A": "Arista",
    "2C:33:11": "Cisco",
    "34:17:EB": "Dell",
    "3C:FD:FE": "Intel",
    "40:A8:F0": "Intel",
    "44:38:39": "Cumulus/NVIDIA",
    "48:DF:37": "Cisco",
    "50:6B:8D": "Dell",
    "50:9A:4C": "Dell",
    "54:BF:64": "Dell",
    "58:8D:09": "Cisco",
    "68:05:CA": "Intel",
    "68:CA:E4": "Cisco",
    "6C:2B:59": "Dell",
    "70:B5:E8": "Cisco",
    "74:86:7A": "Dell",
    "7C:AD:74": "Cisco",
    "80:61:5F": "Cisco",
    "84:B8:02": "Dell",
    "88:51:FB": "Hewlett Packard",
    "8C:DC:D4": "Cisco",
    "90:B1:1C": "Dell",
    "94:18:82": "Cisco",
    "98:5D:82": "Cisco",
    "A0:36:9F": "Intel",
    "A4:BF:01": "Intel",
    "AC:1F:6B": "Super Micro",
    "B0:26:28": "Cisco",
    "B0:83:FE": "Dell",
    "B4:96:91": "Intel",
    "B4:DE:31": "Cisco",
    "BC:30:5B": "Dell",
    "C0:8C:60": "Cisco",
    "C4:F7:D5": "Cisco",
    "C8:1F:66": "Cisco",
    "CC:46:D6": "Cisco",
    "D0:43:1E": "Dell",
    "D0:67:E5": "Dell",
    "D4:BE:D9": "Dell",
    "D8:B1:90": "Cisco",
    "E0:07:1B": "Hewlett Packard",
    "E0:DB:55": "Cisco",
    "E4:43:4B": "Intel",
    "EC:F4:BB": "Dell",
    "F0:1F:AF": "Dell",
    "F0:4D:A2": "Dell",
    "F4:03:43": "Cisco",
    "F8:B1:56": "Dell",
    "FC:15:B4": "Dell",
}


def _format_mac(raw) -> Optional[str]:
    """Convert raw SNMP MAC bytes to 'AA:BB:CC:DD:EE:FF' format."""
    try:
        if isinstance(raw, bytes):
            if len(raw) == 6:
                return ":".join(f"{b:02X}" for b in raw)
        if isinstance(raw, str):
            # Already formatted?
            clean = raw.replace(":", "").replace("-", "").replace(".", "")
            if len(clean) == 12:
                return ":".join(clean[i:i+2].upper() for i in range(0, 12, 2))
            # Hex-encoded bytes from pysnmp — "0x..." prefix
            if raw.startswith("0x") and len(raw) == 14:
                return ":".join(raw[i:i+2].upper() for i in range(2, 14, 2))
        # Try interpreting as OctetString
        s = str(raw)
        if s.startswith("0x") and len(s) == 14:
            return ":".join(s[i:i+2].upper() for i in range(2, 14, 2))
    except Exception:
        pass
    return None


def _mac_from_oid_suffix(oid: str, base_oid: str) -> Optional[str]:
    """Extract MAC address from OID index suffix (6 decimal octets)."""
    suffix = oid[len(base_oid):].lstrip(".")
    parts = suffix.split(".")
    if len(parts) >= 6:
        try:
            # Take last 6 parts as MAC octets
            mac_parts = parts[-6:]
            return ":".join(f"{int(p):02X}" for p in mac_parts)
        except ValueError:
            pass
    return None


def lookup_oui(mac: str) -> Optional[str]:
    """Look up vendor from MAC OUI prefix."""
    prefix = mac[:8].upper()
    return OUI_PREFIXES.get(prefix)


async def discover_mac_table(device: Device, db: AsyncSession) -> int:
    """
    Walk the MAC address table on a switch via SNMP.
    Returns count of MAC entries discovered/updated.
    """
    engine = SnmpEngine()
    try:
        # Step 1: Get bridge-port to ifIndex mapping
        bp_to_ifindex: Dict[int, int] = {}
        bp_data = await snmp_bulk_walk(device, OID_DOT1D_BASE_PORT_IFINDEX, engine)
        for oid, val in bp_data.items():
            try:
                bp_num = int(oid.split(".")[-1])
                bp_to_ifindex[bp_num] = int(val)
            except (ValueError, TypeError):
                continue

        # Step 2: Get interface ifIndex → interface_id mapping
        ifaces = (await db.execute(
            select(Interface).where(Interface.device_id == device.id)
        )).scalars().all()
        ifindex_to_iface: Dict[int, Interface] = {}
        for iface in ifaces:
            if iface.if_index is not None:
                ifindex_to_iface[iface.if_index] = iface

        # Step 3: Try Q-BRIDGE-MIB first (VLAN-aware)
        mac_entries: list[dict] = []
        q_bridge_data = await snmp_bulk_walk(device, OID_DOT1Q_TP_FDB_PORT, engine)

        if q_bridge_data:
            logger.info(f"[{device.hostname}] Q-BRIDGE-MIB: {len(q_bridge_data)} entries")
            for oid, bridge_port in q_bridge_data.items():
                # OID format: dot1qTpFdbPort.<vlan_id>.<mac_bytes_as_6_ints>
                suffix = oid[len(OID_DOT1Q_TP_FDB_PORT):].lstrip(".")
                parts = suffix.split(".")
                if len(parts) < 7:
                    continue
                try:
                    vlan_id = int(parts[0])
                    mac = ":".join(f"{int(p):02X}" for p in parts[1:7])
                    bp = int(bridge_port)
                except (ValueError, TypeError):
                    continue

                ifindex = bp_to_ifindex.get(bp)
                iface = ifindex_to_iface.get(ifindex) if ifindex else None

                mac_entries.append({
                    "mac_address": mac,
                    "vlan_id": vlan_id,
                    "interface_id": iface.id if iface else None,
                    "entry_type": "dynamic",
                })
        else:
            # Fallback: BRIDGE-MIB
            fdb_port_data = await snmp_bulk_walk(device, OID_DOT1D_TP_FDB_PORT, engine)
            fdb_addr_data = await snmp_bulk_walk(device, OID_DOT1D_TP_FDB_ADDRESS, engine)
            fdb_status_data = await snmp_bulk_walk(device, OID_DOT1D_TP_FDB_STATUS, engine)

            if fdb_port_data:
                logger.info(f"[{device.hostname}] BRIDGE-MIB: {len(fdb_port_data)} entries")
                for oid, bridge_port in fdb_port_data.items():
                    mac = _mac_from_oid_suffix(oid, OID_DOT1D_TP_FDB_PORT)
                    if not mac:
                        # Try reading from address table
                        addr_oid = oid.replace(OID_DOT1D_TP_FDB_PORT, OID_DOT1D_TP_FDB_ADDRESS)
                        raw_mac = fdb_addr_data.get(addr_oid)
                        if raw_mac:
                            mac = _format_mac(raw_mac)
                    if not mac:
                        continue

                    try:
                        bp = int(bridge_port)
                    except (ValueError, TypeError):
                        continue

                    # Determine entry type from status
                    status_oid = oid.replace(OID_DOT1D_TP_FDB_PORT, OID_DOT1D_TP_FDB_STATUS)
                    status_val = fdb_status_data.get(status_oid)
                    entry_type = "dynamic"
                    if status_val is not None:
                        try:
                            s = int(status_val)
                            entry_type = {1: "other", 2: "invalid", 3: "dynamic", 4: "static", 5: "self"}.get(s, "dynamic")
                        except (ValueError, TypeError):
                            pass

                    ifindex = bp_to_ifindex.get(bp)
                    iface = ifindex_to_iface.get(ifindex) if ifindex else None

                    mac_entries.append({
                        "mac_address": mac,
                        "vlan_id": None,
                        "interface_id": iface.id if iface else None,
                        "entry_type": entry_type,
                    })

        # Step 4: Discover ARP table for IP resolution
        arp_ip_to_mac: Dict[str, str] = {}
        arp_data = await snmp_bulk_walk(device, OID_IP_NET_TO_MEDIA_PHYS, engine)
        for oid, raw_mac in arp_data.items():
            mac = _format_mac(raw_mac)
            if not mac:
                continue
            # OID suffix is ifIndex.ip_octets
            suffix = oid[len(OID_IP_NET_TO_MEDIA_PHYS):].lstrip(".")
            parts = suffix.split(".")
            if len(parts) >= 5:
                ip = ".".join(parts[1:5])
                arp_ip_to_mac[mac] = ip

        logger.info(f"[{device.hostname}] ARP table: {len(arp_ip_to_mac)} entries")

        # Step 5: Resolve hostnames from device table
        all_devices = (await db.execute(select(Device))).scalars().all()
        ip_to_hostname: Dict[str, str] = {}
        for d in all_devices:
            if d.ip_address:
                ip_to_hostname[d.ip_address] = d.hostname

        # Step 6: Upsert MAC entries
        now = datetime.now(timezone.utc)
        count = 0

        for entry in mac_entries:
            mac = entry["mac_address"]
            if not mac or mac == "00:00:00:00:00:00" or mac == "FF:FF:FF:FF:FF:FF":
                continue

            ip = arp_ip_to_mac.get(mac)
            hostname = ip_to_hostname.get(ip) if ip else None
            vendor = lookup_oui(mac)

            # Check if exists
            existing = (await db.execute(
                select(MacAddressEntry).where(
                    MacAddressEntry.device_id == device.id,
                    MacAddressEntry.mac_address == mac,
                )
            )).scalar_one_or_none()

            if existing:
                existing.interface_id = entry["interface_id"]
                existing.vlan_id = entry["vlan_id"] or existing.vlan_id
                existing.ip_address = ip or existing.ip_address
                existing.hostname = hostname or existing.hostname
                existing.vendor = vendor or existing.vendor
                existing.entry_type = entry["entry_type"]
                existing.last_seen = now
            else:
                db.add(MacAddressEntry(
                    mac_address=mac,
                    device_id=device.id,
                    interface_id=entry["interface_id"],
                    vlan_id=entry["vlan_id"],
                    ip_address=ip,
                    hostname=hostname,
                    vendor=vendor,
                    entry_type=entry["entry_type"],
                    first_seen=now,
                    last_seen=now,
                ))
            count += 1

        await db.commit()
        logger.info(f"[{device.hostname}] MAC table: {count} entries upserted")
        return count

    except Exception as e:
        logger.error(f"[{device.hostname}] MAC discovery error: {e}")
        await db.rollback()
        return 0
    finally:
        try:
            engine.close_dispatcher()
        except Exception:
            pass
