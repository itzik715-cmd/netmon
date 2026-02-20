#!/bin/bash
# NetMon Platform - Backup Script

set -euo pipefail

BACKUP_DIR="${1:-/opt/netmon-backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/netmon_backup_$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "Creating NetMon backup: $BACKUP_FILE"

# Backup database
docker compose exec -T db pg_dump -U netmon netmon | gzip > "/tmp/netmon_db_$TIMESTAMP.sql.gz"

# Create archive
tar -czf "$BACKUP_FILE" \
  -C /home/user/netmon \
  .env \
  nginx/ \
  "/tmp/netmon_db_$TIMESTAMP.sql.gz" 2>/dev/null || true

# Cleanup temp
rm -f "/tmp/netmon_db_$TIMESTAMP.sql.gz"

echo "Backup created: $BACKUP_FILE"

# Retention: keep last 7 backups
ls -t "$BACKUP_DIR"/netmon_backup_*.tar.gz 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null || true
echo "Old backups cleaned up (keeping last 7)"
