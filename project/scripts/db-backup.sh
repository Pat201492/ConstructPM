#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Database Backup & Restore Utility
#
# Usage:
#   bash scripts/db-backup.sh backup          # Create a backup
#   bash scripts/db-backup.sh restore <file>  # Restore from backup
#   bash scripts/db-backup.sh list            # List available backups
# ══════════════════════════════════════════════════════════════

set -e

COMPOSE_FILE="docker-compose.prod.yml"
BACKUP_DIR="./backups"

# Load env vars
if [ -f .env.production ]; then
  export $(grep -v '^#' .env.production | grep -v '^$' | xargs)
fi

DB_NAME=${DB_NAME:-construct_mgr}
DB_USER=${DB_USER:-postgres}

case "$1" in
  backup)
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    FILENAME="backup_${TIMESTAMP}.sql.gz"

    echo "Creating backup: $FILENAME"
    docker compose -f $COMPOSE_FILE exec -T db \
      pg_dump -U $DB_USER $DB_NAME | gzip > "$BACKUP_DIR/$FILENAME"

    SIZE=$(du -h "$BACKUP_DIR/$FILENAME" | cut -f1)
    echo "✓ Backup created: $BACKUP_DIR/$FILENAME ($SIZE)"
    ;;

  restore)
    if [ -z "$2" ]; then
      echo "Usage: $0 restore <backup-file>"
      echo "Available backups:"
      ls -lh $BACKUP_DIR/backup_*.sql.gz 2>/dev/null || echo "  No backups found"
      exit 1
    fi

    BACKUP_FILE="$2"
    if [ ! -f "$BACKUP_FILE" ]; then
      BACKUP_FILE="$BACKUP_DIR/$2"
    fi

    if [ ! -f "$BACKUP_FILE" ]; then
      echo "❌ Backup file not found: $2"
      exit 1
    fi

    echo "⚠️  WARNING: This will REPLACE all data in $DB_NAME!"
    read -p "Type 'yes' to confirm: " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
      echo "Cancelled."
      exit 0
    fi

    echo "Restoring from: $BACKUP_FILE"
    gunzip -c "$BACKUP_FILE" | docker compose -f $COMPOSE_FILE exec -T db \
      psql -U $DB_USER -d $DB_NAME

    echo "✓ Database restored from $BACKUP_FILE"
    ;;

  list)
    echo "Available backups:"
    ls -lh $BACKUP_DIR/backup_*.sql.gz 2>/dev/null || echo "  No backups found"
    echo ""
    echo "Total: $(ls $BACKUP_DIR/backup_*.sql.gz 2>/dev/null | wc -l) backups"
    ;;

  *)
    echo "Usage: $0 {backup|restore <file>|list}"
    exit 1
    ;;
esac
