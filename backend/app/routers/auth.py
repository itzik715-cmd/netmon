from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.database import get_db
from app.models.user import User, Role
from app.services.auth import (
    authenticate_user, create_access_token, create_refresh_token,
    decode_token, hash_password, log_audit
)
from app.services.ldap_auth import authenticate_ldap, get_or_create_ldap_user, test_ldap_connection
from app.services.duo_auth import get_duo_config, verify_duo_push, ping_duo_api, check_duo_auth
from app.middleware.rbac import get_current_user, require_admin
from app.schemas.auth import (
    LoginRequest, Token, PasswordChangeRequest,
    RefreshTokenRequest, LDAPConfigRequest,
)
from app.config import settings
from app.extensions import limiter
from datetime import datetime, timezone, timedelta
import logging

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)

REFRESH_COOKIE = "netmon_refresh"


def _set_refresh_cookie(response: Response, token: str) -> None:
    """Set refresh token as httpOnly, Secure, SameSite=Strict cookie."""
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE, path="/api/auth")


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login")
@limiter.limit(settings.RATE_LIMIT_LOGIN)
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

    # Check if Duo MFA is required (direct Duo Auth API) — per-user toggle
    duo_cfg = await get_duo_config(db)
    if duo_cfg["enabled"] and duo_cfg.get("ikey") and duo_cfg.get("skey") and duo_cfg.get("api_host") and user.mfa_enabled:
        try:
            ok = await verify_duo_push(
                duo_cfg["api_host"],
                duo_cfg["ikey"],
                duo_cfg["skey"],
                user.username,
                timeout=duo_cfg.get("timeout", 60),
            )
            if not ok:
                await log_audit(
                    db, "duo_mfa_failed", user_id=user.id,
                    username=user.username, source_ip=source_ip,
                    success=False, details=f"auth_source={auth_source}"
                )
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="MFA verification failed or timed out. Please try again.",
                )
            await log_audit(
                db, "duo_mfa_success", user_id=user.id,
                username=user.username, source_ip=source_ip,
                details=f"auth_source={auth_source}"
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Duo Auth API failed: {e}")
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

    token_response = Token(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        must_change_password=user.must_change_password,
        role=role_name,
        session_start=session_start,
        session_max_seconds=session_max,
    )
    response = JSONResponse(content=token_response.model_dump())
    _set_refresh_cookie(response, refresh_token)
    return response


@router.get("/duo/status", dependencies=[Depends(require_admin())])
async def duo_status(db: AsyncSession = Depends(get_db)):
    """Return Duo Auth API status for the admin settings page."""
    duo_cfg = await get_duo_config(db)
    configured = bool(
        duo_cfg["enabled"] and duo_cfg.get("ikey")
        and duo_cfg.get("skey") and duo_cfg.get("api_host")
    )
    healthy = False
    check_msg = ""
    if configured:
        try:
            result = await check_duo_auth(
                duo_cfg["api_host"], duo_cfg["ikey"], duo_cfg["skey"]
            )
            healthy = result["ok"]
            check_msg = result.get("message", "")
        except Exception:
            healthy = False

    return {
        "enabled": duo_cfg["enabled"],
        "configured": configured,
        "healthy": healthy,
        "api_host": duo_cfg.get("api_host", "") if duo_cfg["enabled"] else "",
        "message": check_msg,
    }


@router.post("/refresh")
async def refresh_token(
    request: Request,
    payload: Optional[RefreshTokenRequest] = None,
    db: AsyncSession = Depends(get_db),
    netmon_refresh: Optional[str] = Cookie(default=None),
):
    # Accept refresh token from httpOnly cookie or request body (backward compatible)
    raw_token = netmon_refresh or (payload.refresh_token if payload else None)
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token provided")

    token_data = decode_token(raw_token)
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

    token_resp = Token(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        must_change_password=user.must_change_password,
        role=role_name,
        session_start=session_start,
        session_max_seconds=session_max,
    )
    response = JSONResponse(content=token_resp.model_dump())
    _set_refresh_cookie(response, new_refresh_token)
    return response


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
    response = JSONResponse(content={"message": "Logged out successfully"})
    _clear_refresh_cookie(response)
    return response
