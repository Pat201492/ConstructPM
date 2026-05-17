#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Create the test database for integration tests
# ══════════════════════════════════════════════════════════════

set -e

DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-postgres}
TEST_DB_NAME=${TEST_DB_NAME:-construct_mgr_test}

echo "[Test Setup] Creating test database: $TEST_DB_NAME"

# Create DB if it doesn't exist
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -tc \
  "SELECT 1 FROM pg_database WHERE datname = '$TEST_DB_NAME'" \
  | grep -q 1 \
  || psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
  -c "CREATE DATABASE $TEST_DB_NAME"

echo "[Test Setup] ✓ Database '$TEST_DB_NAME' ready"
echo "[Test Setup] Running tests..."
