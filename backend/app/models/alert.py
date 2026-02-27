from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=True)
    interface_id = Column(Integer, ForeignKey("interfaces.id"), nullable=True)
    metric = Column(String(100), nullable=False)   # cpu, memory, if_utilization_in, if_status, etc.
    condition = Column(String(20), nullable=False)  # gt, lt, eq, ne, gte, lte
    threshold = Column(Float, nullable=True)             # legacy single-threshold
    severity = Column(String(20), default="warning")     # info, warning, critical
    warning_threshold = Column(Float, nullable=True)     # multi-threshold: warning level
    critical_threshold = Column(Float, nullable=True)    # multi-threshold: critical level
    duration_seconds = Column(Integer, default=0)        # sustained for N seconds
    is_active = Column(Boolean, default=True)
    notification_email = Column(String(255))
    notification_webhook = Column(String(512))
    cooldown_minutes = Column(Integer, default=15)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    device = relationship("Device", back_populates="alert_rules")
    interface = relationship("Interface", back_populates="alert_rules")
    events = relationship("AlertEvent", back_populates="rule", cascade="all, delete-orphan",
                          foreign_keys="AlertEvent.rule_id")


class AlertEvent(Base):
    __tablename__ = "alert_events"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=True)
    wan_rule_id = Column(Integer, ForeignKey("wan_alert_rules.id", ondelete="CASCADE"), nullable=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=True)
    interface_id = Column(Integer, ForeignKey("interfaces.id"), nullable=True)
    severity = Column(String(20), nullable=False)
    status = Column(String(20), default="open")  # open, acknowledged, resolved
    message = Column(Text)
    metric_value = Column(Float)
    threshold_value = Column(Float)
    triggered_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text)

    rule = relationship("AlertRule", back_populates="events")
    wan_rule = relationship("WanAlertRule", back_populates="events", foreign_keys=[wan_rule_id])
