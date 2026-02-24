"""
Configuration backup and diff service.

Fetch running/startup configs from devices via Arista eAPI (JSON-RPC).
Tries HTTPS first, then falls back to HTTP on port 80.

Provides diff utilities using stdlib difflib.
"""
import difflib
import hashlib
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config fetching
# ---------------------------------------------------------------------------

async def _fetch_via_eapi(device) -> tuple[Optional[str], Optional[str]]:
    """
    Fetch running and startup configs via Arista eAPI (JSON-RPC over HTTP/HTTPS).

    Tries multiple protocol/port combinations in order:
      1. configured protocol:port  (default https:443)
      2. https:8080
      3. http:80
      4. http:8080
    Uses a short connect-timeout (5 s) so each attempt fails fast.
    """
    import httpx

    from app.crypto import decrypt_value
    username = device.api_username
    password = decrypt_value(device.api_password)
    if not username or not password:
        raise ValueError(
            f"No API credentials for {device.hostname}. "
            "Set api_username and api_password in device settings."
        )

    configured_protocol = device.api_protocol or "https"
    configured_port = device.api_port or 443

    # Build deduplicated list of (protocol, port) to try in order
    candidates = [(configured_protocol, configured_port)]
    for proto, port in [("https", 8080), ("http", 80), ("http", 8080)]:
        if (proto, port) not in candidates:
            candidates.append((proto, port))

    payload = {
        "jsonrpc": "2.0",
        "method": "runCmds",
        "params": {
            "version": 1,
            "cmds": ["show running-config", "show startup-config"],
            "format": "text",
        },
        "id": "netmon-backup",
    }

    # Short connect timeout so we don't wait 15 s per endpoint
    timeout = httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=5.0)

    last_exc: Optional[Exception] = None
    for protocol, port in candidates:
        url = f"{protocol}://{device.ip_address}:{port}/command-api"
        try:
            from app.config import settings as _settings
            async with httpx.AsyncClient(verify=_settings.DEVICE_SSL_VERIFY, timeout=timeout) as client:
                resp = await client.post(url, json=payload, auth=(username, password))
                resp.raise_for_status()
                data = resp.json()

            if "error" in data:
                raise ValueError(f"eAPI error from {device.hostname}: {data['error']}")

            results = data.get("result", [])
            running = results[0].get("output", "") if len(results) > 0 else None
            startup = results[1].get("output", "") if len(results) > 1 else None
            logger.info("Config fetched via eAPI (%s:%s) for %s", protocol, port, device.hostname)
            return running, startup

        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in (401, 403):
                # Wrong credentials — no point trying other ports
                raise RuntimeError(
                    f"eAPI authentication failed for {device.hostname} (HTTP {status}). "
                    "Check api_username / api_password in device settings."
                ) from exc
            # 404 means the endpoint path doesn't exist (eAPI not enabled on this port)
            last_exc = exc
            logger.debug("eAPI %s:%s for %s: HTTP %s", protocol, port, device.hostname, status)

        except Exception as exc:
            last_exc = exc
            logger.debug(
                "eAPI fetch attempt %s:%s for %s failed (%s): %s",
                protocol, port, device.hostname, type(exc).__name__, exc,
            )

    # Build a human-readable final error based on what the last failure was
    if isinstance(last_exc, (httpx.ConnectTimeout, httpx.PoolTimeout)):
        detail = (
            "connection timed out on all attempted ports (443, 8080, 80). "
            "Verify the device is reachable and that 'management api http-commands' "
            "is enabled with 'no shutdown'."
        )
    elif isinstance(last_exc, httpx.ConnectError):
        detail = (
            "cannot connect to device. "
            "Check network connectivity and that 'management api http-commands' is enabled."
        )
    elif isinstance(last_exc, httpx.HTTPStatusError) and last_exc.response.status_code == 404:
        detail = (
            "eAPI endpoint not found (HTTP 404) on all tried ports. "
            "Run on the device:  management api http-commands → no shutdown"
        )
    else:
        detail = (
            f"{type(last_exc).__name__}: {last_exc}. "
            "Ensure 'management api http-commands' is enabled and "
            "api_username/api_password are set correctly."
        )

    raise RuntimeError(
        f"eAPI config fetch failed for {device.hostname}: {detail}"
    ) from last_exc


async def fetch_device_configs(device) -> tuple[Optional[str], Optional[str]]:
    """
    Fetch running-config and startup-config from a device via eAPI.

    Requires api_username and api_password to be set on the device.
    Returns (running_config, startup_config).  Either may be None on partial failure.
    """
    if not device.api_username or not device.api_password:
        raise ValueError(
            f"Device {device.hostname} has no API credentials. "
            "Set api_username and api_password in device settings to enable config backup."
        )

    return await _fetch_via_eapi(device)


# ---------------------------------------------------------------------------
# Diff utilities
# ---------------------------------------------------------------------------

def _normalize_config(config: str) -> str:
    """
    Strip lines that change on every save (timestamps, ntp clock-period, etc.)
    so that running==startup comparison is meaningful.
    """
    skip_patterns = [
        "last configuration change",
        "ntp clock-period",
        "! time:",
        "! last",
    ]
    lines = []
    for line in config.splitlines():
        lower = line.lower().strip()
        if any(p in lower for p in skip_patterns):
            continue
        lines.append(line)
    return "\n".join(lines)


