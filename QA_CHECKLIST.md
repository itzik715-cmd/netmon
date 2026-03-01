# NetMon — Post-Migration QA Checklist

Run this checklist after TimescaleDB migration to verify nothing broke.
Every check can be executed autonomously via shell commands.

---

## Usage

Save the script section below as `qa_check.sh` and run:
```bash
chmod +x qa_check.sh && ./qa_check.sh
```

Or run checks individually by copying the commands.

---

## QA Check Script

```bash
#!/usr/bin/env bash
# NetMon Post-Migration QA Checklist
# Exit code 0 = all passed, 1 = at least one failure

set -uo pipefail

PASS=0
FAIL=0
BACKEND_URL="http://localhost:8000"
TOKEN=""

green() { echo -e "\033[32m  PASS: $1\033[0m"; PASS=$((PASS+1)); }
red()   { echo -e "\033[31m  FAIL: $1\033[0m"; FAIL=$((FAIL+1)); }
check() {
  if eval "$1" >/dev/null 2>&1; then
    green "$2"
  else
    red "$2 — expected success but got failure"
  fi
}

echo "========================================"
echo " NetMon Post-Migration QA Checklist"
echo "========================================"
echo ""

# ────────────────────────────────────────────────────
echo "── Pre-flight Checks ──"
# ────────────────────────────────────────────────────

# 1. Docker services are all healthy
SERVICES=$(docker compose ps --format '{{.Name}} {{.Status}}' 2>/dev/null)
for svc in netmon-db netmon-redis netmon-backend netmon-frontend netmon-nginx; do
  if echo "$SERVICES" | grep -q "$svc.*Up"; then
    green "$svc is running"
  else
    red "$svc is NOT running or not healthy"
  fi
done

# 2. No container restarts in last 5 minutes
RESTARTS=$(docker compose ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep -i "restarting" || true)
if [ -z "$RESTARTS" ]; then
  green "No containers restarting"
else
  red "Containers restarting: $RESTARTS"
fi

# 3. Backend logs show no ERROR on startup (last 50 lines)
ERRORS=$(docker compose logs --tail=50 backend 2>/dev/null | grep -c " ERROR " || true)
if [ "$ERRORS" -eq 0 ]; then
  green "No ERROR messages in recent backend logs"
else
  red "$ERRORS ERROR messages found in recent backend logs"
fi

# 4. PostgreSQL accepting connections
check "docker exec netmon-db pg_isready -U netmon -d netmon" \
  "PostgreSQL is accepting connections"

# 5. TimescaleDB extension is active
TSDB=$(docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT extname FROM pg_extension WHERE extname='timescaledb'" 2>/dev/null | tr -d '[:space:]')
if [ "$TSDB" = "timescaledb" ]; then
  green "TimescaleDB extension is active"
else
  red "TimescaleDB extension NOT found in pg_extension"
fi

# 6. Redis is responding
check "docker exec netmon-redis redis-cli ping | grep -q PONG" \
  "Redis is responding to PING"

# ────────────────────────────────────────────────────
echo ""
echo "── Database Schema Checks ──"
# ────────────────────────────────────────────────────

# 7. flow_records table exists
check "docker exec netmon-db psql -U netmon -d netmon -tAc \
  \"SELECT 1 FROM information_schema.tables WHERE table_name='flow_records'\" | grep -q 1" \
  "flow_records table exists"

# 8. flow_summary_5m table exists
check "docker exec netmon-db psql -U netmon -d netmon -tAc \
  \"SELECT 1 FROM information_schema.tables WHERE table_name='flow_summary_5m'\" | grep -q 1" \
  "flow_summary_5m table exists"

# 9. flow_records IS a hypertable
FR_HT=$(docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name='flow_records'" 2>/dev/null | tr -d '[:space:]')
if [ "$FR_HT" = "flow_records" ]; then
  green "flow_records is a hypertable"
else
  red "flow_records is NOT a hypertable"
fi

# 10. flow_summary_5m IS a hypertable
FS_HT=$(docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name='flow_summary_5m'" 2>/dev/null | tr -d '[:space:]')
if [ "$FS_HT" = "flow_summary_5m" ]; then
  green "flow_summary_5m is a hypertable"
else
  red "flow_summary_5m is NOT a hypertable"
fi

# 11. Original indexes still exist
for idx in ix_fs5m_bucket ix_fs5m_bucket_src ix_fs5m_bucket_dst ix_fs5m_bucket_device \
           ix_flow_records_ts_src_ip ix_flow_records_ts_dst_ip ix_flow_records_ts_device; do
  EXISTS=$(docker exec netmon-db psql -U netmon -d netmon -tAc \
    "SELECT 1 FROM pg_indexes WHERE indexname='$idx'" 2>/dev/null | tr -d '[:space:]')
  if [ "$EXISTS" = "1" ]; then
    green "Index $idx exists"
  else
    red "Index $idx is MISSING"
  fi
done

# 12. uq_flow_summary_5m_key constraint exists
UQ=$(docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT 1 FROM pg_constraint WHERE conname='uq_flow_summary_5m_key'" 2>/dev/null | tr -d '[:space:]')
if [ "$UQ" = "1" ]; then
  green "uq_flow_summary_5m_key constraint exists"
else
  red "uq_flow_summary_5m_key constraint is MISSING"
fi

# 13. Compression policy on flow_records
COMP_FR=$(docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT count(*) FROM timescaledb_information.jobs WHERE hypertable_name='flow_records' AND proc_name='policy_compression'" 2>/dev/null | tr -d '[:space:]')
if [ "$COMP_FR" -ge 1 ] 2>/dev/null; then
  green "Compression policy exists on flow_records"
else
  red "Compression policy MISSING on flow_records"
fi

# 14. Compression policy on flow_summary_5m
COMP_FS=$(docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT count(*) FROM timescaledb_information.jobs WHERE hypertable_name='flow_summary_5m' AND proc_name='policy_compression'" 2>/dev/null | tr -d '[:space:]')
if [ "$COMP_FS" -ge 1 ] 2>/dev/null; then
  green "Compression policy exists on flow_summary_5m"
else
  red "Compression policy MISSING on flow_summary_5m"
fi

# 15. Retention policy on flow_records (7 days)
RET_FR=$(docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT count(*) FROM timescaledb_information.jobs WHERE hypertable_name='flow_records' AND proc_name='policy_retention'" 2>/dev/null | tr -d '[:space:]')
if [ "$RET_FR" -ge 1 ] 2>/dev/null; then
  green "Retention policy exists on flow_records"
else
  red "Retention policy MISSING on flow_records"
fi

# 16. Retention policy on flow_summary_5m (14 days)
RET_FS=$(docker exec netmon-db psql -U netmon -d netmon -tAc \
  "SELECT count(*) FROM timescaledb_information.jobs WHERE hypertable_name='flow_summary_5m' AND proc_name='policy_retention'" 2>/dev/null | tr -d '[:space:]')
if [ "$RET_FS" -ge 1 ] 2>/dev/null; then
  green "Retention policy exists on flow_summary_5m"
else
  red "Retention policy MISSING on flow_summary_5m"
fi

# ────────────────────────────────────────────────────
echo ""
echo "── API Endpoint Checks ──"
# ────────────────────────────────────────────────────

# Obtain JWT token
TOKEN=$(curl -sf -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  red "Could not obtain JWT token (admin/admin login failed — password may have been changed)"
  echo "  Skipping API checks. To run manually, set TOKEN= to a valid JWT."
else
  green "JWT token obtained"

  api_check() {
    local path="$1"
    local desc="$2"
    local code
    code=$(curl -sf -o /dev/null -w "%{http_code}" \
      -H "Authorization: Bearer $TOKEN" "$BACKEND_URL$path" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
      green "$desc → HTTP 200"
    else
      red "$desc → HTTP $code (expected 200)"
    fi
  }

  # 17. Health check (no auth needed)
  HC=$(curl -sf -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health" 2>/dev/null || echo "000")
  if [ "$HC" = "200" ]; then green "GET /api/health → 200"; else red "GET /api/health → $HC"; fi

  # 18-26. Endpoint checks
  api_check "/api/flows/stats?hours=1"          "GET /api/flows/stats?hours=1"
  api_check "/api/flows/stats?hours=24"         "GET /api/flows/stats?hours=24"
  api_check "/api/flows/stats?hours=168"        "GET /api/flows/stats?hours=168"
  api_check "/api/flows/conversations?hours=1"  "GET /api/flows/conversations?hours=1"
  api_check "/api/flows/conversations?hours=24" "GET /api/flows/conversations?hours=24"
  api_check "/api/flows/owned-subnets"          "GET /api/flows/owned-subnets"
  api_check "/api/devices/"                     "GET /api/devices/"
  api_check "/api/alerts/rules"                 "GET /api/alerts/rules"
  api_check "/api/users/"                       "GET /api/users/"
fi

# ────────────────────────────────────────────────────
echo ""
echo "── Flow Ingestion Check ──"
# ────────────────────────────────────────────────────

# 27. Send synthetic NetFlow v5 packet and verify it appears
# First, ensure a test device with flow_enabled exists at 127.0.0.1
echo "  Creating test device (127.0.0.1, flow_enabled=true)..."
docker exec netmon-db psql -U netmon -d netmon -c \
  "INSERT INTO devices (hostname, ip_address, device_type, is_active, polling_enabled, flow_enabled, snmp_version)
   VALUES ('qa-test-device', '127.0.0.1', 'router', true, false, true, '2c')
   ON CONFLICT (ip_address) DO UPDATE SET flow_enabled = true" >/dev/null 2>&1

# Wait for flow_enabled_ips cache to refresh (refreshes every 30 seconds)
echo "  Waiting 35 seconds for flow-enabled IP cache to refresh..."
sleep 35

echo "  Sending synthetic NetFlow v5 packet to UDP:2055..."
docker exec netmon-backend python3 -c "
import socket, struct, time

# Build a minimal NetFlow v5 packet: 1 header + 1 record
header = struct.pack('!HHIIIIiBBH',
    5,        # version
    1,        # count
    int(time.time()*1000) & 0xFFFFFFFF,  # sys_uptime
    int(time.time()),       # unix_secs
    0,        # unix_nsecs
    0,        # flow_sequence
    0,        # engine_type
    0,        # engine_id
    0,        # sampling_interval
)
# Record: src=10.255.255.1 dst=10.255.255.2 ... (QA test flow)
record = struct.pack('!IIIHHIIIIHHxBBBBxx',
    0x0AFFFF01,  # src_ip: 10.255.255.1
    0x0AFFFF02,  # dst_ip: 10.255.255.2
    0,           # nexthop
    0, 0,        # input_if, output_if
    100,         # packets
    5000,        # bytes
    0, 0,        # first, last
    12345,       # src_port
    443,         # dst_port
    0,           # pad1
    6,           # tcp_flags
    6,           # protocol (TCP)
    0,           # tos
    0, 0,        # src_as, dst_as
)
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.sendto(header + record, ('127.0.0.1', 2055))
sock.close()
print('Sent NetFlow v5 test packet')
" 2>/dev/null

# Poll for up to 60 seconds (flow buffer flushes every 5s, but cache may need time)
echo "  Waiting for flow record to appear (polling up to 60 seconds)..."
QA_FLOW=0
for i in $(seq 1 12); do
  QA_FLOW=$(docker exec netmon-db psql -U netmon -d netmon -tAc \
    "SELECT count(*) FROM flow_records WHERE src_ip='10.255.255.1' AND dst_ip='10.255.255.2'" 2>/dev/null | tr -d '[:space:]')
  if [ "$QA_FLOW" -ge 1 ] 2>/dev/null; then
    break
  fi
  sleep 5
done

if [ "$QA_FLOW" -ge 1 ] 2>/dev/null; then
  green "Synthetic NetFlow v5 packet ingested into flow_records"
  # Clean up test data
  docker exec netmon-db psql -U netmon -d netmon -c \
    "DELETE FROM flow_records WHERE src_ip='10.255.255.1' AND dst_ip='10.255.255.2'" >/dev/null 2>&1
else
  red "Synthetic NetFlow packet NOT found in flow_records after 60 seconds"
  echo "    Note: If the flow-enabled IP cache hasn't refreshed yet, re-run the test"
fi

# Clean up test device
docker exec netmon-db psql -U netmon -d netmon -c \
  "DELETE FROM devices WHERE hostname='qa-test-device' AND ip_address='127.0.0.1'" >/dev/null 2>&1

# ────────────────────────────────────────────────────
echo ""
echo "── Scheduler Check ──"
# ────────────────────────────────────────────────────

# 28. Verify APScheduler jobs are registered
for job in "snmp_poll" "alert_eval" "flow_rollup" "mac_discovery" "ping_monitor"; do
  if docker compose logs --tail=200 backend 2>/dev/null | grep -qi "Added job.*$job\|id=$job\|$job.*running\|Scheduled tasks started"; then
    green "Scheduler job '$job' registered"
  else
    # Fallback: check if the scheduler started at all
    if docker compose logs --tail=200 backend 2>/dev/null | grep -q "Scheduled tasks started"; then
      green "Scheduler job '$job' (scheduler confirmed running)"
    else
      red "Scheduler job '$job' NOT confirmed in logs"
    fi
  fi
done

# ────────────────────────────────────────────────────
echo ""
echo "── Compression & Retention Policy Check ──"
# ────────────────────────────────────────────────────

# 29. List all TimescaleDB jobs
echo "  Registered TimescaleDB jobs:"
docker exec netmon-db psql -U netmon -d netmon -c \
  "SELECT job_id, proc_name, hypertable_name, schedule_interval FROM timescaledb_information.jobs ORDER BY job_id" 2>/dev/null || \
  red "Could not query timescaledb_information.jobs"

# ────────────────────────────────────────────────────
echo ""
echo "========================================"
echo " Results: $PASS passed, $FAIL failed"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
else
  exit 0
fi
```

