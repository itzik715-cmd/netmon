"""
Server Management API — Ports, SSL, Services, SMTP.
All endpoints require admin role.
"""
import logging
import re
import subprocess
import smtplib
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field

from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.database import get_db
from app.models.settings import SystemSetting
from app.models.user import User
from app.middleware.rbac import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/server-mgmt", tags=["Server Management"])

SSL_DIR = Path("/etc/nginx/ssl")
NGINX_CONF_PATH = Path("/app/nginx-config/nginx.conf")
COMPOSE_FILE = Path("/app/project/docker-compose.yml")

# ── Pydantic Models ──────────────────────────────────────────────────────────


class PortConfig(BaseModel):
    http_port: int = Field(default=80, ge=1, le=65535)
    https_port: int = Field(default=443, ge=1, le=65535)
    api_port: int = Field(default=8000, ge=1, le=65535)
    netflow_port: int = Field(default=2055, ge=1, le=65535)
    sflow_port: int = Field(default=6343, ge=1, le=65535)


class SelfSignedConfig(BaseModel):
    common_name: str = Field(default="netmon.local", min_length=1, max_length=255)
    organization: str = Field(default="NetMon", min_length=1, max_length=255)
    days: int = Field(default=365, ge=30, le=3650)


class SmtpConfig(BaseModel):
    enabled: bool = False
    host: str = ""
    port: int = Field(default=587, ge=1, le=65535)
    username: str = ""
    password: str = ""
    use_tls: bool = True
    from_address: str = ""
    from_name: str = "NetMon"


class SmtpTestRequest(BaseModel):
    to_address: str


# ── Helpers ──────────────────────────────────────────────────────────────────


async def get_setting_value(db: AsyncSession, key: str, default: str = "") -> str:
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    setting = result.scalar_one_or_none()
    return setting.value if setting and setting.value else default


async def save_setting(
    db: AsyncSession,
    key: str,
    value: str,
    description: str = "",
    is_secret: bool = False,
    user_id: Optional[int] = None,
):
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
        setting.is_secret = is_secret
        if user_id:
            setting.updated_by = user_id
    else:
        setting = SystemSetting(
            key=key,
            value=value,
            description=description,
            is_secret=is_secret,
            updated_by=user_id,
        )
        db.add(setting)


# ── 1. GET /ports ────────────────────────────────────────────────────────────


@router.get("/ports", dependencies=[Depends(require_admin())])
async def get_ports(db: AsyncSession = Depends(get_db)):
    defaults = {"http_port": "80", "https_port": "443", "api_port": "8000",
                "netflow_port": "2055", "sflow_port": "6343"}
    result = {}
    for key, default in defaults.items():
        result[key] = int(await get_setting_value(db, f"port_{key}", default))
    return result


# ── 2. PUT /ports ────────────────────────────────────────────────────────────


@router.put("/ports", dependencies=[Depends(require_admin())])
async def update_ports(
    config: PortConfig,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin()),
):
    ports = [config.http_port, config.https_port, config.api_port,
             config.netflow_port, config.sflow_port]
    if len(set(ports)) != len(ports):
        raise HTTPException(status_code=400, detail="All ports must be unique")

    await save_setting(db, "port_http_port", str(config.http_port),
                       "HTTP listen port", user_id=current_user.id)
    await save_setting(db, "port_https_port", str(config.https_port),
                       "HTTPS listen port", user_id=current_user.id)
    await save_setting(db, "port_api_port", str(config.api_port),
                       "Backend API port", user_id=current_user.id)
    await save_setting(db, "port_netflow_port", str(config.netflow_port),
                       "NetFlow UDP port", user_id=current_user.id)
    await save_setting(db, "port_sflow_port", str(config.sflow_port),
                       "sFlow UDP port", user_id=current_user.id)
    await db.commit()

    # Regenerate nginx.conf
    try:
        _regenerate_nginx_conf(config.http_port, config.https_port)
    except Exception as e:
        logger.error(f"Failed to regenerate nginx.conf: {e}")

    return {"message": "Port configuration saved", "restart_required": True}


def _regenerate_nginx_conf(http_port: int, https_port: int):
    if not NGINX_CONF_PATH.exists():
        logger.warning(f"Nginx config not found at {NGINX_CONF_PATH}")
        return
    content = NGINX_CONF_PATH.read_text()
    content = re.sub(r"listen\s+\d+;", f"listen {http_port};", content, count=1)
    content = re.sub(r"listen\s+\d+\s+ssl;", f"listen {https_port} ssl;", content, count=1)
    NGINX_CONF_PATH.write_text(content)
    logger.info(f"Nginx config regenerated: HTTP={http_port}, HTTPS={https_port}")


