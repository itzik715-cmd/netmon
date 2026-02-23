"""
NetFlow/sFlow Collector
Listens on UDP ports using asyncio.DatagramProtocol and parses flow records.
"""
import asyncio
import logging
import struct
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import async_sessionmaker
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
            src_port, dst_port = rec[3], rec[4]
            protocol = rec[12]
            records.append({
                "src_ip": src_ip, "dst_ip": dst_ip,
                "src_port": src_port, "dst_port": dst_port,
                "protocol": protocol,
                "protocol_name": PROTOCOL_NAMES.get(protocol, str(protocol)),
                "packets": rec[8], "bytes": rec[7],
                "duration_ms": max(0, rec[6] - rec[5]),
                "tcp_flags": rec[13], "flow_type": "netflow_v5",
                "application": detect_application(src_port, dst_port, protocol),
            })
            offset += cls.RECORD_SIZE
        return records


class SFlowV5Parser:
    @classmethod
    def parse(cls, data: bytes, exporter_ip: str) -> list:
        if len(data) < 28:
            logger.warning(f"sFlow: datagram from {exporter_ip} too short ({len(data)} bytes)")
            return []
        try:
            return cls._parse_datagram(data)
        except Exception as e:
            logger.warning(f"sFlow parse error from {exporter_ip} ({len(data)} bytes): {type(e).__name__}: {e}")
            return []

    @classmethod
    def _parse_datagram(cls, data: bytes) -> list:
        offset = 0
        version = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
        if version != 5:
            logger.warning(f"sFlow: unsupported version {version} (expected 5)")
            return []
        ip_version = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
        if ip_version == 1:
            offset += 4
        elif ip_version == 2:
            offset += 16
        else:
            logger.warning(f"sFlow: unsupported agent address type {ip_version}")
            return []
        offset += 12  # sub_agent_id + sequence_number + uptime
        num_samples = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
        logger.debug(f"sFlow datagram: {num_samples} samples")
        records = []
        flow_samples = 0
        counter_samples = 0
        for _ in range(num_samples):
            if offset + 8 > len(data):
                break
            sample_type = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
            sample_len  = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
            sample_end  = offset + sample_len
            if sample_end > len(data):
                break
            enterprise, fmt = sample_type >> 12, sample_type & 0xFFF
            if enterprise == 0 and fmt in (1, 3):
                flow_samples += 1
                records.extend(cls._parse_flow_sample(data, offset, sample_end, expanded=(fmt == 3)))
            elif enterprise == 0 and fmt in (2, 4):
                counter_samples += 1  # counter sample — expected, skip silently
            else:
                logger.debug(f"sFlow: unknown sample enterprise={enterprise} fmt={fmt}")
            offset = sample_end
        if num_samples > 0:
            logger.debug(
                f"sFlow datagram: {flow_samples} flow samples → {len(records)} records, "
                f"{counter_samples} counter samples (skipped)"
            )
        return records

    @classmethod
    def _parse_flow_sample(cls, data: bytes, offset: int, end: int, expanded: bool = False) -> list:
        min_size = 32 if expanded else 28
        if offset + min_size > end:
            return []
        offset += 4  # sequence_number
        if expanded:
            offset += 8  # source_id_type + source_id_index
        else:
            offset += 4  # source_id
        sampling_rate = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
        offset += 8  # sample_pool + drops
        if expanded:
            offset += 16  # input/output if_format + if_value x2
        else:
            offset += 8   # input_if + output_if
        if offset + 4 > end:
            return []
        num_records = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
        records = []
        for _ in range(num_records):
            if offset + 8 > end:
                break
            record_type = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
            record_len  = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
            record_end  = offset + record_len
            if record_end > end:
                break
            enterprise, fmt = record_type >> 12, record_type & 0xFFF
            if enterprise == 0 and fmt == 1:
                rec = cls._parse_raw_header(data, offset, record_end, sampling_rate)
                if rec:
                    records.append(rec)
            offset = record_end
        return records

    @classmethod
    def _parse_raw_header(cls, data: bytes, offset: int, end: int, sampling_rate: int) -> Optional[dict]:
        if offset + 16 > end:
            return None
        header_protocol = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
        frame_length    = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
        offset += 4  # stripped
        header_size = struct.unpack("!I", data[offset:offset+4])[0]; offset += 4
        header_data = data[offset:offset+header_size]
        if header_protocol == 1:    # Ethernet
            return cls._parse_ethernet(header_data, frame_length, sampling_rate)
        elif header_protocol == 11:  # IPv4 raw
            return cls._parse_ipv4(header_data, 0, frame_length, sampling_rate)
        return None

    @classmethod
    def _parse_ethernet(cls, data: bytes, frame_length: int, sampling_rate: int) -> Optional[dict]:
        if len(data) < 14:
            return None
        ethertype = struct.unpack("!H", data[12:14])[0]
        if ethertype == 0x0800:
            return cls._parse_ipv4(data, 14, frame_length, sampling_rate)
        elif ethertype == 0x86DD:
            return cls._parse_ipv6(data, 14, frame_length, sampling_rate)
        return None

    @classmethod
    def _parse_ipv4(cls, data: bytes, offset: int, frame_length: int, sampling_rate: int) -> Optional[dict]:
        if len(data) < offset + 20:
            return None
        ihl = (data[offset] & 0x0F) * 4
        protocol = data[offset+9]
        src_ip = socket.inet_ntoa(data[offset+12:offset+16])
        dst_ip = socket.inet_ntoa(data[offset+16:offset+20])
        src_port = dst_port = tcp_flags = 0
        tx = offset + ihl
        if protocol in (6, 17) and len(data) >= tx + 4:
            src_port = struct.unpack("!H", data[tx:tx+2])[0]
            dst_port = struct.unpack("!H", data[tx+2:tx+4])[0]
            if protocol == 6 and len(data) >= tx + 14:
                tcp_flags = data[tx+13]
        rate = max(sampling_rate, 1)
        return {
            "src_ip": src_ip, "dst_ip": dst_ip,
            "src_port": src_port, "dst_port": dst_port,
            "protocol": protocol, "protocol_name": PROTOCOL_NAMES.get(protocol, str(protocol)),
            "packets": rate, "bytes": frame_length * rate, "duration_ms": 0,
            "tcp_flags": tcp_flags, "flow_type": "sflow",
            "application": detect_application(src_port, dst_port, protocol),
        }

    @classmethod
    def _parse_ipv6(cls, data: bytes, offset: int, frame_length: int, sampling_rate: int) -> Optional[dict]:
        if len(data) < offset + 40:
            return None
        protocol = data[offset+6]
        src_ip = socket.inet_ntop(socket.AF_INET6, data[offset+8:offset+24])
        dst_ip = socket.inet_ntop(socket.AF_INET6, data[offset+24:offset+40])
        src_port = dst_port = tcp_flags = 0
        tx = offset + 40
        if protocol in (6, 17) and len(data) >= tx + 4:
            src_port = struct.unpack("!H", data[tx:tx+2])[0]
            dst_port = struct.unpack("!H", data[tx+2:tx+4])[0]
            if protocol == 6 and len(data) >= tx + 14:
                tcp_flags = data[tx+13]
        rate = max(sampling_rate, 1)
        return {
            "src_ip": src_ip, "dst_ip": dst_ip,
            "src_port": src_port, "dst_port": dst_port,
            "protocol": protocol, "protocol_name": PROTOCOL_NAMES.get(protocol, str(protocol)),
            "packets": rate, "bytes": frame_length * rate, "duration_ms": 0,
            "tcp_flags": tcp_flags, "flow_type": "sflow",
            "application": detect_application(src_port, dst_port, protocol),
        }


