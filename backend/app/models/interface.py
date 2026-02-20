from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, BigInteger, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Interface(Base):
    __tablename__ = "interfaces"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    if_index = Column(Integer)
    name = Column(String(100), nullable=False)
    description = Column(String(255))
    alias = Column(String(255))
    if_type = Column(String(50))
    speed = Column(BigInteger)           # bps
    admin_status = Column(String(20))    # up, down
    oper_status = Column(String(20))     # up, down, testing
    mac_address = Column(String(20))
    ip_address = Column(String(50))
    subnet_mask = Column(String(50))
    vlan_id = Column(Integer)
    is_uplink = Column(Boolean, default=False)
    is_monitored = Column(Boolean, default=True)
    last_change = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    device = relationship("Device", back_populates="interfaces")
    metrics = relationship("InterfaceMetric", back_populates="interface", cascade="all, delete-orphan")
    alert_rules = relationship("AlertRule", back_populates="interface")


class InterfaceMetric(Base):
    __tablename__ = "interface_metrics"

    id = Column(Integer, primary_key=True, index=True)
    interface_id = Column(Integer, ForeignKey("interfaces.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    in_octets = Column(BigInteger, default=0)
    out_octets = Column(BigInteger, default=0)
    in_packets = Column(BigInteger, default=0)
    out_packets = Column(BigInteger, default=0)
    in_errors = Column(BigInteger, default=0)
    out_errors = Column(BigInteger, default=0)
    in_discards = Column(BigInteger, default=0)
    out_discards = Column(BigInteger, default=0)
    in_bps = Column(Float, default=0.0)   # bits per second (calculated)
    out_bps = Column(Float, default=0.0)
    in_pps = Column(Float, default=0.0)   # packets per second
    out_pps = Column(Float, default=0.0)
    utilization_in = Column(Float, default=0.0)   # percentage
    utilization_out = Column(Float, default=0.0)
    oper_status = Column(String(20))

    interface = relationship("Interface", back_populates="metrics")
