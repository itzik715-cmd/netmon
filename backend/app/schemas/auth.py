from pydantic import BaseModel, field_validator
from typing import Optional
import re


class LoginRequest(BaseModel):
    username: str
    password: str


class PasswordChangeRequest(BaseModel):
    current_password: Optional[str] = None
    new_password: str
    confirm_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 10:
            raise ValueError("Password must be at least 10 characters long")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must contain at least one lowercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain at least one number")
        if not re.search(r"[!@#$%^&*(),.?\":{}|<>_\-\[\]\\;'/`~+=]", v):
            raise ValueError("Password must contain at least one special character")
        return v

    @field_validator("confirm_password")
    @classmethod
    def passwords_match(cls, v: str, info) -> str:
        if "new_password" in info.data and v != info.data["new_password"]:
            raise ValueError("Passwords do not match")
        return v


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    must_change_password: bool = False
    role: str
    session_start: Optional[str] = None
    session_max_seconds: Optional[int] = None


class TokenData(BaseModel):
    user_id: Optional[int] = None
    username: Optional[str] = None
    role: Optional[str] = None
    session_start: Optional[str] = None


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class LDAPConfigRequest(BaseModel):
    enabled: bool
    server: str
    port: int = 389
    use_ssl: bool = False
    base_dn: str
    bind_dn: str
    bind_password: str
    user_filter: str = "(sAMAccountName={username})"
    group_admin: str = ""
    group_operator: str = ""
    group_readonly: str = ""
    local_fallback: bool = True
