"""ICMP Ping monitoring service."""
import asyncio
import logging
import re
import platform
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.models.device import Device
from app.models.ping import PingMetric

logger = logging.getLogger(__name__)


async def ping_device(ip: str, count: int = 5, timeout: int = 5) -> dict:
    """
    Ping a device and parse results.
    Returns dict with rtt_min, rtt_avg, rtt_max, loss_pct, sent, received, status.
    """
    is_windows = platform.system().lower() == "windows"

    if is_windows:
        cmd = ["ping", "-n", str(count), "-w", str(timeout * 1000), ip]
    else:
        cmd = ["ping", "-c", str(count), "-W", str(timeout), ip]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout * count + 10)
        output = stdout.decode("utf-8", errors="replace")
    except asyncio.TimeoutError:
        return {
            "rtt_min": None, "rtt_avg": None, "rtt_max": None,
            "loss_pct": 100.0, "sent": count, "received": 0, "status": "timeout",
        }
    except Exception as e:
        logger.debug(f"Ping {ip} error: {e}")
        return {
            "rtt_min": None, "rtt_avg": None, "rtt_max": None,
            "loss_pct": 100.0, "sent": count, "received": 0, "status": "timeout",
        }

    # Parse packet loss
    loss_pct = 100.0
    received = 0

    if is_windows:
        # Windows: "Packets: Sent = 5, Received = 5, Lost = 0 (0% loss)"
        loss_match = re.search(r"Lost\s*=\s*\d+\s*\((\d+)%\s*loss\)", output)
        recv_match = re.search(r"Received\s*=\s*(\d+)", output)
    else:
        # Linux: "5 packets transmitted, 5 received, 0% packet loss"
        loss_match = re.search(r"(\d+(?:\.\d+)?)%\s*packet loss", output)
        recv_match = re.search(r"(\d+)\s+received", output)

    if loss_match:
        loss_pct = float(loss_match.group(1))
    if recv_match:
        received = int(recv_match.group(1))

    # Parse RTT
    rtt_min = rtt_avg = rtt_max = None
    if is_windows:
        # Windows: "Minimum = 1ms, Maximum = 3ms, Average = 2ms"
        rtt_match = re.search(r"Minimum\s*=\s*(\d+)ms.*Maximum\s*=\s*(\d+)ms.*Average\s*=\s*(\d+)ms", output)
        if rtt_match:
            rtt_min = float(rtt_match.group(1))
            rtt_max = float(rtt_match.group(2))
            rtt_avg = float(rtt_match.group(3))
    else:
        # Linux: "rtt min/avg/max/mdev = 0.123/0.456/0.789/0.123 ms"
        rtt_match = re.search(r"rtt\s+min/avg/max/\S+\s*=\s*([\d.]+)/([\d.]+)/([\d.]+)", output)
        if rtt_match:
            rtt_min = float(rtt_match.group(1))
            rtt_avg = float(rtt_match.group(2))
            rtt_max = float(rtt_match.group(3))

    status = "ok" if loss_pct == 0 else ("loss" if loss_pct < 100 else "timeout")

    return {
        "rtt_min": rtt_min, "rtt_avg": rtt_avg, "rtt_max": rtt_max,
        "loss_pct": loss_pct, "sent": count, "received": received, "status": status,
    }


async def ping_all_devices(db: AsyncSession):
    """Ping all active devices and store PingMetric records."""
    result = await db.execute(
        select(Device).where(Device.is_active == True, Device.polling_enabled == True)
    )
    devices = result.scalars().all()

    now = datetime.now(timezone.utc)

    for device in devices:
        try:
            ping_result = await ping_device(device.ip_address)

            db.add(PingMetric(
                device_id=device.id,
                timestamp=now,
                rtt_min_ms=ping_result["rtt_min"],
                rtt_avg_ms=ping_result["rtt_avg"],
                rtt_max_ms=ping_result["rtt_max"],
                packet_loss_pct=ping_result["loss_pct"],
                packets_sent=ping_result["sent"],
                packets_received=ping_result["received"],
                status=ping_result["status"],
            ))

            # Update device with latest RTT and packet loss
            await db.execute(
                update(Device).where(Device.id == device.id).values(
                    rtt_ms=ping_result["rtt_avg"],
                    packet_loss_pct=ping_result["loss_pct"],
                )
            )
        except Exception as e:
            logger.debug(f"Ping failed for {device.hostname}: {e}")

    await db.commit()
