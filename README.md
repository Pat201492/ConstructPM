# ConstructPM

Self-hosted construction project management platform for a single electrical
contracting firm (~30 mobile users, ~12 office users). Replaces SaaS tools like
Procore and eMaint with a custom Node.js + PostgreSQL stack, a vanilla-JS web
app, and a React Native mobile app.

**Core principle:** *minimize user input, maximize user verification.* Data
enters via file uploads → AI extracts structured fields → users confirm via
checkboxes → the database populates.

---

## Repository layout — read this first

This repository root is a **handoff wrapper**. The actual application lives in
[`project/`](project/). The root holds only cross-cutting documentation:

| Path | What it is |
|------|------------|
| `project/` | **The application** — backend (Express/Knex/PostgreSQL), `public/` web SPA, `mobile/` React Native app, `migrations/`, `seeds/`, `tests/`. All code lives here. |
| `PROJECT_REFERENCE.md` | **Authoritative reference** — architecture, metrics, file inventory, schema, roles, notifications. Start here for "what exists and why." |
| `CLAUDE.md` | Repo conventions / onboarding entry point for AI sessions and new contributors. |
| `HANDOFF_PACKAGE.md` | Narrative handoff — build history, known debt, deployment runbook, test users. |
| `project/docs/diagrams/` | The four system diagrams (`.svg`) + their index. |
| `project/docs/TERMINOLOGY.md` | Authoritative glossary (Firm → Customer → Location, roles, doc types). |
| `project/docs/FUTURE_REFINEMENTS/` | Deferred-feature design docs. |
| `MOBILE_APP_REFERENCE.md`, `TESTING.md`, `DEPLOY.md`, etc. | Topic-specific references kept at the root. |

Almost every command below is run **from inside `project/`**.

---

## Local setup

### What you need before starting

| Software | Why | Download |
|----------|-----|----------|
| **Docker Desktop** | Runs the database + app in containers | https://www.docker.com/products/docker-desktop/ |
| **Ollama** | Local AI for document extraction (free) | https://ollama.com/download |

Docker handles everything else (Node.js, PostgreSQL, Redis).

### Step 1 — Install Docker Desktop

- **Windows**: download, run the installer (accept defaults), restart when
  prompted, open Docker Desktop and wait for **"Docker Desktop is running"**.
  Accept WSL2 if it asks.
- **Mac**: download, drag to Applications, open, grant permissions, wait for the
  whale icon in the menu bar to settle.
- **Linux**:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER   # log out and back in
  docker --version
  ```

### Step 2 — Install Ollama and pull the model

```bash
ollama pull llama3:8b   # ~4.7 GB; this is the AI extraction model
ollama list             # should show llama3:8b
```

Ollama runs in the background after install.

### Step 3 — Start the system

From the `project/` folder:

```bash
docker compose up --build
```

This downloads PostgreSQL and Redis, builds the Node app container with
Tesseract OCR, runs the Knex migrations, seeds the admin user + default config,
and starts the server. When it is ready you'll see:

```
========================================
  Server: http://localhost:3000
  Login:  admin@company.com / ChangeMe123!
========================================
```

Open **http://localhost:3000** and log in.

### Step 4 — First-time setup (after login)

Go to the **Admin** page and configure, in order:

- **Rate Sheet** — union rates (Local + Classification + ST/OT/DT), or use
  **Bulk Import** to upload a rate-sheet Excel/CSV and map columns.
- **Global Variables** — `dollar_per_mile`, `home_location_address`,
  `bid_inactivity_threshold_days`, etc.
- **Users** — create people with email, password, name, initials, role.
  Roles: `admin` · `project_manager` · `estimator` · `accounting` ·
  `shop_staff` · `field_staff` (`scheduler` is a configurable role for
  scheduling features).
- **Templates** (optional) — upload a `.docx` per PM with `{Field Name}` merge
  fields like `{Customer Name}`, `{Bid Amount}`, `{Location Name}`.

---

## Daily commands (run from `project/`)

| Action | Command |
|--------|---------|
| Start | `docker compose up` |
| Stop | `Ctrl+C` or `docker compose down` |
| Rebuild after a code change | `docker compose up --build` |
| Fresh start (wipe database) | `docker compose down -v` then `docker compose up --build` |
| Run migrations locally | `npm run migrate` |
| Run tests | `npm run test:unit` (unit) / `npm test` (all) |
| Backup database | `docker exec constructpm_db pg_dump -U postgres construct_mgr > backup.sql` |
| Restore database | `docker exec -i constructpm_db psql -U postgres construct_mgr < backup.sql` |

The `-v` flag wipes the database volume — needed after destructive schema
changes or when the DB is in a half-migrated state. File storage persists on
disk in `project/storage/` regardless of Docker restarts.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port 3000 in use | Change `"3000:3000"` → `"3001:3000"` in `docker-compose.yml`, open http://localhost:3001 |
| Port 5432 in use | A local PostgreSQL is running — stop it or change the port |
| Ollama not connecting | Ensure `ollama serve` is running. On Linux set `OLLAMA_HOST=http://172.17.0.1:11434` |
| Slow first extraction | Normal — Ollama loads the model into memory on the first call |
| Docker won't start (Windows) | Enable WSL2 in Docker Desktop settings |

The app is reachable on your LAN at `http://YOUR_IP:3000` (find your IP with
`ipconfig` / `ifconfig`; open port 3000 in the firewall if needed).

---

## Where to go next

- **Understand the system** → [`PROJECT_REFERENCE.md`](PROJECT_REFERENCE.md)
- **Conventions before editing code** → [`CLAUDE.md`](CLAUDE.md)
- **Diagrams** → [`project/docs/diagrams/`](project/docs/diagrams/)
- **Build history / deployment runbook / known debt** → [`HANDOFF_PACKAGE.md`](HANDOFF_PACKAGE.md)
- **Manual test walkthrough** → [`TESTING.md`](TESTING.md)
