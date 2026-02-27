from pydantic import BaseModel, model_validator
from typing import Optional
from datetime import datetime


class PowerAlertRuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    metric: str  # total_power, avg_load, max_load, max_temp, avg_temp, budget_pct
    condition: str  # gt, gte, lt, lte
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    lookback_minutes: int = 60
    cooldown_minutes: int = 60
    notification_email: Optional[str] = None
    notification_webhook: Optional[str] = None

    @model_validator(mode="after")
    def at_least_one_threshold(self):
        if self.warning_threshold is None and self.critical_threshold is None:
            raise ValueError("Must supply at least one threshold (warning or critical)")
        return self


class PowerAlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    metric: Optional[str] = None
    condition: Optional[str] = None
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    lookback_minutes: Optional[int] = None
    is_active: Optional[bool] = None
    cooldown_minutes: Optional[int] = None
    notification_email: Optional[str] = None
    notification_webhook: Optional[str] = None


class PowerAlertRuleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    metric: str
    condition: str
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    lookback_minutes: int
    is_active: bool
    cooldown_minutes: int
    notification_email: Optional[str] = None
    notification_webhook: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
