from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from app.config import settings
from app.models.user import User, AuditLog
from app.schemas.auth import TokenData
import logging

logger = logging.getLogger(__name__)

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=settings.BCRYPT_ROUNDS,
)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict, session_start: Optional[str] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({
        "exp": expire,
        "type": "refresh",
        "session_start": session_start or datetime.now(timezone.utc).isoformat(),
    })
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[TokenData]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        user_id: int = payload.get("sub")
        username: str = payload.get("username")
        role: str = payload.get("role")
        session_start: str = payload.get("session_start")
        if user_id is None:
            return None
        return TokenData(user_id=int(user_id), username=username, role=role, session_start=session_start)
    except JWTError:
        return None


async def get_user_by_username(db: AsyncSession, username: str) -> Optional[User]:
    result = await db.execute(
        select(User).where(User.username == username.lower())
    )
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: int) -> Optional[User]:
    result = await db.execute(
        select(User).options(selectinload(User.role)).where(User.id == user_id)
    )
    return result.scalar_one_or_none()


async def authenticate_user(
    db: AsyncSession, username: str, password: str
) -> Tuple[Optional[User], str]:
    """Returns (user, error_message). error_message is empty on success."""
    user = await get_user_by_username(db, username)

    if not user:
        return None, "Invalid credentials"

    if not user.is_active:
        return None, "Account is disabled"

    if user.account_locked:
        if user.locked_until and datetime.now(timezone.utc) > user.locked_until.replace(tzinfo=timezone.utc):
            # Auto-unlock
            await db.execute(
                update(User)
                .where(User.id == user.id)
                .values(account_locked=False, failed_attempts=0, locked_until=None)
            )
            await db.commit()
        else:
            return None, "Account is locked. Contact administrator."

    if user.auth_source == "ldap":
        # LDAP authentication handled separately
        return None, "Use LDAP authentication"

    if not verify_password(password, user.password_hash):
        new_attempts = user.failed_attempts + 1
        updates = {"failed_attempts": new_attempts}

        if new_attempts >= settings.MAX_LOGIN_ATTEMPTS:
            lock_until = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCOUNT_LOCK_MINUTES)
            updates["account_locked"] = True
            updates["locked_until"] = lock_until
            logger.warning(f"Account locked after {new_attempts} failed attempts: {username}")

        await db.execute(update(User).where(User.id == user.id).values(**updates))
        await db.commit()
        return None, "Invalid credentials"

    # Successful login
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(
            failed_attempts=0,
            last_login=datetime.now(timezone.utc),
        )
    )
    await db.commit()
    return user, ""


async def log_audit(
    db: AsyncSession,
    action: str,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    details: Optional[str] = None,
    source_ip: Optional[str] = None,
    success: bool = True,
):
    audit = AuditLog(
        user_id=user_id,
        username=username,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details,
        source_ip=source_ip,
        success=success,
    )
    db.add(audit)
    await db.commit()
