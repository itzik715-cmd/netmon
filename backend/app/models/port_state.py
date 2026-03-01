"""Port state change tracking for flap detection."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from app.database import Base


class PortStateChange(Base):
    """Records each oper_status transition on an interface."""
    __tablename__ = "port_state_changes"

    id = Column(Integer, primary_key=True, index=True)
    interface_id = Column(Integer, ForeignKey("interfaces.id", ondelete="CASCADE"), nullable=False)
    old_status = Column(String(20), nullable=False)
    new_status = Column(String(20), nullable=False)
    changed_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_port_state_iface_ts", "interface_id", "changed_at"),
    )
