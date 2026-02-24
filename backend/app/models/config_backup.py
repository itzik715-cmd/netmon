from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class ConfigBackup(Base):
    __tablename__ = "config_backups"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    backup_type = Column(String(20), default="manual")  # scheduled, manual
    config_text = Column(Text, nullable=True)        # running-config content
    startup_config = Column(Text, nullable=True)     # startup-config content
    configs_match = Column(Boolean, nullable=True)   # True if running == startup
    config_hash = Column(String(64), nullable=True)  # SHA-256 of running config (quick change detection)
    size_bytes = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)              # error message if backup failed
    triggered_by = Column(String(100), nullable=True)  # username or "scheduler" / "system"
    notes = Column(Text, nullable=True)                # optional notes for manual backups
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)

    device = relationship("Device", back_populates="backups")


class BackupSchedule(Base):
    """Backup schedule — one per device, or device_id=NULL for 'all API-enabled devices'."""
    __tablename__ = "backup_schedules"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=True, unique=True)
    hour = Column(Integer, default=2)          # 0-23 UTC
    minute = Column(Integer, default=0)        # 0-59
    retention_days = Column(Integer, default=90)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    device = relationship("Device", foreign_keys=[device_id])
