# ConstructPM — Web Deployment Guide

## Quick Start (15 minutes)

### 1. Get a Server

Any Ubuntu 22+ VPS works. Recommended providers:

| Provider | ~$10/month plan | Notes |
|----------|----------------|-------|
| DigitalOcean | 2 CPU / 4GB RAM | Best docs, simple |
| Hetzner | 2 CPU / 4GB RAM | Cheapest for EU |
| Linode | 2 CPU / 4GB RAM | Good US performance |
| Vultr | 2 CPU / 4GB RAM | Many locations |

> **No GPU needed** if you set `AI_BACKEND=claude` and use your Anthropic API key.
> With GPU (for local Ollama): get a server with an NVIDIA GPU, or run Ollama separately.

### 2. Get a Domain

Buy a domain or use a subdomain. Point an **A record** to your server's IP:

```
Type: A
Name: app (or @ for root domain)
Value: YOUR_SERVER_IP
TTL: 300
```

### 3. Upload Code to Server

From your local machine:
```bash
scp -r project/ root@YOUR_SERVER_IP:/opt/constructpm/
```

### 4. SSH In and Run Setup

```bash
ssh root@YOUR_SERVER_IP
cd /opt/constructpm

# Install Docker + configure server
./deploy.sh setup

# Generate secure passwords and JWT secrets
./deploy.sh secrets

# Edit your config
nano .env.production
# → Set DOMAIN to your domain (e.g., app.yourcompany.com)
# → Secrets are already filled in by the step above
# → Add ANTHROPIC_API_KEY if using Claude for AI

# Get free SSL certificate
./deploy.sh ssl

# Start everything
./deploy.sh start
```

### 5. Access Your App

Open `https://app.yourcompany.com` in your browser.

**Default login:** `admin@company.com` / `ChangeMe123!`

**Change the admin password immediately** via Admin → Users → Edit.

---

## Updating

When you have a new version:

```bash
# On your local machine — upload new code
scp -r project/ root@YOUR_SERVER_IP:/opt/constructpm/

# On the server
cd /opt/constructpm
./deploy.sh update    # backs up DB, rebuilds, restarts — data preserved
```

---

## Commands Reference

| Command | What it does |
|---------|-------------|
| `./deploy.sh setup` | Install Docker, configure firewall (first time only) |
| `./deploy.sh secrets` | Generate random JWT secrets + DB password |
| `./deploy.sh ssl` | Get free SSL certificate from Let's Encrypt |
| `./deploy.sh start` | Build and start all containers |
| `./deploy.sh stop` | Stop containers (data preserved) |
| `./deploy.sh update` | Backup → rebuild → restart |
| `./deploy.sh backup` | Backup database to backups/ folder |
| `./deploy.sh logs` | View app logs (Ctrl+C to exit) |
| `./deploy.sh logs db` | View database logs |
| `./deploy.sh status` | Show running containers |

---

## Without GPU (Cloud AI Only)

If your server has no GPU, set these in `.env.production`:

```
AI_BACKEND=claude
ANTHROPIC_API_KEY=sk-ant-...your-key...
```

The app uses Claude API for document extraction instead of local Ollama. Costs ~$3-15/month depending on usage.

---

## Multiple Companies

Each company gets their own server (or their own Docker stack on a shared server).

**Separate servers (simplest):**
- Company A: `acme.constructpm.com` → Server A
- Company B: `bob.constructpm.com` → Server B

**Same server, different ports:**
1. Copy project folder: `cp -r /opt/constructpm /opt/constructpm-companyb`
2. Edit `.env.production` with different DB_NAME and ports
3. Edit `docker-compose.prod.yml` to use different container names and ports
4. Run separate stacks

---

## Backups

Automatic: Set up a cron job:
```bash
crontab -e
# Add this line (backs up every night at 2 AM):
0 2 * * * cd /opt/constructpm && ./deploy.sh backup
```

Manual: `./deploy.sh backup`

Restore: `docker exec -i constructpm_db psql -U postgres construct_mgr < backups/backup_FILE.sql`

---

## Troubleshooting

**Can't connect:** Check firewall (`ufw status`), DNS propagation (`dig youromain.com`)

**SSL error:** Make sure DNS is pointing to your server IP, then re-run `./deploy.sh ssl`

**App crashes:** Check logs with `./deploy.sh logs`

**Database issues:** Check DB logs with `./deploy.sh logs db`
