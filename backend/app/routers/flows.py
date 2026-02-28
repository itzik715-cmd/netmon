from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, or_, and_, case, extract, literal_column
from typing import Optional, List
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from ipaddress import ip_network, ip_address
from pydantic import BaseModel, field_validator
import hashlib
import json
import logging
from app.database import get_db
from app.models.flow import FlowRecord, FlowSummary5m
from app.models.device import Device, DeviceRoute
from app.models.owned_subnet import OwnedSubnet
from app.models.user import User
from app.middleware.rbac import get_current_user, require_operator_or_above
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/flows", tags=["Flow Analysis"])

# ── Redis cache helpers ──────────────────────────────────────────────────────

async def _cache_get(key: str):
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
        val = await r.get(key)
        await r.aclose()
        return json.loads(val) if val else None
    except Exception:
        return None

async def _cache_set(key: str, data, ttl_seconds: int = 60):
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
        await r.set(key, json.dumps(data, default=str), ex=ttl_seconds)
        await r.aclose()
    except Exception:
        pass

# ── Summary table routing helpers ────────────────────────────────────────────

def _should_use_summary(hours: int, start: Optional[str] = None, end: Optional[str] = None) -> bool:
    """Return True if the time range is long enough to benefit from the summary table."""
    if start:
        since = datetime.fromisoformat(start)
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        end_dt = datetime.fromisoformat(end) if end else datetime.now(timezone.utc)
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        span_hours = (end_dt - since).total_seconds() / 3600
        return span_hours >= 6
    return hours >= 6

def _time_filter_s(hours: int, start: Optional[str] = None, end: Optional[str] = None) -> list:
    """Build time-range filters for the summary table (bucket column)."""
    if start:
        since = datetime.fromisoformat(start)
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        filters = [FlowSummary5m.bucket >= since]
        if end:
            until = datetime.fromisoformat(end)
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            filters.append(FlowSummary5m.bucket <= until)
        return filters
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return [FlowSummary5m.bucket >= since]

def _device_filter_s(device_ids_str: Optional[str], device_id: Optional[int]) -> list:
    """Device filter clauses for the summary table."""
    if device_ids_str:
        ids = [int(x) for x in device_ids_str.split(",") if x.strip()]
        if ids:
            return [FlowSummary5m.device_id.in_(ids)]
    if device_id:
        return [FlowSummary5m.device_id == device_id]
    return []


class SubnetCreate(BaseModel):
    subnet: str
    note: Optional[str] = None

    @field_validator("subnet")
    @classmethod
    def validate_cidr(cls, v: str) -> str:
        net = ip_network(v, strict=False)
        return str(net)


class SubnetToggle(BaseModel):
    subnet: str
    is_active: bool


PROTOCOL_MAP = {1: "ICMP", 6: "TCP", 17: "UDP", 47: "GRE", 89: "OSPF"}

PORT_SERVICE_MAP: dict[int, str] = {
    20: "FTP Data", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP",
    53: "DNS", 67: "DHCP", 68: "DHCP", 69: "TFTP", 80: "HTTP",
    110: "POP3", 123: "NTP", 143: "IMAP", 161: "SNMP", 162: "SNMP Trap",
    179: "BGP", 389: "LDAP", 443: "HTTPS", 445: "SMB", 465: "SMTPS",
    500: "IKE", 514: "Syslog", 587: "SMTP", 636: "LDAPS", 853: "DoT",
    993: "IMAPS", 995: "POP3S", 1433: "MSSQL", 1521: "Oracle",
    3306: "MySQL", 3389: "RDP", 5432: "PostgreSQL", 5900: "VNC",
    6379: "Redis", 8080: "HTTP Alt", 8443: "HTTPS Alt", 9090: "Prometheus",
    6881: "BitTorrent", 6882: "BitTorrent", 6883: "BitTorrent",
    8006: "Proxmox", 8444: "Proxmox Backup", 3478: "STUN/TURN",
    1194: "OpenVPN", 51820: "WireGuard", 1723: "PPTP",
}

# Activity labels for security classification
PORT_ACTIVITY_MAP: dict[int, str] = {
    22: "SSH Sessions", 23: "Telnet", 80: "Web Browsing", 443: "Web Browsing",
    8080: "Web Browsing", 8443: "Web Browsing",
    25: "Email", 465: "Email", 587: "Email", 993: "Email", 995: "Email", 110: "Email", 143: "Email",
    53: "DNS", 853: "DNS",
    3389: "RDP Access", 5900: "VNC Access",
    21: "FTP Transfers", 20: "FTP Transfers", 69: "TFTP",
    445: "File Sharing", 139: "File Sharing",
    3306: "Database", 5432: "Database", 1433: "Database", 1521: "Database", 6379: "Database",
    161: "SNMP Monitoring", 162: "SNMP Monitoring", 514: "Syslog",
    8006: "Proxmox Management", 8444: "Proxmox Backup",
    6881: "BitTorrent", 6882: "BitTorrent", 6883: "BitTorrent",
    1194: "VPN", 51820: "VPN", 1723: "VPN", 500: "VPN",
    3478: "VoIP/STUN", 5060: "VoIP/SIP",
    179: "BGP Routing",
}


def _compute_behavior(services_accessed: list, services_served: list,
                      unique_src: int, unique_dst: int) -> dict:
    """Classify IP role and detected activities from service port analysis."""
    has_client = len(services_accessed) > 0
    has_server = len(services_served) > 0

    if has_client and has_server:
        role = "Client + Server"
    elif has_server:
        role = "Server"
    elif has_client:
        role = "Client"
    else:
        role = "Unknown"

    # Check for scanner behavior: many unique dst ports, low bytes per flow
    if unique_dst > 30 and unique_src <= 2:
        role = "Scanner"

    # Collect unique activities
    seen = set()
    activities = []
    for svc in services_accessed + services_served:
        port = svc.get("port", 0)
        activity = PORT_ACTIVITY_MAP.get(port)
        if activity and activity not in seen:
            seen.add(activity)
            activities.append(activity)
        elif not activity and port > 0:
            label = PORT_SERVICE_MAP.get(port)
            if label and label not in seen:
                seen.add(label)
                activities.append(label)

    return {"role": role, "activities": activities}


def _compute_threat_indicators(
    unique_src: int, unique_dst: int, unique_dst_ports: int, unique_src_ports: int,
    top_peer_pct: float, bytes_sent: int, bytes_received: int,
    protocols: list, timeline: list,
) -> dict:
    """Score 0-100 with flags based on heuristic indicators."""
    flags = []
    score = 0
    if unique_src > 50:
        flags.append({"id": "high_unique_sources", "label": f"{unique_src} unique sources", "weight": 25})
        score += 25
    if unique_dst_ports > 20:
        flags.append({"id": "high_unique_dst_ports", "label": f"{unique_dst_ports} dst ports probed", "weight": 20})
        score += 20
    if top_peer_pct > 70:
        flags.append({"id": "single_peer_dominance", "label": f"Top peer {top_peer_pct:.0f}% of traffic", "weight": 15})
        score += 15
    total = bytes_sent + bytes_received
    if total > 0:
        ratio = max(bytes_sent, bytes_received) / max(min(bytes_sent, bytes_received), 1)
        if ratio > 10 and min(bytes_sent, bytes_received) > 0:
            flags.append({"id": "asymmetric_traffic", "label": f"Asymmetric ratio {ratio:.0f}:1", "weight": 10})
            score += 10
    suspicious_protos = {"ICMP", "GRE", "ESP", "IPIP"}
    for p in protocols:
        if p.get("protocol", "").upper() in suspicious_protos and p.get("bytes", 0) > 1_000_000:
            flags.append({"id": "suspicious_protocol", "label": f"{p['protocol']} > 1 MB", "weight": 20})
            score += 20
            break
    if len(timeline) >= 3:
        vals = [b.get("bytes_in", 0) + b.get("bytes_out", 0) for b in timeline]
        avg_val = sum(vals) / len(vals)
        if avg_val > 0 and vals[-1] > avg_val * 3:
            flags.append({"id": "traffic_spike", "label": "Recent spike > 3x avg", "weight": 10})
            score += 10
    score = min(score, 100)
    if score >= 70:
        level = "critical"
    elif score >= 45:
        level = "high"
    elif score >= 20:
        level = "medium"
    else:
        level = "low"
    return {"score": score, "level": level, "flags": flags}


