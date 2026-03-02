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
    """Get Duo Auth API configuration (secrets masked)."""
    keys = [
        "duo_enabled", "duo_ikey", "duo_skey", "duo_api_host", "duo_timeout",
    ]
    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(keys)))
    settings_map = {s.key: s.value for s in result.scalars().all()}
    # Mask secret key
    if "duo_skey" in settings_map and settings_map["duo_skey"]:
        settings_map["duo_skey"] = "***"
    return settings_map


@router.put("/duo/config")
async def save_duo_config(
    payload: dict,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    """Save Duo Auth API configuration."""
    allowed_keys = {
        "duo_enabled", "duo_ikey", "duo_skey", "duo_api_host", "duo_timeout",
    }
    secret_keys = {"duo_skey"}

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
    "fnm_mitigation_enabled",
    "fnm_mitigation_host", "fnm_mitigation_port", "fnm_mitigation_use_ssl",
    "fnm_mitigation_api_user", "fnm_mitigation_api_password",
    "fnm_blackhole_enabled",
    "fnm_blackhole_host", "fnm_blackhole_port", "fnm_blackhole_use_ssl",
    "fnm_blackhole_api_user", "fnm_blackhole_api_password",
]
_FNM_SECRET_KEYS = {"fnm_mitigation_api_password", "fnm_blackhole_api_password"}


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
    """Test connectivity to FastNetMon servers."""
    from app.services.fastnetmon_client import FastNetMonClient

    result = await db.execute(select(SystemSetting).where(SystemSetting.key.in_(_FNM_KEYS)))
    cfg = {s.key: s.value for s in result.scalars().all()}

    mitigation_ok = False
    mitigation_version = None
    blackhole_ok = False
    blackhole_version = None

    # Test mitigation server
    if cfg.get("fnm_mitigation_host"):
        client = FastNetMonClient(
            host=cfg["fnm_mitigation_host"],
            port=int(cfg.get("fnm_mitigation_port", "10007")),
            username=cfg.get("fnm_mitigation_api_user", "admin"),
            password=cfg.get("fnm_mitigation_api_password", ""),
            use_ssl=cfg.get("fnm_mitigation_use_ssl", "false") == "true",
        )
        status = await client.get_status()
        mitigation_ok = bool(status)
        mitigation_version = status.get("version") or status.get("raw", "")[:80] if status else None

    # Test blackhole server
    if cfg.get("fnm_blackhole_host"):
        client = FastNetMonClient(
            host=cfg["fnm_blackhole_host"],
            port=int(cfg.get("fnm_blackhole_port", "10007")),
            username=cfg.get("fnm_blackhole_api_user", "admin"),
            password=cfg.get("fnm_blackhole_api_password", ""),
            use_ssl=cfg.get("fnm_blackhole_use_ssl", "false") == "true",
        )
        status = await client.get_status()
        blackhole_ok = bool(status)
        blackhole_version = status.get("version") or status.get("raw", "")[:80] if status else None

    return {
        "mitigation_ok": mitigation_ok,
        "blackhole_ok": blackhole_ok,
        "mitigation_version": mitigation_version,
        "blackhole_version": blackhole_version,
    }
