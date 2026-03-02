from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import List, Optional
from app.database import get_db
from app.models.user import User, Role, AuditLog
from app.services.auth import hash_password, log_audit
from app.middleware.rbac import get_current_user, require_admin, require_any_role
from app.schemas.user import UserCreate, UserUpdate, UserResponse, RoleResponse, AuditLogResponse
from datetime import datetime, timezone

router = APIRouter(prefix="/api/users", tags=["User Management"])


@router.get("/", response_model=List[UserResponse], dependencies=[Depends(require_admin())])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User))
    users = result.scalars().all()
    # Load roles
    for user in users:
        await db.refresh(user, ["role"])
    return users


@router.post("/", response_model=UserResponse)
async def create_user(
    request: Request,
    payload: UserCreate,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    # Check username uniqueness — if a soft-deleted user with the same
    # username exists, reactivate and update it instead of rejecting.
    existing = await db.execute(select(User).where(User.username == payload.username))
    existing_user = existing.scalar_one_or_none()
    if existing_user:
        if not existing_user.is_active:
            # Reactivate the soft-deleted user with new details
            existing_user.email = payload.email
            existing_user.password_hash = hash_password(payload.password)
            existing_user.role_id = payload.role_id
            existing_user.is_active = True
            existing_user.must_change_password = False
            existing_user.failed_login_attempts = 0
            existing_user.locked_until = None
            await db.commit()
            await db.refresh(existing_user)
            return existing_user
        raise HTTPException(status_code=400, detail="Username already exists")

    # Validate role exists
    role_result = await db.execute(select(Role).where(Role.id == payload.role_id))
    role = role_result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=400, detail="Invalid role ID")

    new_user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role_id=payload.role_id,
        is_active=payload.is_active,
        must_change_password=payload.must_change_password,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user, ["role"])

    await log_audit(
        db, "user_created",
        user_id=current_user.id, username=current_user.username,
        resource_type="user", resource_id=str(new_user.id),
        details=f"Created user: {new_user.username}",
        source_ip=request.client.host if request.client else None,
    )
    return new_user


@router.get("/{user_id}", response_model=UserResponse, dependencies=[Depends(require_admin())])
async def get_user(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.refresh(user, ["role"])
    return user


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    request: Request,
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = payload.dict(exclude_unset=True)
    if update_data:
        await db.execute(
            update(User).where(User.id == user_id).values(**update_data)
        )
        await db.commit()

    await log_audit(
        db, "user_updated",
        user_id=current_user.id, username=current_user.username,
        resource_type="user", resource_id=str(user_id),
        details=f"Updated fields: {list(update_data.keys())}",
        source_ip=request.client.host if request.client else None,
    )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    await db.refresh(user, ["role"])
    return user


@router.post("/{user_id}/reset-password")
async def reset_user_password(
    request: Request,
    user_id: int,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    await db.execute(
        update(User).where(User.id == user_id).values(must_change_password=True)
    )
    await db.commit()

    await log_audit(
        db, "password_reset_forced",
        user_id=current_user.id, username=current_user.username,
        resource_type="user", resource_id=str(user_id),
        source_ip=request.client.host if request.client else None,
    )
    return {"message": "Password reset required on next login"}


@router.post("/{user_id}/unlock")
async def unlock_account(
    request: Request,
    user_id: int,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(User).where(User.id == user_id).values(
            account_locked=False,
            failed_attempts=0,
            locked_until=None,
        )
    )
    await db.commit()

    await log_audit(
        db, "account_unlocked",
        user_id=current_user.id, username=current_user.username,
        resource_type="user", resource_id=str(user_id),
        source_ip=request.client.host if request.client else None,
    )
    return {"message": "Account unlocked"}


@router.delete("/{user_id}")
async def delete_user(
    request: Request,
    user_id: int,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Soft delete
    await db.execute(update(User).where(User.id == user_id).values(is_active=False))
    await db.commit()

    await log_audit(
        db, "user_deleted",
        user_id=current_user.id, username=current_user.username,
        resource_type="user", resource_id=str(user_id),
        details=f"Deleted user: {user.username}",
        source_ip=request.client.host if request.client else None,
    )
    return {"message": "User deactivated"}


@router.get("/roles/list", response_model=List[RoleResponse])
async def list_roles(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Role))
    return result.scalars().all()


@router.get("/audit/logs", response_model=List[AuditLogResponse], dependencies=[Depends(require_admin())])
async def get_audit_logs(
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AuditLog)
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()
