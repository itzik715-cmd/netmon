# NetMon Platform — Feature Inventory (Baseline)

Generated from source code analysis. This documents what exists TODAY before any migration.

---

## Flow Data Collection

### Collectors
- **NetFlow v5 collector** — `backend/app/services/flow_collector.py:NetFlowV5Parser`
  - Listens on UDP port **2055** (configurable via `NETFLOW_PORT` env var)
  - Parses NetFlow v5 header + records using `struct.unpack`
  - Extracts: src_ip, dst_ip, src_port, dst_port, protocol, packets, bytes, duration_ms, tcp_flags
  - Application detection via well-known port lookup (`PORT_APPS` dict)
- **sFlow v5 collector** — `backend/app/services/flow_collector.py:SFlowV5Parser`
  - Listens on UDP port **6343** (configurable via `SFLOW_PORT` env var)
  - Supports standard flow samples (fmt=1) and expanded flow samples (fmt=3)
  - Parses raw Ethernet headers → IPv4/IPv6 → TCP/UDP
  - Applies sampling rate multiplier to byte/packet counts
  - Counter samples (fmt=2,4) are received and silently skipped

### Buffer / Queue Architecture
- **Raw datagram queue**: bounded `asyncio.Queue(maxsize=8192)` per protocol
  - Back-pressure: when full, new datagrams are dropped (logged as warnings)
- **Parse workers**: 4 asyncio coroutines per protocol drain the queue
  - Parsing runs in a shared `ThreadPoolExecutor(max_workers=min(16, cpu_count*2))`
  - `struct.unpack` releases the GIL, enabling true parallelism
- **Write-behind buffer**: in-memory list, max 20,000 records
  - Flushed to database every **5 seconds** (`_FLUSH_INTERVAL`)
  - Overflow: oldest records dropped, warning logged at most every 60 seconds
- **Flow-enabled IP cache**: refreshed every 30 seconds from database
  - Datagrams from IPs not in the cache are dropped before parsing
  - Only devices with `flow_enabled=True` have their flows stored
- **SO_REUSEPORT**: UDP sockets use `SO_REUSEPORT` so multiple uvicorn workers share load

### Flow Storage
- Flows stored as `FlowRecord` rows in `flow_records` table
- Each record includes: device_id, timestamp, src/dst IP, src/dst port, protocol, protocol_name, bytes, packets, duration_ms, flow_direction, input/output interface, ToS, tcp_flags, src/dst AS, src/dst country, application, flow_type

---

## Flow Analysis Endpoints

All endpoints under `/api/flows/` (router: `backend/app/routers/flows.py`).

| Method | Path | Key Params | Data Source | Returns |
|--------|------|------------|-------------|---------|
| GET | `/api/flows/devices` | — | `devices` table | List of devices with `flow_enabled` flag |
| GET | `/api/flows/stats` | `hours`, `start`, `end`, `device_id`, `device_ids` | Raw (<6h) or Summary (≥6h) | Top talkers, protocols, applications, traffic totals, time-series |
| GET | `/api/flows/conversations` | `hours`, `start`, `end`, `device_id`, `device_ids`, `limit` | Raw (<6h) or Summary (≥6h) | Top conversations (src↔dst pairs) with bytes, packets, protocol |
| GET | `/api/flows/peer-detail` | `ip`, `peer`, `hours`, `start`, `end` | Raw (<6h) or Summary (≥6h) | Per-port breakdown of traffic between two IPs |
| GET | `/api/flows/ip-profile` | `ip`, `hours`, `start`, `end` | Raw (<6h) or Summary (≥6h) | Full profile of an IP: top peers, protocols, apps, geo, inbound/outbound bytes |
| GET | `/api/flows/ip-geo` | `ip` | In-memory lookup | Country code for an IP (using netaddr ranges) |
| GET | `/api/flows/owned-subnets` | — | `owned_subnets` table | List of all configured owned subnets |
| POST | `/api/flows/owned-subnets` | body: `{subnet, note}` | `owned_subnets` table | Creates owned subnet, auto-discovers from device routes if source="discovered" |
| POST | `/api/flows/owned-subnets/toggle` | body: `{subnet, is_active}` | `owned_subnets` table | Toggle subnet active/inactive |
| DELETE | `/api/flows/owned-subnets/{id}` | — | `owned_subnets` table | Delete owned subnet |

### Smart Data Source Routing
- Queries spanning **< 6 hours** use the raw `flow_records` table
- Queries spanning **≥ 6 hours** use the pre-aggregated `flow_summary_5m` table
- Redis caching with 60-second TTL is used for all flow query results (cache key includes params hash)

---

## Data Storage & Retention

