from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class InterfaceResponse(BaseModel):
    id: int
    device_id: int
    if_index: Optional[int] = None
    name: str
    description: Optional[str] = None
    alias: Optional[str] = None
    speed: Optional[int] = None
    admin_status: Optional[str] = None
    oper_status: Optional[str] = None
    mac_address: Optional[str] = None
    ip_address: Optional[str] = None
    vlan_id: Optional[int] = None
    is_uplink: bool
    is_monitored: bool
    last_change: Optional[datetime] = None

    model_config = {"from_attributes": True}


class InterfaceMetricResponse(BaseModel):
    id: int
    interface_id: int
    timestamp: datetime
    in_bps: float
    out_bps: float
    in_pps: float
    out_pps: float
    utilization_in: float
    utilization_out: float
    in_errors: int
    out_errors: int
    oper_status: Optional[str] = None

    model_config = {"from_attributes": True}