# ── 3. GET /ssl/status ──────────────────────────────────────────────────────


@router.get("/ssl/status", dependencies=[Depends(require_admin())])
async def get_ssl_status():
    cert_path = SSL_DIR / "cert.pem"
    if not cert_path.exists():
        return {"installed": False}

    try:
        cert_pem = cert_path.read_bytes()
        cert = x509.load_pem_x509_certificate(cert_pem)
        now = datetime.now(timezone.utc)

        subject = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
        issuer = cert.issuer.get_attributes_for_oid(NameOID.COMMON_NAME)
        subject_cn = subject[0].value if subject else "Unknown"
        issuer_cn = issuer[0].value if issuer else "Unknown"

        is_self_signed = cert.issuer == cert.subject
        days_remaining = (cert.not_valid_after_utc - now).days

        # Get SAN entries
        san_entries = []
        try:
            san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
            san_entries = [str(name) for name in san.value]
        except x509.ExtensionNotFound:
            pass

        return {
            "installed": True,
            "subject": subject_cn,
            "issuer": issuer_cn,
            "not_before": cert.not_valid_before_utc.isoformat(),
            "not_after": cert.not_valid_after_utc.isoformat(),
            "is_self_signed": is_self_signed,
            "days_remaining": days_remaining,
            "serial": str(cert.serial_number),
            "san": san_entries,
        }
    except Exception as e:
        logger.error(f"Failed to parse SSL certificate: {e}")
        return {"installed": True, "error": str(e)}


# ── 4. POST /ssl/upload ─────────────────────────────────────────────────────


@router.post("/ssl/upload", dependencies=[Depends(require_admin())])
async def upload_ssl(
    cert: UploadFile = File(...),
    key: UploadFile = File(...),
):
    cert_data = await cert.read()
    key_data = await key.read()

    # Validate PEM format and matching key
    try:
        parsed_cert = x509.load_pem_x509_certificate(cert_data)
        parsed_key = serialization.load_pem_private_key(key_data, password=None)

        # Verify key matches certificate
        cert_pub = parsed_cert.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        key_pub = parsed_key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        if cert_pub != key_pub:
            raise HTTPException(status_code=400, detail="Certificate and key do not match")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid PEM data: {e}")

    SSL_DIR.mkdir(parents=True, exist_ok=True)
    (SSL_DIR / "cert.pem").write_bytes(cert_data)
    (SSL_DIR / "key.pem").write_bytes(key_data)

    return {"message": "SSL certificate uploaded", "restart_required": True,
            "subject": parsed_cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value}


# ── 5. POST /ssl/generate-self-signed ───────────────────────────────────────


@router.post("/ssl/generate-self-signed", dependencies=[Depends(require_admin())])
async def generate_self_signed(config: SelfSignedConfig):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, config.common_name),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, config.organization),
    ])
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=config.days))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName(config.common_name),
                x509.DNSName("localhost"),
            ]),
            critical=False,
        )
        .sign(private_key, hashes.SHA256())
    )

    SSL_DIR.mkdir(parents=True, exist_ok=True)
    (SSL_DIR / "cert.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (SSL_DIR / "key.pem").write_bytes(
        private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )

    return {"message": "Self-signed certificate generated", "restart_required": True,
            "common_name": config.common_name, "days": config.days}


# ── 6. GET /services ────────────────────────────────────────────────────────


@router.get("/services", dependencies=[Depends(require_admin())])
async def get_services(db: AsyncSession = Depends(get_db)):
    services = []

    # Backend (always running if we're handling this request)
    services.append({
        "id": "backend",
        "name": "Backend API",
        "status": "running",
        "port": 8000,
    })

    # PostgreSQL
    try:
        from sqlalchemy import text
        await db.execute(text("SELECT 1"))
        services.append({
            "id": "db",
            "name": "PostgreSQL",
            "status": "running",
            "port": 5432,
        })
    except Exception:
        services.append({
            "id": "db",
            "name": "PostgreSQL",
            "status": "error",
            "port": 5432,
        })

    # Redis
    try:
        import redis.asyncio as aioredis
        from app.config import settings
        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await r.ping()
        await r.aclose()
        services.append({
            "id": "redis",
            "name": "Redis",
            "status": "running",
            "port": 6379,
        })
    except Exception:
        services.append({
            "id": "redis",
            "name": "Redis",
            "status": "error",
            "port": 6379,
        })

    # Nginx
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get("http://nginx:80/")
            services.append({
                "id": "nginx",
                "name": "Nginx",
                "status": "running" if resp.status_code < 500 else "error",
                "port": 443,
            })
    except Exception:
        services.append({
            "id": "nginx",
            "name": "Nginx",
            "status": "error",
            "port": 443,
        })

    # Flow Collector (check if the background task is running)
    try:
        from app.services.flow_collector import collector_running
        services.append({
            "id": "flow_collector",
            "name": "Flow Collector",
            "status": "running" if collector_running() else "stopped",
            "port": "2055/6343",
        })
    except Exception:
        services.append({
            "id": "flow_collector",
            "name": "Flow Collector",
            "status": "unknown",
            "port": "2055/6343",
        })

    return services


