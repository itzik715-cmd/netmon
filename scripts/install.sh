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

# Check prerequisites
command -v docker  >/dev/null 2>&1 || error "Docker is not installed. Please install Docker first."
command -v docker-compose >/dev/null 2>&1 || \
  docker compose version >/dev/null 2>&1 || \
  error "Docker Compose is not installed."

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

# Build and start services
step "Building Docker Images"
cd "$PROJECT_DIR"
docker compose build --no-cache

step "Starting Services"
docker compose up -d

# Wait for health
step "Waiting for Services to be Ready"
MAX_WAIT=120
ELAPSED=0
log "Waiting for backend to be healthy..."
while ! docker compose exec -T backend curl -sf http://localhost:8000/api/health > /dev/null 2>&1; do
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    error "Backend failed to start. Check logs: docker compose logs backend"
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
log "To view logs: docker compose logs -f"
log "To stop:      docker compose down"
log "To update:    git pull && docker compose up -d --build"
