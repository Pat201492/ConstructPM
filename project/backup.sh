#!/bin/sh
# ConstructPM Database Backup/Restore
# Usage:
#   ./backup.sh backup           — Creates a timestamped backup
#   ./backup.sh restore FILE     — Restores from a backup file
#   ./backup.sh list             — Lists available backups

CONTAINER="constructpm_db"
DB_NAME="construct_mgr"
DB_USER="postgres"
BACKUP_DIR="./backups"

mkdir -p "$BACKUP_DIR"

case "$1" in
  backup)
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    FILE="$BACKUP_DIR/backup_${TIMESTAMP}.sql"
    echo "Backing up database to $FILE..."
    docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" > "$FILE"
    SIZE=$(du -h "$FILE" | cut -f1)
    echo "✅ Backup complete: $FILE ($SIZE)"
    echo ""
    echo "To restore: ./backup.sh restore $FILE"
    ;;

  restore)
    if [ -z "$2" ]; then
      echo "Usage: ./backup.sh restore FILENAME"
      echo "Run './backup.sh list' to see available backups."
      exit 1
    fi
    if [ ! -f "$2" ]; then
      echo "File not found: $2"
      exit 1
    fi
    echo "⚠️  This will REPLACE all current data with the backup."
    echo "Press Ctrl+C to cancel, or Enter to continue..."
    read _
    echo "Restoring from $2..."
    docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null
    docker exec -i "$CONTAINER" psql -U "$DB_USER" "$DB_NAME" < "$2"
    echo "✅ Restore complete. Restart the app: docker compose restart api"
    ;;

  list)
    echo "Available backups:"
    ls -lh "$BACKUP_DIR"/*.sql 2>/dev/null || echo "  (none)"
    ;;

  *)
    echo "ConstructPM Database Backup"
    echo ""
    echo "Usage:"
    echo "  ./backup.sh backup         — Create backup"
    echo "  ./backup.sh restore FILE   — Restore from backup"
    echo "  ./backup.sh list           — List backups"
    ;;
esac
