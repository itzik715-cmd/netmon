# NetMon - Network Monitoring & Visibility Platform

A full-featured, production-ready network monitoring platform with authentication, RBAC, SNMP polling, NetFlow analysis, and alerting.

## Features

### Monitoring
- **Infrastructure Health** — Spine/Leaf/ToR device monitoring via SNMP v1/v2c/v3
- **Historical Port Graphs** — Per-interface throughput, utilization, errors (1h/6h/24h/7d/30d)
- **Flow Analysis** — NetFlow v5/v9 and sFlow collection with top talkers, conversations, protocol/application breakdown
- **Alerting** — Rule-based alerting with webhook and email notifications, auto-resolve

### Authentication & Security
- **Local Authentication** — bcrypt password hashing (cost 12), enforced password policy
- **Default Account** — `admin/admin` with forced password change on first login
- **RBAC** — Three roles: Admin, Operator, ReadOnly — enforced at API level
- **Active Directory / LDAP** — Optional integration with group→role mapping, configurable via UI
- **Hybrid Mode** — Local admin always active; AD for other users
- **Account Lockout** — 5 failed attempts → auto-lock (30 min)
- **JWT Sessions** — Access tokens (1h) + Refresh tokens (7d)
- **Audit Log** — All actions logged, read-only in UI

### Infrastructure
- Docker Compose — All-In-One deployment per site
- Nginx reverse proxy with security headers and rate limiting
- PostgreSQL for persistent storage
- Redis for caching

## Quick Start

```bash
git clone <repo-url>
cd netmon
./scripts/install.sh
```

Then open: `http://<server-ip>`

**Default credentials:** `admin` / `admin`
**Important:** You will be forced to change the password on first login.

## Default Credentials

| Username | Password | Role  | Note                         |
|----------|----------|-------|------------------------------|
| admin    | admin    | Admin | MUST change on first login   |

## Architecture

```
┌─────────────────────────────────┐
│  Nginx (Port 80/443)            │
│  Rate limiting, Security headers│
└────────┬───────────┬────────────┘
         │           │
    ┌────▼────┐  ┌───▼──────┐
    │Frontend │  │ Backend  │
    │React SPA│  │ FastAPI  │
    └─────────┘  └────┬─────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
    ┌────▼────┐  ┌────▼────┐  ┌───▼───┐
    │PostgreSQL│ │  Redis  │  │ SNMP  │
    │  + Audit │  │ Cache   │  │ Poll  │
    └─────────┘  └─────────┘  └───────┘
```

## RBAC Permissions

| Permission          | Admin | Operator | ReadOnly |
|---------------------|-------|----------|---------|
| View devices        | ✓     | ✓        | ✓       |
| Add/edit devices    | ✓     | ✓        | ✗       |
| Delete devices      | ✓     | ✗        | ✗       |
| View alerts         | ✓     | ✓        | ✓       |
| Acknowledge alerts  | ✓     | ✓        | ✗       |
| Manage alert rules  | ✓     | ✓        | ✗       |
| View flows          | ✓     | ✓        | ✓       |
| Manage users        | ✓     | ✗        | ✗       |
| View audit log      | ✓     | ✗        | ✗       |
| System settings     | ✓     | ✗        | ✗       |

## Network Device Configuration

### NetFlow (Cisco IOS)
```
ip flow-export destination <server-ip> 2055
ip flow-export version 5
interface GigabitEthernet0/0
  ip flow ingress
  ip flow egress
```

### SNMP v2c (Cisco IOS)
```
snmp-server community public RO
snmp-server location <site-name>
```

## Backup

```bash
./scripts/backup.sh /opt/netmon-backups
```

## Environment Variables

See `.env.example` for all configuration options.

## Ports

| Port | Protocol | Purpose         |
|------|----------|-----------------|
| 80   | TCP      | HTTP Web UI     |
| 443  | TCP      | HTTPS Web UI    |
| 2055 | UDP      | NetFlow         |
| 6343 | UDP      | sFlow           |

## Security Checklist

- [ ] Change admin password on first login
- [ ] Generate random `SECRET_KEY` and `JWT_SECRET_KEY` in `.env`
- [ ] Change default database and Redis passwords
- [ ] Configure SSL certificate in `nginx/nginx.conf`
- [ ] Restrict firewall: allow port 80/443 from management networks only
- [ ] Configure LDAP/AD integration for enterprise environments
- [ ] Set up backup schedule via cron
