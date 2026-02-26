from sqlalchemy import Column, Integer, String, DateTime, BigInteger, Float, ForeignKey, Index, UniqueConstraint
from sqlalchemy.sql import func
from app.database import Base


class FlowRecord(Base):
    __tablename__ = "flow_records"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    src_ip = Column(String(50), index=True)
    dst_ip = Column(String(50), index=True)
    src_port = Column(Integer)
    dst_port = Column(Integer)
    protocol = Column(Integer)          # TCP=6, UDP=17, ICMP=1
    protocol_name = Column(String(20))
    bytes = Column(BigInteger, default=0)
    packets = Column(Integer, default=0)
    duration_ms = Column(Integer, default=0)
    flow_direction = Column(String(10))  # in, out
    input_if = Column(Integer)           # SNMP interface index
    output_if = Column(Integer)
    tos = Column(Integer)
    tcp_flags = Column(Integer)
    src_as = Column(Integer)
    dst_as = Column(Integer)
    src_country = Column(String(5))
    dst_country = Column(String(5))
    application = Column(String(100))    # Detected application name
    flow_type = Column(String(20))       # netflow_v5, netflow_v9, ipfix, sflow


class FlowSummary5m(Base):
    """Pre-aggregated 5-minute flow summaries for fast long-range queries."""
    __tablename__ = "flow_summary_5m"

    id = Column(Integer, primary_key=True, index=True)
    bucket = Column(DateTime(timezone=True), nullable=False)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=True)
    src_ip = Column(String(50), nullable=False)
    dst_ip = Column(String(50), nullable=False)
    src_port = Column(Integer, nullable=False, default=0)
    dst_port = Column(Integer, nullable=False, default=0)
    protocol_name = Column(String(20))
    application = Column(String(100))
    bytes = Column(BigInteger, default=0)
    packets = Column(BigInteger, default=0)
    flow_count = Column(Integer, default=0)

    __table_args__ = (
        Index("ix_fs5m_bucket", "bucket"),
        Index("ix_fs5m_bucket_src", "bucket", "src_ip"),
        Index("ix_fs5m_bucket_dst", "bucket", "dst_ip"),
        Index("ix_fs5m_bucket_device", "bucket", "device_id"),
        UniqueConstraint(
            "bucket", "device_id", "src_ip", "dst_ip", "src_port", "dst_port",
            "protocol_name", "application",
            name="uq_flow_summary_5m_key",
        ),
    )
