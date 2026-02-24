"""
Duo Universal Prompt MFA integration.

Uses the duo_universal SDK for OIDC-based redirect flow.
State is preserved in Redis between redirect-out and callback.
"""
import json
import logging
from typing import Optional, Dict, Any, Tuple

import redis.asyncio as aioredis
from duo_universal.client import Client, DuoException

from app.config import settings

logger = logging.getLogger(__name__)

_duo_client: Optional[Client] = None

DUO_STATE_TTL_SECONDS = 300  # 5 minutes
DUO_STATE_PREFIX = "duo_state:"


def get_duo_client() -> Optional[Client]:
    """Return the singleton Duo Client, or None if not configured."""
    global _duo_client
    if not settings.DUO_ENABLED:
        return None
    if not all([settings.DUO_INTEGRATION_KEY, settings.DUO_SECRET_KEY,
                settings.DUO_API_HOSTNAME, settings.DUO_REDIRECT_URI]):
        logger.warning("DUO_ENABLED=true but missing required DUO_* configuration")
        return None
    if _duo_client is None:
        _duo_client = Client(
            client_id=settings.DUO_INTEGRATION_KEY,
            client_secret=settings.DUO_SECRET_KEY,
            host=settings.DUO_API_HOSTNAME,
            redirect_uri=settings.DUO_REDIRECT_URI,
        )
    return _duo_client


def duo_health_check() -> bool:
    """Check connectivity to Duo. Returns True if healthy."""
    client = get_duo_client()
    if not client:
        return False
    try:
        client.health_check()
        return True
    except DuoException as e:
        logger.error(f"Duo health check failed: {e}")
        return False


def create_duo_auth_url(username: str) -> Tuple[str, str]:
    """
    Generate the Duo auth URL and state parameter.
    Returns (auth_url, state).
    """
    client = get_duo_client()
    if not client:
        raise DuoException("Duo client not configured")
    state = client.generate_state()
    auth_url = client.create_auth_url(username, state)
    return auth_url, state


def verify_duo_code(duo_code: str, username: str) -> bool:
    """
    Exchange the Duo authorization code for a 2FA result.
    Returns True if the result is "allow".
    """
    client = get_duo_client()
    if not client:
        return False
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