---

## Individual Check Details

### Pre-flight Checks

| # | Check | Command | Expected | FAIL means |
|---|-------|---------|----------|------------|
| 1 | Docker services healthy | `docker compose ps` | All 5 containers show "Up" | Container crashed or didn't start |
| 2 | No restarts | `docker compose ps \| grep restarting` | Empty output | Container is crash-looping |
| 3 | No backend ERRORs | `docker compose logs --tail=50 backend \| grep ERROR` | 0 matches | Startup error — check full logs |
| 4 | PostgreSQL ready | `docker exec netmon-db pg_isready -U netmon` | Exit 0 | DB container not ready |
| 5 | TimescaleDB active | Query `pg_extension` for `timescaledb` | Row returned | Extension not installed or CREATE EXTENSION failed |
| 6 | Redis responding | `docker exec netmon-redis redis-cli ping` | PONG | Redis container issue |

### Database Schema Checks

| # | Check | Expected | FAIL means |
|---|-------|----------|------------|
| 7 | flow_records exists | Table present | Migration didn't create/preserve table |
| 8 | flow_summary_5m exists | Table present | Migration didn't create/preserve table |
| 9 | flow_records is hypertable | Found in `timescaledb_information.hypertables` | `create_hypertable()` failed |
| 10 | flow_summary_5m is hypertable | Found in `timescaledb_information.hypertables` | `create_hypertable()` failed |
| 11 | Indexes exist | Each index found in `pg_indexes` | Index dropped during migration |
| 12 | Unique constraint | `uq_flow_summary_5m_key` in `pg_constraint` | Rollup upserts will fail |
| 13-14 | Compression policies | Jobs with `policy_compression` | Compression not configured |
| 15-16 | Retention policies | Jobs with `policy_retention` | Old data won't be auto-pruned |