def diff_configs(
    config_a: str,
    config_b: str,
    label_a: str = "version A",
    label_b: str = "version B",
    context_lines: int = 5,
) -> dict:
    """
    Generate a unified diff between two config strings.

    Returns:
        {
            "diff_lines": list[str],   # unified diff lines
            "additions": int,
            "deletions": int,
            "identical": bool,
        }
    """
    lines_a = (config_a or "").splitlines(keepends=True)
    lines_b = (config_b or "").splitlines(keepends=True)

    diff = list(
        difflib.unified_diff(
            lines_a, lines_b,
            fromfile=label_a,
            tofile=label_b,
            n=context_lines,
        )
    )

    additions = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
    deletions = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))

    return {
        "diff_lines": [l.rstrip("\n") for l in diff],
        "additions": additions,
        "deletions": deletions,
        "identical": len(diff) == 0,
    }


# ---------------------------------------------------------------------------
# Backup execution
# ---------------------------------------------------------------------------

async def backup_device(device_id: int, db, backup_type: str = "manual", triggered_by: str = None):
    """
    Fetch and persist a ConfigBackup record for the given device.
    Handles errors gracefully — stores error message in backup record.
    Returns the ConfigBackup ORM object.
    """
    from app.models.device import Device
    from app.models.config_backup import ConfigBackup, BackupSchedule
    from sqlalchemy import select

    # Load device
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise ValueError(f"Device {device_id} not found")

    # Determine retention period from schedule settings
    sched_result = await db.execute(select(BackupSchedule).limit(1))
    schedule = sched_result.scalar_one_or_none()
    retention_days = schedule.retention_days if schedule else 90

    expires_at = datetime.now(timezone.utc) + timedelta(days=retention_days)

    backup = ConfigBackup(
        device_id=device_id,
        backup_type=backup_type,
        triggered_by=triggered_by or ("scheduler" if backup_type == "scheduled" else "system"),
        expires_at=expires_at,
    )

    try:
        running, startup = await fetch_device_configs(device)
        backup.config_text = running
        backup.startup_config = startup

        if running:
            backup.size_bytes = len(running.encode("utf-8"))
            backup.config_hash = hashlib.sha256(running.encode("utf-8")).hexdigest()

        if running is not None and startup is not None:
            backup.configs_match = _normalize_config(running) == _normalize_config(startup)
        else:
            backup.configs_match = None

    except Exception as exc:
        backup.error = str(exc)
        logger.error("Config backup failed for device %s (id=%s): %s", device.hostname, device_id, exc)
        from app.routers.system_events import log_system_event
        await log_system_event(
            level="error",
            source="backup",
            event_type="backup_failed",
            resource_type="device",
            resource_id=device.hostname,
            message=f"Config backup failed for {device.hostname} ({device.ip_address})",
            details=str(exc),
        )

    db.add(backup)
    await db.commit()
    await db.refresh(backup)

    if not backup.error:
        from app.routers.system_events import log_system_event
        await log_system_event(
            level="info",
            source="backup",
            event_type="backup_success",
            resource_type="device",
            resource_id=device.hostname,
            message=f"Config backup OK for {device.hostname} ({device.ip_address})"
                    f" — {backup.size_bytes or 0} bytes",
        )

    return backup


async def run_scheduled_backups():
    """
    Called by APScheduler every minute.  Checks which BackupSchedule entries
    match the current hour:minute (UTC) and runs backups for those devices.
    """
    from app.database import AsyncSessionLocal
    from app.models.device import Device
    from app.models.config_backup import BackupSchedule
    from sqlalchemy import select

    now = datetime.now(timezone.utc)
    current_hour = now.hour
    current_minute = now.minute

    async with AsyncSessionLocal() as db:
        # Load all active schedules that match current time
        result = await db.execute(
            select(BackupSchedule).where(
                BackupSchedule.is_active == True,
                BackupSchedule.hour == current_hour,
                BackupSchedule.minute == current_minute,
            )
        )
        schedules = result.scalars().all()

    if not schedules:
        return

    logger.info("Backup schedule matched at %02d:%02d UTC — %d schedule(s)", current_hour, current_minute, len(schedules))

    ok = fail = 0
    for sched in schedules:
        async with AsyncSessionLocal() as db:
            if sched.device_id:
                # Per-device schedule: back up only this device
                result = await db.execute(
                    select(Device).where(
                        Device.id == sched.device_id,
                        Device.is_active == True,
                        Device.api_username.isnot(None),
                    )
                )
                devices = result.scalars().all()
            else:
                # Global schedule: back up all active devices with API credentials
                result = await db.execute(
                    select(Device).where(
                        Device.is_active == True,
                        Device.api_username.isnot(None),
                    )
                )
                devices = result.scalars().all()

            for device in devices:
                try:
                    await backup_device(device.id, db, backup_type="scheduled")
                    ok += 1
                except Exception as exc:
                    logger.error("Scheduled backup failed for %s: %s", device.hostname, exc)
                    fail += 1

    if ok > 0 or fail > 0:
        logger.info("Scheduled backup done: %d OK, %d failed", ok, fail)
        from app.routers.system_events import log_system_event
        await log_system_event(
            level="info" if fail == 0 else "warning",
            source="backup",
            event_type="scheduled_backup_complete",
            message=f"Scheduled backup run complete: {ok} succeeded, {fail} failed",
        )


async def cleanup_expired_backups():
    """Delete backups past their expires_at date."""
    from app.database import AsyncSessionLocal
    from app.models.config_backup import ConfigBackup
    from sqlalchemy import delete as sql_delete

    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            sql_delete(ConfigBackup)
            .where(ConfigBackup.expires_at < now)
            .returning(ConfigBackup.id)
        )
        deleted = len(result.fetchall())
        await db.commit()
        if deleted:
            logger.info("Cleaned up %d expired config backups", deleted)