# ── 7. POST /services/{service_id}/restart ───────────────────────────────────


ALLOWED_SERVICES = {"backend", "db", "redis", "nginx", "frontend"}


@router.post("/services/{service_id}/restart", dependencies=[Depends(require_admin())])
async def restart_service(service_id: str):
    if service_id not in ALLOWED_SERVICES:
        raise HTTPException(status_code=400, detail=f"Unknown service: {service_id}")

    compose_file = str(COMPOSE_FILE)
    if not COMPOSE_FILE.exists():
        raise HTTPException(status_code=500, detail="docker-compose.yml not found")

    try:
        result = subprocess.run(
            ["docker", "compose", "-f", compose_file, "restart", service_id],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Restart failed: {result.stderr}")
        return {"message": f"Service '{service_id}' restart initiated",
                "warning": "Backend restart will disconnect your session" if service_id == "backend" else None}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Restart timed out")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="docker command not found")


# ── 8. GET /smtp ─────────────────────────────────────────────────────────────


@router.get("/smtp", dependencies=[Depends(require_admin())])
async def get_smtp(db: AsyncSession = Depends(get_db)):
    config = {
        "enabled": (await get_setting_value(db, "smtp_enabled", "false")).lower() == "true",
        "host": await get_setting_value(db, "smtp_host"),
        "port": int(await get_setting_value(db, "smtp_port", "587")),
        "username": await get_setting_value(db, "smtp_username"),
        "password": "***" if await get_setting_value(db, "smtp_password") else "",
        "use_tls": (await get_setting_value(db, "smtp_use_tls", "true")).lower() == "true",
        "from_address": await get_setting_value(db, "smtp_from_address"),
        "from_name": await get_setting_value(db, "smtp_from_name", "NetMon"),
    }
    return config


# ── 9. PUT /smtp ─────────────────────────────────────────────────────────────


@router.put("/smtp", dependencies=[Depends(require_admin())])
async def update_smtp(
    config: SmtpConfig,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin()),
):
    uid = current_user.id
    await save_setting(db, "smtp_enabled", str(config.enabled).lower(),
                       "SMTP enabled", user_id=uid)
    await save_setting(db, "smtp_host", config.host, "SMTP host", user_id=uid)
    await save_setting(db, "smtp_port", str(config.port), "SMTP port", user_id=uid)
    await save_setting(db, "smtp_username", config.username, "SMTP username", user_id=uid)
    # Only update password if not masked
    if config.password and config.password != "***":
        await save_setting(db, "smtp_password", config.password, "SMTP password",
                           is_secret=True, user_id=uid)
    await save_setting(db, "smtp_use_tls", str(config.use_tls).lower(),
                       "SMTP TLS enabled", user_id=uid)
    await save_setting(db, "smtp_from_address", config.from_address,
                       "SMTP from address", user_id=uid)
    await save_setting(db, "smtp_from_name", config.from_name,
                       "SMTP from name", user_id=uid)
    await db.commit()
    return {"message": "SMTP configuration saved"}


# ── 10. POST /smtp/test ─────────────────────────────────────────────────────


@router.post("/smtp/test", dependencies=[Depends(require_admin())])
async def test_smtp(
    payload: SmtpTestRequest,
    db: AsyncSession = Depends(get_db),
):
    from app.services.email_sender import send_email

    success = await send_email(
        db,
        payload.to_address,
        "NetMon SMTP Test",
        "<h2>SMTP Test Successful</h2><p>If you received this email, your SMTP configuration is working correctly.</p>",
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to send test email. Check SMTP configuration and logs.")
    return {"message": f"Test email sent to {payload.to_address}"}
