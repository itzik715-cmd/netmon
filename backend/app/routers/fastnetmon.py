import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models.settings import SystemSetting
from app.models.user import User
from app.middleware.rbac import get_current_user, require_operator_or_above
from app.services.fastnetmon_client import FastNetMonClient

router = APIRouter(prefix="/api/fastnetmon", tags=["FastNetMon"])


async def _get_client(db: AsyncSession, node: str = "monitor") -> FastNetMonClient | None:
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
        return None

    shared = cfg.get("fnm_shared_node", "true") == "true"
    prefix = "fnm_monitor" if (shared or node == "monitor") else "fnm_blocker"

    host = cfg.get(f"{prefix}_host")
    if not host:
        return None

    return FastNetMonClient(
        host=host,
        port=int(cfg.get(f"{prefix}_port", "10007")),
        username=cfg.get(f"{prefix}_api_user", "admin"),
        password=cfg.get(f"{prefix}_api_password", ""),
        use_ssl=cfg.get(f"{prefix}_use_ssl", "false") == "true",
    )


def _require(client):
    if not client:
        raise HTTPException(status_code=400, detail="FastNetMon is not configured or not enabled")
    return client


# ── Dashboard (aggregated) ──────────────────────────────────────────────────

@router.get("/dashboard")
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    client = await _get_client(db)
    if not client:
        return {"enabled": False}

    license_info, traffic, blackholes, bgp_peers = await asyncio.gather(
        client.get_license(),
        client.get_total_traffic(),
        client.get_blocked_hosts(),
        client.get_bgp_peers(),
        return_exceptions=True,
    )

    return {
        "enabled": True,
        "license": license_info if not isinstance(license_info, Exception) else {},
        "traffic": traffic if not isinstance(traffic, Exception) else [],
        "blackhole_count": len(blackholes) if not isinstance(blackholes, Exception) else 0,
        "bgp_peers": bgp_peers if not isinstance(bgp_peers, Exception) else [],
    }


# ── Traffic ─────────────────────────────────────────────────────────────────

@router.get("/traffic")
async def get_traffic(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db)).get_total_traffic()


@router.get("/host-counters")
async def get_host_counters(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db)).get_host_counters()


@router.get("/network-counters")
async def get_network_counters(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db)).get_network_counters()


# ── Mitigations ─────────────────────────────────────────────────────────────

@router.get("/blackholes")
async def get_blackholes(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    client = _require(await _get_client(db, "blocker"))
    return await client.get_blocked_hosts()


class BlackholeRequest(BaseModel):
    ip: str


@router.put("/blackhole")
async def add_blackhole(
    payload: BlackholeRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    client = _require(await _get_client(db, "blocker"))
    ok = await client.block_host(payload.ip)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Failed to blackhole {payload.ip}")
    return {"message": f"Blackhole for {payload.ip} added"}


@router.delete("/blackhole/{uuid}")
async def remove_blackhole(
    uuid: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    client = _require(await _get_client(db, "blocker"))
    ok = await client.unblock_host(uuid)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Failed to remove blackhole {uuid}")
    return {"message": f"Blackhole {uuid} removed"}


@router.get("/flowspec")
async def get_flowspec(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db)).get_flowspec()


# ── BGP ─────────────────────────────────────────────────────────────────────

@router.get("/bgp")
async def get_bgp_peers(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db)).get_bgp_peers()


# ── Hostgroups / Detection ──────────────────────────────────────────────────

@router.get("/hostgroups")
async def get_hostgroups(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db)).get_hostgroups()


# ── Configuration ──────────────────────────────────────────────────────────

@router.get("/config")
async def get_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db)).get_config()


class ConfigUpdateRequest(BaseModel):
    key: str
    value: str


@router.put("/config")
async def update_config(
    payload: ConfigUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    client = _require(await _get_client(db))
    ok = await client.update_config(payload.key, payload.value)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Failed to update {payload.key}")
    return {"message": f"Updated {payload.key}"}


class HostgroupUpdateRequest(BaseModel):
    key: str
    value: str


@router.put("/hostgroup/{name}")
async def update_hostgroup(
    name: str,
    payload: HostgroupUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    client = _require(await _get_client(db))
    ok = await client.update_hostgroup(name, payload.key, payload.value)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Failed to update {name}.{payload.key}")
    return {"message": f"Updated {name}.{payload.key}"}
