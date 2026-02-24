# NetMon Platform — Security & QA Audit Report

**Date:** 2026-02-24
**Scope:** Server infrastructure, Backend API, Frontend application
**Server:** 91.228.127.79 (Ubuntu 24.04 LTS)
**Domain:** https://91-228-127-79.cloud-xip.io

---

## Executive Summary

| Area | Score | Critical | High | Medium | Low |
|------|-------|----------|------|--------|-----|
| Server Infrastructure | **B+** | 1 | 2 | 2 | 2 |
| Backend API (Python/FastAPI) | **B-** | 3 | 9 | 9 | 5 |
| Frontend (React/TypeScript) | **B+** | 0 | 2 | 8 | 3 |
| **TOTAL** | **B** | **4** | **13** | **19** | **10** |

**Overall Posture:** Good foundation with several areas needing immediate attention before production hardening.

---

## PART 1: SERVER INFRASTRUCTURE AUDIT

### System Overview

| Property | Value |
|----------|-------|
| OS | Ubuntu 24.04.3 LTS (Noble Numbat) |
| Kernel | 6.8.0-100-generic x86_64 |
| CPU | 6 cores |
| RAM | 23 GB (1.8 GB used) |
| Disk | 99 GB (26 GB used, 28%) |
| Auto-updates | Enabled (unattended-upgrades) |

### Container Status

| Container | Status | Ports |
|-----------|--------|-------|
| netmon-frontend | Up | 80/tcp (internal) |
| netmon-backend | Healthy | 127.0.0.1:8000, 0.0.0.0:2055/udp, 0.0.0.0:6343/udp |
| netmon-nginx | Up | 0.0.0.0:80, 0.0.0.0:443 |
| netmon-db | Healthy | 5432/tcp (internal) |
| netmon-redis | Healthy | 6379/tcp (internal) |

### SSL/TLS Certificate

| Property | Value |
|----------|-------|
| Subject | CN=91-228-127-79.cloud-xip.io |
| Issuer | Let's Encrypt (E7) |
| Valid From | Feb 24, 2026 |
| Valid Until | May 25, 2026 |
| Protocols | TLSv1.2, TLSv1.3 |
| Ciphers | ECDHE-ECDSA/RSA-AES128/256-GCM-SHA256/384 |

### Server Findings

#### CRITICAL

| # | Finding | Details |
|---|---------|---------|
| S1 | **SSH root login with password enabled** | `PermitRootLogin yes` and no `PasswordAuthentication no` set. Combined with 4 failed brute-force attempts from 195.28.181.129 in the last 2 days, this is an active risk. |

#### HIGH

| # | Finding | Details |
|---|---------|---------|
| S2 | **UFW firewall inactive** | Host firewall is OFF. Only Docker iptables rules are active. No protection for the host itself beyond SSH. |
| S3 | **Database user has superuser privileges** | The `netmon` DB role has `rolsuper=t, rolcreaterole=t, rolcreatedb=t`. App should use a least-privilege role. |

#### MEDIUM

| # | Finding | Details |
|---|---------|---------|
| S4 | **.env file world-readable** | `/root/netmon/.env` has permissions `-rw-r--r--` (644). Should be 600. |
| S5 | **Containers run as root** | Frontend, nginx, DB, and Redis containers have no `User` set (defaults to root). Only backend runs as `netmon`. |

#### LOW

| # | Finding | Details |
|---|---------|---------|
| S6 | **X11Forwarding enabled** | SSH config has `X11Forwarding yes` — unnecessary for a server. |
| S7 | **No outbound internet access** | Server cannot reach the internet (DNS/ping fail). This blocks Docker builds and git pulls but is actually a security benefit for isolation. |

#### POSITIVE

| # | Finding |
|---|---------|
| + | Let's Encrypt SSL with strong TLS 1.2/1.3 configuration |
| + | Security headers present: HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, X-XSS-Protection, Referrer-Policy |
| + | Backend API port (8000) bound to 127.0.0.1 only — not exposed externally |
| + | DB and Redis ports not exposed to host — internal Docker network only |
| + | Redis requires authentication |
| + | Docker logging configured with size limits on all containers |
| + | Auto-updates enabled |
| + | Backend container runs as non-root user `netmon` |
| + | No backend errors in recent logs |

---

## PART 2: BACKEND API SECURITY AUDIT

### CRITICAL

