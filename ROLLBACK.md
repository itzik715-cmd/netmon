# NetMon — TimescaleDB Migration Rollback Procedure

How to revert from TimescaleDB back to plain PostgreSQL if the migration fails or causes issues.

---

> **BEFORE YOU MIGRATE — Take a backup first!**
>
> ```bash
> docker exec netmon-db pg_dump -U netmon -Fc netmon > /root/netmon_pre_tsdb_$(date +%Y%m%d_%H%M%S).dump
> ```
>
> This is your safety net. Without it, Option B (restore from backup) is not possible.

---

## When to Rollback

Rollback if **any** of the following occur after the TimescaleDB migration:

- Backend fails to start (container in restart loop)
- `flow_records` or `flow_summary_5m` queries return errors
- Flow ingestion stops (no new rows appearing)
- Rollup job (`scheduled_flow_rollup`) fails with SQL errors
- QA checklist (`qa_check.sh`) reports critical failures
- Performance regression — flow queries significantly slower than before
- TimescaleDB compression jobs causing excessive I/O or lock contention

---

## Prerequisites

- SSH access to the server (`ssh root@<server-ip>`)
- The pre-migration backup file (if using Option B)
- The git history has the pre-migration versions of all modified files
- Approximately 10 minutes of downtime

---

## Step 1: Stop the Stack

```bash
cd /root/netmon
docker compose down
```

This stops all 5 containers (db, redis, backend, frontend, nginx). The PostgreSQL data volume is preserved.

---

## Step 2: Revert File Changes

Revert the files that were modified during the TimescaleDB migration back to their pre-migration state.

### Option A: Git Revert (if changes were committed)

```bash
cd /root/netmon

# Find the last pre-migration commit
git log --oneline -20

# Revert to the commit before the migration
# Replace <PRE_MIGRATION_COMMIT> with the actual hash
git checkout <PRE_MIGRATION_COMMIT> -- \
  docker-compose.yml \
  scripts/init.sql \
  backend/app/main.py \
  backend/app/services/flow_rollup.py \
  backend/requirements.txt
```

### Option B: Manual Revert (if not in git)

The key files that a TimescaleDB migration would modify:

**`docker-compose.yml`** — Revert the `db` service image from `timescale/timescaledb:latest-pg16` back to `postgres:16-alpine`:

```yaml
  db:
    image: postgres:16-alpine
```

**`scripts/init.sql`** — Remove any TimescaleDB-specific lines. The original file is minimal:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
SELECT 'NetMon DB initialized' AS status;
```

Remove these lines if they were added:
```sql
-- REMOVE these:
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable(...);
SELECT add_compression_policy(...);
SELECT add_retention_policy(...);
ALTER TABLE ... SET (timescaledb.compress, ...);
```

**`backend/app/main.py`** — In the `run_migrations()` function, remove any TimescaleDB hypertable creation, compression policy, or retention policy SQL. The original migration code uses only plain `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN`.

**`backend/app/services/flow_rollup.py`** — Revert any changes to `rollup_flows()` or `backfill_summaries()`. The original uses standard `INSERT ... ON CONFLICT DO UPDATE` with no TimescaleDB-specific syntax.

**`backend/requirements.txt`** — Remove `psycopg2-binary` or any TimescaleDB-specific Python packages if they were added. The original uses `asyncpg==0.29.0` only.

---

## Step 3: Handle the Data Volume

The PostgreSQL data volume (`postgres_data`) still contains a TimescaleDB-format database. You have two options:

### Option A: Clean Start (lose flow history, keep everything else)

This drops only the flow tables and lets the application recreate them as plain PostgreSQL tables on startup.

```bash
# Start only the database with the plain postgres image
docker compose up -d db

# Wait for it to be ready
sleep 5
docker exec netmon-db pg_isready -U netmon -d netmon

# Drop TimescaleDB extension and flow tables
docker exec netmon-db psql -U netmon -d netmon <<'SQL'
-- Drop flow tables (they have TimescaleDB hypertable metadata)
DROP TABLE IF EXISTS flow_records CASCADE;
DROP TABLE IF EXISTS flow_summary_5m CASCADE;

-- Drop TimescaleDB extension
DROP EXTENSION IF EXISTS timescaledb CASCADE;

-- Verify extension is gone
SELECT extname FROM pg_extension;
SQL

# Start everything — backend will recreate flow tables on startup
docker compose up -d --build backend frontend nginx
```

**What you lose:** All flow_records and flow_summary_5m data.
**What you keep:** All other 30 tables (devices, interfaces, alerts, MACs, etc.) are untouched.

### Option B: Restore from Pre-Migration Backup (recommended if you have the backup)

This restores the entire database to the exact state before the migration.

```bash
# Start only the database with the plain postgres image
docker compose up -d db
sleep 5

# Drop and recreate the database
docker exec netmon-db psql -U netmon -d postgres -c "DROP DATABASE netmon"
docker exec netmon-db psql -U netmon -d postgres -c "CREATE DATABASE netmon OWNER netmon"

# Restore from backup
docker cp /root/netmon_pre_tsdb_*.dump netmon-db:/tmp/backup.dump
docker exec netmon-db pg_restore -U netmon -d netmon --no-owner --no-privileges /tmp/backup.dump

# Clean up
docker exec netmon-db rm /tmp/backup.dump

# Start everything
docker compose up -d --build backend frontend nginx
```

**What you lose:** Nothing — full restore to pre-migration state.
**What you keep:** All data exactly as it was before the migration.

---

## Step 4: Verify Rollback Succeeded

Run these checks to confirm the system is back to normal:

```bash
# 1. All containers are up
docker compose ps

# 2. No TimescaleDB extension
docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT count(*) FROM pg_extension WHERE extname='timescaledb'"
# Expected: 0

# 3. flow_records is a PLAIN table (not a hypertable)
docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_name='flow_records'"
# Expected: 1

# 4. Backend health check passes
curl -sf http://localhost:8000/api/health
# Expected: HTTP 200

# 5. Flow stats endpoint works
TOKEN=$(curl -sf -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sf -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/flows/stats?hours=1"
# Expected: HTTP 200 with JSON response

# 6. No errors in backend logs
docker compose logs --tail=30 backend | grep -i error

# 7. Verify all 32 tables exist
docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
# Expected: 32
```

---

## Step 5: Post-Rollback Notes

### Flow Data Gap
If you used Option A (clean start), there will be a gap in flow data history. New flows will start accumulating immediately after the backend starts. The `flow_summary_5m` table will begin populating after the first rollup cycle (5 minutes).

### Application-Level Retention Resumes
The application's `scheduled_cleanup` job (every 6 hours) handles data retention via `DELETE FROM ... WHERE timestamp < cutoff`. This continues to work on plain PostgreSQL with no changes needed. Current retention settings:
- `flow_records`: configurable via `max_flow_age_days` (default 30 days)
- `flow_summary_5m`: same setting as flow_records
- `interface_metrics` / `device_metric_history`: configurable via `max_metric_age_days` (default 90 days)

### Re-Attempting Migration Later
If you want to try the migration again later:
1. Take a fresh backup first
2. Review what went wrong the first time
3. Consider testing on a staging copy first
4. Follow the migration procedure again from the beginning

### If Both Options Fail
As a last resort, you can reset the entire database:

```bash
docker compose down
docker volume rm netmon_postgres_data
docker compose up -d
```

**This destroys ALL data** — devices, users, alerts, everything. The application will recreate all tables and the default admin account on startup. Only use this if no backup exists and the database is unrecoverable.
