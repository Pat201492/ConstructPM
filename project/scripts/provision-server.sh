#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Initial Server Setup for Construction PM Platform
#
# Run this ONCE on a fresh Ubuntu 22.04+ server.
# Prerequisites: SSH access with sudo.
#
# Usage: ssh user@server 'bash -s' < scripts/provision-server.sh
# ══════════════════════════════════════════════════════════════

set -e

echo "╔═══════════════════════════════════════════════╗"
echo "║  Construction PM — Server Provisioning        ║"
echo "╚═══════════════════════════════════════════════╝"

# 1. System updates
echo ""
echo "[1/7] Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

# 2. Install Docker
echo ""
echo "[2/7] Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "  ✓ Docker installed"
else
  echo "  ✓ Docker already installed"
fi

# 3. Install Docker Compose
echo ""
echo "[3/7] Installing Docker Compose..."
if ! command -v docker compose &> /dev/null; then
  sudo apt-get install -y docker-compose-plugin
  echo "  ✓ Docker Compose installed"
else
  echo "  ✓ Docker Compose already installed"
fi

# 4. Create application directory
echo ""
echo "[4/7] Creating application directory..."
sudo mkdir -p /opt/construction-pm
sudo chown $USER:$USER /opt/construction-pm
cd /opt/construction-pm

# 5. Create required directories
echo ""
echo "[5/7] Creating data directories..."
mkdir -p storage/{bids,projects,temp,templates/bid}
mkdir -p backups
mkdir -p nginx/certs
echo "  ✓ Directories created"

# 6. Set up firewall
echo ""
echo "[6/7] Configuring firewall..."
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw --force enable
echo "  ✓ Firewall configured (ports 22, 80, 443)"

# 7. Set up automatic security updates
echo ""
echo "[7/7] Configuring automatic security updates..."
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
echo "  ✓ Automatic updates configured"

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║  Server provisioned!                          ║"
echo "║                                               ║"
echo "║  Next steps:                                  ║"
echo "║  1. Clone your repo to /opt/construction-pm   ║"
echo "║  2. Copy .env.production.example →            ║"
echo "║     .env.production and fill in secrets       ║"
echo "║  3. Add SSL certs to nginx/certs/             ║"
echo "║  4. Run: bash scripts/deploy.sh               ║"
echo "╚═══════════════════════════════════════════════╝"
