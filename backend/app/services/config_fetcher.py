"""
Configuration backup and diff service.

Fetch running/startup configs from devices via:
  - Arista eAPI (preferred for Arista EOS devices)
  - SSH (asyncssh) for Cisco and other vendors

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
    """Fetch running and startup configs via Arista eAPI."""
    from app.services.arista_api import arista_eapi
    results = await arista_eapi(
        device,
        ["show running-config", "show startup-config"],
        format="text",
    )
    running = results[0].get("output", "") if len(results) > 0 else None
    startup = results[1].get("output", "") if len(results) > 1 else None
    return running, startup


async def _fetch_via_ssh(device, commands: list[str]) -> list[str]:
    """Fetch command outputs via SSH using asyncssh."""
    try:
        import asyncssh
    except ImportError:
        raise RuntimeError("asyncssh not installed — cannot use SSH backup method")

    username = device.api_username
    password = device.api_password
    if not username or not password:
        raise ValueError(f"Device {device.hostname} has no SSH credentials (api_username/api_password)")

    outputs = []
    async with asyncssh.connect(
        device.ip_address,
        port=22,
        username=username,
        password=password,
        known_hosts=None,
        connect_timeout=15,
    ) as conn:
        for cmd in commands:
            result = await conn.run(cmd, timeout=30)
            outputs.append(result.stdout or "")
    return outputs


async def fetch_device_configs(device) -> tuple[Optional[str], Optional[str]]:
    """
    Fetch running-config and startup-config from a device.

    Strategy:
    1. Try eAPI if device has api_username set (works for Arista and any device
       with a JSON-RPC endpoint).
    2. Fall back to SSH.
    3. If both fail, raise the last exception.

    Returns (running_config, startup_config).  Either may be None on partial failure.
    """
    vendor = (device.vendor or "").lower()
    has_api_creds = bool(device.api_username and device.api_password)

    # --- Try eAPI ---
    if has_api_creds:
        try:
            running, startup = await _fetch_via_eapi(device)
            logger.info("Config fetched via eAPI for %s", device.hostname)
            return running, startup
        except Exception as eapi_exc:
            logger.warning("eAPI config fetch failed for %s: %s — trying SSH", device.hostname, eapi_exc)

    # --- Try SSH ---
    if has_api_creds:
        try:
            # Most network OSes support 'show running-config' and 'show startup-config'
            ssh_cmds = ["show running-config", "show startup-config"]
            outputs = await _fetch_via_ssh(device, ssh_cmds)
            logger.info("Config fetched via SSH for %s", device.hostname)
            return outputs[0], outputs[1]
        except Exception as ssh_exc:
            logger.error("SSH config fetch failed for %s: %s", device.hostname, ssh_exc)
            raise RuntimeError(
                f"Config fetch failed for {device.hostname}. "
                f"Ensure eAPI or SSH credentials (api_username/api_password) are configured."
            ) from ssh_exc

    raise ValueError(
        f"Device {device.hostname} has no credentials configured. "
        "Set api_username and api_password in device settings."
    )


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

async def backup_device(device_id: int, db, backup_type: str = "manual"):
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

    db.add(backup)
    await db.commit()
    await db.refresh(backup)
    return backup


async def run_scheduled_backups():
    """Called by APScheduler to back up all active devices."""
    from app.database import AsyncSessionLocal
    from app.models.device import Device
    from sqlalchemy import select

    logger.info("Starting scheduled config backup run")
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Device).where(Device.is_active == True, Device.polling_enabled == True)
        )
        devices = result.scalars().all()

        ok = fail = 0
        for device in devices:
            try:
                await backup_device(device.id, db, backup_type="scheduled")
                ok += 1
            except Exception as exc:
                logger.error("Scheduled backup failed for %s: %s", device.hostname, exc)
                fail += 1

        logger.info("Scheduled backup done: %d OK, %d failed", ok, fail)


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
