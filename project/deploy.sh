#!/bin/bash
# ═══════════════════════════════════════════════════════════
# ConstructPM — Server Setup & Deploy Script
# ═══════════════════════════════════════════════════════════
#
# FIRST TIME SETUP (on a fresh Ubuntu 22+ VPS):
#   1. Copy project folder to server:  scp -r project/ root@YOUR_IP:/opt/constructpm/
#   2. SSH into server:                ssh root@YOUR_IP
#   3. Run setup:                      cd /opt/constructpm && ./deploy.sh setup
#   4. Edit your env:                  nano .env.production
#   5. Get SSL certificate:            ./deploy.sh ssl
#   6. Start everything:               ./deploy.sh start
#
# SUBSEQUENT UPDATES:
#   On your local machine:             scp -r project/ root@YOUR_IP:/opt/constructpm/
#   On the server:                     cd /opt/constructpm && ./deploy.sh update
#
# COMMANDS:
#   ./deploy.sh setup     — Install Docker, configure server (run once)
#   ./deploy.sh ssl       — Get free SSL certificate from Let's Encrypt
#   ./deploy.sh start     — Start the application
#   ./deploy.sh stop      — Stop the application
#   ./deploy.sh update    — Rebuild and restart (preserves data)
#   ./deploy.sh logs      — View application logs
#   ./deploy.sh backup    — Backup database
#   ./deploy.sh status    — Show running containers
#   ./deploy.sh secrets   — Generate random JWT secrets

set -e

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

case "$1" in

  # ── FIRST-TIME SERVER SETUP ────────────────────────────
  setup)
    info "Installing Docker..."
    if ! command -v docker &> /dev/null; then
      curl -fsSL https://get.docker.com | sh
      systemctl enable docker
      systemctl start docker
      info "Docker installed"
    else
      info "Docker already installed"
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
      apt-get install -y docker-compose-plugin 2>/dev/null || true
    fi

    # Create env file from template if it doesn't exist
    if [ ! -f "$ENV_FILE" ]; then
      cp .env.production.example "$ENV_FILE"
      warn "Created $ENV_FILE — EDIT THIS FILE before starting!"
      warn "  nano $ENV_FILE"
    fi

    # Generate secrets if still default
    if grep -q "CHANGE_ME" "$ENV_FILE" 2>/dev/null; then
      warn "Your .env.production still has default values."
      warn "Run './deploy.sh secrets' to generate JWT secrets, then edit the rest."
    fi

    # Firewall
    if command -v ufw &> /dev/null; then
      ufw allow 80/tcp
      ufw allow 443/tcp
      ufw allow 22/tcp
      info "Firewall configured (ports 22, 80, 443)"
    fi

    info "Setup complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Edit .env.production with your settings"
    echo "  2. Run: ./deploy.sh secrets    (generates JWT secrets)"
    echo "  3. Run: ./deploy.sh ssl        (gets SSL certificate)"
    echo "  4. Run: ./deploy.sh start      (launches the app)"
    ;;

  # ── GENERATE SECRETS ───────────────────────────────────
  secrets)
    JWT=$(openssl rand -hex 32)
    REFRESH=$(openssl rand -hex 32)
    DBPASS=$(openssl rand -hex 16)

    if [ -f "$ENV_FILE" ]; then
      sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT|" "$ENV_FILE"
      sed -i "s|JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$REFRESH|" "$ENV_FILE"
      # Only replace DB password if it's still the default
      sed -i "s|DB_PASSWORD=CHANGE_ME_TO_A_STRONG_PASSWORD|DB_PASSWORD=$DBPASS|" "$ENV_FILE"
      info "Secrets written to $ENV_FILE"
    else
      echo "JWT_SECRET=$JWT"
      echo "JWT_REFRESH_SECRET=$REFRESH"
      echo "DB_PASSWORD=$DBPASS"
      warn "No $ENV_FILE found — copy these values manually"
    fi
    ;;

  # ── SSL CERTIFICATE ────────────────────────────────────
  ssl)
    if [ ! -f "$ENV_FILE" ]; then
      err "No $ENV_FILE — run setup first"
    fi

    source "$ENV_FILE"
    if [ -z "$DOMAIN" ]; then
      err "Set DOMAIN in $ENV_FILE first (e.g., app.yourcompany.com)"
    fi

    # Replace YOURDOMAIN in nginx config
    sed -i "s/YOURDOMAIN/$DOMAIN/g" nginx/nginx.conf
    info "Nginx configured for $DOMAIN"

    # Start nginx temporarily for ACME challenge
    mkdir -p nginx/certs
    info "Getting SSL certificate for $DOMAIN..."

    # First, start with a temporary self-signed cert so nginx can boot
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d nginx 2>/dev/null || true

    # Get the real cert
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm certbot \
      certbot certonly --webroot --webroot-path=/var/www/certbot \
      --email admin@${DOMAIN} --agree-tos --no-eff-email \
      -d "$DOMAIN"

    info "SSL certificate obtained for $DOMAIN"
    info "Auto-renewal is configured via the certbot container"

    # Restart nginx with real cert
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart nginx 2>/dev/null || true
    ;;

  # ── START ──────────────────────────────────────────────
  start)
    if [ ! -f "$ENV_FILE" ]; then
      err "No $ENV_FILE — run setup first"
    fi
    info "Starting ConstructPM..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build
    info "Application started!"
    echo ""
    echo "  Login: https://$(grep DOMAIN $ENV_FILE | cut -d= -f2)"
    echo "  Default credentials: admin@company.com / ChangeMe123!"
    echo "  ** CHANGE THE ADMIN PASSWORD IMMEDIATELY **"
    ;;

  # ── STOP ───────────────────────────────────────────────
  stop)
    info "Stopping ConstructPM..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down
    info "Stopped (data preserved)"
    ;;

  # ── UPDATE (rebuild without losing data) ───────────────
  update)
    if [ ! -f "$ENV_FILE" ]; then
      err "No $ENV_FILE — run setup first"
    fi

    info "Backing up database first..."
    $0 backup

    info "Rebuilding and restarting..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build
    info "Update complete!"
    ;;

  # ── LOGS ───────────────────────────────────────────────
  logs)
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs -f --tail=100 ${2:-api}
    ;;

  # ── BACKUP ─────────────────────────────────────────────
  backup)
    mkdir -p backups
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    FILE="backups/backup_${TIMESTAMP}.sql"
    docker exec constructpm_db pg_dump -U ${DB_USER:-postgres} ${DB_NAME:-construct_mgr} > "$FILE"
    SIZE=$(du -h "$FILE" | cut -f1)
    info "Backup saved: $FILE ($SIZE)"
    ;;

  # ── STATUS ─────────────────────────────────────────────
  status)
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
    ;;

  # ── HELP ───────────────────────────────────────────────
  *)
    echo "ConstructPM Deploy Script"
    echo ""
    echo "Usage: ./deploy.sh <command>"
    echo ""
    echo "Commands:"
    echo "  setup     Install Docker, configure server (first time)"
    echo "  secrets   Generate random JWT secrets"
    echo "  ssl       Get free SSL certificate (Let's Encrypt)"
    echo "  start     Start the application"
    echo "  stop      Stop the application"
    echo "  update    Rebuild and restart (data preserved)"
    echo "  logs      View logs (default: api, or specify: logs db)"
    echo "  backup    Backup database"
    echo "  status    Show container status"
    ;;
esac
