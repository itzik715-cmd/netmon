from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, BigInteger, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class PduMetric(Base):
    """Time-series power metrics from PDU SNMP polling."""
    __tablename__ = "pdu_metrics"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    # Total device-level
    power_watts = Column(Float, nullable=True)           # Total power in Watts
    energy_kwh = Column(Float, nullable=True)            # Cumulative energy in kWh
    apparent_power_va = Column(Float, nullable=True)     # VA
    power_factor = Column(Float, nullable=True)          # 0.0 - 1.0

    # Phase-level (single-phase PDUs only have phase_1)
    phase1_current_amps = Column(Float, nullable=True)
    phase1_voltage_v = Column(Float, nullable=True)
    phase1_power_watts = Column(Float, nullable=True)
    phase2_current_amps = Column(Float, nullable=True)
    phase2_voltage_v = Column(Float, nullable=True)
    phase2_power_watts = Column(Float, nullable=True)
    phase3_current_amps = Column(Float, nullable=True)
    phase3_voltage_v = Column(Float, nullable=True)
    phase3_power_watts = Column(Float, nullable=True)

    # Environmental
    temperature_c = Column(Float, nullable=True)
    humidity_pct = Column(Float, nullable=True)

    # Load percentage (of rated capacity)
    load_pct = Column(Float, nullable=True)

    # Rated capacity for reference
    rated_power_watts = Column(Float, nullable=True)
    near_overload_watts = Column(Float, nullable=True)
    overload_watts = Column(Float, nullable=True)

    __table_args__ = (
        Index("ix_pdu_metrics_dev_ts", "device_id", "timestamp"),
    )


class PduOutlet(Base):
    """Current state of each PDU outlet — updated on every poll."""
    __tablename__ = "pdu_outlets"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    outlet_number = Column(Integer, nullable=False)
    name = Column(String(100), nullable=True)            # User-configured outlet label
    state = Column(String(10), default="on")             # "on", "off", "unknown"
    current_amps = Column(Float, nullable=True)
    power_watts = Column(Float, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_pdu_outlets_dev_outlet", "device_id", "outlet_number", unique=True),
    )
