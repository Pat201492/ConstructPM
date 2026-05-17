# ConstructPM v2 — Handoff Package

> **Date:** May 2026
> **Build status:** Functional, deployed in development. Latest tarball: `construction_pm_v2_fixed.tar.gz`
> **For:** Pat (project owner), the firm receiving the platform, or any future developer continuing this work
> **Use:** Upload this document at the start of any new conversation about this project to re-establish full context

---

## 1. What this is

ConstructPM v2 is a self-hosted construction project management platform built for a single electrical contracting firm (~30 mobile users, ~12 office users). It replaces SaaS tools like Procore and eMaint with a custom solution.

**Core design principle:** *minimize user input, maximize user verification.* Data enters via file uploads → AI extracts structured fields → users confirm via checkboxes → database populates. Manual typing only happens in: bid creation (customer/contact/location/scope), admin setup (rate sheets, global variables, users).

**Three-tier hierarchy** (terminology that must be used precisely):

```
Firm (the contracting company running the platform — Pat's client; one per deployment)
 └── Customer (the firm's clients: Turner, school districts, owners)
      └── Location (jobsite address)
```

Bids join one customer with one location. Won bids become projects. Projects roll up financials from invoices (revenue), POs + equipment + mileage (cost).

---

## 2. Current build metrics

| Metric | Value |
|---|---|
| Backend source | ~10,500 lines |
| Frontend (`public/index.html`) | ~5,200 lines |
| Database tables | 41 |
| Database enums | 14 |
| Migrations | 16 |
| API endpoints | 214 |
| Models | 13+ |
| Services | 13 (added `PdfStampService` this session) |
| Route files | 19 |
| Unit tests | 34 passing, 1 skipped (storage backend) |
| Mobile app | React Native / Expo, 11 screens, role-based layouts |

---

## 3. Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 20 (Alpine Docker) |
| Framework | Express 5 |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| ORM | Knex 3 |
| Auth | JWT (15m access + 30d refresh) |
| OCR | Tesseract.js primary, AWS Textract fallback |
| AI extraction | Ollama llama3:8b primary, Claude API fallback |
| Excel | ExcelJS |
| Word | docxtemplater + PizZip |
| PDF | pdf-lib (added this session) |
| Storage | Local disk default, S3 backend abstracted |
| Frontend | Vanilla JS SPA, no build step |
| Mobile | React Native / Expo |

---

## 4. Roles (6 total)

| Role | Mobile? | Web? | What they do |
|---|---|---|---|
| `admin` | yes | yes | Full system access; manages users, rates, globals, templates |
| `project_manager` (PM) | yes | yes | Owns bids and projects; quoting, mark won, verifies POs/invoices |
| `estimator` | yes | yes | Creates bids, hands off to PM via `assigned_pm_id` |
| `accounting` | yes | yes | Read-only all projects; CSV exports |
| `shop_staff` | yes | yes | Equipment management, kiosk display, inventory |
| `field_staff` | **mobile only** | no | Submits timesheets, oil samples, field notes from job site |
| `scheduler` | n/a | n/a | Placeholder — no permissions yet, exists for future scheduling features |

