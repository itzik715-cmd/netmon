"""
Reports API — CSV/JSON exports for devices, interfaces, alerts, and flows.
"""
import csv
import io
from datetime import datetime, timezone, timedelta

from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.device import Device
from app.models.interface import Interface, InterfaceMetric
from app.models.alert import AlertEvent, AlertRule
from app.models.flow import FlowRecord
from app.middleware.rbac import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/reports", tags=["Reports"])


def _csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    if not rows:
        output = io.StringIO()
        output.write("No data\n")
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/devices")
async def report_devices(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Export all devices as CSV."""
    result = await db.execute(select(Device).where(Device.is_active == True).order_by(Device.hostname))
    devices = result.scalars().all()
    rows = [
        {
            "hostname": d.hostname,
            "ip_address": d.ip_address,
            "device_type": d.device_type or "",
            "layer": d.layer or "",
            "vendor": d.vendor or "",
            "model": d.model or "",
            "os_version": d.os_version or "",
            "status": d.status,
            "cpu_usage": f"{d.cpu_usage:.1f}" if d.cpu_usage is not None else "",
            "memory_usage": f"{d.memory_usage:.1f}" if d.memory_usage is not None else "",
            "uptime_seconds": d.uptime or "",
            "last_seen": d.last_seen.isoformat() if d.last_seen else "",
            "snmp_community": d.snmp_community or "",
            "snmp_version": d.snmp_version or "",
            "poll_interval": d.poll_interval,
        }
        for d in devices
    ]
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    return _csv_response(rows, f"devices_{ts}.csv")


@router.get("/interfaces")
async def report_interfaces(
    device_id: int = Query(None, description="Filter by device ID"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Export interfaces with latest metrics as CSV."""
    query = select(Interface, Device).join(Device, Interface.device_id == Device.id)
    if device_id:
        query = query.where(Interface.device_id == device_id)
    query = query.order_by(Device.hostname, Interface.name)
    result = await db.execute(query)
    rows_raw = result.all()

    rows = []
    for iface, dev in rows_raw:
        # Get latest metric
        m_result = await db.execute(
            select(InterfaceMetric)
            .where(InterfaceMetric.interface_id == iface.id)
            .order_by(InterfaceMetric.timestamp.desc())
            .limit(1)
        )
        m = m_result.scalar_one_or_none()
        rows.append({
            "device": dev.hostname,
            "device_ip": dev.ip_address,
            "interface": iface.name,
            "description": iface.description or "",
            "speed_mbps": (iface.speed or 0) // 1_000_000 if iface.speed else "",
            "admin_status": iface.admin_status or "",
            "oper_status": iface.oper_status or "",
            "in_bps": f"{m.in_bps:.0f}" if m else "",
            "out_bps": f"{m.out_bps:.0f}" if m else "",
            "utilization_in_pct": f"{m.utilization_in:.2f}" if m else "",
            "utilization_out_pct": f"{m.utilization_out:.2f}" if m else "",
            "in_errors": m.in_errors if m else "",
            "out_errors": m.out_errors if m else "",
            "last_polled": m.timestamp.isoformat() if m else "",
        })
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    return _csv_response(rows, f"interfaces_{ts}.csv")


@router.get("/alerts")
async def report_alerts(
    hours: int = Query(168, description="Hours of history"),
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Export alert events as CSV."""
    if start:
        cutoff = datetime.fromisoformat(start)
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=timezone.utc)
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    time_filters = [AlertEvent.triggered_at >= cutoff]
    if start and end:
        until = datetime.fromisoformat(end)
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        time_filters.append(AlertEvent.triggered_at <= until)
    result = await db.execute(
        select(AlertEvent, AlertRule)
        .join(AlertRule, AlertEvent.rule_id == AlertRule.id)
        .where(*time_filters)
        .order_by(AlertEvent.triggered_at.desc())
    )
    rows = [
        {
            "rule_name": rule.name,
            "severity": event.severity,
            "status": event.status,
            "message": event.message or "",
            "metric_value": event.metric_value or "",
            "threshold": event.threshold_value or "",
            "triggered_at": event.triggered_at.isoformat(),
            "resolved_at": event.resolved_at.isoformat() if event.resolved_at else "",
        }
        for event, rule in result.all()
    ]
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    return _csv_response(rows, f"alerts_{ts}.csv")


@router.get("/flows")
async def report_flows(
    hours: int = Query(24, description="Hours of history"),
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = Query(10000, le=50000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Export flow records as CSV."""
    if start:
        cutoff = datetime.fromisoformat(start)
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=timezone.utc)
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    time_filters = [FlowRecord.timestamp >= cutoff]
    if start and end:
        until = datetime.fromisoformat(end)
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        time_filters.append(FlowRecord.timestamp <= until)
    result = await db.execute(
        select(FlowRecord)
        .where(*time_filters)
        .order_by(FlowRecord.timestamp.desc())
        .limit(limit)
    )
    rows = [
        {
            "timestamp": f.timestamp.isoformat(),
            "src_ip": f.src_ip,
            "dst_ip": f.dst_ip,
            "src_port": f.src_port or "",
            "dst_port": f.dst_port or "",
            "protocol": f.protocol_name or "",
            "application": f.application or "",
            "bytes": f.bytes,
            "packets": f.packets,
            "flow_type": f.flow_type or "",
        }
        for f in result.scalars().all()
    ]
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    return _csv_response(rows, f"flows_{ts}.csv")


@router.get("/summary")
async def report_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return a JSON summary of available report types and record counts."""
    from sqlalchemy import func as sqlfunc
    device_count = (await db.execute(select(sqlfunc.count(Device.id)).where(Device.is_active == True))).scalar()
    iface_count  = (await db.execute(select(sqlfunc.count(Interface.id)))).scalar()
    alert_count  = (await db.execute(select(sqlfunc.count(AlertEvent.id)))).scalar()
    flow_count   = (await db.execute(select(sqlfunc.count(FlowRecord.id)))).scalar()
    return {
        "reports": [
            {"id": "devices",    "name": "Device Inventory",       "count": device_count, "description": "All active devices with status and metrics"},
            {"id": "interfaces", "name": "Interface Report",        "count": iface_count,  "description": "Interfaces with latest throughput and utilization"},
            {"id": "alerts",     "name": "Alert History (7 days)",  "count": alert_count,  "description": "Alert events with severity and resolution time"},
            {"id": "flows",      "name": "Flow Records (24 hours)", "count": flow_count,   "description": "NetFlow/sFlow records with src/dst/protocol"},
        ]
    }