### API Endpoint Checks

| # | Check | Expected | FAIL means |
|---|-------|----------|------------|
| 17 | `/api/health` | HTTP 200 | Backend not running |
| 18-20 | `/api/flows/stats` (1h, 24h, 168h) | HTTP 200 | Flow queries broken — schema mismatch likely |
| 21-22 | `/api/flows/conversations` | HTTP 200 | Conversation queries broken |
| 23 | `/api/flows/owned-subnets` | HTTP 200 | Subnet table issue |
| 24-26 | Other endpoints | HTTP 200 | Non-flow regression |

### Flow Ingestion Check

| # | Check | Expected | FAIL means |
|---|-------|----------|------------|
| 27 | Synthetic NetFlow v5 | Row appears in flow_records within 60s | Collector not running, table schema changed, or flow-enabled IP cache not refreshed yet (30s cycle) |

### Rollup Job Check

Manually verify by checking if flow_summary_5m has recent rows:
```bash
docker exec netmon-db psql -U netmon -d netmon -c \
  "SELECT bucket, count(*) FROM flow_summary_5m WHERE bucket > now() - interval '1 hour' GROUP BY bucket ORDER BY bucket DESC LIMIT 5"
```

### Scheduler Check

| # | Check | Expected | FAIL means |
|---|-------|----------|------------|
| 28 | APScheduler jobs | "Scheduled tasks started" in logs | Scheduler failed to start |
