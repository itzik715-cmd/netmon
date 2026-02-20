from sqlalchemy import Column, Integer, String, DateTime, BigInteger, Float, ForeignKey
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