| # | Finding | File | Line |
|---|---------|------|------|
| B1 | **Default admin credentials `admin/admin`** | `app/main.py` | 298 |
| | Default admin user created on startup with password `admin`. While `must_change_password=True` is set, this is exploitable if the change is never completed. **Recommendation:** Generate a random temporary password and display it in logs once. |
| B2 | **CORS allows all origins** | `app/main.py` | 421 |
| | `ALLOWED_ORIGINS` defaults to `*` with `allow_credentials=True`. Any website can make authenticated API requests. **Recommendation:** Set to your actual domain. |
| B3 | **SSL verification disabled for device APIs** | `app/services/config_fetcher.py`, `app/services/arista_api.py` | 70, 43 |
| | `verify=False` on httpx calls to network devices makes them vulnerable to MITM attacks. **Recommendation:** Use proper CA bundle or allow configurable cert paths. |

### HIGH

| # | Finding | File | Line |
|---|---------|------|------|
| B4 | **LDAP injection vulnerability** | `app/services/ldap_auth.py` | 69 |
| | Username directly formatted into LDAP filter: `cfg["user_filter"].format(username=username)` without escaping. **Recommendation:** Use `ldap3.utils.escape.escape_filter_chars()`. |
| B5 | **No rate limiting on login endpoint** | `app/routers/auth.py` | 36 |
| | Despite `RATE_LIMIT_LOGIN: "10/minute"` in config, the `@limiter.limit()` decorator is NOT applied to the login route. Unlimited brute-force is possible. **Recommendation:** Add `@limiter.limit(settings.RATE_LIMIT_LOGIN)` decorator. |
| B6 | **API credentials stored in plaintext** | `app/models/device.py` | 60-61 |
| | `api_username` and `api_password` stored unencrypted in DB. **Recommendation:** Encrypt at rest with symmetric key. |
| B7 | **SNMP community strings in plaintext** | `app/models/device.py` | 38 |
| | Same issue as B6 for SNMP credentials. |
| B8 | **Session timeout bypassed for readonly role** | `app/routers/auth.py` | 119 |
| | Readonly users have infinite session duration. **Recommendation:** Apply consistent timeout for all roles. |
| B9 | **No CSRF protection** | `app/main.py` | - |
| | No CSRF middleware. Combined with CORS wildcard (B2), this is exploitable. |
| B10 | **Unvalidated IP address input** | `app/schemas/device.py` | 29 |
| | `ip_address: str` accepted without validation. Invalid IPs like `999.999.999.999` pass through. |
| B11 | **Raw SQL in migrations** | `app/main.py` | 162 |
| | `ALTER TABLE` statements use f-strings. Currently safe (hardcoded column names) but fragile. |
| B12 | **API credentials exposed in responses** | `app/schemas/device.py` | 106 |
| | `api_username` returned in device API responses. |

### MEDIUM

| # | Finding | File |
|---|---------|------|
| B13 | Hardcoded default DB credentials in config.py | `app/config.py:15` |
| B14 | HTTPS_ONLY defaults to False | `app/config.py:63` |
| B15 | No Content-Security-Policy header | `app/main.py` |
| B16 | No Permissions-Policy header | `app/main.py` |
| B17 | Broad exception handlers swallow errors | Multiple files |
| B18 | Password reset has no secure token mechanism | `app/routers/users.py:138` |
| B19 | No input length limits on string fields | `app/schemas/alert.py` |
| B20 | No audit logging for settings changes | `app/routers/settings.py:62` |
| B21 | Swagger/ReDoc docs exposed without auth | `app/main.py:412` |

### LOW

| # | Finding |
|---|---------|
| B22 | Debug mode configurable via env var |
| B23 | SQL query logging when DEBUG=true could expose data |
| B24 | No request ID tracing for log correlation |
| B25 | Device tags stored as unvalidated text |
| B26 | No changelog metadata on config backups |

### POSITIVE

| # | Finding |
|---|---------|
| + | Strong password policy: 10+ chars, upper/lower/number/special |
| + | Bcrypt with cost factor 12 |
| + | JWT access tokens: 60 min expiry |
| + | JWT refresh tokens: 7 day expiry |
| + | Soft-delete pattern preserves audit trails |
| + | Dependencies pinned and up-to-date |
| + | SQLAlchemy ORM prevents most SQL injection |

---

## PART 3: FRONTEND SECURITY AUDIT

### HIGH

| # | Finding | File | Line |
|---|---------|------|------|
| F1 | **JWT tokens stored in localStorage** | `store/authStore.ts` | 43-50 |
| | Both access and refresh tokens persisted to localStorage via Zustand. Vulnerable to XSS theft. **Recommendation:** Migrate to httpOnly cookies. |
| F2 | **No CSP meta tag in index.html** | `index.html` | - |
| | No Content-Security-Policy defined. **Recommendation:** Add CSP header via nginx (already partially done) and HTML meta tag. |

