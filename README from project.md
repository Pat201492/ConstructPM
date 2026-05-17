# ConstructPM — Local Setup Guide

## What You Need Before Starting

| Software | Why | Download |
|----------|-----|----------|
| **Docker Desktop** | Runs the database + app in containers | https://www.docker.com/products/docker-desktop/ |
| **Ollama** | Local AI for document extraction (free) | https://ollama.com/download |

That's it. Docker handles everything else (Node.js, PostgreSQL, Redis).

---

## Step 1: Install Docker Desktop

### Windows
1. Download from https://www.docker.com/products/docker-desktop/
2. Run the installer — accept defaults
3. Restart your computer when prompted
4. Open Docker Desktop — wait for it to say **"Docker Desktop is running"**
5. If it asks about WSL2, click **Yes** to install it

### Mac
1. Download from https://www.docker.com/products/docker-desktop/
2. Drag to Applications, open it
3. Grant permissions when asked
4. Wait for the whale icon in the menu bar to stop animating

### Linux
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in, then:
docker --version
```

---

## Step 2: Install Ollama

### Windows
1. Download from https://ollama.com/download
2. Run the installer
3. Open **PowerShell** and run:
```
ollama pull llama3:8b
```
4. Wait for the download (~4.7 GB). This is the AI model.
5. Ollama runs in the background automatically after install.

### Mac
1. Download from https://ollama.com/download
2. Open Terminal and run:
```bash
ollama pull llama3:8b
```

### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3:8b
```

**Verify it works:**
```
ollama list
```
You should see `llama3:8b` in the list.

---

## Step 3: Extract the Project

### Windows
1. Download `construction_pm_v2_complete.tar.gz`
2. Right-click → **Extract All** (or use 7-Zip)
3. Move the `project` folder to `C:\ConstructPM\`

### Mac / Linux
```bash
mkdir ~/ConstructPM && cd ~/ConstructPM
tar -xzf construction_pm_v2_complete.tar.gz
cd project
```

---

## Step 4: Start the System

Open a terminal in the `project` folder:

```bash
docker compose up --build
```

### What happens:
1. Docker downloads PostgreSQL and Redis (~200 MB first time)
2. Builds the Node.js app container with Tesseract OCR
3. Runs database migrations (creates 34 tables)
4. Seeds admin user + default config
5. Server starts

You'll see:
```
========================================
  Server: http://localhost:3000
  Login:  admin@company.com / ChangeMe123!
========================================
```

Open **http://localhost:3000** in your browser and log in.

---

## Step 5: First-Time Setup (do this after login)

Go to the **Admin** page. Configure these tabs in order:

### Rate Sheet
Add your union rates. Each row is: Local + Classification + ST/OT/DT rates.

Or click **Bulk Import** tab → upload your rate sheet Excel/CSV → map columns → import.

### Global Variables
Set your company values:
- `dollar_per_mile` → your current rate (default 0.67)
- `home_location_address` → your shop/HQ address
- `bid_inactivity_threshold_days` → days before archive prompt (default 30)

### Create Your Users
Go to Admin or call the API. Each person needs: email, password, name, initials, role.

Roles: `admin` · `project_manager` · `accounting` · `shop_staff` · `field_staff`

### Upload Bid Templates (optional)
Admin → Templates tab. Upload a `.docx` per PM. Use merge fields like `{Customer Name}`, `{Bid Amount}`, `{Location Name}`, `{Job Scope}`.

---

## Daily Commands

| Action | Command |
|--------|---------|
| **Start** | `docker compose up` |
| **Stop** | `Ctrl+C` or `docker compose down` |
| **Rebuild after code change** | `docker compose up --build` |
| **Fresh start (wipe database)** | `docker compose down -v` then `docker compose up --build` |
| **Backup database** | `docker exec constructpm_db pg_dump -U postgres construct_mgr > backup.sql` |
| **Restore database** | `docker exec -i constructpm_db psql -U postgres construct_mgr < backup.sql` |
| **Backup files** | Copy the `storage/` folder |

---

## Where Your Files Live

```
project/storage/
├── bids/              ← Bid folders (Excel + Word docs)
├── projects/          ← Project folders with filed documents
│   └── {year}/{PM}/{Customer}/{Project}/
│       ├── invoices/
│       ├── timesheets/
│       ├── purchase_orders/
│       └── Contract_PO/
├── inbox/             ← Temporary (moved after confirmation)
├── templates/bid/     ← PM bid templates (.docx)
└── equipment_docs/    ← Calibration certs, inspection reports
```

These persist on your hard drive even when Docker restarts.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port 3000 in use | Change `"3000:3000"` to `"3001:3000"` in docker-compose.yml, open http://localhost:3001 |
| Port 5432 in use | You have PostgreSQL installed locally. Stop it or change the port. |
| Ollama not connecting | Make sure `ollama serve` is running. On Linux change OLLAMA_HOST to `http://172.17.0.1:11434` |
| Slow first extraction | Normal — Ollama loads the model into memory on first call. After that it's fast. |
| Handwritten doc accuracy low | Expected. Tesseract is weaker on handwriting. User corrects via checkboxes. |
| Docker won't start (Windows) | Enable WSL2 in Docker Desktop settings. |

---

## Access From Other Computers

The app is already accessible on your LAN at `http://YOUR_IP:3000`.

Find your IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux).

Open port 3000 in Windows Firewall if other computers can't connect.

---

## GPU Check (for Ollama performance)

Ollama uses your GPU if available. Check:
```bash
ollama ps
```

If it shows CPU instead of GPU, make sure you have:
- NVIDIA GPU with updated drivers
- CUDA toolkit installed (Ollama handles this on Windows/Mac usually)

Without a GPU: extractions take 15-30 seconds instead of 3-8 seconds. Still works, just slower.
