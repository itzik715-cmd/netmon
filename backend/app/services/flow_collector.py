"""
NetFlow/sFlow Collector
Listens on UDP ports and parses flow records.
"""
import asyncio
import logging
import struct
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy import select
from app.config import settings
from app.models.flow import FlowRecord
from app.models.device import Device
import socket

logger = logging.getLogger(__name__)

PROTOCOL_NAMES = {
    1: "ICMP", 6: "TCP", 17: "UDP", 47: "GRE",
    50: "ESP", 51: "AH", 89: "OSPF", 132: "SCTP",
}

PORT_APPS = {
    80: "HTTP", 443: "HTTPS", 22: "SSH", 23: "Telnet",
    25: "SMTP", 53: "DNS", 110: "POP3", 143: "IMAP",
    3306: "MySQL", 5432: "PostgreSQL", 6379: "Redis",
    161: "SNMP", 162: "SNMP-Trap", 389: "LDAP", 636: "LDAPS",
    8080: "HTTP-Alt", 8443: "HTTPS-Alt", 3389: "RDP", 5900: "VNC",
}


def detect_application(src_port: int, dst_port: int, protocol: int) -> str:
    if protocol == 1:
        return "ICMP"
    app = PORT_APPS.get(dst_port) or PORT_APPS.get(src_port)
    return app or f"port/{dst_port}"


class NetFlowV5Parser:
    HEADER_FORMAT = "!HHIIIIiBBH"
    RECORD_FORMAT = "!IIIHHIIIIHHxBBBBxx"
    HEADER_SIZE = struct.calcsize(HEADER_FORMAT)
    RECORD_SIZE = struct.calcsize(RECORD_FORMAT)

    @classmethod
    def parse(cls, data: bytes) -> list:
        if len(data) < cls.HEADER_SIZE:
            return []

        header = struct.unpack(cls.HEADER_FORMAT, data[:cls.HEADER_SIZE])
        version, count = header[0], header[1]

        if version != 5:
            return []

        records = []
        offset = cls.HEADER_SIZE
        for _ in range(count):
            if offset + cls.RECORD_SIZE > len(data):
                break
            rec = struct.unpack(cls.RECORD_FORMAT, data[offset:offset + cls.RECORD_SIZE])
            src_ip = socket.inet_ntoa(struct.pack("!I", rec[0]))
            dst_ip = socket.inet_ntoa(struct.pack("!I", rec[1]))
            src_port = rec[3]
            dst_port = rec[4]
            protocol = rec[12]
            pkts = rec[8]
            octets = rec[7]
            start_ms = rec[5]
            end_ms = rec[6]

            records.append({
                "src_ip": src_ip,
                "dst_ip": dst_ip,
                "src_port": src_port,
                "dst_port": dst_port,
                "protocol": protocol,
                "protocol_name": PROTOCOL_NAMES.get(protocol, str(protocol)),
                "packets": pkts,
                "bytes": octets,
                "duration_ms": max(0, end_ms - start_ms),
                "tcp_flags": rec[13],
                "flow_type": "netflow_v5",
                "application": detect_application(src_port, dst_port, protocol),
            })
            offset += cls.RECORD_SIZE

        return records


class FlowCollector:
    def __init__(self, session_factory: async_sessionmaker):
        self.session_factory = session_factory
        self.running = False

    async def start(self):
        self.running = True
        await asyncio.gather(
            self.listen_netflow(),
            self.listen_sflow(),
        )

    async def listen_netflow(self):
        """Listen for NetFlow UDP datagrams."""
        loop = asyncio.get_event_loop()
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", settings.NETFLOW_PORT))
        sock.setblocking(False)
        logger.info(f"NetFlow collector listening on UDP:{settings.NETFLOW_PORT}")

        while self.running:
            try:
                data, addr = await loop.sock_recvfrom(sock, 65535)
                asyncio.create_task(self.process_netflow(data, addr[0]))
            except Exception as e:
                if self.running:
                    logger.debug(f"NetFlow receive error: {e}")
                await asyncio.sleep(0.1)

    async def listen_sflow(self):
        """Listen for sFlow UDP datagrams (basic support)."""
        loop = asyncio.get_event_loop()
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("0.0.0.0", settings.SFLOW_PORT))
            sock.setblocking(False)
            logger.info(f"sFlow collector listening on UDP:{settings.SFLOW_PORT}")

            while self.running:
                try:
                    data, addr = await loop.sock_recvfrom(sock, 65535)
                    # Basic sFlow parsing - store raw indicator
                    logger.debug(f"sFlow packet from {addr[0]}: {len(data)} bytes")
                except Exception:
                    await asyncio.sleep(0.1)
        except Exception as e:
            logger.warning(f"Could not start sFlow listener: {e}")

    async def process_netflow(self, data: bytes, exporter_ip: str):
        """Parse and store NetFlow records."""
        records = NetFlowV5Parser.parse(data)
        if not records:
            return

        async with self.session_factory() as db:
            # Try to map exporter IP to a device
            result = await db.execute(
                select(Device).where(Device.ip_address == exporter_ip)
            )
            device = result.scalar_one_or_none()
            device_id = device.id if device else None

            now = datetime.now(timezone.utc)
            for rec in records:
                flow = FlowRecord(
                    device_id=device_id,
                    timestamp=now,
                    **rec,
                )
                db.add(flow)

            await db.commit()
            logger.debug(f"Stored {len(records)} flow records from {exporter_ip}")

    def stop(self):
        self.running = False
