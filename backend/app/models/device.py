from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class DeviceLocation(Base):
    __tablename__ = "device_locations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(String(255))
    address = Column(String(255))
    timezone = Column(String(50), default="UTC")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    devices = relationship("Device", back_populates="location")


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    hostname = Column(String(255), nullable=False)
    ip_address = Column(String(50), nullable=False, unique=True, index=True)
    device_type = Column(String(50))  # spine, leaf, tor, router, switch, firewall
    layer = Column(String(20))        # L2, L3, L2/L3
    vendor = Column(String(100))
    model = Column(String(100))
    os_version = Column(String(100))
    location_id = Column(Integer, ForeignKey("device_locations.id"), nullable=True)
    snmp_community = Column(String(100))
    snmp_version = Column(String(10), default="2c")
    snmp_port = Column(Integer, default=161)
    snmp_v3_username = Column(String(100))
    snmp_v3_auth_protocol = Column(String(20))
    snmp_v3_auth_key = Column(String(255))
    snmp_v3_priv_protocol = Column(String(20))
    snmp_v3_priv_key = Column(String(255))
    is_active = Column(Boolean, default=True)
    polling_enabled = Column(Boolean, default=True)
    poll_interval = Column(Integer, default=60)
    status = Column(String(20), default="unknown")  # up, down, unknown, degraded
    last_seen = Column(DateTime(timezone=True), nullable=True)
    uptime = Column(Integer, nullable=True)  # seconds
    cpu_usage = Column(Float, nullable=True)
    memory_usage = Column(Float, nullable=True)
    description = Column(Text)
    tags = Column(Text)  # JSON array of tags
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    location = relationship("DeviceLocation", back_populates="devices")
    interfaces = relationship("Interface", back_populates="device", cascade="all, delete-orphan")
    alert_rules = relationship("AlertRule", back_populates="device")
