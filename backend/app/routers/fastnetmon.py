import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models.settings import SystemSetting
from app.models.user import User
from app.middleware.rbac import get_current_user, require_operator_or_above
from app.services.fastnetmon_client import FastNetMonClient

router = APIRouter(prefix="/api/fastnetmon", tags=["FastNetMon"])

# All config keys for both servers
_ALL_FNM_KEYS = [
    "fnm_mitigation_enabled",
    "fnm_mitigation_host", "fnm_mitigation_port", "fnm_mitigation_use_ssl",
    "fnm_mitigation_api_user", "fnm_mitigation_api_password",
    "fnm_blackhole_enabled",
    "fnm_blackhole_host", "fnm_blackhole_port", "fnm_blackhole_use_ssl",
    "fnm_blackhole_api_user", "fnm_blackhole_api_password",
]


async def _get_client(db: AsyncSession, node: str = "mitigation") -> FastNetMonClient | None:
    """Build a FastNetMonClient for the given node (mitigation or blackhole)."""
    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(_ALL_FNM_KEYS)))
    cfg = {s.key: s.value for s in result.scalars().all()}

    prefix = f"fnm_{node}"
    if cfg.get(f"{prefix}_enabled") != "true":
        return None

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
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    client = await _get_client(db, node)
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
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db, node)).get_total_traffic()


@router.get("/host-counters")
async def get_host_counters(
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db, node)).get_host_counters()


@router.get("/network-counters")
async def get_network_counters(
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db, node)).get_network_counters()


# ── Mitigations ─────────────────────────────────────────────────────────────

@router.get("/blackholes")
async def get_blackholes(
    node: str = Query("blackhole"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    client = _require(await _get_client(db, node))
    return await client.get_blocked_hosts()


class BlackholeRequest(BaseModel):
    ip: str


@router.put("/blackhole")
async def add_blackhole(
    payload: BlackholeRequest,
    node: str = Query("blackhole"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    client = _require(await _get_client(db, node))
    ok = await client.block_host(payload.ip)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Failed to blackhole {payload.ip}")
    return {"message": f"Blackhole for {payload.ip} added"}


@router.delete("/blackhole/{uuid}")
async def remove_blackhole(
    uuid: str,
    node: str = Query("blackhole"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    client = _require(await _get_client(db, node))
    ok = await client.unblock_host(uuid)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Failed to remove blackhole {uuid}")
    return {"message": f"Blackhole {uuid} removed"}


@router.get("/flowspec")
async def get_flowspec(
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db, node)).get_flowspec()


# ── BGP ─────────────────────────────────────────────────────────────────────

@router.get("/bgp")
async def get_bgp_peers(
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db, node)).get_bgp_peers()


# ── Hostgroups / Detection ──────────────────────────────────────────────────

@router.get("/hostgroups")
async def get_hostgroups(
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db, node)).get_hostgroups()


# ── Configuration ──────────────────────────────────────────────────────────

@router.get("/config")
async def get_config(
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _require(await _get_client(db, node)).get_config()


class ConfigUpdateRequest(BaseModel):
    key: str
    value: str


@router.put("/config")
async def update_config(
    payload: ConfigUpdateRequest,
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    client = _require(await _get_client(db, node))
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
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    client = _require(await _get_client(db, node))
    ok = await client.update_hostgroup(name, payload.key, payload.value)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Failed to update {name}.{payload.key}")
    return {"message": f"Updated {name}.{payload.key}"}


# ── Network List Management ───────────────────────────────────────────────

class NetworkListRequest(BaseModel):
    list_name: str  # networks_list, networks_whitelist, networks_whitelist_remote
    cidr: str


@router.put("/network")
async def add_network(
    payload: NetworkListRequest,
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    client = _require(await _get_client(db, node))
    ok = await client.add_network(payload.list_name, payload.cidr)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Failed to add {payload.cidr} to {payload.list_name}")
    return {"message": f"Added {payload.cidr} to {payload.list_name}"}


@router.delete("/network")
async def remove_network(
    payload: NetworkListRequest,
    node: str = Query("mitigation"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above),
):
    client = _require(await _get_client(db, node))
    ok = await client.remove_network(payload.list_name, payload.cidr)
    if not ok:
        raise HTTPException(status_code=502, detail=f"Failed to remove {payload.cidr} from {payload.list_name}")
    return {"message": f"Removed {payload.cidr} from {payload.list_name}"}
