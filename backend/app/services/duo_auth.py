"""
Duo MFA via Duo Auth API (direct HTTPS).

Calls Duo's cloud API to trigger a Push notification. No local Auth Proxy
or RADIUS setup required — just the Integration Key, Secret Key, and
API Hostname from the Duo Admin panel.

Uses httpx (already a project dependency) for async HTTP requests.
"""
import asyncio
import base64
import email.utils
import hashlib
import hmac
import logging
import urllib.parse
from typing import Dict

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings

logger = logging.getLogger(__name__)

# DB setting keys
DUO_DB_KEYS = [
    "duo_enabled", "duo_ikey", "duo_skey", "duo_api_host", "duo_timeout",
]


async def get_duo_config(db: AsyncSession) -> Dict[str, object]:
    """Load Duo config from DB, falling back to env vars."""
    from app.models.settings import SystemSetting
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key.in_(DUO_DB_KEYS))
    )
    db_map = {s.key: s.value for s in result.scalars().all()}

    return {
        "enabled": db_map.get("duo_enabled", str(settings.DUO_ENABLED)).lower() in ("true", "1", "yes"),
        "ikey": db_map.get("duo_ikey") or settings.DUO_IKEY,
        "skey": db_map.get("duo_skey") or settings.DUO_SKEY,
        "api_host": db_map.get("duo_api_host") or settings.DUO_API_HOST,
        "timeout": int(db_map.get("duo_timeout") or settings.DUO_TIMEOUT),
    }


def _sign_request(
    method: str, host: str, path: str,
    params: dict, ikey: str, skey: str,
) -> tuple:
    """
    Sign a Duo Auth API request per Duo's signing spec.

    Returns (date_header, authorization_header).
    """
    now = email.utils.formatdate()

    # Canonical params: sorted, URL-encoded
    canon_params = urllib.parse.urlencode(sorted(params.items()))

    # Canonical request: date\nmethod\nhost\npath\nparams
    canon = "\n".join([now, method.upper(), host.lower(), path, canon_params])

    # HMAC-SHA1 signature
    sig = hmac.new(
        skey.encode("utf-8"),
        canon.encode("utf-8"),
        hashlib.sha1,
    ).hexdigest()

    # Basic auth header: base64(ikey:signature)
    auth = base64.b64encode(f"{ikey}:{sig}".encode("utf-8")).decode("utf-8")

    return now, f"Basic {auth}"


async def verify_duo_push(
    api_host: str, ikey: str, skey: str,
    username: str, timeout: int = 60,
) -> bool:
    """
    Send a Duo Push notification and wait for the user to approve/deny.

    The /auth/v2/auth endpoint blocks until the user responds or the
    request times out on Duo's side.

    Returns True if the user approved, False otherwise.
    """
    path = "/auth/v2/auth"
    params = {
        "username": username,
        "factor": "push",
        "device": "auto",
    }

    date_str, auth_header = _sign_request("POST", api_host, path, params, ikey, skey)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout + 15)) as client:
            resp = await client.post(
                f"https://{api_host}{path}",
                data=params,
                headers={
                    "Date": date_str,
                    "Authorization": auth_header,
                },
            )

        if resp.status_code == 200:
            data = resp.json()
            if data.get("stat") == "OK":
                result = data.get("response", {}).get("result")
                status_msg = data.get("response", {}).get("status_msg", "")
                logger.info("Duo push result for %s: %s (%s)", username, result, status_msg)
                return result == "allow"
            else:
                msg = data.get("message", "unknown error")
                logger.warning("Duo API error for %s: %s", username, msg)
                return False
        else:
            logger.warning("Duo API HTTP %d for %s", resp.status_code, username)
            return False

    except httpx.TimeoutException:
        logger.warning("Duo push timed out for %s (%ds)", username, timeout)
        return False
    except Exception as e:
        logger.error("Duo push failed for %s: %s", username, e)
        raise


async def ping_duo_api(api_host: str) -> bool:
    """
    Quick health check — calls /auth/v2/ping (unauthenticated).
    Returns True if Duo's API is reachable.
    """
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"https://{api_host}/auth/v2/ping")
            if resp.status_code == 200:
                data = resp.json()
                return data.get("stat") == "OK"
    except Exception:
        pass
    return False


async def check_duo_auth(api_host: str, ikey: str, skey: str) -> dict:
    """
    Authenticated health check — calls /auth/v2/check.
    Verifies that ikey/skey/host are correct.
    """
    path = "/auth/v2/check"
    params = {}

    date_str, auth_header = _sign_request("POST", api_host, path, params, ikey, skey)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"https://{api_host}{path}",
                data=params,
                headers={
                    "Date": date_str,
                    "Authorization": auth_header,
                },
            )

        data = resp.json()
        return {
            "ok": data.get("stat") == "OK",
            "message": data.get("response", {}).get("time", "") if data.get("stat") == "OK"
                       else data.get("message", "Unknown error"),
        }
    except Exception as e:
        return {"ok": False, "message": str(e)}
