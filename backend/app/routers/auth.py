from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.database import get_db
from app.models.user import User, Role
from app.services.auth import (
    authenticate_user, create_access_token, create_refresh_token,
    decode_token, hash_password, log_audit
)
from app.services.ldap_auth import authenticate_ldap, get_or_create_ldap_user, test_ldap_connection
from app.services.duo_auth import (
    get_duo_config, build_duo_client, create_duo_auth_url, store_duo_state,
    retrieve_and_delete_duo_state, verify_duo_code, duo_health_check_with_client
)
from app.middleware.rbac import get_current_user, require_admin
from app.schemas.auth import (
    LoginRequest, Token, PasswordChangeRequest,
    RefreshTokenRequest, LDAPConfigRequest, DuoCallbackRequest
)
from app.config import settings
from datetime import datetime, timezone, timedelta
import logging

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login")
async def login(
    request: Request,
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    source_ip = get_client_ip(request)

    # Try LDAP first if enabled
    ldap_user = None
    if settings.LDAP_ENABLED:
        success, dn, groups = await authenticate_ldap(payload.username, payload.password)
        if success and groups is not None:
            ldap_user = await get_or_create_ldap_user(db, payload.username, groups)

    if ldap_user:
        user = ldap_user
        auth_source = "ldap"
    else:
        user, error = await authenticate_user(db, payload.username, payload.password)
        if not user:
            await log_audit(
                db, "login_failed", username=payload.username,
                source_ip=source_ip, success=False, details=error
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=error or "Invalid credentials",
            )
        auth_source = "local"

    # Load role
    await db.refresh(user, ["role"])
    role_name = user.role.name if user.role else "readonly"

    # Check if Duo MFA is required (load config from DB + env fallback)
    duo_cfg = await get_duo_config(db)
    duo_client = build_duo_client(duo_cfg)
    if duo_client is not None:
        try:
            auth_url, state = create_duo_auth_url(duo_client, user.username)
            await store_duo_state(state, {
                "user_id": user.id,
                "username": user.username,
                "role": role_name,
                "must_change_password": user.must_change_password,
                "auth_source": auth_source,
            })
            await log_audit(
                db, "duo_mfa_initiated", user_id=user.id,
                username=user.username, source_ip=source_ip,
                details=f"auth_source={auth_source}"
            )
            return JSONResponse(content={
                "duo_required": True,
                "duo_auth_url": auth_url,
                "duo_state": state,
            })
        except Exception as e:
            logger.error(f"Duo initiation failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="MFA service unavailable. Please try again later.",
            )

    # No Duo — issue tokens directly
    session_start = datetime.now(timezone.utc).isoformat()
    access_token = create_access_token({
        "sub": str(user.id),
        "username": user.username,
        "role": role_name,
    })
    refresh_token = create_refresh_token(
        {"sub": str(user.id), "username": user.username},
        session_start=session_start,
    )

    await log_audit(
        db, "login_success", user_id=user.id, username=user.username,
        source_ip=source_ip, success=True,
        details=f"auth_source={auth_source}"
    )

    session_max = settings.SESSION_MAX_HOURS * 3600 if role_name != "readonly" and settings.SESSION_MAX_HOURS > 0 else None

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        must_change_password=user.must_change_password,
        role=role_name,
        session_start=session_start,
        session_max_seconds=session_max,
    )


@router.post("/duo/callback", response_model=Token)
async def duo_callback(
    request: Request,
    payload: DuoCallbackRequest,
    db: AsyncSession = Depends(get_db),
):
    """Complete Duo MFA flow: validate the code, then issue JWT tokens."""
    source_ip = get_client_ip(request)

    # Retrieve and atomically delete stored state
    user_data = await retrieve_and_delete_duo_state(payload.state)
    if not user_data:
        await log_audit(
            db, "duo_callback_failed", source_ip=source_ip,
            success=False, details="Invalid or expired Duo state"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired MFA session. Please log in again.",
        )

    # Build Duo client from DB config to verify the code
    duo_cfg = await get_duo_config(db)
    duo_client = build_duo_client(duo_cfg)
    if not duo_client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MFA service not configured.",
        )

    # Verify the Duo authorization code
    username = user_data["username"]
    if not verify_duo_code(duo_client, payload.duo_code, username):
        await log_audit(
            db, "duo_mfa_failed", username=username,
            source_ip=source_ip, success=False,
            details="Duo code verification failed"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="MFA verification failed. Please try again.",
        )

    # Re-check user is still active
    result = await db.execute(select(User).where(User.id == user_data["user_id"]))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is disabled.",
        )

    # Issue tokens
    session_start = datetime.now(timezone.utc).isoformat()
    access_token = create_access_token({
        "sub": str(user_data["user_id"]),
        "username": username,
        "role": user_data["role"],
    })
    refresh_token_str = create_refresh_token(
        {"sub": str(user_data["user_id"]), "username": username},
        session_start=session_start,
    )

    await log_audit(
        db, "login_success", user_id=user_data["user_id"],
        username=username, source_ip=source_ip, success=True,
        details=f"auth_source={user_data['auth_source']}, mfa=duo"
    )

    role_name = user_data["role"]
    session_max = settings.SESSION_MAX_HOURS * 3600 if role_name != "readonly" and settings.SESSION_MAX_HOURS > 0 else None

    return Token(
        access_token=access_token,
        refresh_token=refresh_token_str,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        must_change_password=user_data["must_change_password"],
        role=role_name,
        session_start=session_start,
        session_max_seconds=session_max,
    )


