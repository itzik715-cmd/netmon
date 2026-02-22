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


class SFlowV5Parser:
    """sFlow v5 datagram parser — extracts flow records from sampled packets."""

    @classmethod
    def parse(cls, data: bytes, exporter_ip: str) -> list:
        if len(data) < 28:
            return []
        try:
            return cls._parse_datagram(data, exporter_ip)
        except Exception as e:
            logger.debug(f"sFlow parse error from {exporter_ip}: {e}")
            return []

    @classmethod
    def _parse_datagram(cls, data: bytes, exporter_ip: str) -> list:
        offset = 0

        version = struct.unpack("!I", data[offset:offset + 4])[0]
        offset += 4
        if version != 5:
            return []

        ip_version = struct.unpack("!I", data[offset:offset + 4])[0]
        offset += 4

        if ip_version == 1:  # IPv4
            offset += 4
        elif ip_version == 2:  # IPv6
            offset += 16
        else:
            return []

        offset += 4  # sub_agent_id
        offset += 4  # sequence_number
        offset += 4  # uptime

        num_samples = struct.unpack("!I", data[offset:offset + 4])[0]
        offset += 4

        records = []
        for _ in range(num_samples):
            if offset + 8 > len(data):
                break

            sample_type = struct.unpack("!I", data[offset:offset + 4])[0]
            offset += 4
            sample_length = struct.unpack("!I", data[offset:offset + 4])[0]
            offset += 4

            sample_end = offset + sample_length
            if sample_end > len(data):
                break

            enterprise = sample_type >> 12
            fmt = sample_type & 0xFFF

            if enterprise == 0 and fmt in (1, 3):  # Flow Sample / Expanded Flow Sample
                recs = cls._parse_flow_sample(data, offset, sample_end, expanded=(fmt == 3))
                records.extend(recs)

            offset = sample_end

        return records

    @classmethod
    def _parse_flow_sample(cls, data: bytes, offset: int, end: int, expanded: bool = False) -> list:
        min_size = 32 if expanded else 28
        if offset + min_size > end:
            return []

        offset += 4  # sequence_number

        if expanded:
            offset += 4  # source_id_type
            offset += 4  # source_id_index
        else:
            offset += 4  # source_id

        sampling_rate = struct.unpack("!I", data[offset:offset + 4])[0]
        offset += 4
        offset += 4  # sample_pool
        offset += 4  # drops

        if expanded:
            offset += 4  # input_if_format
            offset += 4  # input_if_value
            offset += 4  # output_if_format
            offset += 4  # output_if_value
        else:
            offset += 4  # input_if
            offset += 4  # output_if

        if offset + 4 > end:
            return []

        num_records = struct.unpack("!I", data[offset:offset + 4])[0]
        offset += 4

        records = []
        for _ in range(num_records):
            if offset + 8 > end:
                break

            record_type = struct.unpack("!I", data[offset:offset + 4])[0]
            offset += 4
            record_length = struct.unpack("!I", data[offset:offset + 4])[0]
            offset += 4

            record_end = offset + record_length
            if record_end > end:
                break

            enterprise = record_type >> 12
            fmt = record_type & 0xFFF

            if enterprise == 0 and fmt == 1:  # Raw Packet Header
                rec = cls._parse_raw_header(data, offset, record_end, sampling_rate)
                if rec:
                    records.append(rec)

            offset = record_end

        return records

    @classmethod
    def _parse_raw_header(cls, data: bytes, offset: int, end: int, sampling_rate: int) -> Optional[dict]:
        if offset + 16 > end:
            return None

        header_protocol = struct.unpack("!I", data[offset:offset + 4])[0]
        offset += 4
        frame_length = struct.unpack("!I", data[offset:offset + 4])[0]
        offset += 4
        offset += 4  # stripped bytes
        header_size = struct.unpack("!I", data[offset:offset + 4])[0]
        offset += 4

        header_data = data[offset:offset + header_size]

        if header_protocol == 1:  # Ethernet
            return cls._parse_ethernet(header_data, frame_length, sampling_rate)
        elif header_protocol == 11:  # IPv4
            return cls._parse_ipv4(header_data, 0, frame_length, sampling_rate)

        return None

    @classmethod
    def _parse_ethernet(cls, data: bytes, frame_length: int, sampling_rate: int) -> Optional[dict]:
        if len(data) < 14:
            return None

        ethertype = struct.unpack("!H", data[12:14])[0]

        if ethertype == 0x0800:  # IPv4
            return cls._parse_ipv4(data, 14, frame_length, sampling_rate)
        elif ethertype == 0x86DD:  # IPv6
            return cls._parse_ipv6(data, 14, frame_length, sampling_rate)

        return None

    @classmethod
    def _parse_ipv4(cls, data: bytes, offset: int, frame_length: int, sampling_rate: int) -> Optional[dict]:
        if len(data) < offset + 20:
            return None

        ihl = (data[offset] & 0x0F) * 4
        protocol = data[offset + 9]
        src_ip = socket.inet_ntoa(data[offset + 12:offset + 16])
        dst_ip = socket.inet_ntoa(data[offset + 16:offset + 20])

        src_port = 0
        dst_port = 0
        tcp_flags = 0

        transport_offset = offset + ihl
        if protocol in (6, 17) and len(data) >= transport_offset + 4:
            src_port = struct.unpack("!H", data[transport_offset:transport_offset + 2])[0]
            dst_port = struct.unpack("!H", data[transport_offset + 2:transport_offset + 4])[0]
            if protocol == 6 and len(data) >= transport_offset + 14:
                tcp_flags = data[transport_offset + 13]

        rate = max(sampling_rate, 1)
        return {
            "src_ip": src_ip,
            "dst_ip": dst_ip,
            "src_port": src_port,
            "dst_port": dst_port,
            "protocol": protocol,
            "protocol_name": PROTOCOL_NAMES.get(protocol, str(protocol)),
            "packets": rate,
            "bytes": frame_length * rate,
            "duration_ms": 0,
            "tcp_flags": tcp_flags,
            "flow_type": "sflow",
            "application": detect_application(src_port, dst_port, protocol),
        }

    @classmethod
    def _parse_ipv6(cls, data: bytes, offset: int, frame_length: int, sampling_rate: int) -> Optional[dict]:
        if len(data) < offset + 40:
            return None

        protocol = data[offset + 6]
        src_ip = socket.inet_ntop(socket.AF_INET6, data[offset + 8:offset + 24])
        dst_ip = socket.inet_ntop(socket.AF_INET6, data[offset + 24:offset + 40])

        src_port = 0
        dst_port = 0
        tcp_flags = 0

        transport_offset = offset + 40
        if protocol in (6, 17) and len(data) >= transport_offset + 4:
            src_port = struct.unpack("!H", data[transport_offset:transport_offset + 2])[0]
            dst_port = struct.unpack("!H", data[transport_offset + 2:transport_offset + 4])[0]
            if protocol == 6 and len(data) >= transport_offset + 14:
                tcp_flags = data[transport_offset + 13]

        rate = max(sampling_rate, 1)
        return {
            "src_ip": src_ip,
            "dst_ip": dst_ip,
            "src_port": src_port,
            "dst_port": dst_port,
            "protocol": protocol,
            "protocol_name": PROTOCOL_NAMES.get(protocol, str(protocol)),
            "packets": rate,
            "bytes": frame_length * rate,
            "duration_ms": 0,
            "tcp_flags": tcp_flags,
            "flow_type": "sflow",
            "application": detect_application(src_port, dst_port, protocol),
        }


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
        """Listen for sFlow v5 UDP datagrams."""
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
                    asyncio.create_task(self.process_sflow(data, addr[0]))
                except Exception:
                    await asyncio.sleep(0.1)
        except Exception as e:
            logger.warning(f"Could not start sFlow listener: {e}")

    async def process_netflow(self, data: bytes, exporter_ip: str):
        """Parse and store NetFlow v5 records."""
        records = NetFlowV5Parser.parse(data)
        if not records:
            return
        await self._store_records(records, exporter_ip)
        logger.debug(f"Stored {len(records)} NetFlow records from {exporter_ip}")

    async def process_sflow(self, data: bytes, exporter_ip: str):
        """Parse and store sFlow v5 records."""
        records = SFlowV5Parser.parse(data, exporter_ip)
        if not records:
            return
        await self._store_records(records, exporter_ip)
        logger.debug(f"Stored {len(records)} sFlow records from {exporter_ip}")

    async def _store_records(self, records: list, exporter_ip: str):
        """Store flow records in the database, mapping exporter IP to device."""
        async with self.session_factory() as db:
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

    def stop(self):
        self.running = False
