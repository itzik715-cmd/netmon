"""MLAG/vPC/LACP domain and interface models."""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from app.database import Base


class MlagDomain(Base):
    """MLAG/vPC domain state per switch."""
    __tablename__ = "mlag_domains"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, unique=True)
    domain_id = Column(String(50))
    peer_address = Column(String(50))
    peer_link = Column(String(100))
    local_role = Column(String(20))  # primary, secondary
    peer_status = Column(String(20))  # active, inactive
    config_sanity = Column(String(30))  # consistent, inconsistent
    ports_configured = Column(Integer, default=0)
    ports_active = Column(Integer, default=0)
    ports_errdisabled = Column(Integer, default=0)
    vendor_protocol = Column(String(20))  # mlag, vpc, lacp
    last_seen = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MlagInterface(Base):
    """Per-MLAG interface status."""
    __tablename__ = "mlag_interfaces"

    id = Column(Integer, primary_key=True, index=True)
    domain_id = Column(Integer, ForeignKey("mlag_domains.id", ondelete="CASCADE"), nullable=False, index=True)
    mlag_id = Column(String(20))
    interface_name = Column(String(100))
    local_status = Column(String(20))   # active-full, active-partial, inactive, disabled
    remote_status = Column(String(20))  # active-full, active-partial, inactive, disabled, n/a

    __table_args__ = (
        Index("ix_mlag_iface_domain", "domain_id"),
    )