@router.get("/duo/status", dependencies=[Depends(require_admin())])
async def duo_status(db: AsyncSession = Depends(get_db)):
    """Return Duo MFA config for the admin settings page."""
    duo_cfg = await get_duo_config(db)
    duo_client = build_duo_client(duo_cfg)
    healthy = False
    if duo_client:
        try:
            healthy = duo_health_check_with_client(duo_client)
        except Exception:
            healthy = False

    return {
        "enabled": duo_cfg["enabled"],
        "configured": duo_client is not None,
        "healthy": healthy,
        "api_hostname": duo_cfg.get("api_hostname", "") if duo_cfg["enabled"] else "",
        "integration_key": duo_cfg.get("integration_key", "") if duo_cfg["enabled"] else "",
        "redirect_uri": duo_cfg.get("redirect_uri", "") if duo_cfg["enabled"] else "",
    }


@router.post("/refresh", response_model=Token)
async def refresh_token(
    payload: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    token_data = decode_token(payload.refresh_token)
    if not token_data or not token_data.user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    result = await db.execute(select(User).where(User.id == token_data.user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or disabled")

    await db.refresh(user, ["role"])
    role_name = user.role.name if user.role else "readonly"

    # Enforce session max duration (except readonly role)
    session_start = token_data.session_start
    if session_start and role_name != "readonly" and settings.SESSION_MAX_HOURS > 0:
        try:
            start_dt = datetime.fromisoformat(session_start)
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            elapsed = datetime.now(timezone.utc) - start_dt
            if elapsed > timedelta(hours=settings.SESSION_MAX_HOURS):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Session expired. Please log in again.",
                )
        except ValueError:
            pass  # Malformed timestamp — allow refresh to proceed

    new_access_token = create_access_token({
        "sub": str(user.id),
        "username": user.username,
        "role": role_name,
    })
    new_refresh_token = create_refresh_token(
        {"sub": str(user.id), "username": user.username},
        session_start=session_start,
    )

    session_max = settings.SESSION_MAX_HOURS * 3600 if role_name != "readonly" and settings.SESSION_MAX_HOURS > 0 else None

    return Token(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        must_change_password=user.must_change_password,
        role=role_name,
        session_start=session_start,
        session_max_seconds=session_max,
    )


@router.post("/change-password")
async def change_password(
    request: Request,
    payload: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.auth import verify_password
    source_ip = get_client_ip(request)

    if not current_user.must_change_password and payload.current_password:
        if not verify_password(payload.current_password, current_user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
    elif not current_user.must_change_password and not payload.current_password:
        raise HTTPException(status_code=400, detail="Current password is required")

    new_hash = hash_password(payload.new_password)
    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(
            password_hash=new_hash,
            must_change_password=False,
            updated_at=datetime.now(timezone.utc),
        )
    )
    await db.commit()

    await log_audit(
        db, "password_changed", user_id=current_user.id,
        username=current_user.username, source_ip=source_ip,
        resource_type="user", resource_id=str(current_user.id),
    )
    return {"message": "Password changed successfully"}


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.refresh(current_user, ["role"])
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role.name if current_user.role else None,
        "must_change_password": current_user.must_change_password,
        "auth_source": current_user.auth_source,
    }


@router.post("/ldap/test", dependencies=[Depends(require_admin())])
async def test_ldap(payload: LDAPConfigRequest):
    success, message = await test_ldap_connection(payload.dict())
    return {"success": success, "message": message}


@router.post("/logout")
async def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await log_audit(
        db, "logout", user_id=current_user.id,
        username=current_user.username,
        source_ip=get_client_ip(request),
    )
    return {"message": "Logged out successfully"}
