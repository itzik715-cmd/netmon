"""
System Events API
Exposes the system_events table for the frontend log viewer.
"""
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, AsyncSessionLocal
from app.middleware.rbac import require_operator_or_above
from app.models.system_event import SystemEvent

router = APIRouter(prefix="/api/system-events", tags=["system-events"])


class SystemEventResponse(BaseModel):
    id: int
    timestamp: datetime
    level: str
    source: str
    event_type: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    message: str
    details: Optional[str] = None

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[SystemEventResponse])
async def list_system_events(
    limit: int = Query(200, le=1000),
    offset: int = 0,
    level: Optional[str] = None,
    source: Optional[str] = None,
    _=Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    q = select(SystemEvent).order_by(desc(SystemEvent.timestamp))
    if level:
        q = q.where(SystemEvent.level == level)
    if source:
        q = q.where(SystemEvent.source == source)
    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


# ── helper used by background services (no existing DB session) ───────────────

async def log_system_event(
    level: str,
    source: str,
    event_type: str,
    message: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    details: Optional[str] = None,
) -> None:
    """
    Write a SystemEvent record.  Creates its own DB session so it can be
    called from background tasks / schedulers that have no request context.
    """
    try:
        async with AsyncSessionLocal() as db:
            db.add(SystemEvent(
                level=level,
                source=source,
                event_type=event_type,
                resource_type=resource_type,
                resource_id=resource_id,
                message=message,
                details=details,
            ))
            await db.commit()
    except Exception as exc:
        # Never let logging failure crash the caller
        import logging
        logging.getLogger(__name__).error("Failed to write system event: %s", exc)
