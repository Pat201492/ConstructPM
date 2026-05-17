# Deployment Guide: Windows Testing Setup

## What You're About to Do

You're going to install one program (Docker Desktop), run one command, and have the
entire platform running on your laptop — database, server, and all. No need to
install PostgreSQL, Redis, or Node.js separately. Docker handles everything.

**Time needed:** ~20 minutes (mostly waiting for downloads)

---

## Step 1: Install Docker Desktop

Docker is a tool that runs applications in isolated containers. Think of it as
a lightweight virtual machine that already has everything pre-configured.

1. Go to: **https://www.docker.com/products/docker-desktop/**
2. Click **"Download for Windows"**
3. Run the installer (Docker Desktop Installer.exe)
4. During installation:
   - Check **"Use WSL 2 instead of Hyper-V"** (recommended)
   - If prompted to install WSL 2, say yes
5. After installation, **restart your computer** (required)
6. Open Docker Desktop from your Start Menu
7. Wait for it to say **"Docker Desktop is running"** (the whale icon in your
   system tray should be steady, not animating)

**If you hit issues:**
- If it says "WSL 2 is not installed", open PowerShell as Admin and run:
  `wsl --install` then restart
- If it says "Virtualization must be enabled", you need to enable it in your
  BIOS settings (Google your laptop model + "enable virtualization")

---

## Step 2: Get the Project Files

You downloaded a file called `construction_pm_complete.tar.gz` from our conversation.

