from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class FlowRecordResponse(BaseModel):
    id: int
    device_id: Optional[int] = None
    timestamp: datetime
    src_ip: str
    dst_ip: str
    src_port: Optional[int] = None
    dst_port: Optional[int] = None
    protocol: Optional[int] = None
    protocol_name: Optional[str] = None
    bytes: int
    packets: int
    duration_ms: Optional[int] = None
    application: Optional[str] = None
    flow_type: Optional[str] = None

    model_config = {"from_attributes": True}


class FlowStats(BaseModel):
    top_talkers: list
    top_destinations: list
    protocol_distribution: list
    application_distribution: list
    hourly_bytes: list
    total_flows: int
    total_bytes: int
