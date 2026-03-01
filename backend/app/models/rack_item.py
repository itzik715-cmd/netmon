from sqlalchemy import Column, Integer, String, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from app.database import Base


class RackItem(Base):
    __tablename__ = "rack_items"
    __table_args__ = (
        UniqueConstraint("rack_location", "u_slot", name="uq_rack_item_location_slot"),
    )

    id = Column(Integer, primary_key=True, index=True)
    rack_location = Column(String(100), nullable=False, index=True)
    item_type = Column(String(50), nullable=False)
    label = Column(String(100), nullable=False)
    u_slot = Column(Integer, nullable=False)
    u_size = Column(Integer, nullable=False, default=1)
    color = Column(String(20), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