1. Create a folder on your computer. I recommend: `C:\Projects\construction-pm`
2. Extract the tar.gz file into that folder. You should see two folders inside:
   - `project/` (the backend server)
   - `mobile/` (the phone app — we'll ignore this for now)

**How to extract .tar.gz on Windows:**
- If you have 7-Zip: Right-click → 7-Zip → Extract Here (you may need to do
  this twice — once for .gz, once for .tar)
- If you have WinRAR: Right-click → Extract Here
- Or use the built-in Windows tar: Open PowerShell in your Downloads folder and run:
  ```
  tar -xzf construction_pm_complete.tar.gz -C C:\Projects\construction-pm
  ```

After extracting, your folder should look like:
```
C:\Projects\construction-pm\
  project\
    docker-compose.yml    ← This is the key file
    Dockerfile
    src\
    migrations\
    ...
  mobile\
    ...
```

---

## Step 3: Start the Platform

1. Open **PowerShell** or **Command Prompt**
2. Navigate to the project folder:
   ```
   cd C:\Projects\construction-pm\project
   ```
3. Run this single command:
   ```
   docker compose up --build
   ```

**What happens next (this takes 3-5 minutes the first time):**
- Docker downloads PostgreSQL, Redis, and Node.js images (~500MB total)
- It builds your API server into a container
- It starts the database and waits for it to be healthy
- It runs the database migrations (creates all 15 tables)
- It seeds the admin user
- You'll see:
  ```
  ========================================
    Server: http://localhost:3000
    Health: http://localhost:3000/api/health
    Login:  admin@company.com / ChangeMe123!
  ========================================
  ```

**Leave this window open.** The server runs as long as this window is open.

---

## Step 4: Verify It's Working

Open your web browser and go to:

**http://localhost:3000/api/health**

You should see:
```json
{
  "status": "ok",
  "timestamp": "2026-04-08T...",
  "environment": "development",
  "version": "1.0.0"
}
```

If you see that — the backend is running.

---

## Step 5: Test the API

The easiest way to test API endpoints on Windows is with a free tool called
**Postman** or the built-in **PowerShell** commands. I'll show both.

### Option A: Use Postman (Recommended — visual interface)

1. Download Postman: **https://www.postman.com/downloads/**
2. Install and open it (you can skip creating an account)

**Test 1: Login**
- Method: `POST`
- URL: `http://localhost:3000/api/auth/login`
- Body tab → raw → JSON:
  ```json
  {
    "email": "admin@company.com",
    "password": "ChangeMe123!"
  }
  ```
- Click Send
- You'll get back an `accessToken` — **copy this token**, you need it for every
  other request

**Test 2: Create a Customer**
- Method: `POST`
- URL: `http://localhost:3000/api/customers`
- Headers tab → Add:
  - Key: `Authorization`
  - Value: `Bearer <paste your token here>`
- Body tab → raw → JSON:
  ```json
  {
    "name": "Harbor Logistics",
    "contact_name": "Mike Johnson",
    "email": "mike@harborlogistics.com",
    "phone": "201-555-0100",
    "address": "50 Meadowlands Pkwy",
    "city": "Secaucus",
    "state": "NJ",
    "zip": "07094"
  }
  ```
- Click Send — you'll get the customer back with an ID

**Test 3: Create a Bid**
- Method: `POST`
- URL: `http://localhost:3000/api/bids`
- Headers: same Authorization as above
- Body:
  ```json
  {
    "bid_number": "B-2026-001",
    "project_location": "Newark, NJ",
    "project_scope": "Office Renovation",
    "customer_id": "<paste customer ID from Test 2>",
    "estimated_value": 285000
  }
  ```
- Click Send — the bid is created AND the folder structure is generated

**Test 4: Mark the Bid as Won (creates a project)**
- Method: `POST`
- URL: `http://localhost:3000/api/bids/<bid-id>/mark-won`
  (replace <bid-id> with the ID from Test 3)
- Headers: same Authorization
- Body:
  ```json
  {
    "contract_value": 295000,
    "start_date": "2026-05-01"
  }
  ```
- Click Send — you'll get both the updated bid AND the new project back

**Test 5: Create a User**
- Method: `POST`
- URL: `http://localhost:3000/api/users`
- Headers: same Authorization
- Body:
  ```json
  {
    "email": "mike@company.com",
    "password": "MikePM2026!",
    "first_name": "Mike",
    "last_name": "Torres",
    "role": "project_manager",
    "phone": "201-555-0200"
  }
  ```

### Option B: Use PowerShell (no extra software)

Open a NEW PowerShell window (keep the Docker one running) and run these:

```powershell
# Login
$login = Invoke-RestMethod -Uri http://localhost:3000/api/auth/login `
  -Method POST -ContentType "application/json" `
  -Body '{"email":"admin@company.com","password":"ChangeMe123!"}'

$token = $login.accessToken
$headers = @{ Authorization = "Bearer $token" }

# View your profile
Invoke-RestMethod -Uri http://localhost:3000/api/auth/me -Headers $headers

# Create a customer
$customer = Invoke-RestMethod -Uri http://localhost:3000/api/customers `
  -Method POST -Headers $headers -ContentType "application/json" `
  -Body '{"name":"Harbor Logistics","contact_name":"Mike Johnson","city":"Secaucus","state":"NJ"}'

$customer.customer.id  # Shows the customer ID

# Create a bid
$bid = Invoke-RestMethod -Uri http://localhost:3000/api/bids `
  -Method POST -Headers $headers -ContentType "application/json" `
  -Body "{`"bid_number`":`"B-2026-001`",`"project_location`":`"Newark, NJ`",`"project_scope`":`"Office Renovation`",`"customer_id`":`"$($customer.customer.id)`",`"estimated_value`":285000}"

$bid.bid.id  # Shows the bid ID

# Mark bid as won (creates project + folders)
$bidId = $bid.bid.id
$won = Invoke-RestMethod -Uri "http://localhost:3000/api/bids/$bidId/mark-won" `
  -Method POST -Headers $headers -ContentType "application/json" `
  -Body '{"contract_value":295000}'

$won.project  # Shows the new project

# List all projects
Invoke-RestMethod -Uri http://localhost:3000/api/projects -Headers $headers

# List all bids
Invoke-RestMethod -Uri http://localhost:3000/api/bids -Headers $headers
```

---

## Step 6: Test the Web Frontend

The React frontend you saw in our conversation runs as a standalone preview.
To test it against your live backend:

1. In our Claude conversation, scroll up to the React frontend artifact
2. It should connect to `http://localhost:3000` automatically
3. Log in with `admin@company.com` / `ChangeMe123!`

If the frontend is in "demo mode" (showing fake data), that means it couldn't
reach the backend — check that Docker is still running.

---

## Everyday Commands

**Start the platform** (from the project folder):
```
docker compose up
```

**Start in background** (runs without keeping a window open):
```
docker compose up -d
```

**View logs** (when running in background):
```
docker compose logs -f api
```

**Stop the platform:**
```
docker compose down
```
Or press `Ctrl+C` in the window where it's running.

**Stop AND delete all data** (fresh start):
```
docker compose down -v
```
The `-v` flag deletes the database volume, so next time you start it'll be
a completely fresh database.

**Rebuild after code changes:**
```
docker compose up --build
```

---

## Complete API Endpoint Reference (for testing)

All endpoints require the Authorization header except /auth/login and /health.

### Auth
| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/auth/login | Login → get token |
| POST | /api/auth/refresh | Refresh expired token |
| GET  | /api/auth/me | View your profile |

### Users (Admin only)
| Method | URL | Description |
|--------|-----|-------------|
| GET    | /api/users | List all users |
| POST   | /api/users | Create user |
| PATCH  | /api/users/:id | Update user |
| DELETE | /api/users/:id | Deactivate user |

### Customers
| Method | URL | Description |
|--------|-----|-------------|
| GET    | /api/customers | List customers |
| POST   | /api/customers | Create customer |
| PATCH  | /api/customers/:id | Update customer |

### Bids
| Method | URL | Description |
|--------|-----|-------------|
| GET    | /api/bids | List bids |
| GET    | /api/bids/stats | Win rate & stats |
| POST   | /api/bids | Create bid + folders |
| PATCH  | /api/bids/:id | Update bid |
| POST   | /api/bids/:id/mark-won | Won → creates project |
| POST   | /api/bids/:id/mark-lost | Mark as lost |

### Projects
| Method | URL | Description |
|--------|-----|-------------|
| GET    | /api/projects | List projects |
| GET    | /api/projects/:id | Detail + financials |
| PATCH  | /api/projects/:id | Update project |
| POST   | /api/projects/:id/team | Assign user |
| GET    | /api/projects/:id/files/invoices | List invoice files |

### File Uploads
| Method | URL | Description |
|--------|-----|-------------|
| POST   | /api/files/bid/:bidId | Upload to bid folder |
| POST   | /api/files/project/:id/invoices | Upload invoice → AI scan |
| POST   | /api/files/project/:id/timesheets | Upload timesheet → AI scan |
| POST   | /api/files/project/:id/purchase_orders | Upload PO → AI scan |
| POST   | /api/files/project/:id/contracts | Upload contract → AI scan |

### AI Review Queue
| Method | URL | Description |
|--------|-----|-------------|
| GET    | /api/extractions | List pending reviews |
| GET    | /api/extractions/:id | View AI's guess |
| POST   | /api/extractions/:id/confirm | Accept/correct data |
| POST   | /api/extractions/:id/reject | Reject extraction |
| POST   | /api/extractions/:id/retry | Re-process |

### Timesheets
| Method | URL | Description |
|--------|-----|-------------|
| POST   | /api/timesheets/submit | Mobile timesheet submit |
| GET    | /api/projects/:id/timesheets | List project timesheets |
| PATCH  | /api/projects/:id/timesheets/:tsId/approve | Approve |

### Inventory
| Method | URL | Description |
|--------|-----|-------------|
| GET    | /api/inventory | List items |
| POST   | /api/inventory | Add item |
| POST   | /api/inventory/:id/allocate | Pull for project |
| POST   | /api/inventory/:id/receive | Receive delivery |
| GET    | /api/inventory/low-stock | Low stock alerts |

### CSV Exports
| Method | URL | Description |
|--------|-----|-------------|
| GET    | /api/exports/sources | List exportable data |
| GET    | /api/exports/quickbooks/bills | QB bill import CSV |
| GET    | /api/exports/quickbooks/timesheets | QB timesheet CSV |
| GET    | /api/exports/quickbooks/purchase-orders | QB PO CSV |
| GET    | /api/exports/procore/budget | Procore budget CSV |
| GET    | /api/exports/procore/invoices | Procore invoice CSV |
| GET    | /api/exports/procore/timecards | Procore timecard CSV |
| POST   | /api/exports/custom | Custom CSV export |

### Notifications
| Method | URL | Description |
|--------|-----|-------------|
| GET    | /api/notifications | Your notifications |
| PATCH  | /api/notifications/:id/read | Mark as read |

---

## Troubleshooting

**"docker compose" is not recognized**
→ Docker Desktop isn't running. Open it from your Start Menu and wait for it
to finish starting.

**Port 5432 already in use**
→ You have PostgreSQL already installed on Windows. Either stop it
(Services → postgresql → Stop) or change the port in docker-compose.yml
from "5432:5432" to "5433:5432".

**Port 3000 already in use**
→ Another app is using port 3000. Change it in docker-compose.yml from
"3000:3000" to "3001:3000", then access the API at http://localhost:3001.

**Container keeps restarting**
→ Check the logs: `docker compose logs api`
→ Most common cause: database isn't ready yet. Wait 30 seconds and check again.

**"FATAL: password authentication failed"**
→ Old database volume with different password. Run: `docker compose down -v`
then `docker compose up --build`

**Changes to code aren't showing up**
→ You need to rebuild: `docker compose up --build`

**I want to start completely fresh**
→ `docker compose down -v` removes everything including the database.
Then `docker compose up --build` starts from scratch.
