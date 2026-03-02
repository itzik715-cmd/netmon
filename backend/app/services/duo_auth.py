"""
Duo MFA via RADIUS Auth Proxy.

Sends RADIUS Access-Request (RFC 2865) to a local Duo Auth Proxy running
in duo_only_client mode. The proxy triggers a Duo Push and responds with
Access-Accept (approved) or Access-Reject (denied / timeout).

Pure stdlib — no external RADIUS library required.
"""
import asyncio
import hashlib
import logging
import os
import socket
import struct
from typing import Dict

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings

logger = logging.getLogger(__name__)

# DB setting keys
DUO_DB_KEYS = [
    "duo_enabled", "duo_radius_host", "duo_radius_port",
    "duo_radius_secret", "duo_timeout",
]

# RADIUS codes (RFC 2865)
RADIUS_ACCESS_REQUEST = 1
RADIUS_ACCESS_ACCEPT = 2
RADIUS_ACCESS_REJECT = 3

# RADIUS attribute types
ATTR_USER_NAME = 1
ATTR_USER_PASSWORD = 2


async def get_duo_config(db: AsyncSession) -> Dict[str, object]:
    """Load Duo config from DB, falling back to env vars."""
    from app.models.settings import SystemSetting
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key.in_(DUO_DB_KEYS))
    )
    db_map = {s.key: s.value for s in result.scalars().all()}

    return {
        "enabled": db_map.get("duo_enabled", str(settings.DUO_ENABLED)).lower() in ("true", "1", "yes"),
        "radius_host": db_map.get("duo_radius_host") or settings.DUO_RADIUS_HOST,
        "radius_port": int(db_map.get("duo_radius_port") or settings.DUO_RADIUS_PORT),
        "radius_secret": db_map.get("duo_radius_secret") or settings.DUO_RADIUS_SECRET,
        "timeout": int(db_map.get("duo_timeout") or settings.DUO_RADIUS_TIMEOUT),
    }


def _pad_password(password: bytes, secret: bytes, authenticator: bytes) -> bytes:
    """
    Encrypt User-Password per RFC 2865 Section 5.2.

    The password is padded to a multiple of 16 bytes, then XOR'd with
    MD5(secret + authenticator) in 16-byte blocks.
    """
    # Pad to multiple of 16
    padded = password + b"\x00" * (16 - len(password) % 16) if len(password) % 16 else password
    if len(padded) == 0:
        padded = b"\x00" * 16

    result = b""
    prev_block = authenticator
    for i in range(0, len(padded), 16):
        digest = hashlib.md5(secret + prev_block).digest()
        block = bytes(a ^ b for a, b in zip(padded[i:i + 16], digest))
        result += block
        prev_block = block
    return result


def _build_radius_packet(username: str, secret: bytes) -> tuple:
    """
    Build a RADIUS Access-Request packet.

    Returns (packet_bytes, request_authenticator).
    """
    identifier = os.urandom(1)[0]
    authenticator = os.urandom(16)

    # Build attributes
    user_bytes = username.encode("utf-8")
    attr_username = struct.pack("BB", ATTR_USER_NAME, 2 + len(user_bytes)) + user_bytes

    # Password: "duo_push" — Duo Auth Proxy in duo_only_client mode ignores this
    password_encrypted = _pad_password(b"duo_push", secret, authenticator)
    attr_password = struct.pack("BB", ATTR_USER_PASSWORD, 2 + len(password_encrypted)) + password_encrypted

    attributes = attr_username + attr_password

    # Header: Code (1 byte) + ID (1 byte) + Length (2 bytes) + Authenticator (16 bytes)
    length = 20 + len(attributes)
    header = struct.pack("!BBH", RADIUS_ACCESS_REQUEST, identifier, length) + authenticator

    return header + attributes, authenticator, identifier


def _send_radius_request(host: str, port: int, secret: bytes,
                         username: str, timeout: int = 60) -> bool:
    """
    Send a RADIUS Access-Request and wait for the response.

    Blocking call — use asyncio.to_thread() to avoid blocking the event loop.
    Returns True on Access-Accept, False on Access-Reject or timeout.
    """
    packet, authenticator, identifier = _build_radius_packet(username, secret)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(packet, (host, port))
        data, _ = sock.recvfrom(4096)

        if len(data) < 20:
            logger.warning("RADIUS response too short (%d bytes)", len(data))
            return False

        code = data[0]
        resp_id = data[1]

        if resp_id != identifier:
            logger.warning("RADIUS response ID mismatch (expected %d, got %d)", identifier, resp_id)
            return False

        if code == RADIUS_ACCESS_ACCEPT:
            logger.info("Duo RADIUS: Access-Accept for %s", username)
            return True
        elif code == RADIUS_ACCESS_REJECT:
            logger.info("Duo RADIUS: Access-Reject for %s", username)
            return False
        else:
            logger.warning("Duo RADIUS: unexpected code %d for %s", code, username)
            return False

    except socket.timeout:
        logger.warning("Duo RADIUS: timeout waiting for response for %s (%ds)", username, timeout)
        return False
    except OSError as e:
        logger.error("Duo RADIUS: socket error for %s: %s", username, e)
        return False
    finally:
        sock.close()


async def verify_duo_radius(host: str, port: int, secret: bytes,
                            username: str, timeout: int = 60) -> bool:
    """Async wrapper around the blocking RADIUS request."""
    return await asyncio.to_thread(_send_radius_request, host, port, secret, username, timeout)


async def ping_auth_proxy(host: str, port: int, secret: bytes, timeout: int = 3) -> bool:
    """
    Quick connectivity check — send a RADIUS request with a probe username
    and see if we get any response (Accept or Reject) within a short timeout.
    """
    try:
        return await asyncio.to_thread(
            _send_radius_request, host, port, secret, "__duo_ping__", timeout
        )
    except Exception:
        # Any response (even Reject) means the proxy is reachable
        return False
