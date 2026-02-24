"""
Config Backup API Router
Endpoints for managing device configuration backups, schedules, and diffs.
"""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, delete as sql_delete, func

from app.database import get_db
from app.models.config_backup import ConfigBackup, BackupSchedule
from app.models.device import Device
from app.routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/backups", tags=["config-backups"])


# ---------------------------------------------------------------------------
# Schemas (inline)
# ---------------------------------------------------------------------------

class BackupItem(BaseModel):
    id: int
    device_id: int
    device_hostname: Optional[str] = None
    backup_type: str
    configs_match: Optional[bool] = None
    size_bytes: Optional[int] = None
    config_hash: Optional[str] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class ScheduleSettings(BaseModel):
    id: Optional[int] = None
    device_id: Optional[int] = None
    device_hostname: Optional[str] = None
    hour: int       # 0-23
    minute: int     # 0-59
    retention_days: int
    is_active: bool


class DiffResult(BaseModel):
    diff_lines: list[str]
    additions: int
    deletions: int
    identical: bool
    label_a: str
    label_b: str


# ---------------------------------------------------------------------------
# List & summary
# ---------------------------------------------------------------------------

@router.get("/", response_model=list[BackupItem])
async def list_backups(
    device_id: Optional[int] = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """List backups, newest first. Optionally filter by device."""
    q = (
        select(ConfigBackup, Device.hostname)
        .join(Device, Device.id == ConfigBackup.device_id, isouter=True)
        .order_by(desc(ConfigBackup.created_at))
        .offset(offset)
        .limit(limit)
    )
    if device_id:
        q = q.where(ConfigBackup.device_id == device_id)

    result = await db.execute(q)
    rows = result.all()

    items = []
    for backup, hostname in rows:
        item = BackupItem.model_validate(backup)
        item.device_hostname = hostname
        items.append(item)
    return items


@router.get("/summary")
async def backups_summary(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Return aggregate stats for the backup dashboard widget."""
    total_r = await db.execute(select(func.count()).select_from(ConfigBackup))
    total = total_r.scalar()

    mismatch_r = await db.execute(
        select(func.count()).select_from(ConfigBackup)
        .where(ConfigBackup.configs_match == False)
    )
    unsaved_changes = mismatch_r.scalar()

    failed_r = await db.execute(
        select(func.count()).select_from(ConfigBackup)
        .where(ConfigBackup.error != None)
    )
    failed = failed_r.scalar()

    # Devices monitored
    devices_r = await db.execute(
        select(func.count(ConfigBackup.device_id.distinct()))
        .select_from(ConfigBackup)
    )
    devices_backed_up = devices_r.scalar()

    return {
        "total": total,
        "unsaved_changes": unsaved_changes,
        "failed": failed,
        "devices_backed_up": devices_backed_up,
    }


# ---------------------------------------------------------------------------
# Schedule settings
# ---------------------------------------------------------------------------

@router.get("/schedule", response_model=list[ScheduleSettings])
async def get_schedules(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Return all backup schedules (global + per-device)."""
    result = await db.execute(
        select(BackupSchedule, Device.hostname)
        .join(Device, Device.id == BackupSchedule.device_id, isouter=True)
        .order_by(BackupSchedule.device_id.asc().nullsfirst())
    )
    rows = result.all()

    return [
        ScheduleSettings(
            id=sched.id,
            device_id=sched.device_id,
            device_hostname=hostname,
            hour=sched.hour,
            minute=sched.minute,
            retention_days=sched.retention_days,
            is_active=sched.is_active,
        )
        for sched, hostname in rows
    ]


@router.put("/schedule", response_model=ScheduleSettings)
async def upsert_schedule(
    data: ScheduleSettings,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Create or update a backup schedule. Use device_id=null for global."""
    if not 0 <= data.hour <= 23:
        raise HTTPException(400, "hour must be 0-23")
    if not 0 <= data.minute <= 59:
        raise HTTPException(400, "minute must be 0-59")
    if data.retention_days < 1:
        raise HTTPException(400, "retention_days must be >= 1")

    # Validate device exists if device_id provided
    hostname = None
    if data.device_id is not None:
        dev_result = await db.execute(select(Device).where(Device.id == data.device_id))
        device = dev_result.scalar_one_or_none()
        if not device:
            raise HTTPException(404, "Device not found")
        hostname = device.hostname

    # Upsert: find existing schedule for this device_id (or global)
    if data.device_id is not None:
        result = await db.execute(
            select(BackupSchedule).where(BackupSchedule.device_id == data.device_id)
        )
    else:
        result = await db.execute(
            select(BackupSchedule).where(BackupSchedule.device_id.is_(None))
        )
    sched = result.scalar_one_or_none()

    if sched:
        sched.hour = data.hour
        sched.minute = data.minute
        sched.retention_days = data.retention_days
        sched.is_active = data.is_active
    else:
        sched = BackupSchedule(
            device_id=data.device_id,
            hour=data.hour,
            minute=data.minute,
            retention_days=data.retention_days,
            is_active=data.is_active,
        )
        db.add(sched)

    await db.commit()
    await db.refresh(sched)

    return ScheduleSettings(
        id=sched.id,
        device_id=sched.device_id,
        device_hostname=hostname,
        hour=sched.hour,
        minute=sched.minute,
        retention_days=sched.retention_days,
        is_active=sched.is_active,
    )


@router.delete("/schedule/{schedule_id}")
async def delete_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Delete a backup schedule."""
    result = await db.execute(select(BackupSchedule).where(BackupSchedule.id == schedule_id))
    sched = result.scalar_one_or_none()
    if not sched:
        raise HTTPException(404, "Schedule not found")
    await db.delete(sched)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Manual backup trigger
# ---------------------------------------------------------------------------

@router.post("/device/{device_id}", response_model=BackupItem)
async def manual_backup(
    device_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Trigger an immediate config backup for a single device."""
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(404, "Device not found")
    if not device.api_username or not device.api_password:
        raise HTTPException(400, f"Device {device.hostname} has no API credentials configured")

    from app.services.config_fetcher import backup_device
    backup = await backup_device(device_id, db, backup_type="manual", triggered_by=_user.username)

    item = BackupItem.model_validate(backup)
    item.device_hostname = device.hostname
    return item


# ---------------------------------------------------------------------------
# Backup detail (with full config text)
# ---------------------------------------------------------------------------

@router.get("/{backup_id}")
async def get_backup(
    backup_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Get full backup record including config text."""
    result = await db.execute(
        select(ConfigBackup, Device.hostname)
        .join(Device, Device.id == ConfigBackup.device_id, isouter=True)
        .where(ConfigBackup.id == backup_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(404, "Backup not found")
    backup, hostname = row

    return {
        "id": backup.id,
        "device_id": backup.device_id,
        "device_hostname": hostname,
        "backup_type": backup.backup_type,
        "configs_match": backup.configs_match,
        "size_bytes": backup.size_bytes,
        "config_hash": backup.config_hash,
        "error": backup.error,
        "created_at": backup.created_at,
        "expires_at": backup.expires_at,
        "config_text": backup.config_text,
        "startup_config": backup.startup_config,
    }


@router.get("/{backup_id}/raw")
async def get_backup_raw(
    backup_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Return the raw running-config as plain text (for download)."""
    result = await db.execute(select(ConfigBackup).where(ConfigBackup.id == backup_id))
    backup = result.scalar_one_or_none()
    if not backup:
        raise HTTPException(404, "Backup not found")
    if not backup.config_text:
        raise HTTPException(404, "No config text stored in this backup")
    return PlainTextResponse(
        content=backup.config_text,
        headers={"Content-Disposition": f"attachment; filename=backup-{backup_id}.txt"},
    )


# ---------------------------------------------------------------------------
# Delete backup
# ---------------------------------------------------------------------------

@router.delete("/{backup_id}")
async def delete_backup(
    backup_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    result = await db.execute(select(ConfigBackup).where(ConfigBackup.id == backup_id))
    backup = result.scalar_one_or_none()
    if not backup:
        raise HTTPException(404, "Backup not found")
    await db.delete(backup)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Diff endpoints
# ---------------------------------------------------------------------------

@router.get("/diff/compare", response_model=DiffResult)
async def diff_two_backups(
    a_id: int = Query(..., description="First backup ID (older/left)"),
    b_id: int = Query(..., description="Second backup ID (newer/right)"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Diff two stored backup versions."""
    result_a = await db.execute(
        select(ConfigBackup, Device.hostname)
        .join(Device, Device.id == ConfigBackup.device_id, isouter=True)
        .where(ConfigBackup.id == a_id)
    )
    row_a = result_a.first()
    result_b = await db.execute(
        select(ConfigBackup, Device.hostname)
        .join(Device, Device.id == ConfigBackup.device_id, isouter=True)
        .where(ConfigBackup.id == b_id)
    )
    row_b = result_b.first()

    if not row_a:
        raise HTTPException(404, f"Backup {a_id} not found")
    if not row_b:
        raise HTTPException(404, f"Backup {b_id} not found")

    backup_a, hostname_a = row_a
    backup_b, hostname_b = row_b

    from app.services.config_fetcher import diff_configs
    label_a = f"{hostname_a or 'device'} @ {backup_a.created_at.strftime('%Y-%m-%d %H:%M') if backup_a.created_at else str(a_id)}"
    label_b = f"{hostname_b or 'device'} @ {backup_b.created_at.strftime('%Y-%m-%d %H:%M') if backup_b.created_at else str(b_id)}"

    result_diff = diff_configs(
        backup_a.config_text or "",
        backup_b.config_text or "",
        label_a=label_a,
        label_b=label_b,
    )
    return DiffResult(label_a=label_a, label_b=label_b, **result_diff)


@router.post("/{backup_id}/diff-live", response_model=DiffResult)
async def diff_backup_vs_live(
    backup_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Diff a stored backup against the device's current running-config (live fetch)."""
    result = await db.execute(
        select(ConfigBackup, Device)
        .join(Device, Device.id == ConfigBackup.device_id)
        .where(ConfigBackup.id == backup_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(404, "Backup not found")
    backup, device = row

    from app.services.config_fetcher import fetch_device_configs, diff_configs
    try:
        live_running, _ = await fetch_device_configs(device)
    except Exception as exc:
        raise HTTPException(502, f"Could not fetch live config: {exc}")

    ts = backup.created_at.strftime("%Y-%m-%d %H:%M") if backup.created_at else str(backup_id)
    label_a = f"{device.hostname} @ {ts} (backup)"
    label_b = f"{device.hostname} @ now (live)"

    result_diff = diff_configs(
        backup.config_text or "",
        live_running or "",
        label_a=label_a,
        label_b=label_b,
    )
    return DiffResult(label_a=label_a, label_b=label_b, **result_diff)


@router.post("/{backup_id}/diff-startup", response_model=DiffResult)
async def diff_running_vs_startup(
    backup_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Diff the running-config vs startup-config stored in one backup record."""
    result = await db.execute(
        select(ConfigBackup, Device.hostname)
        .join(Device, Device.id == ConfigBackup.device_id, isouter=True)
        .where(ConfigBackup.id == backup_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(404, "Backup not found")
    backup, hostname = row

    if not backup.config_text:
        raise HTTPException(400, "Backup has no running-config stored")
    if not backup.startup_config:
        raise HTTPException(400, "Backup has no startup-config stored")

    from app.services.config_fetcher import diff_configs
    ts = backup.created_at.strftime("%Y-%m-%d %H:%M") if backup.created_at else str(backup_id)
    label_a = f"{hostname} running-config @ {ts}"
    label_b = f"{hostname} startup-config @ {ts}"

    result_diff = diff_configs(
        backup.config_text,
        backup.startup_config,
        label_a=label_a,
        label_b=label_b,
    )
    return DiffResult(label_a=label_a, label_b=label_b, **result_diff)
