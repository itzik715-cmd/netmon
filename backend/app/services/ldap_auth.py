from typing import Optional, Tuple
from ldap3 import Server, Connection, ALL, NTLM, SIMPLE, Tls
from ldap3.core.exceptions import LDAPException, LDAPBindError
from ldap3.utils.conv import escape_filter_chars
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user import User, Role
from app.services.auth import hash_password
from app.config import settings
import logging
import ssl

logger = logging.getLogger(__name__)


def get_ldap_settings(override: dict = None) -> dict:
    """Get LDAP settings from config or override dict."""
    cfg = override or {}
    return {
        "enabled": cfg.get("enabled", settings.LDAP_ENABLED),
        "server": cfg.get("server", settings.LDAP_SERVER),
        "port": cfg.get("port", settings.LDAP_PORT),
        "use_ssl": cfg.get("use_ssl", settings.LDAP_USE_SSL),
        "base_dn": cfg.get("base_dn", settings.LDAP_BASE_DN),
        "bind_dn": cfg.get("bind_dn", settings.LDAP_BIND_DN),
        "bind_password": cfg.get("bind_password", settings.LDAP_BIND_PASSWORD),
        "user_filter": cfg.get("user_filter", settings.LDAP_USER_FILTER),
        "group_admin": cfg.get("group_admin", settings.LDAP_GROUP_ADMIN),
        "group_operator": cfg.get("group_operator", settings.LDAP_GROUP_OPERATOR),
        "group_readonly": cfg.get("group_readonly", settings.LDAP_GROUP_READONLY),
        "local_fallback": cfg.get("local_fallback", settings.LDAP_LOCAL_FALLBACK),
    }


async def authenticate_ldap(
    username: str, password: str, ldap_cfg: dict = None
) -> Tuple[bool, Optional[str], Optional[list]]:
    """
    Authenticate against LDAP.
    Returns (success, dn, group_list)
    """
    cfg = get_ldap_settings(ldap_cfg)
    if not cfg["enabled"] or not cfg["server"]:
        return False, None, None

    try:
        tls = None
        if cfg["use_ssl"]:
            tls = Tls(validate=ssl.CERT_NONE)

        server = Server(
            cfg["server"],
            port=cfg["port"],
            use_ssl=cfg["use_ssl"],
            get_info=ALL,
            tls=tls,
            connect_timeout=10,
        )

        # First bind with service account to search for user
        conn = Connection(
            server,
            user=cfg["bind_dn"],
            password=cfg["bind_password"],
            authentication=SIMPLE,
            auto_bind=True,
        )

        # Search for user — escape LDAP metacharacters to prevent injection
        safe_username = escape_filter_chars(username)
        user_filter = cfg["user_filter"].format(username=safe_username)
        conn.search(
            cfg["base_dn"],
            user_filter,
            attributes=["distinguishedName", "memberOf", "mail", "displayName"],
        )

        if not conn.entries:
            logger.warning(f"LDAP: User not found: {username}")
            return False, None, None

        user_dn = conn.entries[0].entry_dn
        groups = []
        if hasattr(conn.entries[0], "memberOf"):
            groups = list(conn.entries[0].memberOf) if conn.entries[0].memberOf else []

        conn.unbind()

        # Now bind as the user to validate password
        user_conn = Connection(
            server,
            user=user_dn,
            password=password,
            authentication=SIMPLE,
            auto_bind=True,
        )
        user_conn.unbind()

        logger.info(f"LDAP authentication successful for user: {username}")
        return True, user_dn, groups

    except LDAPBindError as e:
        logger.warning(f"LDAP bind failed for {username}: {e}")
        return False, None, None
    except LDAPException as e:
        logger.error(f"LDAP error for {username}: {e}")
        return False, None, None
    except Exception as e:
        logger.error(f"Unexpected LDAP error: {e}")
        return False, None, None


def map_ldap_groups_to_role(groups: list, cfg: dict) -> str:
    """Map LDAP group membership to internal role name."""
    for group in groups:
        group_lower = group.lower()
        if cfg.get("group_admin", "").lower() in group_lower:
            return "admin"
        if cfg.get("group_operator", "").lower() in group_lower:
            return "operator"
        if cfg.get("group_readonly", "").lower() in group_lower:
            return "readonly"
    return "readonly"  # Default to most restrictive


async def get_or_create_ldap_user(
    db: AsyncSession,
    username: str,
    groups: list,
    ldap_cfg: dict = None,
) -> Optional[User]:
    """Create or update shadow user for LDAP-authenticated user."""
    cfg = get_ldap_settings(ldap_cfg)
    role_name = map_ldap_groups_to_role(groups, cfg)

    # Find role
    result = await db.execute(select(Role).where(Role.name == role_name))
    role = result.scalar_one_or_none()
    if not role:
        result = await db.execute(select(Role).where(Role.name == "readonly"))
        role = result.scalar_one_or_none()

    # Check if user exists
    result = await db.execute(select(User).where(User.username == username.lower()))
    user = result.scalar_one_or_none()

    if user:
        # Update role if changed
        user.role_id = role.id
        user.auth_source = "ldap"
        await db.commit()
        await db.refresh(user)
        return user

    # Create new shadow user
    new_user = User(
        username=username.lower(),
        email=f"{username.lower()}@ldap.local",
        password_hash=hash_password("*ldap-no-local-login*"),
        role_id=role.id,
        is_active=True,
        must_change_password=False,
        auth_source="ldap",
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user


async def test_ldap_connection(ldap_cfg: dict) -> Tuple[bool, str]:
    """Test LDAP connectivity and binding. Returns (success, message)."""
    try:
        tls = None
        if ldap_cfg.get("use_ssl"):
            tls = Tls(validate=ssl.CERT_NONE)

        server = Server(
            ldap_cfg["server"],
            port=ldap_cfg.get("port", 389),
            use_ssl=ldap_cfg.get("use_ssl", False),
            get_info=ALL,
            tls=tls,
            connect_timeout=10,
        )
        conn = Connection(
            server,
            user=ldap_cfg["bind_dn"],
            password=ldap_cfg["bind_password"],
            authentication=SIMPLE,
            auto_bind=True,
        )
        info = f"Connected to {ldap_cfg['server']} - Server: {server.info.vendor_name}"
        conn.unbind()
        return True, info
    except Exception as e:
        return False, str(e)
