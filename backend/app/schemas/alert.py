from pydantic import BaseModel, model_validator
from typing import Optional
from datetime import datetime


class AlertRuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    device_id: Optional[int] = None
    interface_id: Optional[int] = None
    metric: str
    condition: str
    threshold: Optional[float] = None
    severity: str = "warning"
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    duration_seconds: int = 0
    notification_email: Optional[str] = None
    notification_webhook: Optional[str] = None
    cooldown_minutes: int = 15

    @model_validator(mode="after")
    def at_least_one_threshold(self):
        has_legacy = self.threshold is not None
        has_new = self.warning_threshold is not None or self.critical_threshold is not None
        if not has_legacy and not has_new:
            raise ValueError(
                "Must supply either threshold or warning_threshold/critical_threshold"
            )
        return self


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    device_id: Optional[int] = None
    interface_id: Optional[int] = None
    metric: Optional[str] = None
    condition: Optional[str] = None
    threshold: Optional[float] = None
    severity: Optional[str] = None
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
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
    threshold: Optional[float] = None
    severity: str
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    is_active: bool
    duration_seconds: Optional[int] = 0
    cooldown_minutes: Optional[int] = 15
    notification_email: Optional[str] = None
    notification_webhook: Optional[str] = None
    created_at: datetime
    device_hostname: Optional[str] = None
    interface_name: Optional[str] = None

    model_config = {"from_attributes": True}


class AlertEventResponse(BaseModel):
    id: int
    rule_id: Optional[int] = None
    wan_rule_id: Optional[int] = None
    power_rule_id: Optional[int] = None
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
    device_hostname: Optional[str] = None

    model_config = {"from_attributes": True}


class AlertAcknowledgeRequest(BaseModel):
    notes: Optional[str] = None
