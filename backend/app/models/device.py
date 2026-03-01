from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Text, Index, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class DeviceLocation(Base):
    __tablename__ = "device_locations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    datacenter = Column(String(50), nullable=True)
    rack = Column(String(50), nullable=True)
    description = Column(String(255))
    address = Column(String(255))
    timezone = Column(String(50), default="UTC")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    devices = relationship("Device", back_populates="location")

    __table_args__ = (
        UniqueConstraint("datacenter", "rack", name="uq_location_datacenter_rack"),
    )


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    hostname = Column(String(255), nullable=False)
    ip_address = Column(String(50), nullable=False, unique=True, index=True)
    device_type = Column(String(50))  # spine, leaf, tor, router, switch, firewall
    layer = Column(String(20))        # L2, L3, L2/L3
    vendor = Column(String(100))
    model = Column(String(100))
    os_version = Column(String(200))
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
    flow_enabled = Column(Boolean, default=False)
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

    rtt_ms = Column(Float, nullable=True)
    packet_loss_pct = Column(Float, nullable=True)

    api_username = Column(String(100), nullable=True)
    api_password = Column(String(255), nullable=True)
    api_port = Column(Integer, default=443)
    api_protocol = Column(String(10), default="https")

    location = relationship("DeviceLocation", back_populates="devices")
    interfaces = relationship("Interface", back_populates="device", cascade="all, delete-orphan")
    alert_rules = relationship("AlertRule", back_populates="device")
    routes = relationship("DeviceRoute", back_populates="device", cascade="all, delete-orphan")
    blocks = relationship("DeviceBlock", back_populates="device", cascade="all, delete-orphan")
    backups = relationship("ConfigBackup", back_populates="device", cascade="all, delete-orphan")


class DeviceRoute(Base):
    __tablename__ = "device_routes"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    destination = Column(String(50), nullable=False)
    mask = Column(String(50))
    prefix_len = Column(Integer)
    next_hop = Column(String(50))
    protocol = Column(String(20))  # static, bgp, ospf, rip, local, other
    metric = Column(Integer, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    device = relationship("Device", back_populates="routes")


class DeviceBlock(Base):
    __tablename__ = "device_blocks"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    prefix = Column(String(100), nullable=False)
    block_type = Column(String(20), nullable=False)  # null_route, flowspec
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_by = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    synced_at = Column(DateTime(timezone=True), nullable=True)

    device = relationship("Device", back_populates="blocks")


class DeviceLink(Base):
    """Stores discovered or manually configured links between devices (LLDP/CDP)."""
    __tablename__ = "device_links"

    id = Column(Integer, primary_key=True, index=True)
    source_device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    target_device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    source_if = Column(String(100), nullable=True)   # local port name
    target_if = Column(String(100), nullable=True)   # remote port name
    link_type = Column(String(20), default="lldp")   # lldp, cdp, manual
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DeviceMetricHistory(Base):
    """Historical CPU / memory snapshots from SNMP polling."""
    __tablename__ = "device_metric_history"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    cpu_usage = Column(Float, nullable=True)
    memory_usage = Column(Float, nullable=True)
    uptime = Column(Integer, nullable=True)

    __table_args__ = (
        Index("ix_device_metric_history_dev_ts", "device_id", "timestamp"),
    )
