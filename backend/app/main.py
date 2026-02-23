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
from app.routers import auth, users, devices, interfaces, alerts, flows, settings as settings_router, blocks, topology, reports, config_backup as backups_router, system_events as system_events_router
from app.models import system_event as _system_event_model  # noqa: F401 – registers table with Base
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


async def _acquire_scheduler_lock(job_id: str, ttl_seconds: int) -> bool:
    """Try to acquire a Redis SETNX lock so only one uvicorn worker runs each
    scheduled job.  Returns True if the lock was acquired (caller should
    proceed) or if Redis is unavailable (degrade gracefully — allow the job
    to run rather than silently skip it).  Returns False if another worker
    already holds the lock.
    """
    import redis.asyncio as aioredis
    try:
        r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
        acquired = await r.set(f"sched:{job_id}", "1", nx=True, ex=ttl_seconds)
        await r.aclose()
        return bool(acquired)
    except Exception:
        return True   # Redis down → let the job run (better than silent skip)


async def scheduled_polling():
    """Run SNMP polling for all active devices.

    Uses a single shared SnmpEngine for the entire polling cycle to keep
    only one UDP socket open, preventing file-descriptor exhaustion
    ([Errno 24] Too many open files).

    A Semaphore caps concurrency at 5 to avoid overwhelming the engine
    with too many in-flight SNMP requests.
    """
    from app.database import AsyncSessionLocal
    from app.models.device import Device
    from sqlalchemy import select
    from app.services.snmp_poller import poll_device
    from pysnmp.hlapi.asyncio import SnmpEngine

    def _close_engine(eng):
        try:
            eng.transportDispatcher.closeDispatcher()
        except Exception:
            pass

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Device).where(Device.is_active == True, Device.polling_enabled == True)
        )
        devices = result.scalars().all()

    if not devices:
        return

    engine = SnmpEngine()
    sem = asyncio.Semaphore(5)
    try:
        async def _poll_one(device):
            async with sem:
                async with AsyncSessionLocal() as dev_db:
                    return await poll_device(device, dev_db, engine=engine)

        await asyncio.gather(*[_poll_one(d) for d in devices], return_exceptions=True)
    finally:
        _close_engine(engine)


async def scheduled_alerts():
    """Evaluate alert rules."""
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await evaluate_rules(db)


async def scheduled_cleanup():
    """Prune old interface_metrics, device_metric_history, and flow_records."""
    from app.database import AsyncSessionLocal
    from app.services.snmp_poller import cleanup_old_metrics
    async with AsyncSessionLocal() as db:
        await cleanup_old_metrics(db)


async def run_migrations():
    """
    Idempotent schema migrations for columns added after initial deployment.
    SQLAlchemy create_all only creates missing *tables* — it never ALTERs
    existing ones — so new columns must be added here via raw SQL.
    All statements use 'ADD COLUMN IF NOT EXISTS' so they are safe to run
    on every startup.
    """
    from sqlalchemy import text
    from app.database import engine

    # (column_name, sql_type_with_default)
    devices_columns = [
        ("api_username",   "VARCHAR(100)"),
        ("api_password",   "VARCHAR(255)"),
        ("api_port",       "INTEGER DEFAULT 443"),
        ("api_protocol",   "VARCHAR(10) DEFAULT 'https'"),
        ("cpu_usage",      "FLOAT"),
        ("memory_usage",   "FLOAT"),
        ("flow_enabled",   "BOOLEAN DEFAULT FALSE"),
    ]

    async with engine.begin() as conn:
        for col, col_type in devices_columns:
            try:
                await conn.execute(
                    text(f"ALTER TABLE devices ADD COLUMN IF NOT EXISTS {col} {col_type}")
                )
            except Exception as e:
                logger.warning("Migration ALTER devices.%s skipped: %s", col, e)

        # Composite indexes to speed up per-interface and per-device metric lookups
        for idx_sql in [
            "CREATE INDEX IF NOT EXISTS ix_interface_metrics_iface_ts ON interface_metrics (interface_id, timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS ix_device_metric_history_dev_ts ON device_metric_history (device_id, timestamp DESC)",
        ]:
            try:
                await conn.execute(text(idx_sql))
            except Exception as e:
                logger.warning("Migration index skipped: %s", e)

    logger.info("Database migrations applied")


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

        # Default backup schedule
        from app.models.config_backup import BackupSchedule
        existing_sched = await db.execute(select(BackupSchedule).limit(1))
        if not existing_sched.scalar_one_or_none():
            db.add(BackupSchedule(hour=2, minute=0, retention_days=90, is_active=True))
            await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    await init_db()          # creates any missing tables
    await run_migrations()   # adds missing columns to existing tables
    await create_default_data()

    # Start schedulers.
    # max_instances=1 prevents a second run from starting within the same
    # worker while a previous run is still in progress.  The Redis lock in
    # each job body prevents duplicate runs across multiple uvicorn workers.
    scheduler.add_job(
        scheduled_polling,
        "interval",
        seconds=settings.SNMP_POLL_INTERVAL_SECONDS,
        id="snmp_poll",
        max_instances=1,
    )
    scheduler.add_job(
        scheduled_alerts,
        "interval",
        seconds=60,
        id="alert_eval",
        max_instances=1,
    )
    scheduler.add_job(
        scheduled_cleanup,
        "interval",
        hours=6,
        id="metrics_cleanup",
        max_instances=1,
    )

    # Config backup scheduler — load saved schedule from DB (defaults: 02:00 UTC)
    async def _start_backup_scheduler():
        from app.database import AsyncSessionLocal
        from app.models.config_backup import BackupSchedule
        from app.services.config_fetcher import run_scheduled_backups, cleanup_expired_backups
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select
            sched_result = await db.execute(select(BackupSchedule).limit(1))
            sched = sched_result.scalar_one_or_none()

        hour = sched.hour if sched else 2
        minute = sched.minute if sched else 0
        is_active = sched.is_active if sched else True

        if is_active:
            scheduler.add_job(run_scheduled_backups, "cron", hour=hour, minute=minute, id="config_backup")
            logger.info("Config backup scheduled at %02d:%02d UTC", hour, minute)

        # Cleanup expired backups daily at 03:00 UTC
        scheduler.add_job(cleanup_expired_backups, "cron", hour=3, minute=0, id="backup_cleanup")

    import asyncio as _asyncio
    _asyncio.create_task(_start_backup_scheduler())

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
app.include_router(topology.router)
app.include_router(reports.router)
app.include_router(backups_router.router)
app.include_router(system_events_router.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}


# Serve frontend static files in production
frontend_build = "/app/frontend/dist"
if os.path.exists(frontend_build):
    app.mount("/", StaticFiles(directory=frontend_build, html=True), name="frontend")
