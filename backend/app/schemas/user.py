from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from datetime import datetime
import re


class RoleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role_id: int
    is_active: bool = True
    must_change_password: bool = True

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_.-]{3,100}$", v):
            raise ValueError("Username must be 3-100 alphanumeric characters")
        return v.lower()


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    role_id: Optional[int] = None
    is_active: Optional[bool] = None
    must_change_password: Optional[bool] = None
    account_locked: Optional[bool] = None


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    role: RoleResponse
    is_active: bool
    must_change_password: bool
    auth_source: str
    account_locked: bool
    failed_attempts: int
    created_at: datetime
    last_login: Optional[datetime] = None

    model_config = {"from_attributes": True}


class AuditLogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    username: Optional[str] = None
    action: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    details: Optional[str] = None
    source_ip: Optional[str] = None
    success: bool
    timestamp: datetime

    model_config = {"from_attributes": True}
