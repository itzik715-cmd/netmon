"""
Device Environment models — temperature sensors, fan status, PSU status.
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from app.database import Base


class DeviceEnvironment(Base):
    """Latest state per sensor (temperature, fan, PSU)."""
    __tablename__ = "device_environments"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    sensor_name = Column(String(100), nullable=False)
    sensor_type = Column(String(20), nullable=False)  # temperature, fan, psu
    value = Column(Float, nullable=True)
    status = Column(String(20), nullable=True)  # ok, warning, critical, notPresent, notFunctioning
    unit = Column(String(20), nullable=True)  # celsius, rpm, watts, volts
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_device_env_device_sensor", "device_id", "sensor_name", unique=True),
    )


class DeviceEnvMetric(Base):
    """Time-series for temperature sensors (for charting)."""
    __tablename__ = "device_env_metrics"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    sensor_name = Column(String(100), nullable=False)
    sensor_type = Column(String(20), nullable=False)
    value = Column(Float, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_device_env_metrics_dev_ts", "device_id", "timestamp"),
    )
