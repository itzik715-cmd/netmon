from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class LocationCreate(BaseModel):
    name: str
    description: Optional[str] = None
    address: Optional[str] = None
    timezone: str = "UTC"


class LocationResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    address: Optional[str] = None
    timezone: str

    model_config = {"from_attributes": True}


class DeviceCreate(BaseModel):
    hostname: str
    ip_address: str
    device_type: Optional[str] = None
    layer: Optional[str] = None
    vendor: Optional[str] = None
    model: Optional[str] = None
    location_id: Optional[int] = None
    snmp_community: Optional[str] = "public"
    snmp_version: str = "2c"
    snmp_port: int = 161
    snmp_v3_username: Optional[str] = None
    snmp_v3_auth_protocol: Optional[str] = None
    snmp_v3_auth_key: Optional[str] = None
    snmp_v3_priv_protocol: Optional[str] = None
    snmp_v3_priv_key: Optional[str] = None
    poll_interval: int = 60
    description: Optional[str] = None
    tags: Optional[str] = None


class DeviceUpdate(BaseModel):
    hostname: Optional[str] = None
    device_type: Optional[str] = None
    layer: Optional[str] = None
    vendor: Optional[str] = None
    model: Optional[str] = None
    location_id: Optional[int] = None
    snmp_community: Optional[str] = None
    snmp_version: Optional[str] = None
    snmp_port: Optional[int] = None
    poll_interval: Optional[int] = None
    polling_enabled: Optional[bool] = None
    is_active: Optional[bool] = None
    description: Optional[str] = None
    tags: Optional[str] = None


class DeviceResponse(BaseModel):
    id: int
    hostname: str
    ip_address: str
    device_type: Optional[str] = None
    layer: Optional[str] = None
    vendor: Optional[str] = None
    model: Optional[str] = None
    os_version: Optional[str] = None
    location: Optional[LocationResponse] = None
    status: str
    last_seen: Optional[datetime] = None
    uptime: Optional[int] = None
    cpu_usage: Optional[float] = None
    memory_usage: Optional[float] = None
    poll_interval: int
    polling_enabled: bool
    is_active: bool
    description: Optional[str] = None
    tags: Optional[str] = None
    interface_count: Optional[int] = 0

    model_config = {"from_attributes": True}
