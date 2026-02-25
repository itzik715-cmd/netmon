from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, or_, and_, case, extract, literal_column
from typing import Optional, List
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from ipaddress import ip_network, ip_address
from app.database import get_db
from app.models.flow import FlowRecord
from app.models.device import Device, DeviceRoute
from app.models.user import User
from app.middleware.rbac import get_current_user

router = APIRouter(prefix="/api/flows", tags=["Flow Analysis"])

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


async def _load_owned_subnets(db: AsyncSession) -> list:
    """Load announced subnets from spine device routing tables.

    Returns a list of ipaddress network objects for matching.
    Excludes RFC1918, loopback, link-local, and default routes.
    """
    rows = (await db.execute(
        select(DeviceRoute.destination, DeviceRoute.prefix_len, DeviceRoute.device_id)
        .join(Device, Device.id == DeviceRoute.device_id)
        .where(Device.device_type == "spine")
    )).all()
    nets = []
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
            nets.append(net)
        except ValueError:
            continue
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
    """Return the list of owned/announced public subnets from spine routing tables."""
    nets = await _load_owned_subnets(db)
    return [{"subnet": str(n), "prefix_len": n.prefixlen} for n in sorted(nets, key=lambda n: n.network_address)]


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
    base_filter = _time_filter(FlowRecord.timestamp, hours, start, end) + _device_filter(device_ids, device_id)

    # Load owned subnets for inbound/outbound classification
    owned_nets = await _load_owned_subnets(db)

    # Top talkers (src IP by bytes) — kept for backward compat
    talkers_q = await db.execute(
        select(FlowRecord.src_ip, func.sum(FlowRecord.bytes).label("total_bytes"))
        .where(*base_filter)
        .group_by(FlowRecord.src_ip)
        .order_by(desc("total_bytes"))
        .limit(limit)
    )
    top_talkers = [{"ip": row.src_ip, "bytes": int(row.total_bytes or 0)} for row in talkers_q]

    # Top destinations — kept for backward compat
    dest_q = await db.execute(
        select(FlowRecord.dst_ip, func.sum(FlowRecord.bytes).label("total_bytes"))
        .where(*base_filter)
        .group_by(FlowRecord.dst_ip)
        .order_by(desc("total_bytes"))
        .limit(limit)
    )
    top_destinations = [{"ip": row.dst_ip, "bytes": int(row.total_bytes or 0)} for row in dest_q]

    # ── Inbound / Outbound classification ────────────────────
    # sFlow ingress: src_ip=remote peer, dst_ip=our owned IP
    # INBOUND = traffic coming INTO our network (dst_ip is owned)
    #   -> group by src_ip (who is sending to us) + src_port (what service the peer runs / what they're sending from)
    # OUTBOUND = traffic going OUT from our network (src_ip is owned)
    #   -> group by dst_ip (where are we sending to) + dst_port (what service we're accessing)
    #
    # With sFlow ingress-only capture:
    #   dst_ip is always the owned IP, src_ip is the remote peer
    #   src_port = the service port on the remote (e.g. 443 = HTTPS server)
    #   So from our network's perspective: our owned IP → remote:443 = OUTBOUND web browsing
    #
    # Classification:
    #   If dst_ip is owned: this is traffic TO us = but if src_port is well-known (443, 22)
    #     it means our IP was the client connecting out and getting responses back
    #   If src_ip is owned: this is traffic FROM us

    # For sFlow ingress: all flows have dst_ip=owned, src_ip=external
    # We classify based on the service port:
    # - src_port is well-known (server port like 443, 22, 80) => OUTBOUND (our IP connected to remote service)
    # - dst_port is well-known (server port like 80, 443, 3389) => INBOUND (remote connected to our service)

    # Fetch broader data for classification
    flow_rows = (await db.execute(
        select(
            FlowRecord.src_ip,
            FlowRecord.dst_ip,
            FlowRecord.src_port,
            FlowRecord.dst_port,
            FlowRecord.protocol_name,
            func.sum(FlowRecord.bytes).label("bytes"),
            func.count(FlowRecord.id).label("flows"),
        ).where(*base_filter)
        .group_by(FlowRecord.src_ip, FlowRecord.dst_ip, FlowRecord.src_port, FlowRecord.dst_port, FlowRecord.protocol_name)
        .order_by(desc("bytes"))
        .limit(500)
    )).all()

    # Aggregate inbound and outbound
    inbound_by_ip: dict[str, dict] = {}   # external IP → {bytes, flows, services: {port: bytes}}
    outbound_by_ip: dict[str, dict] = {}  # external IP → {bytes, flows, services: {port: bytes}}
    total_inbound = 0
    total_outbound = 0

    for r in flow_rows:
        src_owned = _is_owned(r.src_ip, owned_nets)
        dst_owned = _is_owned(r.dst_ip, owned_nets)
        b = int(r.bytes or 0)
        f = int(r.flows or 0)
        src_port = int(r.src_port) if r.src_port else 0
        dst_port = int(r.dst_port) if r.dst_port else 0

        if dst_owned and not src_owned:
            # dst_ip is ours, src_ip is external
            # If src_port is a well-known service port → our IP was connecting out (OUTBOUND)
            # If dst_port is a well-known service port → external connecting to our service (INBOUND)
            src_is_service = src_port in PORT_SERVICE_MAP and src_port < 10000
            dst_is_service = dst_port in PORT_SERVICE_MAP and dst_port < 10000

            if src_is_service and not dst_is_service:
                # OUTBOUND: our IP connected to remote's service (src_port = the service)
                ext_ip = r.src_ip
                svc_port = src_port
                if ext_ip not in outbound_by_ip:
                    outbound_by_ip[ext_ip] = {"bytes": 0, "flows": 0, "services": {}}
                outbound_by_ip[ext_ip]["bytes"] += b
                outbound_by_ip[ext_ip]["flows"] += f
                outbound_by_ip[ext_ip]["services"][svc_port] = outbound_by_ip[ext_ip]["services"].get(svc_port, 0) + b
                total_outbound += b
            elif dst_is_service and not src_is_service:
                # INBOUND: external connecting to our service (dst_port = the service)
                ext_ip = r.src_ip
                svc_port = dst_port
                if ext_ip not in inbound_by_ip:
                    inbound_by_ip[ext_ip] = {"bytes": 0, "flows": 0, "services": {}}
                inbound_by_ip[ext_ip]["bytes"] += b
                inbound_by_ip[ext_ip]["flows"] += f
                inbound_by_ip[ext_ip]["services"][svc_port] = inbound_by_ip[ext_ip]["services"].get(svc_port, 0) + b
                total_inbound += b
            else:
                # Ambiguous — use src_port heuristic (lower port = service)
                if src_port > 0 and (dst_port == 0 or src_port < dst_port):
                    ext_ip = r.src_ip
                    svc_port = src_port
                    if ext_ip not in outbound_by_ip:
                        outbound_by_ip[ext_ip] = {"bytes": 0, "flows": 0, "services": {}}
                    outbound_by_ip[ext_ip]["bytes"] += b
                    outbound_by_ip[ext_ip]["flows"] += f
                    outbound_by_ip[ext_ip]["services"][svc_port] = outbound_by_ip[ext_ip]["services"].get(svc_port, 0) + b
                    total_outbound += b
                else:
                    ext_ip = r.src_ip
                    svc_port = dst_port
                    if ext_ip not in inbound_by_ip:
                        inbound_by_ip[ext_ip] = {"bytes": 0, "flows": 0, "services": {}}
                    inbound_by_ip[ext_ip]["bytes"] += b
                    inbound_by_ip[ext_ip]["flows"] += f
                    if svc_port > 0:
                        inbound_by_ip[ext_ip]["services"][svc_port] = inbound_by_ip[ext_ip]["services"].get(svc_port, 0) + b
                    total_inbound += b

        elif src_owned and not dst_owned:
            # Our IP is sending out (OUTBOUND)
            ext_ip = r.dst_ip
            svc_port = dst_port
            if ext_ip not in outbound_by_ip:
                outbound_by_ip[ext_ip] = {"bytes": 0, "flows": 0, "services": {}}
            outbound_by_ip[ext_ip]["bytes"] += b
            outbound_by_ip[ext_ip]["flows"] += f
            if svc_port > 0:
                outbound_by_ip[ext_ip]["services"][svc_port] = outbound_by_ip[ext_ip]["services"].get(svc_port, 0) + b
            total_outbound += b
        # else: internal-to-internal or both external — skip

    # Build top inbound/outbound lists with primary service
    def _build_top(by_ip: dict, total: int) -> list:
        items = sorted(by_ip.items(), key=lambda x: -x[1]["bytes"])[:limit]
        result = []
        for ext_ip, data in items:
            # Find the dominant service port
            svcs = data["services"]
            if svcs:
                top_port = max(svcs, key=svcs.get)
                svc_name = PORT_SERVICE_MAP.get(top_port, f"port/{top_port}")
            else:
                top_port = 0
                svc_name = ""
            result.append({
                "ip": ext_ip,
                "bytes": data["bytes"],
                "flows": data["flows"],
                "service_port": top_port,
                "service_name": svc_name,
                "pct": round(data["bytes"] / total * 100, 1) if total > 0 else 0,
            })
        return result

    top_inbound = _build_top(inbound_by_ip, total_inbound)
    top_outbound = _build_top(outbound_by_ip, total_outbound)

    # Protocol distribution
    proto_q = await db.execute(
        select(
            FlowRecord.protocol_name,
            func.count(FlowRecord.id).label("count"),
            func.sum(FlowRecord.bytes).label("bytes"),
        )
        .where(*base_filter)
        .group_by(FlowRecord.protocol_name)
        .order_by(desc("bytes"))
    )
    protocol_dist = [
        {"protocol": row.protocol_name or "Unknown", "count": int(row.count), "bytes": int(row.bytes or 0)}
        for row in proto_q
    ]

    # Application distribution
    app_q = await db.execute(
        select(
            FlowRecord.application,
            func.count(FlowRecord.id).label("count"),
            func.sum(FlowRecord.bytes).label("bytes"),
        )
        .where(*base_filter)
        .group_by(FlowRecord.application)
        .order_by(desc("bytes"))
        .limit(limit)
    )
    app_dist = [
        {"app": row.application or "Unknown", "count": int(row.count), "bytes": int(row.bytes or 0)}
        for row in app_q
    ]

    # Total stats
    total_q = await db.execute(
        select(
            func.count(FlowRecord.id).label("flows"),
            func.sum(FlowRecord.bytes).label("bytes"),
        ).where(*base_filter)
    )
    total_row = total_q.first()

    return {
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
    time_filters = _time_filter(FlowRecord.timestamp, hours, start, end)
    device_filters = list(_device_filter(device_ids, device_id))

    # When filtering by a specific IP, return aggregated top conversations
    # grouped by peer IP with total bytes, instead of raw individual flows.
    if ip:
        peer_ip = case(
            (FlowRecord.src_ip == ip, FlowRecord.dst_ip),
            else_=FlowRecord.src_ip,
        ).label("peer_ip")
        query = (
            select(
                peer_ip,
                func.sum(FlowRecord.bytes).label("bytes"),
                func.sum(FlowRecord.packets).label("packets"),
                func.count(FlowRecord.id).label("flow_count"),
            )
            .where(
                *time_filters,
                *device_filters,
                or_(FlowRecord.src_ip == ip, FlowRecord.dst_ip == ip),
            )
            .group_by("peer_ip")
            .order_by(desc("bytes"))
            .limit(limit)
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

    # No IP filter — return raw individual flow records
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
    time_filters = _time_filter(FlowRecord.timestamp, hours, start, end)
    both_dirs = [*time_filters, or_(FlowRecord.src_ip == ip, FlowRecord.dst_ip == ip)]

    # ── 1. Basic sent/received totals ────────────────────────
    sent_row = (await db.execute(
        select(func.sum(FlowRecord.bytes), func.count(FlowRecord.id))
        .where(*time_filters, FlowRecord.src_ip == ip)
    )).first()
    recv_row = (await db.execute(
        select(func.sum(FlowRecord.bytes), func.count(FlowRecord.id))
        .where(*time_filters, FlowRecord.dst_ip == ip)
    )).first()

    bytes_sent = int(sent_row[0] or 0)
    flows_as_src = int(sent_row[1] or 0)
    bytes_received = int(recv_row[0] or 0)
    flows_as_dst = int(recv_row[1] or 0)

    # ── 2. Top peers simple (both directions) ────────────────
    as_src = (await db.execute(
        select(FlowRecord.dst_ip.label("peer"), func.sum(FlowRecord.bytes).label("bytes"))
        .where(*time_filters, FlowRecord.src_ip == ip)
        .group_by(FlowRecord.dst_ip).order_by(desc("bytes")).limit(10)
    )).all()
    as_dst = (await db.execute(
        select(FlowRecord.src_ip.label("peer"), func.sum(FlowRecord.bytes).label("bytes"))
        .where(*time_filters, FlowRecord.dst_ip == ip)
        .group_by(FlowRecord.src_ip).order_by(desc("bytes")).limit(10)
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
        select(FlowRecord.protocol_name,
               func.count(FlowRecord.id).label("count"),
               func.sum(FlowRecord.bytes).label("bytes"))
        .where(*both_dirs)
        .group_by(FlowRecord.protocol_name).order_by(desc("bytes"))
    )).all()
    protocols = [
        {"protocol": r.protocol_name or "Unknown",
         "count": int(r.count), "bytes": int(r.bytes or 0)}
        for r in proto_rows
    ]

    # ── 4. Top destination ports (old simple format kept as top_ports) ──
    port_rows = (await db.execute(
        select(FlowRecord.dst_port.label("port"),
               func.sum(FlowRecord.bytes).label("bytes"))
        .where(*both_dirs)
        .where(FlowRecord.dst_port.isnot(None), FlowRecord.dst_port > 0)
        .group_by(FlowRecord.dst_port).order_by(desc("bytes")).limit(8)
    )).all()
    top_ports = [{"port": int(r.port), "bytes": int(r.bytes or 0)} for r in port_rows]

    # ── 5. Unique counts (single query) ──────────────────────
    uniq_row = (await db.execute(
        select(
            func.count(func.distinct(case(
                (FlowRecord.dst_ip == ip, FlowRecord.src_ip), else_=None
            ))).label("unique_src"),
            func.count(func.distinct(case(
                (FlowRecord.src_ip == ip, FlowRecord.dst_ip), else_=None
            ))).label("unique_dst"),
            func.count(func.distinct(FlowRecord.dst_port)).label("unique_dst_ports"),
            func.count(func.distinct(FlowRecord.src_port)).label("unique_src_ports"),
        ).where(*both_dirs)
    )).first()
    unique_src = int(uniq_row.unique_src or 0)
    unique_dst = int(uniq_row.unique_dst or 0)
    unique_dst_ports = int(uniq_row.unique_dst_ports or 0)
    unique_src_ports = int(uniq_row.unique_src_ports or 0)

    # ── 6. Top destination ports detailed ────────────────────
    dst_port_detail = (await db.execute(
        select(
            FlowRecord.dst_port.label("port"),
            FlowRecord.protocol_name.label("proto"),
            func.sum(FlowRecord.bytes).label("bytes"),
            func.sum(FlowRecord.packets).label("packets"),
            func.count(FlowRecord.id).label("flows"),
        ).where(*both_dirs)
        .where(FlowRecord.dst_port.isnot(None), FlowRecord.dst_port > 0)
        .group_by(FlowRecord.dst_port, FlowRecord.protocol_name)
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
            FlowRecord.src_port.label("port"),
            FlowRecord.protocol_name.label("proto"),
            func.sum(FlowRecord.bytes).label("bytes"),
            func.count(FlowRecord.id).label("flows"),
        ).where(*both_dirs)
        .where(FlowRecord.src_port.isnot(None), FlowRecord.src_port > 0)
        .group_by(FlowRecord.src_port, FlowRecord.protocol_name)
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
        (FlowRecord.src_ip == ip, FlowRecord.dst_ip),
        else_=FlowRecord.src_ip,
    ).label("peer_ip")
    peer_detail_rows = (await db.execute(
        select(
            peer_ip_expr,
            func.sum(case(
                (FlowRecord.src_ip == ip, FlowRecord.bytes), else_=literal_column("0")
            )).label("bytes_out"),
            func.sum(case(
                (FlowRecord.dst_ip == ip, FlowRecord.bytes), else_=literal_column("0")
            )).label("bytes_in"),
            func.sum(FlowRecord.packets).label("packets"),
            func.count(FlowRecord.id).label("flows"),
            func.string_agg(func.distinct(FlowRecord.protocol_name), literal_column("','")).label("protos"),
        ).where(*both_dirs)
        .group_by("peer_ip").order_by(desc(func.sum(FlowRecord.bytes))).limit(5)
    )).all()

    # Country lookup for top peers
    top_peer_ips = [r.peer_ip for r in peer_detail_rows]
    peer_country: dict[str, str] = {}
    if top_peer_ips:
        # Look up country from flow records where peer appears
        country_rows = (await db.execute(
            select(
                FlowRecord.src_ip,
                func.max(FlowRecord.src_country).label("country"),
            ).where(FlowRecord.src_ip.in_(top_peer_ips), FlowRecord.src_country.isnot(None))
            .group_by(FlowRecord.src_ip)
        )).all()
        for cr in country_rows:
            peer_country[cr.src_ip] = cr.country or ""
        # Also check dst side
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
                FlowRecord.dst_port.label("port"),
                func.sum(FlowRecord.bytes).label("bytes"),
            ).where(*both_dirs, FlowRecord.dst_port.isnot(None), FlowRecord.dst_port > 0)
            .where(case(
                (FlowRecord.src_ip == ip, FlowRecord.dst_ip),
                else_=FlowRecord.src_ip,
            ).in_(top_peer_ips))
            .group_by("peer_ip", FlowRecord.dst_port)
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
    proto_dir_rows = (await db.execute(
        select(
            FlowRecord.protocol_name,
            func.sum(case(
                (FlowRecord.src_ip == ip, FlowRecord.bytes), else_=literal_column("0")
            )).label("bytes_out"),
            func.sum(case(
                (FlowRecord.dst_ip == ip, FlowRecord.bytes), else_=literal_column("0")
            )).label("bytes_in"),
            func.count(case(
                (FlowRecord.src_ip == ip, FlowRecord.id), else_=None
            )).label("flows_out"),
            func.count(case(
                (FlowRecord.dst_ip == ip, FlowRecord.id), else_=None
            )).label("flows_in"),
        ).where(*both_dirs)
        .group_by(FlowRecord.protocol_name).order_by(desc(func.sum(FlowRecord.bytes)))
    )).all()
    protocol_direction = [
        {"protocol": r.protocol_name or "Unknown",
         "bytes_in": int(r.bytes_in or 0), "bytes_out": int(r.bytes_out or 0),
         "flows_in": int(r.flows_in or 0), "flows_out": int(r.flows_out or 0)}
        for r in proto_dir_rows
    ]

    # ── 11. Country aggregations ─────────────────────────────
    countries_in_rows = (await db.execute(
        select(FlowRecord.src_country.label("country"),
               func.sum(FlowRecord.bytes).label("bytes"),
               func.count(FlowRecord.id).label("flows"))
        .where(*time_filters, FlowRecord.dst_ip == ip, FlowRecord.src_country.isnot(None))
        .group_by(FlowRecord.src_country).order_by(desc("bytes")).limit(10)
    )).all()
    countries_in = [{"country": r.country, "bytes": int(r.bytes or 0), "flows": int(r.flows or 0)} for r in countries_in_rows]

    countries_out_rows = (await db.execute(
        select(FlowRecord.dst_country.label("country"),
               func.sum(FlowRecord.bytes).label("bytes"),
               func.count(FlowRecord.id).label("flows"))
        .where(*time_filters, FlowRecord.src_ip == ip, FlowRecord.dst_country.isnot(None))
        .group_by(FlowRecord.dst_country).order_by(desc("bytes")).limit(10)
    )).all()
    countries_out = [{"country": r.country, "bytes": int(r.bytes or 0), "flows": int(r.flows or 0)} for r in countries_out_rows]

    # ── 12. Services Accessed (src_port from peers when dst_ip == ip) ──
    svc_accessed_rows = (await db.execute(
        select(
            FlowRecord.src_port.label("port"),
            FlowRecord.protocol_name.label("proto"),
            func.sum(FlowRecord.bytes).label("bytes"),
            func.count(FlowRecord.id).label("flows"),
            func.count(func.distinct(FlowRecord.src_ip)).label("unique_peers"),
        ).where(*time_filters, FlowRecord.dst_ip == ip)
        .where(FlowRecord.src_port.isnot(None), FlowRecord.src_port > 0)
        .group_by(FlowRecord.src_port, FlowRecord.protocol_name)
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
            FlowRecord.dst_port.label("port"),
            FlowRecord.protocol_name.label("proto"),
            func.sum(FlowRecord.bytes).label("bytes"),
            func.count(FlowRecord.id).label("flows"),
            func.count(func.distinct(FlowRecord.dst_ip)).label("unique_peers"),
        ).where(*time_filters, FlowRecord.src_ip == ip)
        .where(FlowRecord.dst_port.isnot(None), FlowRecord.dst_port > 0)
        .group_by(FlowRecord.dst_port, FlowRecord.protocol_name)
        .order_by(desc("bytes")).limit(12)
    )).all()
    services_served = [
        {"port": int(r.port), "service": PORT_SERVICE_MAP.get(int(r.port), f"port/{r.port}"),
         "protocol": r.proto or "", "bytes": int(r.bytes or 0),
         "flows": int(r.flows or 0), "unique_peers": int(r.unique_peers or 0)}
        for r in svc_served_rows
    ]

    # ── 14. Peer primary service port ────────────────────────
    # For each top peer, determine the dominant service port
    if top_peer_ips:
        # When dst_ip == ip, src_port = the service the peer runs (what our IP accesses)
        peer_svc_rows = (await db.execute(
            select(
                FlowRecord.src_ip.label("peer_ip"),
                FlowRecord.src_port.label("port"),
                func.sum(FlowRecord.bytes).label("bytes"),
            ).where(*time_filters, FlowRecord.dst_ip == ip,
                    FlowRecord.src_ip.in_(top_peer_ips),
                    FlowRecord.src_port.isnot(None), FlowRecord.src_port > 0)
            .group_by(FlowRecord.src_ip, FlowRecord.src_port)
            .order_by(desc("bytes"))
        )).all()
        # Keep only the top port per peer
        peer_primary_service: dict[str, dict] = {}
        for r in peer_svc_rows:
            if r.peer_ip not in peer_primary_service:
                peer_primary_service[r.peer_ip] = {
                    "port": int(r.port),
                    "service": PORT_SERVICE_MAP.get(int(r.port), f"port/{r.port}"),
                }
        # Also check the other direction: when src_ip == ip, dst_port = service
        peer_svc_rows2 = (await db.execute(
            select(
                FlowRecord.dst_ip.label("peer_ip"),
                FlowRecord.dst_port.label("port"),
                func.sum(FlowRecord.bytes).label("bytes"),
            ).where(*time_filters, FlowRecord.src_ip == ip,
                    FlowRecord.dst_ip.in_(top_peer_ips),
                    FlowRecord.dst_port.isnot(None), FlowRecord.dst_port > 0)
            .group_by(FlowRecord.dst_ip, FlowRecord.dst_port)
            .order_by(desc("bytes"))
        )).all()
        for r in peer_svc_rows2:
            if r.peer_ip not in peer_primary_service:
                peer_primary_service[r.peer_ip] = {
                    "port": int(r.port),
                    "service": PORT_SERVICE_MAP.get(int(r.port), f"port/{r.port}"),
                }
        # Attach to peer details
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

    return {
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
        # New security fields
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
