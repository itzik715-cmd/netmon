from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from app.database import get_db
from app.models.settings import SystemSetting
from app.models.user import User
from app.middleware.rbac import get_current_user, require_admin
from pydantic import BaseModel

router = APIRouter(prefix="/api/settings", tags=["Settings"])


class SettingUpdate(BaseModel):
    value: str


@router.get("/")
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin()),
):
    result = await db.execute(select(SystemSetting))
    settings_list = result.scalars().all()
    return [
        {
            "key": s.key,
            "value": "***" if s.is_secret else s.value,
            "description": s.description,
        }
        for s in settings_list
    ]


@router.get("/{key}")
async def get_setting(
    key: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin()),
):
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    return {
        "key": setting.key,
        "value": "***" if setting.is_secret else setting.value,
        "description": setting.description,
    }


@router.put("/{key}")
async def update_setting(
    key: str,
    payload: SettingUpdate,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    setting = result.scalar_one_or_none()

    if setting:
        setting.value = payload.value
        setting.updated_by = current_user.id
    else:
        setting = SystemSetting(key=key, value=payload.value, updated_by=current_user.id)
        db.add(setting)

    await db.commit()
    return {"key": key, "updated": True}


@router.get("/ldap/config")
async def get_ldap_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin()),
):
    """Get LDAP configuration (passwords masked)."""
    keys = [
        "ldap_enabled", "ldap_server", "ldap_port", "ldap_use_ssl",
        "ldap_base_dn", "ldap_bind_dn", "ldap_user_filter",
        "ldap_group_admin", "ldap_group_operator", "ldap_group_readonly",
        "ldap_local_fallback",
    ]
    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(keys)))
    settings_map = {s.key: s.value for s in result.scalars().all()}
    return settings_map


@router.put("/ldap/config")
async def save_ldap_config(
    payload: dict,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    """Save LDAP configuration."""
    allowed_keys = {
        "ldap_enabled", "ldap_server", "ldap_port", "ldap_use_ssl",
        "ldap_base_dn", "ldap_bind_dn", "ldap_bind_password",
        "ldap_user_filter", "ldap_group_admin", "ldap_group_operator",
        "ldap_group_readonly", "ldap_local_fallback",
    }
    secret_keys = {"ldap_bind_password"}

    for key, value in payload.items():
        if key not in allowed_keys:
            continue
        result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = str(value)
            setting.updated_by = current_user.id
        else:
            setting = SystemSetting(
                key=key,
                value=str(value),
                is_secret=(key in secret_keys),
                updated_by=current_user.id,
            )
            db.add(setting)

    await db.commit()
    return {"message": "LDAP configuration saved"}


@router.get("/duo/config")
async def get_duo_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin()),
):
    """Get Duo MFA configuration (secrets masked)."""
    keys = [
        "duo_enabled", "duo_integration_key", "duo_secret_key",
        "duo_api_hostname", "duo_redirect_uri",
    ]
    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(keys)))
    settings_map = {s.key: s.value for s in result.scalars().all()}
    # Mask secret key
    if "duo_secret_key" in settings_map and settings_map["duo_secret_key"]:
        settings_map["duo_secret_key"] = "***"
    return settings_map


@router.put("/duo/config")
async def save_duo_config(
    payload: dict,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    """Save Duo MFA configuration."""
    allowed_keys = {
        "duo_enabled", "duo_integration_key", "duo_secret_key",
        "duo_api_hostname", "duo_redirect_uri",
    }
    secret_keys = {"duo_secret_key"}

    for key, value in payload.items():
        if key not in allowed_keys:
            continue
        # Skip masked secret values (user didn't change it)
        if key in secret_keys and value == "***":
            continue
        result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = str(value)
            setting.updated_by = current_user.id
        else:
            setting = SystemSetting(
                key=key,
                value=str(value),
                is_secret=(key in secret_keys),
                updated_by=current_user.id,
            )
            db.add(setting)

    await db.commit()
    return {"message": "Duo MFA configuration saved"}


# ─── FastNetMon Config ───────────────────────────────────────────────────────

_FNM_KEYS = [
    "fnm_enabled", "fnm_shared_node",
    "fnm_monitor_host", "fnm_monitor_port", "fnm_monitor_use_ssl",
    "fnm_monitor_api_user", "fnm_monitor_api_password",
    "fnm_blocker_host", "fnm_blocker_port", "fnm_blocker_use_ssl",
    "fnm_blocker_api_user", "fnm_blocker_api_password",
]
_FNM_SECRET_KEYS = {"fnm_monitor_api_password", "fnm_blocker_api_password"}


@router.get("/fastnetmon/config")
async def get_fastnetmon_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin()),
):
    """Get FastNetMon configuration (passwords masked)."""
    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(_FNM_KEYS)))
    settings_map = {s.key: s.value for s in result.scalars().all()}
    for k in _FNM_SECRET_KEYS:
        if k in settings_map and settings_map[k]:
            settings_map[k] = "***"
    return settings_map


@router.put("/fastnetmon/config")
async def save_fastnetmon_config(
    payload: dict,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    """Save FastNetMon configuration."""
    allowed_keys = set(_FNM_KEYS)

    for key, value in payload.items():
        if key not in allowed_keys:
            continue
        if key in _FNM_SECRET_KEYS and value == "***":
            continue
        result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = str(value)
            setting.updated_by = current_user.id
        else:
            setting = SystemSetting(
                key=key,
                value=str(value),
                is_secret=(key in _FNM_SECRET_KEYS),
                updated_by=current_user.id,
            )
            db.add(setting)

    await db.commit()
    return {"message": "FastNetMon configuration saved"}


@router.post("/fastnetmon/test")
async def test_fastnetmon(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin()),
):
    """Test connectivity to FastNetMon nodes."""
    from app.services.fastnetmon_client import FastNetMonClient

    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(_FNM_KEYS)))
    cfg = {s.key: s.value for s in result.scalars().all()}

    monitor_ok = False
    monitor_version = None
    blocker_ok = False
    blocker_version = None

    # Test monitor node
    if cfg.get("fnm_monitor_host"):
        client = FastNetMonClient(
            host=cfg["fnm_monitor_host"],
            port=int(cfg.get("fnm_monitor_port", "10007")),
            username=cfg.get("fnm_monitor_api_user", "admin"),
            password=cfg.get("fnm_monitor_api_password", ""),
            use_ssl=cfg.get("fnm_monitor_use_ssl", "false") == "true",
        )
        status = await client.get_status()
        monitor_ok = bool(status)
        monitor_version = status.get("version") or status.get("raw", "")[:80] if status else None

    # Test blocker node (only if separate)
    shared = cfg.get("fnm_shared_node", "true") == "true"
    if shared:
        blocker_ok = monitor_ok
        blocker_version = monitor_version
    elif cfg.get("fnm_blocker_host"):
        client = FastNetMonClient(
            host=cfg["fnm_blocker_host"],
            port=int(cfg.get("fnm_blocker_port", "10007")),
            username=cfg.get("fnm_blocker_api_user", "admin"),
            password=cfg.get("fnm_blocker_api_password", ""),
            use_ssl=cfg.get("fnm_blocker_use_ssl", "false") == "true",
        )
        status = await client.get_status()
        blocker_ok = bool(status)
        blocker_version = status.get("version") or status.get("raw", "")[:80] if status else None

    return {
        "monitor_ok": monitor_ok,
        "blocker_ok": blocker_ok,
        "monitor_version": monitor_version,
        "blocker_version": blocker_version,
    }
