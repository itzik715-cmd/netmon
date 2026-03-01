"""Device VLAN configuration model."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index, Text
from sqlalchemy.sql import func
from app.database import Base


class DeviceVlan(Base):
    """VLAN configuration per switch device."""
    __tablename__ = "device_vlans"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    vlan_id = Column(Integer, nullable=False)
    vlan_name = Column(String(100))
    status = Column(String(20), default="active")  # active, suspend
    tagged_ports = Column(Text)     # JSON array of port names
    untagged_ports = Column(Text)   # JSON array of port names
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_device_vlan_dev_vid", "device_id", "vlan_id", unique=True),
    )