`foreman` was renamed to `field_staff` in the May 2026 batch. Old `foreman` enum value lingers harmlessly (Postgres can't drop enum values).

---

## 5. Key data flows

### Bid → Project
1. PM/Estimator selects customer/location/contact
2. System generates `YY-PMInitials-Seq` bid number, creates folder
3. Quoting: classification × personnel × ST/OT/DT, rates auto-locked to `bid_quote_lines`
4. Generate Docs (Excel + Word merge)
5. Mark Won: AI scans signed Word doc → verification → confirm
6. Project created with primary number `<PMCode><YY>-<LocCode>.<Seq>` (e.g. `M26-1308.1`)
7. Folder structure: `projects/<year>/<staff>/<customer>/<projectNumber>/{invoices,timesheets,purchase_orders,Contract}/`

### Inbox upload (invoice / PO / vendor quote / timesheet)
1. User uploads file via centralized inbox
2. Tesseract OCR + Ollama extracts structured fields
3. AI auto-detects project number; project picker is optional override (required for vendor quotes since they have no project info)
4. Notification sent to correct user (PM / delegate / shop / admin)
5. User reviews extracted fields on verification screen, confirms
6. Record created with **platform-canonical number** (`INV-M26-1308.1-001`, `M26-1308.1-PO-001`)
7. Original document number from source preserved in `external_reference`
8. PDF source filed under project subfolder; **stamped** in top-right corner with platform number (semi-transparent text, no box)
9. Vendor quotes: source PDF is **deleted** post-extraction (extraction creates a PO draft, original quote not retained)

### Financial rollup (real-time, not cached)
- Revenue = sum of non-cancelled invoice amounts
- Cost = POs + equipment days × cost + mileage cost
- Margin = Revenue - Cost
- WCI = avg(payment_received_date - invoice_date) for paid invoices
- **Billed % (new)** = revenue / contract_value × 100 (auto-recomputed on invoice mutations)

---

## 6. Recent changes (this conversation chain)

### Major batches (chronological)

**Date display + timezone capture (early session)**
- All timestamps in UI default to `MM/DD/YY`, click for full detail in popover
- Field notes capture author's IANA timezone at write time; display in author's local time
- Decision: **author-from-phone** approach (not location-based timezone) — see `docs/FUTURE_REFINEMENTS/02-location-based-timezone.md` for the deferred upgrade path

**Excel timesheet export**
- Replaced docx default with multi-sheet Excel workbook (one summary sheet + one detail sheet per worker per week)
- Embedded formulas — accountant edits propagate
- Word format kept as opt-in via `?format=docx`

**Terminology cleanup batch**
- `foreman` → `field_staff` everywhere in code, UI, mobile, tests
- Added `scheduler` placeholder role
- `t_and_m` enum value → `tm` (cleaner)
- `Contract_PO` folder → `Contract` (vendor contracts can live there too)
- Customer Code (toggleable placeholder for project number formats)
- Local Union displays as just digits (`164` not `Local 164`)
- Notification routing fixes: timesheet upload → informational, overdue + revenue-meets-contract → informational with yellow ⚠️ warning style
- Project status changeable in edit modal (was already there, just polished)
- New `total_personnel` and `percent_billed` columns on projects
- New `Billed %` column + stat card with yellow >100% warning (early signal of change orders)

**Inbox + extraction flow rework**
- Vendor Quotes inbox added (4th card) — quotes don't have project info, so picker is required
- AI extraction order-of-operations: AI reviews → user confirms (project picker optional for invoices/POs)
- Vendor quote → PO draft flow: extracts vendor + line items, creates PO draft, source quote deleted
- Vendor learning extends to vendor quotes via existing `vendor_profiles`
- `external_reference` column added: platform always assigns canonical number, original doc number preserved
- PDF stamping: invoices/POs uploaded via inbox get a single-line semi-transparent text stamp (`INV-M26-1308.1-001`) top-right of page 1

### Migration history (May 2026)

```
20260505_001_split_financials_tabs.js        Split financials UI into separate tabs
20260505_002_timezone_tracking.js            users.default_timezone, field_notes.author_timezone
20260505_002a_enum_additions.js              ⚠️ critical: enum values committed BEFORE use (see §8)
20260505_003_terminology_cleanup.js          Schema additions only, no enum value usage
20260505_003a_terminology_data_migration.js  UPDATE users SET role='field_staff', etc.
20260505_004_vendor_quote_doctype.js         doc_type: vendor_quote (now redundant — _002a does it)
20260505_005_external_reference.js           invoices/purchase_orders.external_reference
```

---

## 7. Test users (after migration runs)

All passwords `Password123!` except admin:

| Email | Password | Role | PM Code |
|---|---|---|---|
| `admin@company.com` | `ChangeMe123!` | admin | — |
| `mike.torres@company.com` | `Password123!` | project_manager | M |
| `sarah.chen@company.com` | `Password123!` | project_manager | S |
| `alex.kim@company.com` | `Password123!` | estimator | — |
| `jennifer.russo@company.com` | `Password123!` | accounting | — |
| `ray.jackson@company.com` | `Password123!` | shop_staff | — |
| `carlos.mendez@company.com` | `Password123!` | field_staff | — |
| `danny.oconnor@company.com` | `Password123!` | field_staff | — |
| `tyrell.brooks@company.com` | `Password123!` | field_staff | — |

---

## 8. Critical "gotchas" — must read before changing migrations

### Postgres enum quirk (cost us 3 deploy attempts this session)

Postgres rule: a new enum value added via `ALTER TYPE ... ADD VALUE` **cannot be used in the same transaction that added it**. Knex wraps each migration in a transaction by default.

If you ever add a new enum value AND want to migrate existing rows to use it, **you must split the work into two migrations**:

```js
// migration_A.js — adds enum value, no transaction wrapper
exports.config = { transaction: false };
exports.up = async (knex) => {
  await knex.raw(`ALTER TYPE my_enum ADD VALUE 'new_value'`);
};

// migration_B.js — uses the new value (runs after _A commits)
exports.up = async (knex) => {
  await knex('my_table').where('col', 'old').update({ col: 'new_value' });
};
```

This pattern is currently used for `_002a` (enum adds) → `_003` (schema only) → `_003a` (data migration). Follow it for any future enum work.

### Schema column assumptions

We hit two bugs this session where my migrations referenced columns that didn't exist:
- `global_variables.value_type` (doesn't exist — globals are stored as plain strings)
- `role_configurations.permissions` (exists but is NOT NULL with no default — must be supplied explicitly)

**Before writing any migration that inserts/updates rows, verify the actual table schema.** A Python audit script at the bottom of this section can scan migrations for missing NOT NULL columns.

### Other known constraints

- `role_configurations.role_name` is a string column, NOT the `user_role` enum — so inserting `'field_staff'` there is safe even before the enum value commits
- `pending_extractions` uses lazy DB loading intentionally (avoids crashing the test suite which runs without DB) — don't "fix" it
- Express route ordering matters: `/export` must be defined BEFORE `/:id` to avoid Express matching "export" as a UUID
- StorageService references `LocalBackend.js` and `S3Backend.js` files that don't exist — the abstraction is in `StorageService.js` itself. The skipped storage test reflects this. Either extract the backends into separate files or update the require paths.

### Pre-deployment audit script

Run this Python script before packaging any tarball to catch column-mismatch bugs:

```python
import re, glob

schema = {}
def parse_block(text, tname, schema):
    cols = schema.setdefault(tname, {})
    for line in text.split('\n'):
        m = re.search(r"t\.\w+\('([a-z_]+)'", line)
        if not m:
            if 't.timestamps' in line:
                cols.setdefault('created_at', {'notnull': True, 'has_default': True})
                cols.setdefault('updated_at', {'notnull': True, 'has_default': True})
            continue
        col = m.group(1)
        notnull = '.notNullable()' in line
        has_default = '.defaultTo(' in line or '.primary()' in line
        cols.setdefault(col, {'notnull': notnull, 'has_default': has_default})
        if notnull: cols[col]['notnull'] = True
        if has_default: cols[col]['has_default'] = True
    for d in re.findall(r"dropColumn\('([a-z_]+)'\)", text):
        cols.pop(d, None)

for f in sorted(glob.glob('migrations/*.js')):
    with open(f) as fh: text = fh.read()
    for m in re.finditer(r"(createTable|alterTable)\('([a-z_]+)',\s*\(t\)\s*=>\s*\{", text):
        tname = m.group(2); start = m.end(); depth = 1; i = start
        while i < len(text) and depth > 0:
            if text[i] == '{': depth += 1
            elif text[i] == '}': depth -= 1
            i += 1
        parse_block(text[start:i], tname, schema)

# (audit logic — see git history for full implementation)
```

---

## 9. What's deferred (in `docs/FUTURE_REFINEMENTS/`)

| # | Title | Priority | Effort |
|---|---|---|---|
| 01 | Native mobile data entry with system-driven autofill | High once deployed | 3–5 weeks |
| 02 | Location-based timezone (vs current author-based) | Medium | 1–2 days |
| 03 | Mobile equipment management for field staff | Medium | 2–3 weeks |
| 04 | AI training data capture for improved extraction accuracy | Medium | 1–2 weeks |
| 05 | Auto-file contract upload window + amount confirmation | Medium | 1 week |

Each has its own markdown file in `docs/FUTURE_REFINEMENTS/` with implementation sketch, schema changes, open questions, and effort estimate.

---

## 10. Open questions / partially-decided work

These are things that came up during the session but weren't fully resolved:

### Inbox flow purpose
The invoice and PO inboxes are described as a fallback path for firms that use outside tools (QuickBooks, Excel, vendor portals) and just want the platform to track records after the fact. The platform's *generation* features (`generate-invoice`, PO creation, vendor-quote→PO) are the preferred path. **Both paths now coexist cleanly with `external_reference`** preserving the source-system identifier.

### PO/invoice walkthrough
Pat asked for a structured walkthrough of the purchase order and invoice systems "after everything." This wasn't completed — the conversation stayed on building features. Next session would be a good time for that walkthrough now that the inbox + generation flows have stabilized.

### Multi-state expansion
Firm operates US-wide + Bahamas. Author-timezone capture is the chosen interim solution. Location-based timezone is documented in refinement 02 and is the right upgrade once it becomes worth the schema work.

---

## 11. Deployment

### Required on host
- Docker Desktop (or Docker Engine + Compose v2)
- Ollama running on host: `ollama serve` + `ollama pull llama3:8b`
- ~4GB RAM for Ollama, ~2GB for Postgres + Redis + Node

### Wipe-rebuild sequence (Pat's Windows PowerShell)

```powershell
cd "C:\Users\pegan\OneDrive\Desktop\Python\Project_Management_Software\project"
docker compose down -v
cd ..
Remove-Item -Recurse -Force project
tar -xzf "C:\Users\pegan\Downloads\construction_pm_v2_fixed.tar.gz"
cd project
docker compose up --build
```

The `-v` flag wipes the database volume — needed when migrations have changed in destructive ways or when the DB is in a half-migrated state.

### What "running successfully" looks like

Final boot log lines should include:
```
Migration complete — all schema additions applied.
[Migrations 002, 002a, 003, 003a, 004, 005 all run cleanly]
✅ Migrated N 'foreman' users to 'field_staff'
[Server listening on port 3000]
```

Then `http://localhost:3000` should serve the login page.

### Configuration (env vars in docker-compose.yml)

```
NODE_ENV=development
ENABLE_DEV_LOGIN=true        # set to false in production
PORT=3000
DB_HOST=db / DB_NAME=construct_mgr / DB_USER=postgres
JWT_SECRET=<change for production>
JWT_REFRESH_SECRET=<change for production>
STORAGE_TYPE=local
STORAGE_BASE_PATH=/app/storage
OLLAMA_HOST=http://host.docker.internal:11434
OLLAMA_MODEL=llama3:8b
AI_BACKEND=ollama            # or 'claude' or 'auto' if ANTHROPIC_API_KEY set
OCR_BACKEND=tesseract        # or 'textract' or 'auto' if AWS_TEXTRACT_REGION set
DISPLAY_TOKEN=shopfloor      # auth token for the kiosk display board
```

---

## 12. Cost (for the firm)

| Component | Cost |
|---|---|
| Open-source software (Postgres, Redis, Node, etc.) | $0 |
| Ollama (local AI extraction) | $0 |
| Tesseract OCR | $0 |
| Optional Claude API fallback | ~$3-15 per 1M tokens (disabled by default) |
| Optional AWS Textract fallback | ~$1.50 per 1000 pages (disabled by default) |
| Hardware: dedicated server (Ryzen 7 + RTX 4060 Ti + 32GB) | ~$1,280 one-time, ~$22/mo electricity |
| **3-year TCO with local AI** | **~$2,072** |

If both cloud AI fallbacks are enabled with moderate usage, add ~$3-15/month.

---

## 13. File inventory (key paths)

```
project/
├── docker-compose.yml              # Postgres + Redis + API services
├── Dockerfile                      # Node 20 Alpine + Tesseract
├── .env.example                    # Documented env vars
├── README.md                       # Setup walkthrough
├── TESTING.md                      # Manual test procedures
├── PROJECT_REFERENCE.md            # Older comprehensive ref doc
├── HANDOFF_PACKAGE.md              # ← This file
│
├── public/
│   ├── index.html                  # ~5,200-line vanilla JS SPA (no build step)
│   └── display.html                # Standalone shop floor kiosk
│
├── migrations/                     # 16 files, must run in order
├── seeds/
│   ├── 001_admin_user.js           # admin@company.com / ChangeMe123!
│   └── 002_test_data.js            # Full test dataset (customers, projects, invoices, POs, etc.)
│
├── src/
│   ├── app.js                      # Express setup, route mounts
│   ├── server.js                   # HTTP + WebSocket startup
│   ├── config/
│   │   ├── database.js             # Knex config
│   │   ├── roles.js                # Roles + permissions matrix
│   │   └── aiConfig.js             # Ollama/Claude/Tesseract/Textract routing
│   ├── middleware/
│   │   ├── authenticate.js
│   │   ├── authorize.js
│   │   └── errorHandler.js
│   ├── models/                     # 13 model files
│   ├── services/                   # 13 service files
│   │   └── PdfStampService.js      # NEW this session
│   └── routes/                     # 19 route files
│
├── mobile/                         # React Native / Expo app
│   └── src/screens/                # 11 screens, role-based layouts
│
├── docs/
│   ├── TERMINOLOGY.md              # Authoritative glossary
│   └── FUTURE_REFINEMENTS/         # 5 deferred-feature design docs
│
└── tests/unit/                     # 34 passing tests + 1 skipped
```

---

## 14. How to continue

### To pick up development in a new conversation
1. Upload this `HANDOFF_PACKAGE.md` as a project file
2. Optionally upload `docs/TERMINOLOGY.md` for terminology precision
3. Reference specific refinement docs by number (e.g. "refinement 03") to pick up that work

### To deploy to the actual firm
1. Verify Ollama is running on the deployment host with `llama3:8b` pulled
2. Set production-grade JWT secrets in env
3. Set `ENABLE_DEV_LOGIN=false`
4. Configure storage backend (local works for single-host; S3 if multi-host or cloud)
5. Wipe-rebuild as documented in §11
6. Change admin password from `ChangeMe123!` immediately
7. Bulk-import users via `/admin/users/bulk-import` (Excel/CSV)
8. Configure rate sheet, global variables, PM delegates, inbox access in admin
9. Train users via `TESTING.md` workflow guides

### To extend the platform
- Read `TERMINOLOGY.md` first
- Read the `FUTURE_REFINEMENTS/` doc for any related feature
- Check the audit script in §8 before writing migrations
- Run `npm test` after changes (target: 34/34 passing)
- Repackage with the wipe-rebuild test before declaring done

---

## 15. Known issues / debt

- **Storage backend files don't exist as separate modules.** `StorageService.js` references `./storage/LocalBackend` and `./storage/S3Backend` which were never extracted. The single `StorageService.js` does both jobs internally. The unit test for storage is skipped because of this. Pure tech debt; works fine at runtime.
- **Test suite doesn't cover migrations.** Migrations only get tested on real Postgres at boot. Several deploy iterations this session were caused by migration bugs that unit tests couldn't catch. Setting up an integration test harness against a real test DB would prevent this class of bug.
- **Mobile app is partial.** Field staff can submit timesheets, oil samples, field notes. PM/admin can use mobile but the screens are limited. Equipment workflows on mobile are missing entirely (refinement 03).
- **Google Maps integration is TODO.** `miles_from_hq` is entered manually because the API key wiring was never finished. Refinement-eligible.
- **No email/push notifications wired.** Backend has `notification_channels` table support but the actual delivery layer needs SendGrid/SES + Firebase config to fire. Currently in-app only.
- **Old `foreman` enum value lingers.** Postgres can't drop enum values without recreating the type. The value is unused but still appears in the enum definition. Cosmetic.

---

*This document is the single source of truth for project state as of May 2026. Update it whenever significant changes are made or major decisions are revisited.*