### MEDIUM

| # | Finding | File |
|---|---------|------|
| F3 | API error details leaked to users via toast | `services/api.ts:54-61` |
| F4 | No CSRF token handling in API client | `services/api.ts` |
| F5 | IP address regex allows invalid values | `AddDeviceModal.tsx:149` |
| F6 | Subnet CIDR regex allows invalid values | `ScanSubnetModal.tsx:63` |
| F7 | Duo callback params used without validation | `LoginPage.tsx:20-25` |
| F8 | Frontend-only role check could be bypassed | `App.tsx:33` |
| F9 | TypeScript strict mode disabled | `tsconfig.json:15` |
| F10 | Excessive `any` type usage reduces type safety | Multiple files |

### LOW

| # | Finding | File |
|---|---------|------|
| F11 | Device ID parseInt without error handling | `DeviceDetailPage.tsx:140` |
| F12 | API base URL hardcoded to `/api` | `services/api.ts:6` |
| F13 | No environment variable configuration support | `vite.config.ts` |

### POSITIVE

| # | Finding |
|---|---------|
| + | No XSS vectors: no dangerouslySetInnerHTML, no innerHTML, no eval() |
| + | No console.log statements in production code |
| + | No hardcoded secrets or credentials in source |
| + | Source maps disabled in production build |
| + | Proper route protection with ProtectedRoute and AdminRoute components |
| + | Strong client-side password validation |
| + | API passwords never pre-filled in edit forms |
| + | Token refresh with retry logic properly implemented |
| + | All dependencies current and well-maintained |
| + | Bearer token correctly sent via Authorization header |
| + | Google Fonts loaded over HTTPS |

---

## PRIORITY REMEDIATION PLAN

### Immediate (Do Now)

| Priority | Issue | Action |
|----------|-------|--------|
| 1 | SSH root login open (S1) | Add `PasswordAuthentication no` and `PermitRootLogin prohibit-password` to sshd_config |
| 2 | No rate limiting on login (B5) | Add `@limiter.limit()` decorator to login endpoint |
| 3 | CORS wildcard (B2) | Set `ALLOWED_ORIGINS=https://91-228-127-79.cloud-xip.io` in .env |
| 4 | LDAP injection (B4) | Add `escape_filter_chars()` to LDAP user filter |
| 5 | .env file permissions (S4) | `chmod 600 /root/netmon/.env` |

### Short-Term (1-2 Weeks)

| Priority | Issue | Action |
|----------|-------|--------|
| 6 | DB superuser (S3) | Create restricted role for app, revoke superuser |
| 7 | SSL verify disabled (B3) | Add configurable CA bundle path |
| 8 | Plaintext credentials (B6, B7) | Implement symmetric encryption for stored credentials |
| 9 | Default admin password (B1) | Generate random password on first run |
| 10 | UFW firewall (S2) | Enable UFW, allow only 22, 80, 443, 2055/udp, 6343/udp |

### Medium-Term (1 Month)

| Priority | Issue | Action |
|----------|-------|--------|
| 11 | localStorage tokens (F1) | Migrate to httpOnly cookies |
| 12 | CSRF protection (B9, F4) | Implement CSRF middleware |
| 13 | Input validation (B10, F5, F6) | Add proper IP/CIDR validators |
| 14 | CSP header (F2) | Add Content-Security-Policy to nginx and index.html |
| 15 | TypeScript strict mode (F9) | Enable strict, fix `any` types |

---

## INFRASTRUCTURE HEALTH

| Metric | Status |
|--------|--------|
| All containers running | PASS |
| Health checks passing | PASS |
| SSL certificate valid | PASS (expires May 25, 2026) |
| Disk usage | PASS (28%) |
| Memory usage | PASS (1.8/23 GB) |
| Auto-updates | PASS (enabled) |
| Backend error log | PASS (clean) |
| Docker logging limits | PASS (configured) |
| Internal services isolated | PASS (DB, Redis internal only) |
| Brute-force attempts | WARN (4 attempts from 195.28.181.129) |

---

## CONCLUSION

The NetMon platform has a **solid security foundation** with proper authentication flows, encrypted communications (TLS 1.2/1.3), containerized architecture with internal networking, and good coding practices (no XSS vectors, ORM-based queries, bcrypt hashing).

The most critical items to address are:
1. **SSH hardening** — disable password auth for root
2. **Login rate limiting** — the decorator is configured but not applied
3. **CORS restriction** — change from wildcard to specific domain
4. **LDAP input escaping** — prevent injection attacks

These 4 fixes would significantly improve the security posture with minimal effort.

---

*Report generated by Claude Code — 2026-02-24*
