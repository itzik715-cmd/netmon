from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Index, UniqueConstraint
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
    power_watts = Column(Float, nullable=True)
    energy_kwh = Column(Float, nullable=True)
    apparent_power_va = Column(Float, nullable=True)
    power_factor = Column(Float, nullable=True)          # 0.0 – 1.0

    # Phase-level (single-phase PDUs only populate phase_1)
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

    # Load
    load_pct = Column(Float, nullable=True)

    # Thresholds (captured from device for alerting context)
    rated_power_watts = Column(Float, nullable=True)
    near_overload_watts = Column(Float, nullable=True)
    overload_watts = Column(Float, nullable=True)

    __table_args__ = (
        Index("ix_pdu_metrics_dev_ts", "device_id", "timestamp"),
    )


class PduBank(Base):
    """Bank/breaker-level metrics — updated on every poll.
    APC PDUs divide outlets into banks (physical breaker groups).
    Single-phase PDUs may have 1-2 banks, 3-phase PDUs have 3+ banks."""
    __tablename__ = "pdu_banks"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    bank_number = Column(Integer, nullable=False)
    name = Column(String(100), nullable=True)
    current_amps = Column(Float, nullable=True)
    power_watts = Column(Float, nullable=True)
    near_overload_amps = Column(Float, nullable=True)
    overload_amps = Column(Float, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("device_id", "bank_number", name="uq_pdu_bank_dev_num"),
        Index("ix_pdu_banks_dev_bank", "device_id", "bank_number"),
    )


class PduBankMetric(Base):
    """Time-series for individual banks — for historical charts."""
    __tablename__ = "pdu_bank_metrics"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    bank_number = Column(Integer, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    current_amps = Column(Float, nullable=True)
    power_watts = Column(Float, nullable=True)

    __table_args__ = (
        Index("ix_pdu_bank_metrics_dev_ts", "device_id", "bank_number", "timestamp"),
    )


class PduOutlet(Base):
    """Current state of each PDU outlet — updated on every poll."""
    __tablename__ = "pdu_outlets"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    outlet_number = Column(Integer, nullable=False)
    bank_number = Column(Integer, nullable=True)          # Which bank this outlet belongs to
    name = Column(String(100), nullable=True)
    state = Column(String(10), default="on")              # "on", "off", "unknown"
    current_amps = Column(Float, nullable=True)
    power_watts = Column(Float, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("device_id", "outlet_number", name="uq_pdu_outlet_dev_num"),
        Index("ix_pdu_outlets_dev_outlet", "device_id", "outlet_number"),
    )
