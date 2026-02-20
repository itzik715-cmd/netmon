from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from app.database import get_db
from app.models.interface import Interface, InterfaceMetric
from app.middleware.rbac import get_current_user
from app.schemas.interface import InterfaceResponse, InterfaceMetricResponse
from app.models.user import User

router = APIRouter(prefix="/api/interfaces", tags=["Interfaces"])


@router.get("/device/{device_id}", response_model=List[InterfaceResponse])
async def get_device_interfaces(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Interface).where(Interface.device_id == device_id)
    )
    return result.scalars().all()


@router.get("/{interface_id}", response_model=InterfaceResponse)
async def get_interface(
    interface_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Interface).where(Interface.id == interface_id))
    iface = result.scalar_one_or_none()
    if not iface:
        raise HTTPException(status_code=404, detail="Interface not found")
    return iface


@router.get("/{interface_id}/metrics", response_model=List[InterfaceMetricResponse])
async def get_interface_metrics(
    interface_id: int,
    hours: int = 24,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get historical metrics for an interface (default last 24h)."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(InterfaceMetric)
        .where(
            InterfaceMetric.interface_id == interface_id,
            InterfaceMetric.timestamp >= since,
        )
        .order_by(InterfaceMetric.timestamp.asc())
        .limit(2000)
    )
    return result.scalars().all()


@router.get("/{interface_id}/latest")
async def get_interface_latest(
    interface_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get the most recent metric for an interface."""
    result = await db.execute(
        select(InterfaceMetric)
        .where(InterfaceMetric.interface_id == interface_id)
        .order_by(InterfaceMetric.timestamp.desc())
        .limit(1)
    )
    metric = result.scalar_one_or_none()
    if not metric:
        return None
    return InterfaceMetricResponse.model_validate(metric)


@router.patch("/{interface_id}/toggle-monitor")
async def toggle_monitoring(
    interface_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Interface).where(Interface.id == interface_id))
    iface = result.scalar_one_or_none()
    if not iface:
        raise HTTPException(status_code=404, detail="Interface not found")

    iface.is_monitored = not iface.is_monitored
    await db.commit()
    return {"interface_id": interface_id, "is_monitored": iface.is_monitored}
