from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
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
    if src_ip:
        query = query.where(FlowRecord.src_ip == src_ip)
    if dst_ip:
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
