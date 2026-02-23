"""
NetMon Platform - Main Application Entry Point
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.config import settings
from app.database import init_db
from app.routers import auth, users, devices, interfaces, alerts, flows, settings as settings_router, blocks
from app.services.alert_engine import evaluate_rules
from app.services.flow_collector import FlowCollector
import os

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)
scheduler = AsyncIOScheduler()


async def scheduled_polling():
    """Run SNMP polling for all active devices."""
    from app.database import AsyncSessionLocal
    from app.models.device import Device
    from sqlalchemy import select
    from app.services.snmp_poller import poll_device

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Device).where(Device.is_active == True, Device.polling_enabled == True)
        )
        devices = result.scalars().all()
        tasks = [poll_device(device, db) for device in devices]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


async def scheduled_alerts():
    """Evaluate alert rules."""
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await evaluate_rules(db)


async def create_default_data():
    """Initialize default roles and admin user."""
    from app.database import AsyncSessionLocal
    from app.models.user import Role, User
    from app.services.auth import hash_password
    from sqlalchemy import select
    import json

    async with AsyncSessionLocal() as db:
        # Create roles
        roles_data = [
            {
                "name": "admin",
                "description": "Full system access",
                "permissions": json.dumps([
                    "users:read", "users:write", "users:delete",
                    "devices:read", "devices:write", "devices:delete",
                    "alerts:read", "alerts:write", "alerts:delete",
                    "flows:read", "settings:read", "settings:write",
                    "audit:read",
                ]),
            },
            {
                "name": "operator",
                "description": "Monitor and acknowledge alerts",
                "permissions": json.dumps([
                    "devices:read", "devices:write",
                    "alerts:read", "alerts:write",
                    "flows:read",
                ]),
            },
            {
                "name": "readonly",
                "description": "View-only access",
                "permissions": json.dumps([
                    "devices:read", "alerts:read", "flows:read",
                ]),
            },
        ]

        for role_data in roles_data:
            existing = await db.execute(select(Role).where(Role.name == role_data["name"]))
            if not existing.scalar_one_or_none():
                role = Role(**role_data)
                db.add(role)

        await db.commit()

        # Create default admin user
        existing_admin = await db.execute(select(User).where(User.username == "admin"))
        if not existing_admin.scalar_one_or_none():
            admin_role = await db.execute(select(Role).where(Role.name == "admin"))
            admin_role = admin_role.scalar_one_or_none()
            if admin_role:
                admin_user = User(
                    username="admin",
                    email="admin@netmon.local",
                    password_hash=hash_password("admin"),
                    role_id=admin_role.id,
                    is_active=True,
                    must_change_password=True,  # Force change on first login
                    auth_source="local",
                )
                db.add(admin_user)
                await db.commit()
                logger.info("Default admin user created (admin/admin) - MUST CHANGE PASSWORD ON FIRST LOGIN")

        # Default settings
        from app.models.settings import SystemSetting
        default_settings = [
            ("snmp_poll_interval", str(settings.SNMP_POLL_INTERVAL_SECONDS), "SNMP polling interval in seconds"),
            ("alert_eval_interval", "60", "Alert evaluation interval in seconds"),
            ("max_flow_age_days", "30", "Maximum age of flow records in days"),
            ("max_metric_age_days", "90", "Maximum age of interface metrics in days"),
        ]
        for key, value, desc in default_settings:
            existing = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
            if not existing.scalar_one_or_none():
                setting = SystemSetting(key=key, value=value, description=desc)
                db.add(setting)
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    await init_db()
    await create_default_data()

    # Start schedulers
    scheduler.add_job(
        scheduled_polling,
        "interval",
        seconds=settings.SNMP_POLL_INTERVAL_SECONDS,
        id="snmp_poll",
    )
    scheduler.add_job(
        scheduled_alerts,
        "interval",
        seconds=60,
        id="alert_eval",
    )
    scheduler.start()
    logger.info("Scheduled tasks started")

    # Start flow collector (NetFlow + sFlow UDP listeners)
    from app.database import AsyncSessionLocal
    flow_collector = FlowCollector(AsyncSessionLocal)
    collector_task = asyncio.create_task(flow_collector.start())
    logger.info("Flow collector started (NetFlow UDP:2055, sFlow UDP:6343)")

    yield

    # Shutdown
    flow_collector.stop()
    collector_task.cancel()
    try:
        await collector_task
    except asyncio.CancelledError:
        pass
    scheduler.shutdown()
    logger.info("NetMon Platform shutting down")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
origins = settings.ALLOWED_ORIGINS.split(",") if settings.ALLOWED_ORIGINS != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Security headers middleware
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if settings.HTTPS_ONLY:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# Routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(devices.router)
app.include_router(interfaces.router)
app.include_router(alerts.router)
app.include_router(flows.router)
app.include_router(settings_router.router)
app.include_router(blocks.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}


# Serve frontend static files in production
frontend_build = "/app/frontend/dist"
if os.path.exists(frontend_build):
    app.mount("/", StaticFiles(directory=frontend_build, html=True), name="frontend")