def _time_filter(model_ts, hours: int, start: Optional[str] = None, end: Optional[str] = None) -> list:
    """Build time-range filter clauses.  If start/end provided, use them; otherwise fall back to hours."""
    if start:
        since = datetime.fromisoformat(start)
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        filters = [model_ts >= since]
        if end:
            until = datetime.fromisoformat(end)
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            filters.append(model_ts <= until)
        return filters
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return [model_ts >= since]


@router.get("/devices")
async def get_flow_devices(
    hours: int = 1,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return devices that have sent flow records in the given time window."""
    time_filters = _time_filter(FlowRecord.timestamp, hours, start, end)
    rows = (await db.execute(
        select(FlowRecord.device_id, func.count(FlowRecord.id).label("flow_count"))
        .where(*time_filters)
        .where(FlowRecord.device_id.isnot(None))
        .group_by(FlowRecord.device_id)
        .order_by(desc("flow_count"))
    )).all()

    if not rows:
        return []

    id_to_count = {r.device_id: int(r.flow_count) for r in rows}
    devices = (await db.execute(
        select(Device).where(Device.id.in_(id_to_count.keys()))
    )).scalars().all()

    return [
        {
            "device_id": d.id,
            "hostname": d.hostname,
            "ip_address": d.ip_address,
            "flow_count": id_to_count.get(d.id, 0),
        }
        for d in sorted(devices, key=lambda d: -id_to_count.get(d.id, 0))
    ]


def _parse_spine_routes(rows) -> dict[str, list[str]]:
    """Parse spine device routes into a dict of CIDR -> list of device hostnames."""
    learned: dict[str, list[str]] = {}
    for r in rows:
        dest = r.destination
        if not dest or dest == "0.0.0.0":
            continue
        try:
            addr = ip_address(dest)
        except ValueError:
            continue
        if addr.is_private or addr.is_loopback or addr.is_link_local:
            continue
        prefix = r.prefix_len if r.prefix_len else 24
        try:
            net = ip_network(f"{dest}/{prefix}", strict=False)
            cidr = str(net)
            learned.setdefault(cidr, []).append(r.hostname)
        except ValueError:
            continue
    return learned


async def _load_owned_subnets(db: AsyncSession) -> list:
    """Load owned subnets for flow classification, respecting overrides."""
    rows = (await db.execute(
        select(DeviceRoute.destination, DeviceRoute.prefix_len, Device.hostname)
        .join(Device, Device.id == DeviceRoute.device_id)
        .where(Device.device_type == "spine")
    )).all()
    learned = _parse_spine_routes(rows)

    # Load overrides
    overrides = (await db.execute(select(OwnedSubnet))).scalars().all()
    ignored_cidrs = {o.subnet for o in overrides if not o.is_active}
    manual_nets = []
    for o in overrides:
        if o.source == "manual" and o.is_active:
            try:
                manual_nets.append(ip_network(o.subnet, strict=False))
            except ValueError:
                continue

    # Build final list: learned (minus ignored) + manual
    nets = []
    for cidr in learned:
        if cidr not in ignored_cidrs:
            try:
                nets.append(ip_network(cidr, strict=False))
            except ValueError:
                continue
    nets.extend(manual_nets)
    return nets


def _is_owned(ip_str: str, owned_nets: list) -> bool:
    """Check if an IP belongs to any owned subnet."""
    try:
        addr = ip_address(ip_str)
    except (ValueError, TypeError):
        return False
    return any(addr in net for net in owned_nets)


@router.get("/owned-subnets")
async def get_owned_subnets(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return merged list of learned + manual subnets with override status."""
    # 1. Load learned from spine routes
    rows = (await db.execute(
        select(DeviceRoute.destination, DeviceRoute.prefix_len, Device.hostname)
        .join(Device, Device.id == DeviceRoute.device_id)
        .where(Device.device_type == "spine")
    )).all()
    learned = _parse_spine_routes(rows)

    # 2. Load overrides from OwnedSubnet table
    overrides = (await db.execute(select(OwnedSubnet))).scalars().all()
    override_map = {o.subnet: o for o in overrides}

    # 3. Merge learned subnets
    results = []
    for cidr in sorted(learned):
        override = override_map.pop(cidr, None)
        net = ip_network(cidr, strict=False)
        results.append({
            "id": override.id if override else None,
            "subnet": cidr,
            "prefix_len": net.prefixlen,
            "source": "learned",
            "source_devices": sorted(set(learned[cidr])),
            "is_active": override.is_active if override else True,
            "note": override.note if override else None,
            "created_at": override.created_at.isoformat() if override and override.created_at else None,
        })

    # 4. Add remaining manual subnets
    for cidr, o in sorted(override_map.items()):
        if o.source == "manual":
            net = ip_network(cidr, strict=False)
            results.append({
                "id": o.id,
                "subnet": cidr,
                "prefix_len": net.prefixlen,
                "source": "manual",
                "source_devices": [],
                "is_active": o.is_active,
                "note": o.note,
                "created_at": o.created_at.isoformat() if o.created_at else None,
            })

    return results


@router.post("/owned-subnets", status_code=201)
async def create_owned_subnet(
    payload: SubnetCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above()),
):
    """Add a manual owned subnet."""
    existing = (await db.execute(
        select(OwnedSubnet).where(OwnedSubnet.subnet == payload.subnet)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Subnet already exists")

    subnet = OwnedSubnet(subnet=payload.subnet, source="manual", is_active=True, note=payload.note)
    db.add(subnet)
    await db.flush()
    await db.refresh(subnet)
    net = ip_network(subnet.subnet, strict=False)
    return {
        "id": subnet.id, "subnet": subnet.subnet, "prefix_len": net.prefixlen,
        "source": "manual", "source_devices": [], "is_active": True,
        "note": subnet.note, "created_at": subnet.created_at.isoformat() if subnet.created_at else None,
    }


@router.post("/owned-subnets/toggle")
async def toggle_owned_subnet(
    payload: SubnetToggle,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above()),
):
    """Toggle a subnet's active/ignored state."""
    cidr = str(ip_network(payload.subnet, strict=False))

    existing = (await db.execute(
        select(OwnedSubnet).where(OwnedSubnet.subnet == cidr)
    )).scalar_one_or_none()

    if existing:
        if existing.source == "learned" and payload.is_active:
            # Re-enabling a learned subnet — remove the override
            await db.delete(existing)
        else:
            existing.is_active = payload.is_active
    else:
        # Creating an ignore override for a learned subnet
        db.add(OwnedSubnet(subnet=cidr, source="learned", is_active=False))

    return {"status": "ok", "subnet": cidr, "is_active": payload.is_active}


@router.delete("/owned-subnets/{subnet_id}", status_code=204)
async def delete_owned_subnet(
    subnet_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above()),
):
    """Delete a manual subnet."""
    subnet = (await db.execute(
        select(OwnedSubnet).where(OwnedSubnet.id == subnet_id)
    )).scalar_one_or_none()
    if not subnet:
        raise HTTPException(status_code=404, detail="Subnet not found")
    if subnet.source != "manual":
        raise HTTPException(status_code=400, detail="Only manual subnets can be deleted")
    await db.delete(subnet)


