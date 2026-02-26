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
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.extensions import limiter
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.config import settings
from app.database import init_db
from app.routers import auth, users, devices, interfaces, alerts, flows, settings as settings_router, blocks, topology, reports, config_backup as backups_router, system_events as system_events_router, server_management
from app.models import system_event as _system_event_model  # noqa: F401 – registers table with Base
from app.models.owned_subnet import OwnedSubnet as _owned_subnet_model  # noqa: F401
from app.models.flow import FlowSummary5m as _flow_summary_model  # noqa: F401
from app.services.alert_engine import evaluate_rules
from app.services.flow_collector import FlowCollector
import os

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


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

    Polls devices sequentially, each with its own short-lived SnmpEngine.
    This avoids pysnmp's internal concurrency issues while keeping file
    descriptor usage bounded (only 1 engine/socket open at a time).
    """
    from app.database import AsyncSessionLocal
    from app.models.device import Device
    from sqlalchemy import select
    from app.services.snmp_poller import poll_device

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Device).where(Device.is_active == True, Device.polling_enabled == True)
        )
        devices = result.scalars().all()

    if not devices:
        return

    for device in devices:
        try:
            async with AsyncSessionLocal() as dev_db:
                await poll_device(device, dev_db)
        except Exception as e:
            logger.warning("Error polling %s: %s", device.hostname, e)


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


async def scheduled_flow_rollup():
    """Roll up raw flow_records into 5-minute summary buckets."""
    if not await _acquire_scheduler_lock("flow_rollup", ttl_seconds=270):
        return
    from app.database import AsyncSessionLocal
    from app.services.flow_rollup import rollup_flows
    async with AsyncSessionLocal() as db:
        await rollup_flows(db)


async def scheduled_block_sync():
    """Sync null-route and flowspec blocks from all spine devices with eAPI credentials."""
    from app.database import AsyncSessionLocal
    from app.models.device import Device
    from sqlalchemy import select
    from app.services.arista_api import sync_device_blocks

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Device).where(
                Device.is_active == True,
                Device.device_type == "spine",
                Device.api_username.isnot(None),
            )
        )
        spines = result.scalars().all()

    if not spines:
        return

    for spine in spines:
        try:
            async with AsyncSessionLocal() as db:
                counts = await sync_device_blocks(spine, db)
                total = counts.get("total_active", 0)
                if total > 0:
                    logger.info("Block sync %s: %d null routes, %d flowspec",
                                spine.hostname, counts.get("null_routes_synced", 0),
                                counts.get("flowspec_synced", 0))
        except Exception as e:
            logger.warning("Block sync failed for %s: %s", spine.hostname, e)


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

    interfaces_columns = [
        ("is_wan",  "BOOLEAN DEFAULT FALSE"),
    ]

    # device_locations new columns
    location_columns = [
        ("datacenter", "VARCHAR(50)"),
        ("rack",       "VARCHAR(50)"),
    ]

    async with engine.begin() as conn:
        for col, col_type in devices_columns:
            try:
                await conn.execute(
                    text(f"ALTER TABLE devices ADD COLUMN IF NOT EXISTS {col} {col_type}")
                )
            except Exception as e:
                logger.warning("Migration ALTER devices.%s skipped: %s", col, e)

        for col, col_type in interfaces_columns:
            try:
                await conn.execute(
                    text(f"ALTER TABLE interfaces ADD COLUMN IF NOT EXISTS {col} {col_type}")
                )
            except Exception as e:
                logger.warning("Migration ALTER interfaces.%s skipped: %s", col, e)

        # Composite indexes to speed up per-interface and per-device metric lookups
        for idx_sql in [
            "CREATE INDEX IF NOT EXISTS ix_interface_metrics_iface_ts ON interface_metrics (interface_id, timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS ix_device_metric_history_dev_ts ON device_metric_history (device_id, timestamp DESC)",
        ]:
            try:
                await conn.execute(text(idx_sql))
            except Exception as e:
                logger.warning("Migration index skipped: %s", e)

    # device_locations migrations — separate transaction to avoid aborting the above
    async with engine.begin() as conn:
        for col, col_type in location_columns:
            try:
                await conn.execute(
                    text(f"ALTER TABLE device_locations ADD COLUMN IF NOT EXISTS {col} {col_type}")
                )
            except Exception as e:
                logger.warning("Migration ALTER device_locations.%s skipped: %s", col, e)

        # Backfill: parse existing name values to extract datacenter and rack
        try:
            await conn.execute(text(
                "UPDATE device_locations "
                "SET datacenter = split_part(name, '_', 1), "
                "    rack = CASE WHEN position('_' in name) > 0 "
                "                THEN substring(name from position('_' in name) + 1) "
                "                ELSE name END "
                "WHERE datacenter IS NULL"
            ))
        except Exception as e:
            logger.warning("Migration backfill datacenter/rack skipped: %s", e)

    # Unique constraint — separate transaction; use CREATE UNIQUE INDEX which supports IF NOT EXISTS
    async with engine.begin() as conn:
        try:
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_location_datacenter_rack "
                "ON device_locations (datacenter, rack)"
            ))
        except Exception as e:
            logger.warning("Migration unique index datacenter_rack skipped: %s", e)

    # backup_schedules: add device_id column for per-device schedules
    async with engine.begin() as conn:
        try:
            await conn.execute(text(
                "ALTER TABLE backup_schedules ADD COLUMN IF NOT EXISTS "
                "device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE"
            ))
        except Exception as e:
            logger.warning("Migration ALTER backup_schedules.device_id skipped: %s", e)

        # Drop the old unique constraint on device_id if it conflicts, and create a proper unique index
        try:
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_backup_schedule_device "
                "ON backup_schedules (device_id)"
            ))
        except Exception as e:
            logger.warning("Migration unique index backup_schedule_device skipped: %s", e)

    # config_backups: add changelog metadata columns
    async with engine.begin() as conn:
        for col, col_type in [
            ("triggered_by", "VARCHAR(100)"),
            ("notes", "TEXT"),
        ]:
            try:
                await conn.execute(
                    text(f"ALTER TABLE config_backups ADD COLUMN IF NOT EXISTS {col} {col_type}")
                )
            except Exception as e:
                logger.warning("Migration ALTER config_backups.%s skipped: %s", col, e)

    # flow_summary_5m table and composite indexes for flow queries
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS flow_summary_5m (
                id SERIAL PRIMARY KEY,
                bucket TIMESTAMPTZ NOT NULL,
                device_id INTEGER REFERENCES devices(id),
                src_ip VARCHAR(50) NOT NULL,
                dst_ip VARCHAR(50) NOT NULL,
                src_port INTEGER NOT NULL DEFAULT 0,
                dst_port INTEGER NOT NULL DEFAULT 0,
                protocol_name VARCHAR(20),
                application VARCHAR(100),
                bytes BIGINT DEFAULT 0,
                packets BIGINT DEFAULT 0,
                flow_count INTEGER DEFAULT 0
            )
        """))
        for idx_sql in [
            "CREATE INDEX IF NOT EXISTS ix_fs5m_bucket ON flow_summary_5m (bucket)",
            "CREATE INDEX IF NOT EXISTS ix_fs5m_bucket_src ON flow_summary_5m (bucket, src_ip)",
            "CREATE INDEX IF NOT EXISTS ix_fs5m_bucket_dst ON flow_summary_5m (bucket, dst_ip)",
            "CREATE INDEX IF NOT EXISTS ix_fs5m_bucket_device ON flow_summary_5m (bucket, device_id)",
            # Composite indexes on raw flow_records for faster short-range queries
            "CREATE INDEX IF NOT EXISTS ix_flow_records_ts_src_ip ON flow_records (timestamp, src_ip)",
            "CREATE INDEX IF NOT EXISTS ix_flow_records_ts_dst_ip ON flow_records (timestamp, dst_ip)",
            "CREATE INDEX IF NOT EXISTS ix_flow_records_ts_device ON flow_records (timestamp, device_id)",
        ]:
            try:
                await conn.execute(text(idx_sql))
            except Exception as e:
                logger.warning("Migration index skipped: %s", e)

    # Unique constraint for flow_summary_5m (idempotent upserts)
    async with engine.begin() as conn:
        try:
            await conn.execute(text(
                "ALTER TABLE flow_summary_5m ADD CONSTRAINT uq_flow_summary_5m_key "
                "UNIQUE (bucket, device_id, src_ip, dst_ip, src_port, dst_port, protocol_name, application)"
            ))
        except Exception:
            pass  # already exists

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

        # Create default admin user with random password
        existing_admin = await db.execute(select(User).where(User.username == "admin"))
        if not existing_admin.scalar_one_or_none():
            admin_role = await db.execute(select(Role).where(Role.name == "admin"))
            admin_role = admin_role.scalar_one_or_none()
            if admin_role:
                import secrets
                temp_password = secrets.token_urlsafe(16)
                admin_user = User(
                    username="admin",
                    email="admin@netmon.local",
                    password_hash=hash_password(temp_password),
                    role_id=admin_role.id,
                    is_active=True,
                    must_change_password=True,  # Force change on first login
                    auth_source="local",
                )
                db.add(admin_user)
                await db.commit()
                logger.warning("=" * 60)
                logger.warning("  DEFAULT ADMIN CREDENTIALS (first run only)")
                logger.warning("  Username: admin")
                logger.warning("  Password: %s", temp_password)
                logger.warning("  You MUST change this password on first login.")
                logger.warning("=" * 60)

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

        # Default alert rules — created once on fresh install
        from app.models.alert import AlertRule
        existing_rules = await db.execute(select(AlertRule).limit(1))
        if not existing_rules.scalar_one_or_none():
            default_rules = [
                AlertRule(
                    name="Device Down",
                    description="Alert when any device becomes unreachable",
                    metric="device_status",
                    condition="gt",
                    threshold=0.5,
                    severity="critical",
                    cooldown_minutes=5,
                    is_active=True,
                ),
                AlertRule(
                    name="High CPU Usage",
                    description="Alert when any device CPU exceeds 90%",
                    metric="cpu_usage",
                    condition="gt",
                    threshold=90.0,
                    severity="warning",
                    cooldown_minutes=15,
                    is_active=True,
                ),
                AlertRule(
                    name="Critical CPU Usage",
                    description="Alert when any device CPU exceeds 98%",
                    metric="cpu_usage",
                    condition="gt",
                    threshold=98.0,
                    severity="critical",
                    cooldown_minutes=10,
                    is_active=True,
                ),
                AlertRule(
                    name="High Memory Usage",
                    description="Alert when any device memory exceeds 90%",
                    metric="memory_usage",
                    condition="gt",
                    threshold=90.0,
                    severity="warning",
                    cooldown_minutes=15,
                    is_active=True,
                ),
                AlertRule(
                    name="Critical Memory Usage",
                    description="Alert when any device memory exceeds 95%",
                    metric="memory_usage",
                    condition="gt",
                    threshold=95.0,
                    severity="critical",
                    cooldown_minutes=10,
                    is_active=True,
                ),
            ]
            for rule in default_rules:
                db.add(rule)
            await db.commit()
            logger.info("Default alert rules created (5 rules)")

        # One-time backfill of flow_summary_5m from existing flow_records
        backfill_row = await db.execute(
            select(SystemSetting).where(SystemSetting.key == "flow_rollup_backfilled")
        )
        if not backfill_row.scalar_one_or_none():
            logger.info("Starting one-time flow summary backfill (this may take a few minutes)...")
            from app.services.flow_rollup import backfill_summaries
            await backfill_summaries(db, days=30)
            db.add(SystemSetting(
                key="flow_rollup_backfilled",
                value="true",
                description="Whether flow_summary_5m has been backfilled from historical data",
            ))
            await db.commit()
            logger.info("Flow summary backfill complete")


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
    scheduler.add_job(
        scheduled_block_sync,
        "interval",
        seconds=60,
        id="block_sync",
        max_instances=1,
    )

    # Flow summary rollup — every 5 minutes
    scheduler.add_job(
        scheduled_flow_rollup,
        "interval",
        seconds=300,
        id="flow_rollup",
        max_instances=1,
    )

    # Config backup scheduler — runs every minute, checks which schedules match
    from app.services.config_fetcher import run_scheduled_backups, cleanup_expired_backups
    scheduler.add_job(
        run_scheduled_backups,
        "cron",
        minute="*",
        id="config_backup",
        max_instances=1,
    )
    logger.info("Config backup checker registered (runs every minute, matches per-device schedules)")

    # Cleanup expired backups daily at 03:00 UTC
    scheduler.add_job(cleanup_expired_backups, "cron", hour=3, minute=0, id="backup_cleanup")

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


# Request ID middleware for log correlation
@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    import uuid
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4())[:8])
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# CSRF Origin validation middleware
@app.middleware("http")
async def csrf_origin_check(request: Request, call_next):
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("origin")
        if origin:
            allowed = settings.ALLOWED_ORIGINS.split(",") if settings.ALLOWED_ORIGINS != "*" else []
            if allowed and origin not in allowed:
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": "Origin not allowed"},
                )
    return await call_next(request)


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
app.include_router(server_management.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}


# Serve frontend static files in production
frontend_build = "/app/frontend/dist"
if os.path.exists(frontend_build):
    app.mount("/", StaticFiles(directory=frontend_build, html=True), name="frontend")
