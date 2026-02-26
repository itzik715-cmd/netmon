from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.database import Base


class OwnedSubnet(Base):
    __tablename__ = "owned_subnets"

    id = Column(Integer, primary_key=True, index=True)
    subnet = Column(String(50), unique=True, nullable=False, index=True)
    source = Column(String(20), default="manual")  # "manual" or "learned"
    is_active = Column(Boolean, default=True)
    note = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
