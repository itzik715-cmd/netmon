#!/bin/bash
# NetMon Platform - Installation Script
# Run as root or with sudo on Ubuntu 20.04+ / CentOS 8+

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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

step "NetMon Platform Installation"
log "Project directory: $PROJECT_DIR"

# ─── Detect OS ────────────────────────────────────────────────────────────────
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${ID}"
    OS_ID_LIKE="${ID_LIKE:-}"
    OS_VERSION_ID="${VERSION_ID:-}"
  elif command -v lsb_release >/dev/null 2>&1; then
    OS_ID=$(lsb_release -si | tr '[:upper:]' '[:lower:]')
    OS_VERSION_ID=$(lsb_release -sr)
  else
    OS_ID="unknown"
    OS_VERSION_ID=""
  fi
}

# ─── Install Docker ────────────────────────────────────────────────────────────
install_docker() {
  detect_os
  log "Detected OS: ${OS_ID} ${OS_VERSION_ID}"

  case "${OS_ID}" in
    ubuntu|debian|linuxmint|pop)
      step "Installing Docker (apt)"
      apt-get update -qq
      apt-get install -y -qq \
        ca-certificates curl gnupg lsb-release

      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/${OS_ID}/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg

      echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/${OS_ID} \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list

      apt-get update -qq
      apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;

    centos|rhel|rocky|almalinux|ol)
      step "Installing Docker (yum/dnf)"
      yum install -y -q yum-utils
      yum-config-manager --add-repo \
        https://download.docker.com/linux/centos/docker-ce.repo
      yum install -y -q \
        docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      systemctl enable --now docker
      ;;

    fedora)
      step "Installing Docker (dnf)"
      dnf install -y -q dnf-plugins-core
      dnf config-manager --add-repo \
        https://download.docker.com/linux/fedora/docker-ce.repo
      dnf install -y -q \
        docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      systemctl enable --now docker
      ;;

    *)
      # Generic fallback: Docker's convenience script
      step "Installing Docker (convenience script)"
      warn "OS '${OS_ID}' not explicitly supported — using Docker's get.docker.com script"
      curl -fsSL https://get.docker.com | sh
      ;;
  esac

  # Start and enable Docker daemon
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable docker  2>/dev/null || true
    systemctl start  docker  2>/dev/null || true
  fi

  log "Docker installed: $(docker --version)"
}

# ─── Check / Install Docker ───────────────────────────────────────────────────
step "Checking Prerequisites"

# Must run as root (or via sudo) to install packages
if [ "$(id -u)" -ne 0 ]; then
  error "Please run this script as root or with sudo."
fi

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker not found — installing automatically..."
  install_docker
else
  log "Docker already installed: $(docker --version)"
fi

# Verify docker compose (plugin v2 preferred, standalone v1 as fallback)
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker compose"
  log "Docker Compose (plugin) available: $(docker compose version --short)"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker-compose"
  log "Docker Compose (standalone) available: $(docker-compose --version)"
else
  warn "Docker Compose plugin not found — attempting install..."
  detect_os
  case "${OS_ID}" in
    ubuntu|debian|linuxmint|pop)
      apt-get install -y -qq docker-compose-plugin
      ;;
    centos|rhel|rocky|almalinux|ol|fedora)
      yum install -y -q docker-compose-plugin 2>/dev/null || \
        dnf install -y -q docker-compose-plugin
      ;;
    *)
      # Fallback: install standalone docker-compose binary
      COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest \
        | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
      curl -fsSL \
        "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose
      chmod +x /usr/local/bin/docker-compose
      ;;
  esac
  if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
  else
    error "Docker Compose installation failed. Please install it manually."
  fi
  log "Docker Compose installed"
fi

# Generate .env from template
step "Configuring Environment"
if [ ! -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"

  # Generate random secrets
  DB_PASS=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))" 2>/dev/null || openssl rand -base64 24)
  REDIS_PASS=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))" 2>/dev/null || openssl rand -base64 24)
  SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))" 2>/dev/null || openssl rand -base64 48)
  JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))" 2>/dev/null || openssl rand -base64 48)

  sed -i "s|netmon_CHANGE_THIS_PASSWORD|${DB_PASS}|g" "$PROJECT_DIR/.env"
  sed -i "s|redis_CHANGE_THIS_PASSWORD|${REDIS_PASS}|g" "$PROJECT_DIR/.env"
  sed -i "s|CHANGE_THIS_TO_RANDOM_64_CHARS|${SECRET}|g" "$PROJECT_DIR/.env"
  sed -i "s|CHANGE_THIS_TO_DIFFERENT_RANDOM_64_CHARS|${JWT_SECRET}|g" "$PROJECT_DIR/.env"

  log "Generated .env with random secrets"
else
  warn ".env already exists, skipping generation"
fi

# Create log directory
mkdir -p "$PROJECT_DIR/logs"
chmod 777 "$PROJECT_DIR/logs"

