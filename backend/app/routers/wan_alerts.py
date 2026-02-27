from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_
from typing import List, Optional
from datetime import datetime, timezone
from app.database import get_db
from app.models.wan_alert import WanAlertRule
from app.models.alert import AlertEvent
from app.models.user import User
from app.services.auth import log_audit
from app.middleware.rbac import get_current_user, require_operator_or_above, require_admin
from app.schemas.wan_alert import (
    WanAlertRuleCreate, WanAlertRuleUpdate, WanAlertRuleResponse,
)
from app.schemas.alert import AlertEventResponse

router = APIRouter(prefix="/api/wan-alerts", tags=["WAN Alerts"])


@router.get("/rules", response_model=List[WanAlertRuleResponse])
async def list_rules(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(WanAlertRule).order_by(WanAlertRule.created_at.desc())
    )
    return result.scalars().all()


@router.post("/rules", response_model=WanAlertRuleResponse)
async def create_rule(
    request: Request,
    payload: WanAlertRuleCreate,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    rule = WanAlertRule(**payload.dict(), created_by=current_user.id)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    await log_audit(
        db, "wan_alert_rule_created",
        user_id=current_user.id, username=current_user.username,
        resource_type="wan_alert_rule", resource_id=str(rule.id),
        details=f"WAN Rule: {rule.name}",
        source_ip=request.client.host if request.client else None,
    )
    return rule


@router.patch("/rules/{rule_id}", response_model=WanAlertRuleResponse)
async def update_rule(
    request: Request,
    rule_id: int,
    payload: WanAlertRuleUpdate,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(WanAlertRule).where(WanAlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="WAN alert rule not found")

    update_data = payload.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(rule, key, value)
    await db.commit()
    await db.refresh(rule)

    await log_audit(
        db, "wan_alert_rule_updated",
        user_id=current_user.id, username=current_user.username,
        resource_type="wan_alert_rule", resource_id=str(rule_id),
        source_ip=request.client.host if request.client else None,
    )
    return rule


@router.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: int,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(WanAlertRule).where(WanAlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="WAN alert rule not found")

    await db.delete(rule)
    await db.commit()
    return {"message": "WAN alert rule deleted"}


@router.get("/events", response_model=List[AlertEventResponse])
async def list_events(
    status: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = (
        select(AlertEvent)
        .where(AlertEvent.wan_rule_id.isnot(None))
        .order_by(AlertEvent.triggered_at.desc())
        .limit(limit)
    )
    if status:
        query = query.where(AlertEvent.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/events/{event_id}/acknowledge")
async def acknowledge_event(
    event_id: int,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AlertEvent).where(AlertEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event or not event.wan_rule_id:
        raise HTTPException(status_code=404, detail="WAN alert event not found")

    now = datetime.now(timezone.utc)
    event.status = "acknowledged"
    event.acknowledged_at = now
    event.acknowledged_by = current_user.id
    await db.commit()
    return {"message": "WAN alert acknowledged"}


@router.post("/events/{event_id}/resolve")
async def resolve_event(
    event_id: int,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AlertEvent).where(AlertEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event or not event.wan_rule_id:
        raise HTTPException(status_code=404, detail="WAN alert event not found")

    now = datetime.now(timezone.utc)
    event.status = "resolved"
    event.resolved_at = now
    await db.commit()
    return {"message": "WAN alert resolved"}