# ─── asyncio.DatagramProtocol implementations ────────────────────────────────

class _BaseUDPProtocol(asyncio.DatagramProtocol):
    """Base class for UDP flow protocol handlers."""

    def __init__(self, session_factory: async_sessionmaker, flow_type: str):
        self.session_factory = session_factory
        self.flow_type = flow_type
        self.transport: Optional[asyncio.DatagramTransport] = None

    def connection_made(self, transport: asyncio.DatagramTransport):
        self.transport = transport
        addr = transport.get_extra_info("sockname")
        logger.info(f"{self.flow_type} collector listening on UDP:{addr[1]}")

    def error_received(self, exc: Exception):
        logger.warning(f"{self.flow_type} UDP error: {exc}")

    def connection_lost(self, exc: Optional[Exception]):
        logger.info(f"{self.flow_type} UDP socket closed")

    def close(self):
        if self.transport and not self.transport.is_closing():
            self.transport.close()

    def datagram_received(self, data: bytes, addr: tuple):
        exporter_ip = addr[0]
        asyncio.create_task(self._handle(data, exporter_ip))

    async def _handle(self, data: bytes, exporter_ip: str):
        raise NotImplementedError

    async def _store_records(self, records: list, exporter_ip: str):
        if not records:
            return
        try:
            async with self.session_factory() as db:
                result = await db.execute(
                    select(Device).where(Device.ip_address == exporter_ip)
                )
                device = result.scalar_one_or_none()
                device_id = device.id if device else None
                now = datetime.now(timezone.utc)
                for rec in records:
                    flow = FlowRecord(device_id=device_id, timestamp=now, **rec)
                    db.add(flow)
                await db.commit()
        except Exception as exc:
            logger.error(f"Error storing {self.flow_type} records from {exporter_ip}: {exc}")