def _device_filter(device_ids_str: Optional[str], device_id: Optional[int]) -> list:
    """Build SQLAlchemy filter clauses for device(s). device_ids takes precedence."""
    if device_ids_str:
        ids = [int(x) for x in device_ids_str.split(",") if x.strip()]
        if ids:
            return [FlowRecord.device_id.in_(ids)]
    if device_id:
        return [FlowRecord.device_id == device_id]
    return []


@router.get("/stats")
async def get_flow_stats(
    hours: int = 1,
    start: Optional[str] = None,
    end: Optional[str] = None,
    device_id: Optional[int] = None,
    device_ids: Optional[str] = None,   # comma-separated device IDs
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # ── Redis cache check ──
    cache_params = f"stats:{hours}:{start}:{end}:{device_id}:{device_ids}:{limit}"
    cache_key = f"flow:{hashlib.md5(cache_params.encode()).hexdigest()}"
    use_summary = _should_use_summary(hours, start, end)
    cache_ttl = 300 if use_summary else 30
    cached = await _cache_get(cache_key)
    if cached:
        return cached

    # ── Choose data source ──
    if use_summary:
        M = FlowSummary5m
        bf = _time_filter_s(hours, start, end) + _device_filter_s(device_ids, device_id)
        count_expr = func.sum(M.flow_count)
        bytes_expr = func.sum(M.bytes)
    else:
        M = FlowRecord
        bf = _time_filter(FlowRecord.timestamp, hours, start, end) + _device_filter(device_ids, device_id)
        count_expr = func.count(M.id)
        bytes_expr = func.sum(M.bytes)

    # Load owned subnets for inbound/outbound classification
    owned_nets = await _load_owned_subnets(db)

    # Top talkers
    talkers_q = await db.execute(
        select(M.src_ip, func.sum(M.bytes).label("total_bytes"))
        .where(*bf).group_by(M.src_ip).order_by(desc("total_bytes")).limit(limit)
    )
    top_talkers = [{"ip": row.src_ip, "bytes": int(row.total_bytes or 0)} for row in talkers_q]

    # Top destinations
    dest_q = await db.execute(
        select(M.dst_ip, func.sum(M.bytes).label("total_bytes"))
        .where(*bf).group_by(M.dst_ip).order_by(desc("total_bytes")).limit(limit)
    )
    top_destinations = [{"ip": row.dst_ip, "bytes": int(row.total_bytes or 0)} for row in dest_q]

    # ── Inbound / Outbound classification ──
    flow_rows = (await db.execute(
        select(
            M.src_ip, M.dst_ip, M.src_port, M.dst_port, M.protocol_name,
            func.sum(M.bytes).label("bytes"),
            count_expr.label("flows"),
        ).where(*bf)
        .group_by(M.src_ip, M.dst_ip, M.src_port, M.dst_port, M.protocol_name)
        .order_by(desc("bytes")).limit(500)
    )).all()

    inbound_by_ip: dict[str, dict] = {}
    outbound_by_ip: dict[str, dict] = {}
    total_inbound = 0
    total_outbound = 0

    def _add_inbound(ext_ip: str, internal_ip: str, svc_port: int, b: int, f: int):
        nonlocal total_inbound
        # Key by internal (destination) IP — shows which of OUR IPs receive the most traffic
        if internal_ip not in inbound_by_ip:
            inbound_by_ip[internal_ip] = {"bytes": 0, "flows": 0, "services": {}, "source_ips": {}}
        inbound_by_ip[internal_ip]["bytes"] += b
        inbound_by_ip[internal_ip]["flows"] += f
        if svc_port > 0:
            inbound_by_ip[internal_ip]["services"][svc_port] = inbound_by_ip[internal_ip]["services"].get(svc_port, 0) + b
        inbound_by_ip[internal_ip]["source_ips"][ext_ip] = inbound_by_ip[internal_ip]["source_ips"].get(ext_ip, 0) + b
        total_inbound += b

    def _add_outbound(ext_ip: str, internal_ip: str, svc_port: int, b: int, f: int):
        nonlocal total_outbound
        if ext_ip not in outbound_by_ip:
            outbound_by_ip[ext_ip] = {"bytes": 0, "flows": 0, "services": {}, "internal_ips": {}}
        outbound_by_ip[ext_ip]["bytes"] += b
        outbound_by_ip[ext_ip]["flows"] += f
        if svc_port > 0:
            outbound_by_ip[ext_ip]["services"][svc_port] = outbound_by_ip[ext_ip]["services"].get(svc_port, 0) + b
        outbound_by_ip[ext_ip]["internal_ips"][internal_ip] = outbound_by_ip[ext_ip]["internal_ips"].get(internal_ip, 0) + b
        total_outbound += b

    for r in flow_rows:
        src_owned = _is_owned(r.src_ip, owned_nets)
        dst_owned = _is_owned(r.dst_ip, owned_nets)
        b = int(r.bytes or 0)
        f = int(r.flows or 0)
        src_port = int(r.src_port) if r.src_port else 0
        dst_port = int(r.dst_port) if r.dst_port else 0

        if dst_owned and not src_owned:
            # dst is ours, src is external
            internal_ip = r.dst_ip
            src_is_service = src_port in PORT_SERVICE_MAP and src_port < 10000
            dst_is_service = dst_port in PORT_SERVICE_MAP and dst_port < 10000

            if src_is_service and not dst_is_service:
                _add_outbound(r.src_ip, internal_ip, src_port, b, f)
            elif dst_is_service and not src_is_service:
                _add_inbound(r.src_ip, internal_ip, dst_port, b, f)
            else:
                if src_port > 0 and (dst_port == 0 or src_port < dst_port):
                    _add_outbound(r.src_ip, internal_ip, src_port, b, f)
                else:
                    _add_inbound(r.src_ip, internal_ip, dst_port, b, f)

        elif src_owned and not dst_owned:
            # src is ours, dst is external
            internal_ip = r.src_ip
            _add_outbound(r.dst_ip, internal_ip, dst_port, b, f)

    def _build_top_outbound(by_ip: dict, total: int) -> list:
        items = sorted(by_ip.items(), key=lambda x: -x[1]["bytes"])[:limit]
        result = []
        for ext_ip, data in items:
            svcs = data["services"]
            if svcs:
                top_port = max(svcs, key=svcs.get)
                svc_name = PORT_SERVICE_MAP.get(top_port, f"port/{top_port}")
            else:
                top_port = 0
                svc_name = ""
            int_ips = data.get("internal_ips", {})
            top_internal = [
                {"ip": ip, "bytes": byt}
                for ip, byt in sorted(int_ips.items(), key=lambda x: -x[1])[:5]
            ]
            result.append({
                "ip": ext_ip, "bytes": data["bytes"], "flows": data["flows"],
                "service_port": top_port, "service_name": svc_name,
                "pct": round(data["bytes"] / total * 100, 1) if total > 0 else 0,
                "internal_ips": top_internal,
            })
        return result

    def _build_top_inbound(by_ip: dict, total: int) -> list:
        """Build top inbound list keyed by internal destination IP."""
        items = sorted(by_ip.items(), key=lambda x: -x[1]["bytes"])[:limit]
        result = []
        for dest_ip, data in items:
            svcs = data["services"]
            if svcs:
                top_port = max(svcs, key=svcs.get)
                svc_name = PORT_SERVICE_MAP.get(top_port, f"port/{top_port}")
            else:
                top_port = 0
                svc_name = ""
            # External source IPs sorted by traffic (top 5)
            src_ips = data.get("source_ips", {})
            top_sources = [
                {"ip": ip, "bytes": byt}
                for ip, byt in sorted(src_ips.items(), key=lambda x: -x[1])[:5]
            ]
            result.append({
                "ip": dest_ip, "bytes": data["bytes"], "flows": data["flows"],
                "service_port": top_port, "service_name": svc_name,
                "pct": round(data["bytes"] / total * 100, 1) if total > 0 else 0,
                "source_ips": top_sources,
            })
        return result

    top_inbound = _build_top_inbound(inbound_by_ip, total_inbound)
    top_outbound = _build_top_outbound(outbound_by_ip, total_outbound)

    # Protocol distribution
    proto_q = await db.execute(
        select(M.protocol_name, count_expr.label("count"), func.sum(M.bytes).label("bytes"))
        .where(*bf).group_by(M.protocol_name).order_by(desc("bytes"))
    )
    protocol_dist = [
        {"protocol": row.protocol_name or "Unknown", "count": int(row.count), "bytes": int(row.bytes or 0)}
        for row in proto_q
    ]

    # Application distribution
    app_q = await db.execute(
        select(M.application, count_expr.label("count"), func.sum(M.bytes).label("bytes"))
        .where(*bf).group_by(M.application).order_by(desc("bytes")).limit(limit)
    )
    app_dist = [
        {"app": row.application or "Unknown", "count": int(row.count), "bytes": int(row.bytes or 0)}
        for row in app_q
    ]

    # Total stats
    total_q = await db.execute(
        select(count_expr.label("flows"), bytes_expr.label("bytes")).where(*bf)
    )
    total_row = total_q.first()

    result = {
        "top_talkers": top_talkers,
        "top_destinations": top_destinations,
        "top_inbound": top_inbound,
        "top_outbound": top_outbound,
        "total_inbound": total_inbound,
        "total_outbound": total_outbound,
        "protocol_distribution": protocol_dist,
        "application_distribution": app_dist,
        "total_flows": int(total_row.flows or 0),
        "total_bytes": int(total_row.bytes or 0),
    }
    await _cache_set(cache_key, result, cache_ttl)
    return result


@router.get("/conversations")
async def get_conversations(
    hours: int = 1,
    start: Optional[str] = None,
    end: Optional[str] = None,
    device_id: Optional[int] = None,
    device_ids: Optional[str] = None,  # comma-separated device IDs
    ip: Optional[str] = None,          # match either src OR dst
    src_ip: Optional[str] = None,
    dst_ip: Optional[str] = None,
    protocol: Optional[str] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    use_summary = _should_use_summary(hours, start, end)

    # When filtering by a specific IP, return aggregated top conversations
    # grouped by peer IP with total bytes, instead of raw individual flows.
    if ip:
        if use_summary:
            M = FlowSummary5m
            tf = _time_filter_s(hours, start, end)
            df = _device_filter_s(device_ids, device_id)
            peer_ip = case((M.src_ip == ip, M.dst_ip), else_=M.src_ip).label("peer_ip")
            query = (
                select(
                    peer_ip,
                    func.sum(M.bytes).label("bytes"),
                    func.sum(M.packets).label("packets"),
                    func.sum(M.flow_count).label("flow_count"),
                )
                .where(*tf, *df, or_(M.src_ip == ip, M.dst_ip == ip))
                .group_by("peer_ip").order_by(desc("bytes")).limit(limit)
            )
            if protocol:
                query = query.where(M.protocol_name == protocol.upper())
        else:
            tf = _time_filter(FlowRecord.timestamp, hours, start, end)
            df = list(_device_filter(device_ids, device_id))
            peer_ip = case((FlowRecord.src_ip == ip, FlowRecord.dst_ip), else_=FlowRecord.src_ip).label("peer_ip")
            query = (
                select(
                    peer_ip,
                    func.sum(FlowRecord.bytes).label("bytes"),
                    func.sum(FlowRecord.packets).label("packets"),
                    func.count(FlowRecord.id).label("flow_count"),
                )
                .where(*tf, *df, or_(FlowRecord.src_ip == ip, FlowRecord.dst_ip == ip))
                .group_by("peer_ip").order_by(desc("bytes")).limit(limit)
            )
            if protocol:
                query = query.where(FlowRecord.protocol_name == protocol.upper())

        result = await db.execute(query)
        rows = result.all()
        return [
            {
                "peer_ip": r.peer_ip,
                "bytes": int(r.bytes or 0),
                "packets": int(r.packets or 0),
                "flow_count": int(r.flow_count or 0),
                "aggregated": True,
            }
            for r in rows
        ]

    # No IP filter — return raw individual flow records (always raw table)
    time_filters = _time_filter(FlowRecord.timestamp, hours, start, end)
    device_filters = list(_device_filter(device_ids, device_id))
    query = select(FlowRecord).where(*time_filters)
    for clause in device_filters:
        query = query.where(clause)
    if src_ip:
        query = query.where(FlowRecord.src_ip == src_ip)
    elif dst_ip:
        query = query.where(FlowRecord.dst_ip == dst_ip)
    if protocol:
        query = query.where(FlowRecord.protocol_name == protocol.upper())

    query = query.order_by(desc(FlowRecord.bytes)).limit(limit)
    result = await db.execute(query)
    flows = result.scalars().all()

    return [
        {
            "id": f.id,
            "src_ip": f.src_ip,
            "dst_ip": f.dst_ip,
            "src_port": f.src_port,
            "dst_port": f.dst_port,
            "protocol": f.protocol_name,
            "bytes": f.bytes,
            "packets": f.packets,
            "application": f.application,
            "timestamp": f.timestamp.isoformat() if f.timestamp else None,
            "src_service": PORT_SERVICE_MAP.get(f.src_port, "") if f.src_port else "",
            "dst_service": PORT_SERVICE_MAP.get(f.dst_port, "") if f.dst_port else "",
        }
        for f in flows
    ]


@router.get("/peer-detail")
async def get_peer_detail(
    ip: str,
    peer: str,
    hours: int = 1,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return detailed conversation analysis between two IPs."""
    # Ensure the owned/local IP is always 'ip' (primary perspective)
    owned_nets = await _load_owned_subnets(db)
    ip_owned = _is_owned(ip, owned_nets)
    peer_owned = _is_owned(peer, owned_nets)
    if peer_owned and not ip_owned:
        ip, peer = peer, ip

    # Cache check
    use_summary = _should_use_summary(hours, start, end)
    cp = f"peer_detail:{ip}:{peer}:{hours}:{start}:{end}"
    ck = f"flow:{hashlib.md5(cp.encode()).hexdigest()}"
    cached = await _cache_get(ck)
    if cached:
        return cached

    time_filters = _time_filter(FlowRecord.timestamp, hours, start, end)
    pair_filter = [
        *time_filters,
        or_(
            and_(FlowRecord.src_ip == ip, FlowRecord.dst_ip == peer),
            and_(FlowRecord.src_ip == peer, FlowRecord.dst_ip == ip),
        ),
    ]

    # ── 1. Direction totals ──
    dir_row = (await db.execute(
        select(
            func.sum(case(
                (FlowRecord.src_ip == ip, FlowRecord.bytes), else_=literal_column("0")
            )).label("bytes_from_ip"),
            func.sum(case(
                (FlowRecord.src_ip == peer, FlowRecord.bytes), else_=literal_column("0")
            )).label("bytes_from_peer"),
            func.count(case(
                (FlowRecord.src_ip == ip, FlowRecord.id), else_=None
            )).label("flows_from_ip"),
            func.count(case(
                (FlowRecord.src_ip == peer, FlowRecord.id), else_=None
            )).label("flows_from_peer"),
            func.sum(FlowRecord.packets).label("total_packets"),
        ).where(*pair_filter)
    )).first()

    bytes_from_ip = int(dir_row.bytes_from_ip or 0)
    bytes_from_peer = int(dir_row.bytes_from_peer or 0)
    flows_from_ip = int(dir_row.flows_from_ip or 0)
    flows_from_peer = int(dir_row.flows_from_peer or 0)
    total_bytes = bytes_from_ip + bytes_from_peer
    total_flows = flows_from_ip + flows_from_peer

    # ── 2. Services between them ──
    # src_port when peer→ip (service the peer provides, accessed by ip = outbound from ip's perspective)
    svc_out_rows = (await db.execute(
        select(
            FlowRecord.src_port.label("port"),
            FlowRecord.protocol_name.label("proto"),
            func.sum(FlowRecord.bytes).label("bytes"),
            func.count(FlowRecord.id).label("flows"),
        ).where(*time_filters, FlowRecord.src_ip == peer, FlowRecord.dst_ip == ip)
        .where(FlowRecord.src_port.isnot(None), FlowRecord.src_port > 0)
        .group_by(FlowRecord.src_port, FlowRecord.protocol_name)
        .order_by(desc("bytes")).limit(10)
    )).all()
    services_outbound = [
        {"port": int(r.port), "service": PORT_SERVICE_MAP.get(int(r.port), f"port/{r.port}"),
         "protocol": r.proto or "", "bytes": int(r.bytes or 0), "flows": int(r.flows or 0),
         "direction": "outbound"}
        for r in svc_out_rows
    ]

    # dst_port when peer→ip (service on ip's side = inbound to ip)
    svc_in_rows = (await db.execute(
        select(
            FlowRecord.dst_port.label("port"),
            FlowRecord.protocol_name.label("proto"),
            func.sum(FlowRecord.bytes).label("bytes"),
            func.count(FlowRecord.id).label("flows"),
        ).where(*time_filters, FlowRecord.src_ip == peer, FlowRecord.dst_ip == ip)
        .where(FlowRecord.dst_port.isnot(None), FlowRecord.dst_port > 0)
        .group_by(FlowRecord.dst_port, FlowRecord.protocol_name)
        .order_by(desc("bytes")).limit(10)
    )).all()
    services_inbound = [
        {"port": int(r.port), "service": PORT_SERVICE_MAP.get(int(r.port), f"port/{r.port}"),
         "protocol": r.proto or "", "bytes": int(r.bytes or 0), "flows": int(r.flows or 0),
         "direction": "inbound"}
        for r in svc_in_rows
    ]

    # Also check reverse direction (ip→peer)
    svc_rev_rows = (await db.execute(
        select(
            FlowRecord.dst_port.label("port"),
            FlowRecord.protocol_name.label("proto"),
            func.sum(FlowRecord.bytes).label("bytes"),
            func.count(FlowRecord.id).label("flows"),
        ).where(*time_filters, FlowRecord.src_ip == ip, FlowRecord.dst_ip == peer)
        .where(FlowRecord.dst_port.isnot(None), FlowRecord.dst_port > 0)
        .group_by(FlowRecord.dst_port, FlowRecord.protocol_name)
        .order_by(desc("bytes")).limit(10)
    )).all()
    for r in svc_rev_rows:
        services_outbound.append({
            "port": int(r.port), "service": PORT_SERVICE_MAP.get(int(r.port), f"port/{r.port}"),
            "protocol": r.proto or "", "bytes": int(r.bytes or 0), "flows": int(r.flows or 0),
            "direction": "outbound",
        })

    # Deduplicate and merge services
    svc_merged: dict[str, dict] = {}
    for s in services_outbound + services_inbound:
        key = f"{s['port']}-{s['protocol']}-{s['direction']}"
        if key in svc_merged:
            svc_merged[key]["bytes"] += s["bytes"]
            svc_merged[key]["flows"] += s["flows"]
        else:
            svc_merged[key] = dict(s)
    services = sorted(svc_merged.values(), key=lambda x: -x["bytes"])[:12]

    # ── 3. Timeline between them ──
    if hours <= 6:
        bucket_seconds = 300
    elif hours <= 24:
        bucket_seconds = 900
    else:
        bucket_seconds = 3600

    epoch = extract("epoch", FlowRecord.timestamp)
    bucket_ts = func.to_timestamp(func.floor(epoch / bucket_seconds) * bucket_seconds).label("bucket")

    tl_rows = (await db.execute(
        select(
            bucket_ts,
            func.sum(case(
                (FlowRecord.src_ip == peer, FlowRecord.bytes), else_=literal_column("0")
            )).label("bytes_from_peer"),
            func.sum(case(
                (FlowRecord.src_ip == ip, FlowRecord.bytes), else_=literal_column("0")
            )).label("bytes_from_ip"),
            func.count(FlowRecord.id).label("flows"),
        ).where(*pair_filter)
        .group_by("bucket").order_by("bucket")
    )).all()
    timeline = [
        {"timestamp": r.bucket.isoformat() if hasattr(r.bucket, "isoformat") else str(r.bucket),
         "bytes_from_peer": int(r.bytes_from_peer or 0),
         "bytes_from_ip": int(r.bytes_from_ip or 0),
         "flows": int(r.flows or 0)}
        for r in tl_rows
    ]

    # ── 4. Protocol breakdown ──
    proto_rows = (await db.execute(
        select(
            FlowRecord.protocol_name,
            func.sum(FlowRecord.bytes).label("bytes"),
            func.count(FlowRecord.id).label("flows"),
        ).where(*pair_filter)
        .group_by(FlowRecord.protocol_name).order_by(desc("bytes"))
    )).all()
    protocols = [
        {"protocol": r.protocol_name or "Unknown", "bytes": int(r.bytes or 0), "flows": int(r.flows or 0)}
        for r in proto_rows
    ]

    # ── 5. Recent flows sample ──
    recent_rows = (await db.execute(
        select(FlowRecord).where(*pair_filter)
        .order_by(desc(FlowRecord.bytes)).limit(50)
    )).scalars().all()
    recent_flows = [
        {"id": f.id, "src_ip": f.src_ip, "dst_ip": f.dst_ip,
         "src_port": f.src_port, "dst_port": f.dst_port,
         "protocol": f.protocol_name, "bytes": f.bytes, "packets": f.packets,
         "timestamp": f.timestamp.isoformat() if f.timestamp else None,
         "src_service": PORT_SERVICE_MAP.get(f.src_port, "") if f.src_port else "",
         "dst_service": PORT_SERVICE_MAP.get(f.dst_port, "") if f.dst_port else ""}
        for f in recent_rows
    ]

    # ── 6. Country lookup for peer ──
    country_row = (await db.execute(
        select(func.max(FlowRecord.src_country).label("c"))
        .where(FlowRecord.src_ip == peer, FlowRecord.src_country.isnot(None))
    )).first()
    peer_country = country_row.c if country_row and country_row.c else ""
    if not peer_country:
        country_row2 = (await db.execute(
            select(func.max(FlowRecord.dst_country).label("c"))
            .where(FlowRecord.dst_ip == peer, FlowRecord.dst_country.isnot(None))
        )).first()
        peer_country = country_row2.c if country_row2 and country_row2.c else ""

    result = {
        "ip": ip,
        "peer": peer,
        "peer_country": peer_country,
        "bytes_from_ip": bytes_from_ip,
        "bytes_from_peer": bytes_from_peer,
        "flows_from_ip": flows_from_ip,
        "flows_from_peer": flows_from_peer,
        "total_bytes": total_bytes,
        "total_flows": total_flows,
        "total_packets": int(dir_row.total_packets or 0),
        "services": services,
        "timeline": timeline,
        "protocols": protocols,
        "recent_flows": recent_flows,
    }
    await _cache_set(ck, result, 300 if use_summary else 30)
    return result


@router.get("/ip-profile")
async def get_ip_profile(
    ip: str,
    hours: int = 1,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return a security-focused activity summary for a single IP address."""
    # ── Redis cache check ──
    use_summary = _should_use_summary(hours, start, end)
    cp = f"ip_profile:{ip}:{hours}:{start}:{end}"
    ck = f"flow:{hashlib.md5(cp.encode()).hexdigest()}"
    cache_ttl = 300 if use_summary else 30
    cached = await _cache_get(ck)
    if cached:
        return cached

    # ── Choose data source for aggregation queries ──
    if use_summary:
        M = FlowSummary5m
        tf = _time_filter_s(hours, start, end)
        both_dirs = [*tf, or_(M.src_ip == ip, M.dst_ip == ip)]
        count_expr = func.sum(M.flow_count)
    else:
        M = FlowRecord
        tf = _time_filter(FlowRecord.timestamp, hours, start, end)
        both_dirs = [*tf, or_(M.src_ip == ip, M.dst_ip == ip)]
        count_expr = func.count(M.id)

    # ── 1. Basic sent/received totals ────────────────────────
    sent_row = (await db.execute(
        select(func.sum(M.bytes), count_expr.label("cnt"))
        .where(*tf, M.src_ip == ip)
    )).first()
    recv_row = (await db.execute(
        select(func.sum(M.bytes), count_expr.label("cnt"))
        .where(*tf, M.dst_ip == ip)
    )).first()

    bytes_sent = int(sent_row[0] or 0)
    flows_as_src = int(sent_row[1] or 0)
    bytes_received = int(recv_row[0] or 0)
    flows_as_dst = int(recv_row[1] or 0)

    # ── 2. Top peers simple (both directions) ────────────────
    as_src = (await db.execute(
        select(M.dst_ip.label("peer"), func.sum(M.bytes).label("bytes"))
        .where(*tf, M.src_ip == ip)
        .group_by(M.dst_ip).order_by(desc("bytes")).limit(10)
    )).all()
    as_dst = (await db.execute(
        select(M.src_ip.label("peer"), func.sum(M.bytes).label("bytes"))
        .where(*tf, M.dst_ip == ip)
        .group_by(M.src_ip).order_by(desc("bytes")).limit(10)
    )).all()

    peer_bytes: dict[str, int] = {}
    for row in as_src:
        peer_bytes[row.peer] = peer_bytes.get(row.peer, 0) + int(row.bytes or 0)
    for row in as_dst:
        peer_bytes[row.peer] = peer_bytes.get(row.peer, 0) + int(row.bytes or 0)
    top_peers = sorted(
        [{"ip": k, "bytes": v} for k, v in peer_bytes.items()],
        key=lambda x: -x["bytes"],
    )[:8]
    top_out = [{"ip": r.peer, "bytes": int(r.bytes or 0)} for r in as_src]
    top_in  = [{"ip": r.peer, "bytes": int(r.bytes or 0)} for r in as_dst]

    # ── 3. Protocol distribution ─────────────────────────────
    proto_rows = (await db.execute(
        select(M.protocol_name,
               count_expr.label("count"),
               func.sum(M.bytes).label("bytes"))
        .where(*both_dirs)
        .group_by(M.protocol_name).order_by(desc("bytes"))
    )).all()
    protocols = [
        {"protocol": r.protocol_name or "Unknown",
         "count": int(r.count), "bytes": int(r.bytes or 0)}
        for r in proto_rows
    ]

    # ── 4. Top destination ports (old simple format kept as top_ports) ──
    port_rows = (await db.execute(
        select(M.dst_port.label("port"),
               func.sum(M.bytes).label("bytes"))
        .where(*both_dirs)
        .where(M.dst_port.isnot(None), M.dst_port > 0)
        .group_by(M.dst_port).order_by(desc("bytes")).limit(8)
    )).all()
    top_ports = [{"port": int(r.port), "bytes": int(r.bytes or 0)} for r in port_rows]

    # ── 5. Unique counts (single query) ──────────────────────
    uniq_row = (await db.execute(
        select(
            func.count(func.distinct(case(
                (M.dst_ip == ip, M.src_ip), else_=None
            ))).label("unique_src"),
            func.count(func.distinct(case(
                (M.src_ip == ip, M.dst_ip), else_=None
            ))).label("unique_dst"),
            func.count(func.distinct(M.dst_port)).label("unique_dst_ports"),
            func.count(func.distinct(M.src_port)).label("unique_src_ports"),
        ).where(*both_dirs)
    )).first()
    unique_src = int(uniq_row.unique_src or 0)
    unique_dst = int(uniq_row.unique_dst or 0)
    unique_dst_ports = int(uniq_row.unique_dst_ports or 0)
    unique_src_ports = int(uniq_row.unique_src_ports or 0)

    # ── 6. Top destination ports detailed ────────────────────
    dst_port_detail = (await db.execute(
        select(
            M.dst_port.label("port"),
            M.protocol_name.label("proto"),
            func.sum(M.bytes).label("bytes"),
            func.sum(M.packets).label("packets"),
            count_expr.label("flows"),
        ).where(*both_dirs)
        .where(M.dst_port.isnot(None), M.dst_port > 0)
        .group_by(M.dst_port, M.protocol_name)
        .order_by(desc("bytes")).limit(10)
    )).all()
    top_dst_ports = [
        {"port": int(r.port), "service": PORT_SERVICE_MAP.get(int(r.port), ""),
         "protocol": r.proto or "", "bytes": int(r.bytes or 0),
         "packets": int(r.packets or 0), "flows": int(r.flows or 0)}
        for r in dst_port_detail
    ]

    # ── 7. Top source ports detailed ─────────────────────────
    src_port_detail = (await db.execute(
        select(
            M.src_port.label("port"),
            M.protocol_name.label("proto"),
            func.sum(M.bytes).label("bytes"),
            count_expr.label("flows"),
        ).where(*both_dirs)
        .where(M.src_port.isnot(None), M.src_port > 0)
        .group_by(M.src_port, M.protocol_name)
        .order_by(desc("bytes")).limit(5)
    )).all()
    top_src_ports = [
        {"port": int(r.port), "service": PORT_SERVICE_MAP.get(int(r.port), ""),
         "protocol": r.proto or "", "bytes": int(r.bytes or 0),
         "flows": int(r.flows or 0)}
        for r in src_port_detail
    ]

    # ── 8. Timeline (bucketed) ───────────────────────────────
    if hours <= 6:
        bucket_seconds = 300     # 5 min
    elif hours <= 24:
        bucket_seconds = 900     # 15 min
    else:
        bucket_seconds = 3600    # 1 hour

    if use_summary:
        # For summary table, bucket is already a column — re-bucket to desired interval
        epoch_s = extract("epoch", FlowSummary5m.bucket)
        bucket_ts = func.to_timestamp(func.floor(epoch_s / bucket_seconds) * bucket_seconds).label("bucket")
        timeline_rows = (await db.execute(
            select(
                bucket_ts,
                func.sum(case(
                    (FlowSummary5m.dst_ip == ip, FlowSummary5m.bytes), else_=literal_column("0")
                )).label("bytes_in"),
                func.sum(case(
                    (FlowSummary5m.src_ip == ip, FlowSummary5m.bytes), else_=literal_column("0")
                )).label("bytes_out"),
                func.sum(case(
                    (FlowSummary5m.dst_ip == ip, FlowSummary5m.flow_count), else_=literal_column("0")
                )).label("flows_in"),
                func.sum(case(
                    (FlowSummary5m.src_ip == ip, FlowSummary5m.flow_count), else_=literal_column("0")
                )).label("flows_out"),
            ).where(*both_dirs)
            .group_by("bucket").order_by("bucket")
        )).all()
    else:
        epoch = extract("epoch", FlowRecord.timestamp)
        bucket_ts = func.to_timestamp(func.floor(epoch / bucket_seconds) * bucket_seconds).label("bucket")
        timeline_rows = (await db.execute(
            select(
                bucket_ts,
                func.sum(case(
                    (FlowRecord.dst_ip == ip, FlowRecord.bytes), else_=literal_column("0")
                )).label("bytes_in"),
                func.sum(case(
                    (FlowRecord.src_ip == ip, FlowRecord.bytes), else_=literal_column("0")
                )).label("bytes_out"),
                func.count(case(
                    (FlowRecord.dst_ip == ip, FlowRecord.id), else_=None
                )).label("flows_in"),
                func.count(case(
                    (FlowRecord.src_ip == ip, FlowRecord.id), else_=None
                )).label("flows_out"),
            ).where(*both_dirs)
            .group_by("bucket").order_by("bucket")
        )).all()
    timeline = [
        {"timestamp": r.bucket.isoformat() if hasattr(r.bucket, "isoformat") else str(r.bucket),
         "bytes_in": int(r.bytes_in or 0), "bytes_out": int(r.bytes_out or 0),
         "flows_in": int(r.flows_in or 0), "flows_out": int(r.flows_out or 0)}
        for r in timeline_rows
    ]

    # ── 9. Top peers detailed (direction breakdown + protocols + country) ──
    peer_ip_expr = case(
        (M.src_ip == ip, M.dst_ip),
        else_=M.src_ip,
    ).label("peer_ip")
    peer_detail_rows = (await db.execute(
        select(
            peer_ip_expr,
            func.sum(case(
                (M.src_ip == ip, M.bytes), else_=literal_column("0")
            )).label("bytes_out"),
            func.sum(case(
                (M.dst_ip == ip, M.bytes), else_=literal_column("0")
            )).label("bytes_in"),
            func.sum(M.packets).label("packets"),
            count_expr.label("flows"),
            func.string_agg(func.distinct(M.protocol_name), literal_column("','")).label("protos"),
        ).where(*both_dirs)
        .group_by("peer_ip").order_by(desc(func.sum(M.bytes))).limit(5)
    )).all()

    # Country lookup for top peers (always from raw table — has country columns)
    top_peer_ips = [r.peer_ip for r in peer_detail_rows]
    peer_country: dict[str, str] = {}
    if top_peer_ips:
        country_rows = (await db.execute(
            select(
                FlowRecord.src_ip,
                func.max(FlowRecord.src_country).label("country"),
            ).where(FlowRecord.src_ip.in_(top_peer_ips), FlowRecord.src_country.isnot(None))
            .group_by(FlowRecord.src_ip)
        )).all()
        for cr in country_rows:
            peer_country[cr.src_ip] = cr.country or ""
        country_rows2 = (await db.execute(
            select(
                FlowRecord.dst_ip,
                func.max(FlowRecord.dst_country).label("country"),
            ).where(FlowRecord.dst_ip.in_(top_peer_ips), FlowRecord.dst_country.isnot(None))
            .group_by(FlowRecord.dst_ip)
        )).all()
        for cr in country_rows2:
            if cr.dst_ip not in peer_country:
                peer_country[cr.dst_ip] = cr.country or ""

    # Top ports per peer
    peer_ports: dict[str, list] = defaultdict(list)
    if top_peer_ips:
        pp_rows = (await db.execute(
            select(
                peer_ip_expr,
                M.dst_port.label("port"),
                func.sum(M.bytes).label("bytes"),
            ).where(*both_dirs, M.dst_port.isnot(None), M.dst_port > 0)
            .where(case(
                (M.src_ip == ip, M.dst_ip),
                else_=M.src_ip,
            ).in_(top_peer_ips))
            .group_by("peer_ip", M.dst_port)
            .order_by(desc("bytes")).limit(25)
        )).all()
        for ppr in pp_rows:
            if len(peer_ports[ppr.peer_ip]) < 3:
                peer_ports[ppr.peer_ip].append({
                    "port": int(ppr.port),
                    "service": PORT_SERVICE_MAP.get(int(ppr.port), ""),
                    "bytes": int(ppr.bytes or 0),
                })

    total_bytes = bytes_sent + bytes_received
    top_peers_detailed = []
    for r in peer_detail_rows:
        b_total = int(r.bytes_in or 0) + int(r.bytes_out or 0)
        top_peers_detailed.append({
            "ip": r.peer_ip,
            "bytes_in": int(r.bytes_in or 0),
            "bytes_out": int(r.bytes_out or 0),
            "bytes_total": b_total,
            "packets": int(r.packets or 0),
            "flows": int(r.flows or 0),
            "pct": round(b_total / total_bytes * 100, 1) if total_bytes > 0 else 0,
            "protocols": [p for p in (r.protos or "").split(",") if p],
            "country": peer_country.get(r.peer_ip, ""),
            "top_ports": peer_ports.get(r.peer_ip, []),
        })

    # ── 10. Protocol direction breakdown ─────────────────────
    if use_summary:
        flows_out_col = func.sum(case(
            (M.src_ip == ip, M.flow_count), else_=literal_column("0")
        )).label("flows_out")
        flows_in_col = func.sum(case(
            (M.dst_ip == ip, M.flow_count), else_=literal_column("0")
        )).label("flows_in")
    else:
        flows_out_col = func.count(case(
            (M.src_ip == ip, M.id), else_=None
        )).label("flows_out")
        flows_in_col = func.count(case(
            (M.dst_ip == ip, M.id), else_=None
        )).label("flows_in")
    proto_dir_rows = (await db.execute(
        select(
            M.protocol_name,
            func.sum(case(
                (M.src_ip == ip, M.bytes), else_=literal_column("0")
            )).label("bytes_out"),
            func.sum(case(
                (M.dst_ip == ip, M.bytes), else_=literal_column("0")
            )).label("bytes_in"),
            flows_out_col,
            flows_in_col,
        ).where(*both_dirs)
        .group_by(M.protocol_name).order_by(desc(func.sum(M.bytes)))
    )).all()
    protocol_direction = [
        {"protocol": r.protocol_name or "Unknown",
         "bytes_in": int(r.bytes_in or 0), "bytes_out": int(r.bytes_out or 0),
         "flows_in": int(r.flows_in or 0), "flows_out": int(r.flows_out or 0)}
        for r in proto_dir_rows
    ]

    # ── 11. Country aggregations (always raw — summary has no country) ──
    raw_tf = _time_filter(FlowRecord.timestamp, hours, start, end)
    countries_in_rows = (await db.execute(
        select(FlowRecord.src_country.label("country"),
               func.sum(FlowRecord.bytes).label("bytes"),
               func.count(FlowRecord.id).label("flows"))
        .where(*raw_tf, FlowRecord.dst_ip == ip, FlowRecord.src_country.isnot(None))
        .group_by(FlowRecord.src_country).order_by(desc("bytes")).limit(10)
    )).all()
    countries_in = [{"country": r.country, "bytes": int(r.bytes or 0), "flows": int(r.flows or 0)} for r in countries_in_rows]

    countries_out_rows = (await db.execute(
        select(FlowRecord.dst_country.label("country"),
               func.sum(FlowRecord.bytes).label("bytes"),
               func.count(FlowRecord.id).label("flows"))
        .where(*raw_tf, FlowRecord.src_ip == ip, FlowRecord.dst_country.isnot(None))
        .group_by(FlowRecord.dst_country).order_by(desc("bytes")).limit(10)
    )).all()
    countries_out = [{"country": r.country, "bytes": int(r.bytes or 0), "flows": int(r.flows or 0)} for r in countries_out_rows]

    # ── 12. Services Accessed (src_port from peers when dst_ip == ip) ──
    svc_accessed_rows = (await db.execute(
        select(
            M.src_port.label("port"),
            M.protocol_name.label("proto"),
            func.sum(M.bytes).label("bytes"),
            count_expr.label("flows"),
            func.count(func.distinct(M.src_ip)).label("unique_peers"),
        ).where(*tf, M.dst_ip == ip)
        .where(M.src_port.isnot(None), M.src_port > 0)
        .group_by(M.src_port, M.protocol_name)
        .order_by(desc("bytes")).limit(12)
    )).all()
    services_accessed = [
        {"port": int(r.port), "service": PORT_SERVICE_MAP.get(int(r.port), f"port/{r.port}"),
         "protocol": r.proto or "", "bytes": int(r.bytes or 0),
         "flows": int(r.flows or 0), "unique_peers": int(r.unique_peers or 0)}
        for r in svc_accessed_rows
    ]

    # ── 13. Services Served (dst_port from peers when src_ip == ip) ──
    svc_served_rows = (await db.execute(
        select(
            M.dst_port.label("port"),
            M.protocol_name.label("proto"),
            func.sum(M.bytes).label("bytes"),
            count_expr.label("flows"),
            func.count(func.distinct(M.dst_ip)).label("unique_peers"),
        ).where(*tf, M.src_ip == ip)
        .where(M.dst_port.isnot(None), M.dst_port > 0)
        .group_by(M.dst_port, M.protocol_name)
        .order_by(desc("bytes")).limit(12)
    )).all()
    services_served = [
        {"port": int(r.port), "service": PORT_SERVICE_MAP.get(int(r.port), f"port/{r.port}"),
         "protocol": r.proto or "", "bytes": int(r.bytes or 0),
         "flows": int(r.flows or 0), "unique_peers": int(r.unique_peers or 0)}
        for r in svc_served_rows
    ]

    # ── 14. Peer primary service port ────────────────────────
    if top_peer_ips:
        peer_svc_rows = (await db.execute(
            select(
                M.src_ip.label("peer_ip"),
                M.src_port.label("port"),
                func.sum(M.bytes).label("bytes"),
            ).where(*tf, M.dst_ip == ip,
                    M.src_ip.in_(top_peer_ips),
                    M.src_port.isnot(None), M.src_port > 0)
            .group_by(M.src_ip, M.src_port)
            .order_by(desc("bytes"))
        )).all()
        peer_primary_service: dict[str, dict] = {}
        for r in peer_svc_rows:
            if r.peer_ip not in peer_primary_service:
                peer_primary_service[r.peer_ip] = {
                    "port": int(r.port),
                    "service": PORT_SERVICE_MAP.get(int(r.port), f"port/{r.port}"),
                }
        peer_svc_rows2 = (await db.execute(
            select(
                M.dst_ip.label("peer_ip"),
                M.dst_port.label("port"),
                func.sum(M.bytes).label("bytes"),
            ).where(*tf, M.src_ip == ip,
                    M.dst_ip.in_(top_peer_ips),
                    M.dst_port.isnot(None), M.dst_port > 0)
            .group_by(M.dst_ip, M.dst_port)
            .order_by(desc("bytes"))
        )).all()
        for r in peer_svc_rows2:
            if r.peer_ip not in peer_primary_service:
                peer_primary_service[r.peer_ip] = {
                    "port": int(r.port),
                    "service": PORT_SERVICE_MAP.get(int(r.port), f"port/{r.port}"),
                }
        for pd in top_peers_detailed:
            svc = peer_primary_service.get(pd["ip"])
            if svc:
                pd["primary_port"] = svc["port"]
                pd["primary_service"] = svc["service"]

    # ── 15. Unidirectional detection ─────────────────────────
    unidirectional = (
        (bytes_sent == 0 and bytes_received > 0) or
        (bytes_received == 0 and bytes_sent > 0)
    )

    # ── 16. Behavior classification ──────────────────────────
    behavior = _compute_behavior(services_accessed, services_served, unique_src, unique_dst)

    # ── 17. Threat scoring ───────────────────────────────────
    top_peer_pct = top_peers_detailed[0]["pct"] if top_peers_detailed else 0
    threat = _compute_threat_indicators(
        unique_src, unique_dst, unique_dst_ports, unique_src_ports,
        top_peer_pct, bytes_sent, bytes_received,
        protocols, timeline,
    )

    result = {
        "ip": ip,
        "bytes_sent": bytes_sent,
        "flows_as_src": flows_as_src,
        "bytes_received": bytes_received,
        "flows_as_dst": flows_as_dst,
        "total_bytes": total_bytes,
        "total_flows": flows_as_src + flows_as_dst,
        "unidirectional": unidirectional,
        "top_peers": top_peers,
        "top_out": top_out,
        "top_in": top_in,
        "top_ports": top_ports,
        "protocol_distribution": protocols,
        "unique_src_ips": unique_src,
        "unique_dst_ips": unique_dst,
        "unique_dst_ports": unique_dst_ports,
        "unique_src_ports": unique_src_ports,
        "top_dst_ports": top_dst_ports,
        "top_src_ports": top_src_ports,
        "timeline": timeline,
        "top_peers_detailed": top_peers_detailed,
        "protocol_direction": protocol_direction,
        "countries_in": countries_in,
        "countries_out": countries_out,
        "threat": threat,
        "services_accessed": services_accessed,
        "services_served": services_served,
        "behavior": behavior,
    }
    await _cache_set(ck, result, cache_ttl)
    return result


@router.get("/ip-geo")
async def get_ip_geo(
    ip: str,
    _: User = Depends(get_current_user),
):
    """Return ASN, country code, and country name for an IP address."""
    import ipaddress as _ipa
    try:
        addr = _ipa.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local:
            return {"ip": ip, "country_code": None, "country": None, "asn": None, "org": None}
    except ValueError:
        raise HTTPException(400, "Invalid IP address")

    # Check Redis cache first (long TTL — geo data rarely changes)
    cache_key = f"ipgeo:{ip}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached

    import httpx
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,as,org,isp")
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    result = {
                        "ip": ip,
                        "country_code": data.get("countryCode", "").lower(),
                        "country": data.get("country"),
                        "asn": data.get("as", "").split(" ")[0] if data.get("as") else None,
                        "org": data.get("org") or data.get("isp"),
                    }
                    await _cache_set(cache_key, result, 86400)  # cache 24h
                    return result
    except Exception as e:
        logger.warning(f"IP geo lookup failed for {ip}: {e}")

    return {"ip": ip, "country_code": None, "country": None, "asn": None, "org": None}
