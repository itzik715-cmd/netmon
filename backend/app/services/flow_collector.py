"""
NetFlow/sFlow Collector
Listens on UDP ports using asyncio.DatagramProtocol and parses flow records.
"""
import asyncio
import concurrent.futures
import logging
import os
import struct
import time
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy import select
from app.config import settings
from app.models.flow import FlowRecord
from app.models.device import Device
import socket

# Thread pool shared across all protocol instances for CPU-bound packet parsing.
# struct.unpack (used heavily in the parsers) releases the GIL, so multiple
# threads genuinely run in parallel on separate CPU cores.
_parse_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=min(16, (os.cpu_count() or 1) * 2),
    thread_name_prefix="flow-parse",
)

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

_FLUSH_INTERVAL      = 5.0    # seconds between DB writes
_BUFFER_MAX          = 20000  # drop oldest records if DB-write buffer overflows
_RAW_QUEUE_MAX       = 8192   # max datagrams queued for parsing (back-pressure)
_PARSE_WORKERS       = 4      # asyncio coroutines draining the raw queue per protocol
_OVERFLOW_WARN_EVERY = 60.0   # log overflow warning at most once per this many seconds


class _BaseUDPProtocol(asyncio.DatagramProtocol):
    """
    Base UDP flow protocol handler.

    Architecture:
      datagram_received()  →  bounded asyncio.Queue  →  _parse_worker() coroutines
        (synchronous, fast)       (back-pressure)       (run parser in thread pool)
                                                              ↓
                                                        _enqueue()  →  _flush_loop()
                                                       (in-memory buffer)   (DB write every 5 s)

    Why a thread pool?
      The sFlow/NetFlow parsers call struct.unpack hundreds of times per datagram.
      struct.unpack is a C extension — it releases the GIL — so multiple parser
      threads run on separate CPU cores simultaneously, spreading load across all
      available cores instead of saturating one.

    Why a bounded queue?
      If datagrams arrive faster than they can be parsed, the queue fills up and
      new arrivals are dropped (logged as warnings).  This is far better than
      creating an unbounded number of asyncio tasks or running out of memory.
    """

    def __init__(self, session_factory: async_sessionmaker, flow_type: str,
                 flow_enabled_ips: Optional[set] = None):
        self.session_factory = session_factory
        self.flow_type = flow_type
        # Shared reference to the set of flow-enabled IPs maintained by FlowCollector.
        # When not None, datagrams from IPs not in this set are dropped immediately
        # (before parsing / buffering) to prevent buffer overflow from unknown exporters.
        self._flow_enabled_ips: Optional[set] = flow_enabled_ips
        self.transport: Optional[asyncio.DatagramTransport] = None
        self._buffer: list[tuple[dict, str, datetime]] = []
        self._flush_task: Optional[asyncio.Task] = None
        self._worker_tasks: list[asyncio.Task] = []
        self._recv_counts: dict[str, int] = {}
        self._drop_counts: dict[str, int] = {}
        self._last_overflow_warn: float = 0.0
        # Queue created here; asyncio.Queue() is safe to instantiate before the
        # event loop starts in Python 3.10+
        self._raw_queue: asyncio.Queue = asyncio.Queue(maxsize=_RAW_QUEUE_MAX)

    def connection_made(self, transport: asyncio.DatagramTransport):
        self.transport = transport
        addr = transport.get_extra_info("sockname")
        logger.info(f"{self.flow_type} collector listening on UDP:{addr[1]}")
        self._flush_task = asyncio.create_task(self._flush_loop())
        for _ in range(_PARSE_WORKERS):
            self._worker_tasks.append(asyncio.create_task(self._parse_worker()))

    def error_received(self, exc: Exception):
        logger.warning(f"{self.flow_type} UDP error: {exc}")

    def connection_lost(self, exc: Optional[Exception]):
        logger.info(f"{self.flow_type} UDP socket closed")
        self._cancel_tasks()

    def close(self):
        if self.transport and not self.transport.is_closing():
            self.transport.close()
        self._cancel_tasks()

    def _cancel_tasks(self):
        for t in self._worker_tasks:
            if not t.done():
                t.cancel()
        if self._flush_task and not self._flush_task.done():
            self._flush_task.cancel()

    # ── hot path: called by the event loop for every UDP packet ──────────────

    def datagram_received(self, data: bytes, addr: tuple):
        exporter_ip = addr[0]
        # Early rejection: if we have a known-IPs cache and this IP is not in it,
        # drop the datagram immediately without parsing or buffering.
        if self._flow_enabled_ips is not None and exporter_ip not in self._flow_enabled_ips:
            return
        n = self._recv_counts.get(exporter_ip, 0) + 1
        self._recv_counts[exporter_ip] = n
        if n <= 5 or n % 1000 == 0:
            logger.info(f"{self.flow_type}: datagram #{n} from {exporter_ip} ({len(data)} B, "
                        f"queue {self._raw_queue.qsize()}/{_RAW_QUEUE_MAX})")
        try:
            self._raw_queue.put_nowait((data, exporter_ip))
        except asyncio.QueueFull:
            d = self._drop_counts.get(exporter_ip, 0) + 1
            self._drop_counts[exporter_ip] = d
            if d == 1 or d % 500 == 0:
                logger.warning(f"{self.flow_type}: parse queue full — dropped datagram #{d} "
                               f"from {exporter_ip} (consider more _PARSE_WORKERS or faster DB)")

    # ── worker: drains the raw queue, parses in thread pool ──────────────────

    async def _parse_worker(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            try:
                data, exporter_ip = await self._raw_queue.get()
                try:
                    records = await loop.run_in_executor(
                        _parse_executor, self._do_parse, data, exporter_ip
                    )
                    if records:
                        self._enqueue(records, exporter_ip)
                except Exception as exc:
                    logger.debug(f"{self.flow_type}: parse error from {exporter_ip}: {exc}")
                finally:
                    self._raw_queue.task_done()
            except asyncio.CancelledError:
                break

    def _do_parse(self, data: bytes, exporter_ip: str) -> list:
        """CPU-bound parse — runs in a thread pool worker, not the event loop."""
        raise NotImplementedError

    # ── write-behind buffer ───────────────────────────────────────────────────

    def _enqueue(self, records: list, exporter_ip: str) -> None:
        now = datetime.now(timezone.utc)
        for rec in records:
            self._buffer.append((rec, exporter_ip, now))
        if len(self._buffer) > _BUFFER_MAX:
            excess = len(self._buffer) - _BUFFER_MAX
            del self._buffer[:excess]
            # Rate-limit: log at most once per _OVERFLOW_WARN_EVERY seconds
            mono = time.monotonic()
            if mono - self._last_overflow_warn >= _OVERFLOW_WARN_EVERY:
                self._last_overflow_warn = mono
                logger.warning(
                    f"{self.flow_type}: buffer overflow — flow rate exceeds DB write speed "
                    f"(buffer={_BUFFER_MAX}, dropping oldest records)"
                )

    async def _flush_loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(_FLUSH_INTERVAL)
                await self._flush()
        except asyncio.CancelledError:
            pass

    async def _flush(self) -> None:
        if not self._buffer:
            return
        batch = self._buffer[:]
        self._buffer.clear()
        try:
            async with self.session_factory() as db:
                exporter_ips = {item[1] for item in batch}
                # Map exporter IP → device id, but only for devices with flow_enabled=True.
                # Flows from unknown IPs or devices that have not opted-in are silently dropped.
                device_id_map: dict[str, Optional[int]] = {}
                for ip in exporter_ips:
                    result = await db.execute(
                        select(Device).where(
                            Device.ip_address == ip,
                            Device.flow_enabled == True,  # noqa: E712
                        )
                    )
                    device = result.scalar_one_or_none()
                    device_id_map[ip] = device.id if device else None

                stored = 0
                for rec, exporter_ip, ts in batch:
                    device_id = device_id_map.get(exporter_ip)
                    if device_id is None:
                        continue   # device not found or flow collection not enabled
                    db.add(FlowRecord(device_id=device_id, timestamp=ts, **rec))
                    stored += 1
                await db.commit()
            logger.debug(f"{self.flow_type}: flushed {stored}/{len(batch)} records to DB")
        except Exception as exc:
            logger.error(f"{self.flow_type}: error flushing {len(batch)} records to DB: {exc}")


class _NetFlowProtocol(_BaseUDPProtocol):
    def _do_parse(self, data: bytes, exporter_ip: str) -> list:
        return NetFlowV5Parser.parse(data)


class _SFlowProtocol(_BaseUDPProtocol):
    def _do_parse(self, data: bytes, exporter_ip: str) -> list:
        return SFlowV5Parser.parse(data, exporter_ip)


# ─── FlowCollector ────────────────────────────────────────────────────────────

def _make_udp_socket(port: int) -> socket.socket:
    """
    Create a UDP socket with SO_REUSEPORT so that every uvicorn worker
    process can bind the same port.  The kernel load-balances incoming
    datagrams across all sockets sharing the port, distributing flow
    processing across all CPU cores.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    sock.bind(("0.0.0.0", port))
    return sock


_IP_CACHE_REFRESH = 30.0   # seconds between flow-enabled IP cache refreshes


class FlowCollector:
    def __init__(self, session_factory: async_sessionmaker):
        self.session_factory = session_factory
        self._netflow_proto: Optional[_NetFlowProtocol] = None
        self._sflow_proto: Optional[_SFlowProtocol] = None
        # Mutable set shared with protocol instances — updated by _refresh_ip_cache
        self._flow_enabled_ips: set[str] = set()
        self._ip_cache_task: Optional[asyncio.Task] = None

    async def _refresh_ip_cache(self) -> None:
        """Periodically refresh the set of IPs that have flow collection enabled.
        Protocols use this set to drop datagrams from unknown/disabled exporters
        immediately (before parsing or buffering) to prevent buffer overflow.
        """
        while True:
            try:
                async with self.session_factory() as db:
                    result = await db.execute(
                        select(Device.ip_address).where(
                            Device.flow_enabled == True,   # noqa: E712
                            Device.is_active == True,      # noqa: E712
                        )
                    )
                    ips = {row[0] for row in result}
                    self._flow_enabled_ips.clear()
                    self._flow_enabled_ips.update(ips)
                    logger.debug(f"FlowCollector: IP cache refreshed — {len(ips)} flow-enabled devices")
            except Exception as e:
                logger.warning(f"FlowCollector: IP cache refresh failed: {e}")
            await asyncio.sleep(_IP_CACHE_REFRESH)

    async def start(self):
        loop = asyncio.get_event_loop()

        # Start IP cache refresh task before binding sockets
        self._ip_cache_task = asyncio.create_task(self._refresh_ip_cache())
        # Give it one iteration so the cache is populated before we start accepting flows
        await asyncio.sleep(0)

        # NetFlow UDP listener
        try:
            _nf_transport, nf_proto = await loop.create_datagram_endpoint(
                lambda: _NetFlowProtocol(self.session_factory, "NetFlow", self._flow_enabled_ips),
                sock=_make_udp_socket(settings.NETFLOW_PORT),
            )
            self._netflow_proto = nf_proto
        except OSError as e:
            logger.error(f"Failed to bind NetFlow UDP:{settings.NETFLOW_PORT}: {e}")

        # sFlow UDP listener
        try:
            _sf_transport, sf_proto = await loop.create_datagram_endpoint(
                lambda: _SFlowProtocol(self.session_factory, "sFlow", self._flow_enabled_ips),
                sock=_make_udp_socket(settings.SFLOW_PORT),
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
        if self._ip_cache_task and not self._ip_cache_task.done():
            self._ip_cache_task.cancel()
        if self._netflow_proto:
            self._netflow_proto.close()
        if self._sflow_proto:
            self._sflow_proto.close()
