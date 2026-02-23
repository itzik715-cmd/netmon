from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, or_
from typing import Optional
from datetime import datetime, timedelta, timezone
from app.database import get_db
from app.models.flow import FlowRecord
from app.models.user import User
from app.middleware.rbac import get_current_user

router = APIRouter(prefix="/api/flows", tags=["Flow Analysis"])

PROTOCOL_MAP = {1: "ICMP", 6: "TCP", 17: "UDP", 47: "GRE", 89: "OSPF"}


@router.get("/stats")
async def get_flow_stats(
    hours: int = 1,
    device_id: Optional[int] = None,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    base_filter = [FlowRecord.timestamp >= since]
    if device_id:
        base_filter.append(FlowRecord.device_id == device_id)

    # Top talkers (src IP by bytes)
    talkers_q = await db.execute(
        select(FlowRecord.src_ip, func.sum(FlowRecord.bytes).label("total_bytes"))
        .where(*base_filter)
        .group_by(FlowRecord.src_ip)
        .order_by(desc("total_bytes"))
        .limit(limit)
    )
    top_talkers = [{"ip": row.src_ip, "bytes": int(row.total_bytes or 0)} for row in talkers_q]

    # Top destinations
    dest_q = await db.execute(
        select(FlowRecord.dst_ip, func.sum(FlowRecord.bytes).label("total_bytes"))
        .where(*base_filter)
        .group_by(FlowRecord.dst_ip)
        .order_by(desc("total_bytes"))
        .limit(limit)
    )
    top_destinations = [{"ip": row.dst_ip, "bytes": int(row.total_bytes or 0)} for row in dest_q]

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
        "protocol_distribution": protocol_dist,
        "application_distribution": app_dist,
        "total_flows": int(total_row.flows or 0),
        "total_bytes": int(total_row.bytes or 0),
    }


@router.get("/conversations")
async def get_conversations(
    hours: int = 1,
    device_id: Optional[int] = None,
    ip: Optional[str] = None,          # match either src OR dst
    src_ip: Optional[str] = None,
    dst_ip: Optional[str] = None,
    protocol: Optional[str] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    query = select(FlowRecord).where(FlowRecord.timestamp >= since)

    if device_id:
        query = query.where(FlowRecord.device_id == device_id)
    if ip:
        query = query.where(or_(FlowRecord.src_ip == ip, FlowRecord.dst_ip == ip))
    elif src_ip:
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
        }
        for f in flows
    ]


@router.get("/ip-profile")
async def get_ip_profile(
    ip: str,
    hours: int = 1,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return an activity summary for a single IP address."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    ip_filter = FlowRecord.timestamp >= since

    # Bytes/flows when this IP is the source
    sent_row = (await db.execute(
        select(func.sum(FlowRecord.bytes), func.count(FlowRecord.id))
        .where(ip_filter, FlowRecord.src_ip == ip)
    )).first()

    # Bytes/flows when this IP is the destination
    recv_row = (await db.execute(
        select(func.sum(FlowRecord.bytes), func.count(FlowRecord.id))
        .where(ip_filter, FlowRecord.dst_ip == ip)
    )).first()

    # Top peers — combine both directions, rank by total bytes
    as_src = (await db.execute(
        select(FlowRecord.dst_ip.label("peer"), func.sum(FlowRecord.bytes).label("bytes"))
        .where(ip_filter, FlowRecord.src_ip == ip)
        .group_by(FlowRecord.dst_ip)
        .order_by(desc("bytes"))
        .limit(10)
    )).all()
    as_dst = (await db.execute(
        select(FlowRecord.src_ip.label("peer"), func.sum(FlowRecord.bytes).label("bytes"))
        .where(ip_filter, FlowRecord.dst_ip == ip)
        .group_by(FlowRecord.src_ip)
        .order_by(desc("bytes"))
        .limit(10)
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

    # Protocol distribution for this IP
    proto_rows = (await db.execute(
        select(FlowRecord.protocol_name,
               func.count(FlowRecord.id).label("count"),
               func.sum(FlowRecord.bytes).label("bytes"))
        .where(ip_filter, or_(FlowRecord.src_ip == ip, FlowRecord.dst_ip == ip))
        .group_by(FlowRecord.protocol_name)
        .order_by(desc("bytes"))
    )).all()
    protocols = [
        {"protocol": r.protocol_name or "Unknown",
         "count": int(r.count), "bytes": int(r.bytes or 0)}
        for r in proto_rows
    ]

    return {
        "ip": ip,
        "bytes_sent": int(sent_row[0] or 0),
        "flows_as_src": int(sent_row[1] or 0),
        "bytes_received": int(recv_row[0] or 0),
        "flows_as_dst": int(recv_row[1] or 0),
        "top_peers": top_peers,
        "protocol_distribution": protocols,
    }
