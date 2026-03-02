from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Enum
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import enum


class RoleEnum(str, enum.Enum):
    admin = "admin"
    operator = "operator"
    readonly = "readonly"


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(String(255))
    permissions = Column(Text)  # JSON string of permissions
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    must_change_password = Column(Boolean, default=False)
    auth_source = Column(String(20), default="local")  # local | ldap
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    last_login = Column(DateTime(timezone=True), nullable=True)
    failed_attempts = Column(Integer, default=0)
    mfa_enabled = Column(Boolean, default=True)
    account_locked = Column(Boolean, default=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    password_expires_at = Column(DateTime(timezone=True), nullable=True)

    role = relationship("Role", back_populates="users")
    audit_logs = relationship("AuditLog", back_populates="user")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    username = Column(String(100))  # Stored separately in case user is deleted
    action = Column(String(100), nullable=False)
    resource_type = Column(String(100))
    resource_id = Column(String(100))
    details = Column(Text)
    source_ip = Column(String(50))
    success = Column(Boolean, default=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    user = relationship("User", back_populates="audit_logs")
