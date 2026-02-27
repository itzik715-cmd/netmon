from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import List, Optional
from datetime import datetime, timezone
from app.database import get_db
from app.models.alert import AlertRule, AlertEvent
from app.models.device import Device
from app.models.interface import Interface
from app.models.user import User
from app.services.auth import log_audit
from app.middleware.rbac import get_current_user, require_operator_or_above, require_admin
from app.schemas.alert import (
    AlertRuleCreate, AlertRuleUpdate, AlertRuleResponse,
    AlertEventResponse, AlertAcknowledgeRequest
)

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


@router.get("/rules", response_model=List[AlertRuleResponse])
async def list_rules(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(AlertRule).order_by(AlertRule.created_at.desc()))
    rules = result.scalars().all()

    # Batch-load device and interface names
    device_ids = {r.device_id for r in rules if r.device_id}
    iface_ids = {r.interface_id for r in rules if r.interface_id}
    dev_map: dict[int, str] = {}
    iface_map: dict[int, str] = {}
    if device_ids:
        dr = await db.execute(select(Device.id, Device.hostname).where(Device.id.in_(device_ids)))
        dev_map = {row.id: row.hostname for row in dr}
    if iface_ids:
        ir = await db.execute(select(Interface.id, Interface.name).where(Interface.id.in_(iface_ids)))
        iface_map = {row.id: row.name for row in ir}

    out = []
    for r in rules:
        d = AlertRuleResponse.model_validate(r)
        d.device_hostname = dev_map.get(r.device_id) if r.device_id else None
        d.interface_name = iface_map.get(r.interface_id) if r.interface_id else None
        out.append(d)
    return out


@router.post("/rules", response_model=AlertRuleResponse)
async def create_rule(
    request: Request,
    payload: AlertRuleCreate,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    rule = AlertRule(**payload.dict(), created_by=current_user.id)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    await log_audit(
        db, "alert_rule_created",
        user_id=current_user.id, username=current_user.username,
        resource_type="alert_rule", resource_id=str(rule.id),
        details=f"Rule: {rule.name}",
        source_ip=request.client.host if request.client else None,
    )
    resp = AlertRuleResponse.model_validate(rule)
    if rule.device_id:
        dr = await db.execute(select(Device.hostname).where(Device.id == rule.device_id))
        resp.device_hostname = dr.scalar_one_or_none()
    if rule.interface_id:
        ir = await db.execute(select(Interface.name).where(Interface.id == rule.interface_id))
        resp.interface_name = ir.scalar_one_or_none()
    return resp


@router.patch("/rules/{rule_id}", response_model=AlertRuleResponse)
async def update_rule(
    request: Request,
    rule_id: int,
    payload: AlertRuleUpdate,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")

    update_data = payload.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(rule, key, value)
    await db.commit()
    await db.refresh(rule)

    await log_audit(
        db, "alert_rule_updated",
        user_id=current_user.id, username=current_user.username,
        resource_type="alert_rule", resource_id=str(rule_id),
        source_ip=request.client.host if request.client else None,
    )
    resp = AlertRuleResponse.model_validate(rule)
    if rule.device_id:
        dr = await db.execute(select(Device.hostname).where(Device.id == rule.device_id))
        resp.device_hostname = dr.scalar_one_or_none()
    if rule.interface_id:
        ir = await db.execute(select(Interface.name).where(Interface.id == rule.interface_id))
        resp.interface_name = ir.scalar_one_or_none()
    return resp


@router.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: int,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")

    await db.delete(rule)
    await db.commit()
    return {"message": "Alert rule deleted"}


@router.get("/events", response_model=List[AlertEventResponse])
async def list_events(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = select(AlertEvent).order_by(AlertEvent.triggered_at.desc()).limit(limit)
    if status:
        query = query.where(AlertEvent.status == status)
    if severity:
        query = query.where(AlertEvent.severity == severity)

    result = await db.execute(query)
    events = result.scalars().all()

    # Batch-load device names
    device_ids = {e.device_id for e in events if e.device_id}
    dev_map: dict[int, str] = {}
    if device_ids:
        dr = await db.execute(select(Device.id, Device.hostname).where(Device.id.in_(device_ids)))
        dev_map = {row.id: row.hostname for row in dr}

    out = []
    for e in events:
        d = AlertEventResponse.model_validate(e)
        d.device_hostname = dev_map.get(e.device_id) if e.device_id else None
        out.append(d)
    return out


@router.get("/events/summary")
async def events_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from sqlalchemy import func
    open_result = await db.execute(
        select(func.count(AlertEvent.id)).where(AlertEvent.status == "open")
    )
    critical_result = await db.execute(
        select(func.count(AlertEvent.id)).where(
            AlertEvent.status == "open", AlertEvent.severity == "critical"
        )
    )
    warning_result = await db.execute(
        select(func.count(AlertEvent.id)).where(
            AlertEvent.status == "open", AlertEvent.severity == "warning"
        )
    )
    return {
        "open": open_result.scalar() or 0,
        "critical": critical_result.scalar() or 0,
        "warning": warning_result.scalar() or 0,
    }


@router.post("/events/{event_id}/acknowledge")
async def acknowledge_event(
    request: Request,
    event_id: int,
    payload: AlertAcknowledgeRequest,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AlertEvent).where(AlertEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Alert event not found")

    now = datetime.now(timezone.utc)
    await db.execute(
        update(AlertEvent)
        .where(AlertEvent.id == event_id)
        .values(
            status="acknowledged",
            acknowledged_at=now,
            acknowledged_by=current_user.id,
            notes=payload.notes,
        )
    )
    await db.commit()

    await log_audit(
        db, "alert_acknowledged",
        user_id=current_user.id, username=current_user.username,
        resource_type="alert_event", resource_id=str(event_id),
        source_ip=request.client.host if request.client else None,
    )
    return {"message": "Alert acknowledged"}


@router.post("/events/{event_id}/resolve")
async def resolve_event(
    event_id: int,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    await db.execute(
        update(AlertEvent)
        .where(AlertEvent.id == event_id)
        .values(status="resolved", resolved_at=now)
    )
    await db.commit()
    return {"message": "Alert resolved"}
