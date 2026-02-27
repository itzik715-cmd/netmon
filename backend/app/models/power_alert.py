from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class PowerAlertRule(Base):
    __tablename__ = "power_alert_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    metric = Column(String(50), nullable=False)       # total_power, avg_load, max_load, max_temp, avg_temp, budget_pct
    condition = Column(String(20), nullable=False)     # gt, gte, lt, lte
    warning_threshold = Column(Float, nullable=True)
    critical_threshold = Column(Float, nullable=True)
    lookback_minutes = Column(Integer, default=60)     # time window for evaluation
    is_active = Column(Boolean, default=True)
    cooldown_minutes = Column(Integer, default=60)
    notification_email = Column(String(255))
    notification_webhook = Column(String(512))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    events = relationship("AlertEvent", back_populates="power_rule", cascade="all, delete-orphan",
                          foreign_keys="AlertEvent.power_rule_id")
