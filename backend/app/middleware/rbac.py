from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.services.auth import decode_token, get_user_by_id
from app.models.user import User
from typing import List, Optional

security = HTTPBearer()

ROLE_HIERARCHY = {
    "admin": 3,
    "operator": 2,
    "readonly": 1,
}


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = decode_token(credentials.credentials)
    if not token_data or not token_data.user_id:
        raise credentials_exception

    user = await get_user_by_id(db, token_data.user_id)
    if not user:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    return current_user


def require_roles(*roles: str):
    """Dependency factory: requires user to have one of the specified roles."""
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        # Load role name - need to access through relationship
        from sqlalchemy.orm import selectinload
        user_role = current_user.role.name if current_user.role else None

        if user_role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required: {roles}",
            )
        return current_user
    return role_checker


def require_admin():
    return require_roles("admin")


def require_operator_or_above():
    return require_roles("admin", "operator")


def require_any_role():
    return require_roles("admin", "operator", "readonly")


def require_not_must_change_password():
    """Blocks access if user must change password first."""
    async def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.must_change_password:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Password change required. Please change your password first.",
                headers={"X-Password-Change-Required": "true"},
            )
        return current_user
    return checker
