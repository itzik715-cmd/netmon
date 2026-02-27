from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class WanAlertRule(Base):
    __tablename__ = "wan_alert_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    metric = Column(String(50), nullable=False)       # p95_in, p95_out, p95_max, max_in, max_out, avg_in, avg_out, commitment_pct
    condition = Column(String(20), nullable=False)     # gt, gte, lt, lte
    warning_threshold = Column(Float, nullable=True)
    critical_threshold = Column(Float, nullable=True)
    lookback_minutes = Column(Integer, default=1440)   # time window for evaluation
    is_active = Column(Boolean, default=True)
    cooldown_minutes = Column(Integer, default=60)
    notification_email = Column(String(255))
    notification_webhook = Column(String(512))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    events = relationship("AlertEvent", back_populates="wan_rule", cascade="all, delete-orphan",
                          foreign_keys="AlertEvent.wan_rule_id")
