from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional

from app.database import get_db
from app.models.device import Device, DeviceBlock
from app.models.settings import SystemSetting
from app.middleware.rbac import get_current_user, require_operator_or_above
from app.schemas.block import BlockCreate, BlockResponse, SyncBlocksResponse
from app.models.user import User

router = APIRouter(prefix="/api/blocks", tags=["Blocks"])


async def _get_device_or_404(device_id: int, db: AsyncSession) -> Device:
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


# ── List blocks ──────────────────────────────────────────────────────────────

@router.get("/", response_model=List[BlockResponse])
async def list_blocks(
    device_id: Optional[int] = None,
    block_type: Optional[str] = None,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List active blocks, optionally filtered by device or type."""
    query = select(DeviceBlock)
    if device_id is not None:
        query = query.where(DeviceBlock.device_id == device_id)
    if block_type is not None:
        query = query.where(DeviceBlock.block_type == block_type)
    if active_only:
        query = query.where(DeviceBlock.is_active == True)
    query = query.order_by(DeviceBlock.created_at.desc())

    result = await db.execute(query)
    blocks = result.scalars().all()

    # Enrich with device hostname
    device_ids = {b.device_id for b in blocks}
    device_map: dict[int, str] = {}
    if device_ids:
        dev_result = await db.execute(select(Device).where(Device.id.in_(device_ids)))
        device_map = {d.id: d.hostname for d in dev_result.scalars().all()}

    response = []
    for b in blocks:
        br = BlockResponse.model_validate(b)
        br.device_hostname = device_map.get(b.device_id)
        response.append(br)
    return response


# ── Apply a block ─────────────────────────────────────────────────────────────

@router.post("/device/{device_id}", response_model=BlockResponse)
async def create_block(
    device_id: int,
    payload: BlockCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator_or_above),
):
    """
    Apply a null-route or flowspec block on an Arista device and record it.
    """
    from app.services.arista_api import apply_null_route

    device = await _get_device_or_404(device_id, db)

    if payload.block_type == "null_route":
        ok = await apply_null_route(device, payload.prefix)
        if not ok:
            raise HTTPException(status_code=502, detail="Failed to apply null route on device")
    elif payload.block_type == "flowspec":
        # FlowSpec rules are managed externally via BGP; we only record the intent
        pass
    else:
        raise HTTPException(status_code=400, detail=f"Unknown block_type '{payload.block_type}'")

    block = DeviceBlock(
        device_id=device_id,
        prefix=payload.prefix,
        block_type=payload.block_type,
        description=payload.description,
        is_active=True,
        created_by=current_user.username,
    )
    db.add(block)
    await db.commit()
    await db.refresh(block)
    return block


# ── Remove a block ────────────────────────────────────────────────────────────

@router.delete("/{block_id}", status_code=204)
async def delete_block(
    block_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    """Remove a block from the device and mark it inactive in the DB."""
    from app.services.arista_api import remove_null_route

    result = await db.execute(select(DeviceBlock).where(DeviceBlock.id == block_id))
    block = result.scalar_one_or_none()
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")

    if block.block_type == "null_route":
        device = await _get_device_or_404(block.device_id, db)
        await remove_null_route(device, block.prefix)

    block.is_active = False
    await db.commit()


# ── Sync blocks from device ───────────────────────────────────────────────────

@router.post("/device/{device_id}/sync", response_model=SyncBlocksResponse)
async def sync_blocks(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    """
    Pull current null-route and flowspec blocks from an Arista device
    and sync the database to match.
    """
    from app.services.arista_api import sync_device_blocks

    device = await _get_device_or_404(device_id, db)
    counts = await sync_device_blocks(device, db)
    return SyncBlocksResponse(device_id=device_id, **counts)


# ── Active blocks summary (for dashboard) ────────────────────────────────────

@router.get("/summary", response_model=dict)
async def blocks_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return counts of active blocks grouped by type, plus recent list."""
    from sqlalchemy import func

    result = await db.execute(
        select(DeviceBlock.block_type, func.count(DeviceBlock.id))
        .where(DeviceBlock.is_active == True)
        .group_by(DeviceBlock.block_type)
    )
    counts = {row[0]: row[1] for row in result.all()}

    recent_result = await db.execute(
        select(DeviceBlock)
        .where(DeviceBlock.is_active == True)
        .order_by(DeviceBlock.created_at.desc())
        .limit(10)
    )
    recent = recent_result.scalars().all()

    return {
        "total": sum(counts.values()),
        "null_route": counts.get("null_route", 0),
        "flowspec": counts.get("flowspec", 0),
        "recent": [
            {
                "id": b.id,
                "device_id": b.device_id,
                "prefix": b.prefix,
                "block_type": b.block_type,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in recent
        ],
    }


# ─── FastNetMon Blackholes ──────────────────────────────────────────────────

async def _get_fnm_client(db: AsyncSession, node: str = "blocker"):
    """Build a FastNetMonClient from saved settings. node = 'monitor' or 'blocker'."""
    from app.services.fastnetmon_client import FastNetMonClient

    fnm_keys = [
        "fnm_enabled", "fnm_shared_node",
        "fnm_monitor_host", "fnm_monitor_port", "fnm_monitor_use_ssl",
        "fnm_monitor_api_user", "fnm_monitor_api_password",
        "fnm_blocker_host", "fnm_blocker_port", "fnm_blocker_use_ssl",
        "fnm_blocker_api_user", "fnm_blocker_api_password",
    ]
    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(fnm_keys)))
    cfg = {s.key: s.value for s in result.scalars().all()}

    if cfg.get("fnm_enabled") != "true":
        return None, cfg

    shared = cfg.get("fnm_shared_node", "true") == "true"
    if shared or node == "monitor":
        prefix = "fnm_monitor"
    else:
        prefix = "fnm_blocker"

    host = cfg.get(f"{prefix}_host")
    if not host:
        return None, cfg

    return FastNetMonClient(
        host=host,
        port=int(cfg.get(f"{prefix}_port", "10007")),
        username=cfg.get(f"{prefix}_api_user", "admin"),
        password=cfg.get(f"{prefix}_api_password", ""),
        use_ssl=cfg.get(f"{prefix}_use_ssl", "false") == "true",
    ), cfg


@router.get("/fastnetmon/blackholes")
async def get_fnm_blackholes(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Fetch currently blackholed IPs from FastNetMon."""
    client, cfg = await _get_fnm_client(db, "blocker")
    if not client:
        return {"enabled": cfg.get("fnm_enabled") == "true", "blocks": []}

    blocks = await client.get_blocked_hosts()
    return {
        "enabled": True,
        "blocks": blocks,
        "node": client.node_label,
    }


@router.delete("/fastnetmon/blackhole/{ip}")
async def fnm_unblock(
    ip: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    """Remove an IP from FastNetMon blackhole."""
    client, _ = await _get_fnm_client(db, "blocker")
    if not client:
        raise HTTPException(status_code=400, detail="FastNetMon is not configured")

    ok = await client.unblock_host(ip)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Failed to unblock {ip} on FastNetMon")
    return {"message": f"Blackhole for {ip} removed"}
