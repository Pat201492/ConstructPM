#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Deploy / Update Construction PM Platform
#
# Usage: bash scripts/deploy.sh
# Run from the project root: /opt/construction-pm
# ══════════════════════════════════════════════════════════════

set -e

COMPOSE_FILE="docker-compose.prod.yml"
HEALTH_URL="http://localhost:3000/api/health"

echo "╔═══════════════════════════════════════════════╗"
echo "║  Construction PM — Deploying...               ║"
echo "╚═══════════════════════════════════════════════╝"

# 0. Preflight checks
if [ ! -f ".env.production" ]; then
  echo "❌ .env.production not found!"
  echo "   Copy .env.production.example → .env.production and fill in secrets."
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "❌ $COMPOSE_FILE not found! Are you in the project root?"
  exit 1
fi

# 1. Pull latest code (if using git)
if [ -d ".git" ]; then
  echo ""
  echo "[1/6] Pulling latest code..."
  git pull origin main
fi

# 2. Build the Docker image
echo ""
echo "[2/6] Building Docker image..."
docker compose -f $COMPOSE_FILE build api

# 3. Start database and redis (if not running)
echo ""
echo "[3/6] Ensuring database and Redis are running..."
docker compose -f $COMPOSE_FILE up -d db redis
sleep 3

# 4. Run database migrations
echo ""
echo "[4/6] Running database migrations..."
docker compose -f $COMPOSE_FILE run --rm api npx knex migrate:latest

# 5. Restart API with zero downtime
echo ""
echo "[5/6] Restarting API server..."
docker compose -f $COMPOSE_FILE up -d --no-deps --remove-orphans api nginx db-backup

# 6. Health check
echo ""
echo "[6/6] Verifying deployment..."
RETRIES=10
until [ $RETRIES -eq 0 ]; do
  if curl -sf $HEALTH_URL > /dev/null 2>&1; then
    echo "  ✓ Health check passed!"
    break
  fi
  RETRIES=$((RETRIES - 1))
  echo "  Waiting for API to start... ($RETRIES retries left)"
  sleep 3
done

if [ $RETRIES -eq 0 ]; then
  echo "  ❌ Health check failed! Rolling back..."
  docker compose -f $COMPOSE_FILE logs --tail=50 api
  exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║  ✅ Deployment successful!                    ║"
echo "║                                               ║"
echo "║  API:     http://localhost:3000/api/health     ║"
echo "║  Logs:    docker compose -f $COMPOSE_FILE logs -f api  ║"
echo "╚═══════════════════════════════════════════════╝"
