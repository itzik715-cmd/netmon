from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class BlockCreate(BaseModel):
    prefix: str
    block_type: str  # null_route, flowspec
    description: Optional[str] = None


class BlockResponse(BaseModel):
    id: int
    device_id: int
    device_hostname: Optional[str] = None
    prefix: str
    block_type: str
    description: Optional[str] = None
    is_active: bool
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    synced_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SyncBlocksResponse(BaseModel):
    device_id: int
    null_routes_synced: int
    flowspec_synced: int
    total_active: int
