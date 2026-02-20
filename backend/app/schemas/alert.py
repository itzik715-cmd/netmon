from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AlertRuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    device_id: Optional[int] = None
    interface_id: Optional[int] = None
    metric: str
    condition: str
    threshold: float
    severity: str = "warning"
    duration_seconds: int = 0
    notification_email: Optional[str] = None
    notification_webhook: Optional[str] = None
    cooldown_minutes: int = 15


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    metric: Optional[str] = None
    condition: Optional[str] = None
    threshold: Optional[float] = None
    severity: Optional[str] = None
    is_active: Optional[bool] = None
    notification_email: Optional[str] = None
    notification_webhook: Optional[str] = None
    cooldown_minutes: Optional[int] = None


class AlertRuleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    device_id: Optional[int] = None
    interface_id: Optional[int] = None
    metric: str
    condition: str
    threshold: float
    severity: str
    is_active: bool
    duration_seconds: int
    cooldown_minutes: int
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertEventResponse(BaseModel):
    id: int
    rule_id: int
    device_id: Optional[int] = None
    interface_id: Optional[int] = None
    severity: str
    status: str
    message: Optional[str] = None
    metric_value: Optional[float] = None
    threshold_value: Optional[float] = None
    triggered_at: datetime
    resolved_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class AlertAcknowledgeRequest(BaseModel):
    notes: Optional[str] = None