class _NetFlowProtocol(_BaseUDPProtocol):
    _recv_counts: dict = {}

    async def _handle(self, data: bytes, exporter_ip: str):
        n = self._recv_counts.get(exporter_ip, 0) + 1
        self._recv_counts[exporter_ip] = n
        if n <= 3 or n % 500 == 0:
            logger.info(f"NetFlow: datagram #{n} from {exporter_ip} ({len(data)} bytes)")
        records = NetFlowV5Parser.parse(data)
        if records:
            logger.info(f"NetFlow: {len(records)} records from {exporter_ip}")
            await self._store_records(records, exporter_ip)
        elif n <= 3:
            logger.warning(f"NetFlow: datagram from {exporter_ip} parsed to 0 records (version mismatch?)")


class _SFlowProtocol(_BaseUDPProtocol):
    _recv_counts: dict = {}

    async def _handle(self, data: bytes, exporter_ip: str):
        n = self._recv_counts.get(exporter_ip, 0) + 1
        self._recv_counts[exporter_ip] = n
        if n <= 5 or n % 500 == 0:
            logger.info(f"sFlow: datagram #{n} from {exporter_ip} ({len(data)} bytes)")
        records = SFlowV5Parser.parse(data, exporter_ip)
        if records:
            logger.info(f"sFlow: stored {len(records)} flow records from {exporter_ip}")
            await self._store_records(records, exporter_ip)
        elif n <= 5:
            logger.info(
                f"sFlow: datagram #{n} from {exporter_ip} ({len(data)} bytes) "
                f"contained 0 flow records (may be counter-only sample — this is normal)"
            )


# ─── FlowCollector ────────────────────────────────────────────────────────────

class FlowCollector:
    def __init__(self, session_factory: async_sessionmaker):
        self.session_factory = session_factory
        self._netflow_proto: Optional[_NetFlowProtocol] = None
        self._sflow_proto: Optional[_SFlowProtocol] = None

    async def start(self):
        loop = asyncio.get_event_loop()

        # NetFlow UDP listener
        try:
            _nf_transport, nf_proto = await loop.create_datagram_endpoint(
                lambda: _NetFlowProtocol(self.session_factory, "NetFlow"),
                local_addr=("0.0.0.0", settings.NETFLOW_PORT),
            )
            self._netflow_proto = nf_proto
        except OSError as e:
            logger.error(f"Failed to bind NetFlow UDP:{settings.NETFLOW_PORT}: {e}")

        # sFlow UDP listener
        try:
            _sf_transport, sf_proto = await loop.create_datagram_endpoint(
                lambda: _SFlowProtocol(self.session_factory, "sFlow"),
                local_addr=("0.0.0.0", settings.SFLOW_PORT),
            )
            self._sflow_proto = sf_proto
        except OSError as e:
            logger.error(f"Failed to bind sFlow UDP:{settings.SFLOW_PORT}: {e}")

        # Run until cancelled
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            pass

    def stop(self):
        if self._netflow_proto:
            self._netflow_proto.close()
        if self._sflow_proto:
            self._sflow_proto.close()