# ─── Free Required Ports ──────────────────────────────────────────────────────
free_port() {
  local port="$1"
  local proto="${2:-tcp}"

  # Skip if nothing is listening
  if ! ss -lnp "${proto}" 2>/dev/null | grep -q ":${port} " && \
     ! netstat -lnp 2>/dev/null | grep -q ":${port} "; then
    return 0
  fi

  warn "Port ${port}/${proto} is in use — attempting to free it..."

  # Try stopping well-known services that commonly bind port 80/443
  for svc in nginx apache2 httpd lighttpd caddy haproxy; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      log "Stopping system service: $svc"
      systemctl stop "$svc"  2>/dev/null || true
      systemctl disable "$svc" 2>/dev/null || true
    fi
  done

  # If still in use, kill the process directly
  if ss -lnp "${proto}" 2>/dev/null | grep -q ":${port} " || \
     netstat -lnp 2>/dev/null | grep -q ":${port} "; then
    # Extract PID(s) via ss
    local pids
    pids=$(ss -lnp "${proto}" 2>/dev/null \
           | grep ":${port} " \
           | grep -oP 'pid=\K[0-9]+' \
           | sort -u)
    # Fallback: fuser
    if [ -z "$pids" ] && command -v fuser >/dev/null 2>&1; then
      pids=$(fuser "${port}/${proto}" 2>/dev/null | tr ' ' '\n' | grep -v '^$' || true)
    fi
    if [ -n "$pids" ]; then
      for pid in $pids; do
        warn "Killing PID $pid occupying port ${port}/${proto}"
        kill -9 "$pid" 2>/dev/null || true
      done
      sleep 1
    fi
  fi

  if ss -lnp "${proto}" 2>/dev/null | grep -q ":${port} " || \
     netstat -lnp 2>/dev/null | grep -q ":${port} "; then
    error "Could not free port ${port}/${proto}. Please stop the service manually and re-run."
  fi
  log "Port ${port}/${proto} is now free."
}

step "Checking Required Ports"
# Install ss / netstat if missing (for port checks)
if ! command -v ss >/dev/null 2>&1 && ! command -v netstat >/dev/null 2>&1; then
  detect_os
  case "${OS_ID}" in
    ubuntu|debian|linuxmint|pop) apt-get install -y -qq iproute2 ;;
    *) yum install -y -q iproute2 2>/dev/null || dnf install -y -q iproute2 2>/dev/null || true ;;
  esac
fi
# Install fuser as a backup PID resolver
if ! command -v fuser >/dev/null 2>&1; then
  detect_os
  case "${OS_ID}" in
    ubuntu|debian|linuxmint|pop) apt-get install -y -qq psmisc ;;
    *) yum install -y -q psmisc 2>/dev/null || true ;;
  esac
fi

free_port 80  tcp
free_port 443 tcp
# UDP ports for NetFlow/sFlow — just warn, don't kill (they rarely conflict)
for udp_port in 2055 6343; do
  if ss -lnp udp 2>/dev/null | grep -q ":${udp_port} "; then
    warn "UDP port ${udp_port} is already in use. NetFlow/sFlow collection may not work."
  fi
done

# Build and start services
step "Building Docker Images"
cd "$PROJECT_DIR"
if ! $DOCKER_COMPOSE build --no-cache; then
  echo ""
  error "Docker build failed. Review the output above for the exact error.
       Tip: run '$DOCKER_COMPOSE build --no-cache' manually to see the full log."
fi

step "Starting Services"
if ! $DOCKER_COMPOSE up -d; then
  # Show last 30 lines of logs for the failed container
  echo ""
  warn "Container start failed — showing recent logs:"
  $DOCKER_COMPOSE logs --tail=30 2>/dev/null || true
  error "Failed to start containers. See logs above or run '$DOCKER_COMPOSE logs' for details."
fi

# Wait for health
step "Waiting for Services to be Ready"
MAX_WAIT=180
ELAPSED=0
log "Waiting for backend to be healthy..."
while ! $DOCKER_COMPOSE exec -T backend curl -sf http://localhost:8000/api/health > /dev/null 2>&1; do
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    error "Backend failed to start within ${MAX_WAIT}s. Check logs: $DOCKER_COMPOSE logs backend"
  fi
  echo -n "."
done
echo ""
log "Backend is healthy!"

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

step "Installation Complete!"
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         NetMon Platform is Ready!                  ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC} Web UI:      http://${SERVER_IP}                      ${GREEN}║${NC}"
echo -e "${GREEN}║${NC} API Docs:    http://${SERVER_IP}/api/docs             ${GREEN}║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC} Default Login:                                     ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}   Username: ${YELLOW}admin${NC}                               ${GREEN}    ║${NC}"
echo -e "${GREEN}║${NC}   Password: ${YELLOW}admin${NC}                               ${GREEN}    ║${NC}"
echo -e "${GREEN}║${NC}   ${RED}IMPORTANT: Change password on first login!${NC}     ${GREEN}║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC} NetFlow/sFlow: UDP port 2055 / 6343                ${GREEN}║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
echo ""
log "To view logs: $DOCKER_COMPOSE logs -f"
log "To stop:      $DOCKER_COMPOSE down"
log "To update:    git pull && $DOCKER_COMPOSE up -d --build"
