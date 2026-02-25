from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from app.database import Base


class OwnedSubnet(Base):
    __tablename__ = "owned_subnets"

    id = Column(Integer, primary_key=True, index=True)
    subnet = Column(String(50), nullable=False, unique=True, index=True)  # CIDR e.g. "195.28.181.0/24"
    source = Column(String(20), nullable=False)  # "learned" or "manual"
    is_active = Column(Boolean, default=True, nullable=False)  # False = ignored
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
