"""ICMP Ping metrics model."""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from app.database import Base


class PingMetric(Base):
    """Time-series ICMP ping results per device."""
    __tablename__ = "ping_metrics"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    rtt_min_ms = Column(Float)
    rtt_avg_ms = Column(Float)
    rtt_max_ms = Column(Float)
    packet_loss_pct = Column(Float, default=0.0)
    packets_sent = Column(Integer, default=5)
    packets_received = Column(Integer, default=0)
    status = Column(String(20), default="ok")  # ok, loss, timeout

    __table_args__ = (
        Index("ix_ping_metrics_dev_ts", "device_id", "timestamp"),
    )