### Database
- **PostgreSQL 16 Alpine** (vanilla — no extensions besides `uuid-ossp` and `pg_stat_statements`)
- Async driver: `asyncpg` 0.29.0 via SQLAlchemy 2.0.30
- Connection pool: `pool_size=10`, `max_overflow=20`, `pool_pre_ping=True`

### Tables (32 total)

| Table | Primary Content | Key Indexes |
|-------|----------------|-------------|
| `devices` | Network devices | PK, unique `ip_address` |
| `device_routes` | Routing tables | `device_id` |
| `device_blocks` | Null-route/flowspec blocks | `device_id` |
| `device_links` | LLDP topology links | `source_device_id`, `target_device_id` |
| `device_metric_history` | CPU/memory time-series | `(device_id, timestamp DESC)` |
| `device_locations` | Physical locations/racks | Unique `(datacenter, rack)` |
| `interfaces` | Network interfaces | PK |
| `interface_metrics` | Bandwidth/error time-series | `(interface_id, timestamp DESC)` |
| `flow_records` | Raw flow data | `(timestamp, src_ip)`, `(timestamp, dst_ip)`, `(timestamp, device_id)` |
| `flow_summary_5m` | 5-min aggregated flows | `(bucket)`, `(bucket, src_ip)`, `(bucket, dst_ip)`, `(bucket, device_id)`, unique key on `(bucket, device_id, src_ip, dst_ip, src_port, dst_port, protocol_name, application)` |
| `owned_subnets` | Owned network subnets | Unique `subnet` |
| `alert_rules` | Alert definitions | PK |
| `alert_events` | Alert occurrences | `triggered_at` |
| `wan_alert_rules` | WAN-specific alert rules | PK |
| `power_alert_rules` | Power-specific alert rules | PK |
| `users` | User accounts | Unique `username`, unique `email` |
| `roles` | RBAC roles | Unique `name` |
| `audit_logs` | User activity audit trail | `timestamp` |
| `system_settings` | Key-value config store | Unique `key` |
| `system_events` | System log events | `timestamp`, `level`, `source` |
| `config_backups` | Device config snapshots | `device_id`, `created_at`, `expires_at` |
| `backup_schedules` | Backup scheduling | Unique `device_id` |
| `mac_address_entries` | MAC table entries | Unique `(device_id, mac_address)`, `ip_address` |
| `device_environments` | Sensor current state | Unique `(device_id, sensor_name)` |
| `device_env_metrics` | Temp time-series | `(device_id, timestamp)` |
| `port_state_changes` | Port flap history | `(interface_id, changed_at)` |
| `device_vlans` | VLAN discovery | Unique `(device_id, vlan_id)` |
| `ping_metrics` | ICMP ping results | `(device_id, timestamp)` |
| `mlag_domains` | MLAG/vPC domain state | Unique `device_id` |
| `mlag_interfaces` | Per-MLAG interface status | `domain_id` |
| `pdu_metrics` | PDU power time-series | `(device_id, timestamp DESC)` |
| `pdu_banks` | PDU bank current state | Unique `(device_id, bank_number)` |
| `pdu_bank_metrics` | PDU bank time-series | `(device_id, bank_number, timestamp DESC)` |
| `pdu_outlets` | PDU outlet states | Unique `(device_id, outlet_number)` |

### Retention Policy (Application-Level DELETE)
- **interface_metrics** / **device_metric_history** / **device_env_metrics**: configurable via `max_metric_age_days` setting (default **90 days**)
- **flow_records** / **flow_summary_5m**: configurable via `max_flow_age_days` setting (default **30 days**)
- **port_state_changes**: hardcoded **30 days**
- **pdu_metrics** / **pdu_bank_metrics**: hardcoded **90 days**
- **config_backups**: per-schedule `retention_days` (default **90 days**), cleaned daily at 03:00 UTC
- Cleanup runs every **6 hours** via `scheduled_cleanup` + daily 03:00 for backups
- **No database-level retention policies** — all done via application `DELETE FROM ... WHERE timestamp < cutoff`

---

## SNMP Monitoring

### Polling
- **SNMP v1/v2c/v3** supported per-device (community string or v3 auth/priv credentials)
- Polling interval: configurable via `SNMP_POLL_INTERVAL_SECONDS` env var (default **60 seconds**)
- Devices polled sequentially, each with own short-lived `SnmpEngine` (avoids FD exhaustion)
- PDU devices polled separately in same cycle

