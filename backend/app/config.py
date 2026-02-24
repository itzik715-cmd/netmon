from pydantic_settings import BaseSettings
from typing import Optional
import secrets


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "NetMon Platform"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    SECRET_KEY: str = secrets.token_urlsafe(64)
    ALLOWED_ORIGINS: str = "https://91-228-127-79.cloud-xip.io"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://netmon:netmon@db:5432/netmon"
    DATABASE_URL_SYNC: str = "postgresql://netmon:netmon@db:5432/netmon"

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"

    # JWT
    JWT_SECRET_KEY: str = secrets.token_urlsafe(64)
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Security
    BCRYPT_ROUNDS: int = 12
    MAX_LOGIN_ATTEMPTS: int = 5
    ACCOUNT_LOCK_MINUTES: int = 30
    PASSWORD_MIN_LENGTH: int = 10
    RATE_LIMIT_LOGIN: str = "10/minute"

    # Device API
    DEVICE_SSL_VERIFY: bool = False  # Set True if devices have valid/trusted certs

    # SNMP
    SNMP_COMMUNITY: str = "public"
    SNMP_VERSION: str = "2c"
    SNMP_TIMEOUT: int = 5
    SNMP_RETRIES: int = 2
    SNMP_POLL_INTERVAL_SECONDS: int = 60

    # NetFlow
    NETFLOW_PORT: int = 2055
    SFLOW_PORT: int = 6343

    # LDAP (optional)
    LDAP_ENABLED: bool = False
    LDAP_SERVER: str = ""
    LDAP_PORT: int = 389
    LDAP_USE_SSL: bool = False
    LDAP_BASE_DN: str = ""
    LDAP_BIND_DN: str = ""
    LDAP_BIND_PASSWORD: str = ""
    LDAP_USER_FILTER: str = "(sAMAccountName={username})"
    LDAP_GROUP_ADMIN: str = "CN=NetMon-Admins"
    LDAP_GROUP_OPERATOR: str = "CN=NetMon-Operators"
    LDAP_GROUP_READONLY: str = "CN=NetMon-ReadOnly"
    LDAP_LOCAL_FALLBACK: bool = True

    # Session
    SESSION_MAX_HOURS: int = 4  # Auto-logout after N hours (0 = disabled). Readonly role is exempt.

    # HTTPS
    HTTPS_ONLY: bool = True

    # Duo MFA (optional)
    DUO_ENABLED: bool = False
    DUO_INTEGRATION_KEY: str = ""     # Client ID from Duo Admin Panel
    DUO_SECRET_KEY: str = ""          # Client Secret from Duo Admin Panel
    DUO_API_HOSTNAME: str = ""        # e.g. "api-XXXXXXXX.duosecurity.com"
    DUO_REDIRECT_URI: str = ""        # e.g. "https://netmon.example.com/login"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
