"""MAC address table entries discovered via SNMP."""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index, BigInteger
from sqlalchemy.sql import func
from app.models.device import Base


class MacAddressEntry(Base):
    __tablename__ = "mac_address_entries"

    id = Column(Integer, primary_key=True, index=True)
    mac_address = Column(String(20), nullable=False, index=True)  # "AA:BB:CC:DD:EE:FF"
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    interface_id = Column(Integer, ForeignKey("interfaces.id", ondelete="SET NULL"), nullable=True)
    vlan_id = Column(Integer, nullable=True)
    ip_address = Column(String(45), nullable=True)  # resolved from ARP
    hostname = Column(String(255), nullable=True)  # resolved from device table or DNS
    vendor = Column(String(100), nullable=True)  # OUI vendor lookup
    entry_type = Column(String(20), default="dynamic")  # dynamic, static, self
    first_seen = Column(DateTime(timezone=True), server_default=func.now())
    last_seen = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_mac_entries_device_mac", "device_id", "mac_address", unique=True),
        Index("ix_mac_entries_ip", "ip_address"),
    )
