from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func
from app.database import Base


class SystemEvent(Base):
    """
    Operational system log — tracks automated background actions such as
    backup runs, SNMP polling failures, scheduler errors, etc.

    This is separate from AuditLog (which records user-initiated actions).
    level:   info | warning | error
    source:  backup | snmp_poll | flow | alert_engine | scheduler
    """
    __tablename__ = "system_events"

    id            = Column(Integer, primary_key=True, index=True)
    timestamp     = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    level         = Column(String(20), nullable=False, index=True)    # info/warning/error
    source        = Column(String(50), nullable=False, index=True)    # subsystem name
    event_type    = Column(String(100), nullable=False)               # backup_failed, poll_error …
    resource_type = Column(String(50), nullable=True)                 # device / interface / …
    resource_id   = Column(String(200), nullable=True)                # hostname or numeric id
    message       = Column(String(500), nullable=False)               # short human-readable line
    details       = Column(Text, nullable=True)                       # full error / traceback
