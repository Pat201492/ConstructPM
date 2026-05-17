#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Construction Bid & Project Management Platform - Setup Script
# ══════════════════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════════╗"
echo "║  Construction PM Platform - Initial Setup    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# 1. Check prerequisites
echo "[1/6] Checking prerequisites..."
command -v node >/dev/null 2>&1 || { echo "Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "PostgreSQL client (psql) is required."; exit 1; }
echo "  ✓ Node.js $(node -v)"
echo "  ✓ PostgreSQL client found"

# 2. Copy environment file
echo ""
echo "[2/6] Setting up environment..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ✓ Created .env from .env.example"
  echo "  ⚠ EDIT .env with your database credentials before continuing!"
  echo "    Then re-run this script."
  exit 0
else
  echo "  ✓ .env already exists"
fi

# 3. Install dependencies
echo ""
echo "[3/6] Installing dependencies..."
npm install
echo "  ✓ Dependencies installed"

# 4. Create database (if it doesn't exist)
echo ""
echo "[4/6] Creating database..."
DB_NAME=${DB_NAME:-construct_mgr}
DB_USER=${DB_USER:-postgres}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}

# Source .env for variables
export $(grep -v '^#' .env | grep -v '^$' | xargs)

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -tc \
  "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" \
  | grep -q 1 || psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
  -c "CREATE DATABASE $DB_NAME"
echo "  ✓ Database '$DB_NAME' ready"

# 5. Run migrations
echo ""
echo "[5/6] Running database migrations..."
npx knex migrate:latest
echo "  ✓ Migrations complete"

# 6. Seed admin user
echo ""
echo "[6/6] Seeding initial data..."
npx knex seed:run
echo ""

# 7. Create local storage directories
mkdir -p storage/bids storage/projects storage/temp
echo "  ✓ Local storage directories created"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Setup Complete!                             ║"
echo "║                                              ║"
echo "║  Start the server:  node src/server.js       ║"
echo "║  Health check:      http://localhost:3000/api/health  ║"
echo "╚══════════════════════════════════════════════╝"
