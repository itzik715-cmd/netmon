#!/bin/bash
# Update Duo Authentication Proxy to the latest version.
# Preserves the existing configuration.
#
# Usage: sudo bash update_duo_authproxy.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error(){ echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

INSTALL_DIR="/opt/duoauthproxy"
CONFIG_FILE="${INSTALL_DIR}/conf/authproxy.cfg"

[ "$(id -u)" -ne 0 ] && error "Please run as root or with sudo"
[ ! -d "$INSTALL_DIR" ] && error "Duo Auth Proxy not found at ${INSTALL_DIR}. Run install_duo_authproxy.sh first."
[ ! -f "$CONFIG_FILE" ] && error "Config file not found: ${CONFIG_FILE}"

# ─── Show current version ────────────────────────────────────────────────────
step "Current Version"
if [ -x "${INSTALL_DIR}/bin/authproxy" ]; then
  CURRENT_VER=$("${INSTALL_DIR}/bin/authproxy" --version 2>/dev/null || echo "unknown")
  log "Current version: ${CURRENT_VER}"
else
  log "Current version: unknown"
fi

# ─── Stop service ─────────────────────────────────────────────────────────────
step "Stopping Duo Auth Proxy"
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet duoauthproxy 2>/dev/null; then
  systemctl stop duoauthproxy
  log "Service stopped"
elif [ -x "${INSTALL_DIR}/bin/authproxyctl" ]; then
  "${INSTALL_DIR}/bin/authproxyctl" stop 2>/dev/null || true
  log "Service stopped via authproxyctl"
else
  warn "Could not detect running service — continuing"
fi

# ─── Backup config ───────────────────────────────────────────────────────────
step "Backing up configuration"
BACKUP_FILE="/tmp/authproxy.cfg.backup.$(date +%Y%m%d%H%M%S)"
cp "$CONFIG_FILE" "$BACKUP_FILE"
log "Config backed up to: ${BACKUP_FILE}"

# ─── Download + build ────────────────────────────────────────────────────────
step "Downloading latest Duo Auth Proxy"
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
curl -fsSL "https://dl.duosecurity.com/duoauthproxy-latest-src.tgz" -o duoauthproxy-latest-src.tgz
tar xzf duoauthproxy-latest-src.tgz
cd duoauthproxy-*-src

step "Building (this may take a few minutes)"
make

step "Installing"
cd duoauthproxy-build
./install --install-dir "$INSTALL_DIR" --service-user nobody --create-init-script yes 2>/dev/null || \
  ./install --install-dir "$INSTALL_DIR" --service-user nobody 2>/dev/null || \
  ./install --install-dir "$INSTALL_DIR"

# ─── Restore config ──────────────────────────────────────────────────────────
step "Restoring configuration"
cp "$BACKUP_FILE" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
log "Config restored from backup"

# ─── Start service ────────────────────────────────────────────────────────────
step "Starting Duo Auth Proxy"
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl start duoauthproxy
  log "Service started"
elif [ -x "${INSTALL_DIR}/bin/authproxyctl" ]; then
  "${INSTALL_DIR}/bin/authproxyctl" start
  log "Service started via authproxyctl"
fi

# ─── Cleanup ──────────────────────────────────────────────────────────────────
rm -rf "$TMPDIR"

# ─── Show new version ────────────────────────────────────────────────────────
step "Update Complete"
if [ -x "${INSTALL_DIR}/bin/authproxy" ]; then
  NEW_VER=$("${INSTALL_DIR}/bin/authproxy" --version 2>/dev/null || echo "unknown")
  log "New version: ${NEW_VER}"
else
  log "New version: (check manually)"
fi
log "Config backup kept at: ${BACKUP_FILE}"
echo ""