### Metrics Collected per Poll
- **Device**: sysUpTime, sysDescr, CPU usage (Arista/Cisco MIBs), memory usage
- **Interfaces**: ifHCInOctets/ifHCOutOctets (64-bit), ifInErrors/ifOutErrors, ifInDiscards/ifOutDiscards, ifOperStatus, ifAdminStatus, ifSpeed/ifHighSpeed, duplex, broadcast/multicast packet counts
- **Rate calculation**: delta between current and previous counter values, divided by elapsed time
- **Environment**: temperature sensors (ENTITY-SENSOR-MIB, CISCO-ENVMON-MIB fallback), fan status, PSU status

### Discovery Features
- **Interface discovery**: walks IF-MIB for all interfaces on a device
- **LLDP neighbor discovery**: walks LLDP-MIB, creates DeviceLink records for topology
- **Route table discovery**: walks IP-MIB routing table
- **MAC table discovery**: walks Q-BRIDGE-MIB / BRIDGE-MIB (every 5 min for switches)
- **ARP table resolution**: IP-MIB ipNetToMediaPhysAddress → enriches MAC entries with IP
- **VLAN discovery**: walks Q-BRIDGE-MIB dot1qVlanStaticName + dot1qPvid
- **MLAG discovery**: Arista MLAG MIB + eAPI, Cisco vPC MIB (every 60s for switches)
- **LLDP/CDP hostname enrichment**: populates MAC entry hostname from LLDP/CDP neighbors (skips VM MACs)
- **OUI vendor lookup**: 80+ hardcoded OUI prefix → vendor name mappings
- **Subnet scan**: SNMP-probe a CIDR range to find responsive devices
- **SNMP test**: test connectivity before adding a device

### Alert Metrics from SNMP
- `device_status`, `cpu_usage`, `memory_usage`
- `if_utilization_in/out`, `if_errors_in/out`, `if_oper_status`
- `device_temperature`, `device_fan_status`, `device_psu_status`
- `if_duplex_mismatch`, `if_broadcast_rate`, `if_flapping`
- `device_rtt`, `device_packet_loss`
- `mlag_peer_status`, `mlag_config_sanity`

---

## Alerting

### Alert Types
1. **Device/Interface Alerts** (`alert_rules` table)
   - Per-device or per-interface metric thresholds
   - Supports single threshold + condition or dual warning/critical thresholds
   - Metrics: device_status, cpu_usage, memory_usage, if_utilization, if_errors, if_oper_status, temperature, fan, PSU, duplex mismatch, broadcast rate, flapping, RTT, packet loss, MLAG peer/sanity
   - Evaluated every **60 seconds**

2. **WAN Aggregate Alerts** (`wan_alert_rules` table)
   - Aggregate metrics across all WAN-flagged interfaces
   - Metrics: wan_total_in_bps, wan_total_out_bps, wan_avg_utilization_in/out, wan_max_utilization_in/out, wan_total_errors
   - Configurable lookback window (default 1440 min = 24h)

3. **Power Alerts** (`power_alert_rules` table)
   - Aggregate PDU power metrics
   - Metrics: total_power_watts, max_load_pct, avg_load_pct, max_phase_current, total_energy_kwh, max_bank_current
   - Configurable lookback window (default 60 min)

### Delivery Methods
- **Email** via SMTP (configurable in server management settings)
- **Webhook** (arbitrary URL, POST with JSON payload)
- Both configured per-rule via `notification_email` and `notification_webhook` fields

### Alert Lifecycle
- **Open** → **Acknowledged** (by user with optional notes) → **Resolved** (manually or auto-clear)
- Cooldown period per rule (default 15 min for device alerts, 60 min for WAN/power)

---

## Authentication & Security

### Auth Methods
- **Local authentication**: bcrypt password hashing (12 rounds)
- **LDAP/Active Directory**: optional, with group → role mapping (Admin/Operator/ReadOnly groups)
  - Local fallback configurable (`LDAP_LOCAL_FALLBACK`)
- **Duo MFA**: optional Universal Prompt (Web SDK v4) integration
  - Two-step login: credentials → Duo redirect → callback with MFA code

### JWT
- Access token: HS256, expires in **60 minutes** (configurable)
- Refresh token: HS256, expires in **7 days** (configurable), stored in HttpOnly cookie
- Separate `JWT_SECRET_KEY` from application `SECRET_KEY`

### RBAC Roles
| Role | Permissions |
|------|------------|
| admin | users:read/write/delete, devices:read/write/delete, alerts:read/write/delete, flows:read, settings:read/write, audit:read |
| operator | devices:read/write, alerts:read/write, flows:read |
| readonly | devices:read, alerts:read, flows:read |

### Security Features
- Account lockout after **5 failed attempts** for **30 minutes**
- Password minimum length: **10 characters**
- Force password change on first login (default admin account)
- Login rate limiting: **10/minute**
- CSRF origin validation middleware
- Security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, optional HSTS
- Request ID tracking via X-Request-ID header
- SNMP credentials encrypted in database (Fernet symmetric encryption)
- Audit logging for all user actions

