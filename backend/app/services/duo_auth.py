"""
Duo Universal Prompt MFA integration.

Uses the duo_universal SDK for OIDC-based redirect flow.
State is preserved in Redis between redirect-out and callback.
Configuration can come from DB settings (GUI) or env vars (fallback).
"""
import json
import logging
from typing import Optional, Dict, Any, Tuple

import redis.asyncio as aioredis
from duo_universal.client import Client, DuoException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings

logger = logging.getLogger(__name__)

DUO_STATE_TTL_SECONDS = 300  # 5 minutes
DUO_STATE_PREFIX = "duo_state:"

# DB setting keys
DUO_DB_KEYS = [
    "duo_enabled", "duo_integration_key", "duo_secret_key",
    "duo_api_hostname", "duo_redirect_uri",
]


async def get_duo_config(db: AsyncSession) -> Dict[str, str]:
    """Load Duo config from DB, falling back to env vars."""
    from app.models.settings import SystemSetting
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key.in_(DUO_DB_KEYS))
    )
    db_map = {s.key: s.value for s in result.scalars().all()}

    return {
        "enabled": db_map.get("duo_enabled", str(settings.DUO_ENABLED)).lower() in ("true", "1", "yes"),
        "integration_key": db_map.get("duo_integration_key") or settings.DUO_INTEGRATION_KEY,
        "secret_key": db_map.get("duo_secret_key") or settings.DUO_SECRET_KEY,
        "api_hostname": db_map.get("duo_api_hostname") or settings.DUO_API_HOSTNAME,
        "redirect_uri": db_map.get("duo_redirect_uri") or settings.DUO_REDIRECT_URI,
    }


def build_duo_client(cfg: Dict[str, Any]) -> Optional[Client]:
    """Build a Duo Client from config dict. Returns None if not fully configured."""
    if not cfg.get("enabled"):
        return None
    ikey = cfg.get("integration_key", "")
    skey = cfg.get("secret_key", "")
    host = cfg.get("api_hostname", "")
    redirect = cfg.get("redirect_uri", "")
    if not all([ikey, skey, host, redirect]):
        logger.warning("Duo enabled but missing required configuration")
        return None
    return Client(
        client_id=ikey,
        client_secret=skey,
        host=host,
        redirect_uri=redirect,
    )


def duo_health_check_with_client(client: Optional[Client]) -> bool:
    """Check connectivity to Duo. Returns True if healthy."""
    if not client:
        return False
    try:
        client.health_check()
        return True
    except DuoException as e:
        logger.error(f"Duo health check failed: {e}")
        return False


def create_duo_auth_url(client: Client, username: str) -> Tuple[str, str]:
    """Generate the Duo auth URL and state parameter. Returns (auth_url, state)."""
    state = client.generate_state()
    auth_url = client.create_auth_url(username, state)
    return auth_url, state


def verify_duo_code(client: Client, duo_code: str, username: str) -> bool:
    """Exchange the Duo authorization code for a 2FA result. Returns True if allowed."""
    try:
        token = client.exchange_authorization_code_for_2fa_result(duo_code, username)
        if token and token.get("auth_result", {}).get("result") == "allow":
            return True
        logger.warning(f"Duo 2FA denied for {username}: {token}")
        return False
    except DuoException as e:
        logger.error(f"Duo code exchange failed for {username}: {e}")
        return False


async def store_duo_state(state: str, user_data: Dict[str, Any]) -> None:
    """Store pre-authenticated user data in Redis, keyed by Duo state."""
    r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
    try:
        key = f"{DUO_STATE_PREFIX}{state}"
        await r.set(key, json.dumps(user_data), ex=DUO_STATE_TTL_SECONDS)
    finally:
        await r.aclose()


async def retrieve_and_delete_duo_state(state: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve and atomically delete stored user data for a Duo state.
    Returns None if not found or expired (prevents replay).
    """
    r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
    try:
        key = f"{DUO_STATE_PREFIX}{state}"
        pipe = r.pipeline()
        pipe.get(key)
        pipe.delete(key)
        results = await pipe.execute()
        raw = results[0]
        if raw is None:
            return None
        return json.loads(raw)
    finally:
        await r.aclose()