### Session Management
- Session max duration: **4 hours** (configurable, readonly role exempt)
- Session start/max tracked in JWT claims

---

## Infrastructure

### Docker Services (5 containers)
| Service | Image | Container Name | Ports |
|---------|-------|---------------|-------|
| db | postgres:16-alpine | netmon-db | internal only |
| redis | redis:7-alpine | netmon-redis | internal only |
| backend | custom (Python 3.11-slim) | netmon-backend | 127.0.0.1:8000, 0.0.0.0:2055/udp, 0.0.0.0:6343/udp |
| frontend | custom (Node 20 + nginx:alpine) | netmon-frontend | internal only |
| nginx | nginx:1.25-alpine | netmon-nginx | 80, 443 |

### Volumes
- `postgres_data` — PostgreSQL data directory
- `redis_data` — Redis persistence
- `nginx_logs` — Nginx access/error logs
- `./logs` — Application logs (bind mount)
- `./nginx/ssl` — TLS certificates (bind mount)
- `/var/run/docker.sock` — Docker socket for service management

### Network
- Bridge network `netmon-net` with subnet `172.20.0.0/24`

### Redis Usage
- Flow query result caching (60-second TTL)
- APScheduler lock coordination across uvicorn workers (`SETNX` with TTL)
- Configured with 256MB max memory, LRU eviction policy
- Password-protected

### Nginx
- Reverse proxy for backend API + frontend SPA
- TLS termination (self-signed cert generated by installer, or user-uploaded)
- HTTP → HTTPS redirect

---

## Scheduled Jobs

| Job ID | Interval | Function | Description |
|--------|----------|----------|-------------|
| `snmp_poll` | `SNMP_POLL_INTERVAL_SECONDS` (default 60s) | `scheduled_polling()` | SNMP poll all active devices + PDUs sequentially |
| `alert_eval` | 60s | `scheduled_alerts()` | Evaluate device/interface, WAN, and power alert rules |
| `metrics_cleanup` | 6 hours | `scheduled_cleanup()` | Delete old interface_metrics, device_metric_history, flow_records, flow_summary_5m, env_metrics, port_state_changes, pdu_metrics |
| `block_sync` | 60s | `scheduled_block_sync()` | Sync null-route/flowspec blocks from spine devices via Arista eAPI |
| `ping_monitor` | 60s | `scheduled_ping()` | ICMP ping all active devices, record RTT/loss |
| `mlag_discovery` | 60s | `scheduled_mlag_discovery()` | Discover MLAG/vPC on switch-type devices |
| `flow_rollup` | 300s (5 min) | `scheduled_flow_rollup()` | Aggregate raw flow_records into flow_summary_5m buckets |
| `config_backup` | cron every minute | `run_scheduled_backups()` | Check backup schedules, run matching device config backups |
| `backup_cleanup` | cron daily 03:00 UTC | `cleanup_expired_backups()` | Delete config backups past retention date |
| `mac_discovery` | 300s (5 min) | `scheduled_mac_discovery()` | Walk MAC/VLAN tables on switch-type devices |

All jobs use `max_instances=1` (APScheduler) + Redis `SETNX` locks (cross-worker).

---

## Frontend Pages

| Route | Page Component | Access |
|-------|---------------|--------|
| `/` | MainDashboardPage | Protected |
| `/login` | LoginPage | Public |
| `/change-password` | ChangePasswordPage | Protected |
| `/devices` | DevicesPage | Protected |
| `/devices/:id` | DeviceDetailPage | Protected |
| `/interfaces/:id` | InterfaceDetailPage | Protected |
| `/switches` | SwitchesDashboardPage | Protected |
| `/alerts` | AlertsPage | Protected |
| `/flows` | FlowsPage | Protected |
| `/wan` | WanDashboardPage | Protected |
| `/power` | PowerDashboardPage | Protected |
| `/power/racks` | RackPowerPage | Protected |
| `/blocks` | BlocksPage | Protected |
| `/topology` | TopologyPage | Protected |
| `/reports` | ReportsPage | Protected |
| `/backups` | BackupsPage | Protected |
| `/system-events` | SystemEventsPage | Protected |
| `/users` | UsersPage | Admin only |
| `/audit` | AuditLogPage | Admin only |
| `/settings` | SettingsPage | Admin only |

NOC mode available via `?noc=1` query parameter (chromeless dashboard display).

### DeviceDetailPage Tabs (switch-type devices)
`interfaces` | `routes` | `metrics` | `mac` | `environment` | `vlans` | `mlag`
