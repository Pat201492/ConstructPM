# Construction PM Platform — Complete Reference

> Single source of truth. Upload this at the start of any future conversation.
> Last updated: April 15, 2026
> Build state: COMPLETE (0 stubs, 0 TODOs)

---

## 1. CORE PRINCIPLE

**Minimize user input. Maximize user verification.**

Data enters the system through file uploads to centralized inboxes. AI extracts structured fields. Users verify via checkboxes and correct as needed. Database populates.

Manual typing happens during: bid creation (customer/contact/location/scope) and admin setup (rate sheets, global variables, users).

When a user types a new entity during bid creation, they click "+" to expand an inline form, save it, and it auto-selects in the searchable dropdown. All dropdowns are type-to-filter.

---

## 2. BUILD METRICS

| Metric | Value |
|--------|-------|
| Backend source | ~10,500 lines |
| Frontend (index.html) | ~1,980 lines |
| Display board (display.html) | ~300 lines |
| Migration | ~810 lines |
| Database tables | 36 |
| Database enums | 13 |
| API endpoints | 155 |
| Models | 13 |
| Services | 13 |
| Route files | 18 |
| Unit tests | 51 passing |
| Stubs | 0 |
| TODOs | 0 |

---

## 3. FILE INVENTORY

```
project/
├── docker-compose.yml              # Postgres 16 + Redis 7 + API
├── Dockerfile                      # Node 20 Alpine + Tesseract OCR
├── .env.example                    # All env vars documented
├── .dockerignore
├── knexfile.js
├── jest.config.js
├── package.json
├── package-lock.json
├── README.md                       # Local setup guide (Docker + Ollama)
├── TESTING.md                      # 13-section test walkthrough
│
├── public/
│   ├── index.html                  # Main SPA (14 pages, vanilla JS)
│   └── display.html                # Kiosk display board (no login, auto-refresh)
│
├── migrations/
│   └── 20260410_001_target_schema.js   # 36 tables + 13 enums + role + global var seeds
│
├── seeds/
│   └── 001_admin_user.js           # admin@company.com / ChangeMe123!
│
├── docs/                           # Generated Word documents
│   ├── ConstructPM_Data_Flow.docx
│   ├── ConstructPM_Features_by_Role.docx
│   ├── ConstructPM_Backend_Infrastructure.docx
│   ├── ConstructPM_Cost_Analysis.docx
│   └── ConstructPM_Notification_Breakdown.docx
│
├── src/
│   ├── app.js                      # Express app, middleware, 18 route mounts
│   ├── server.js                   # HTTP + WebSocket startup
│   │
│   ├── config/
│   │   ├── database.js             # Knex PostgreSQL connection
│   │   ├── roles.js                # 5 system roles, 30+ permissions
│   │   └── aiConfig.js             # Ollama primary, Claude fallback, confidence thresholds
│   │
│   ├── middleware/
│   │   ├── authenticate.js         # JWT verification
│   │   ├── authorize.js            # RBAC permission checking
│   │   └── errorHandler.js         # Global error handler
│   │
│   ├── models/ (13)
│   │   ├── Bid.js                  # CRUD, bid number gen (YY-PM-Seq), stats, archive, snooze
│   │   ├── BidQuoteLine.js         # Quote lines with locked rates, totals
│   │   ├── Customer.js             # CRUD with billing address
│   │   ├── CustomerContact.js      # CRUD linked to customer
│   │   ├── Equipment.js            # CRUD, barcode lookup, checkout/return, maintenance, certs
│   │   ├── Extraction.js           # CRUD, confirm (routes to type-specific handlers), reject
│   │   ├── GlobalVariable.js       # Key/value store with convenience getters
│   │   ├── Inventory.js            # Consumable materials CRUD, allocation, low stock
│   │   ├── Location.js             # CRUD, Google Maps Distance Matrix auto-miles, union local
│   │   ├── Project.js              # CRUD, getFinancials (real queries), assignments, close-out
│   │   ├── ProjectNumber.js        # Multiple numbers per project, configurable generator
│   │   ├── RateSheet.js            # CRUD, bulkUpsert (ON CONFLICT), getByLocal
│   │   └── User.js                 # CRUD, auth, password hashing, login tracking, tab_overrides, access_config
│   │
│   ├── services/ (13)
│   │   ├── AuditService.js         # Log all changes (table, field, old/new, who, when)
│   │   ├── AuthService.js          # JWT access + refresh tokens
│   │   ├── BidDocumentService.js   # Excel (ExcelJS) + Word (docxtemplater) generation
│   │   ├── DocumentQueue.js        # File processing queue
│   │   ├── ExportBuilder.js        # Cross-table query builder for CSV exports
│   │   ├── ExportService.js        # CSV: QuickBooks, Procore, equipment, custom
│   │   ├── ExtractionService.js    # OCR (Tesseract→Textract) + AI (Ollama→Claude)
│   │   ├── FileService.js          # Folder creation, file storage, inbox→project filing
│   │   ├── FileWatcher.js          # Polls: bid inactivity, Contract_PO empty, overdue payments
│   │   ├── NotificationService.js  # Multi-channel (in-app, email, push), helpers
│   │   ├── PaymentReminderService.js # Overdue detection, payment recording, close-out trigger
│   │   ├── StorageService.js       # Local disk or S3 abstraction
│   │   └── VendorLearning.js       # Correction tracking, prompt hint injection
│   │
│   ├── routes/ (18)
│   │   ├── admin.js        (35 endpoints) # Users, roles, rate sheet, globals, templates, inbox access, delegates, bulk import, audit, per-user access config, bid/project assignments
│   │   ├── auth.js          (5 endpoints) # Login, refresh, logout, me (returns allowed_tabs + visibility), change password
│   │   ├── bids.js         (14 endpoints) # CRUD, quote, generate docs, initiate-won, confirm-won, archive, snooze, hard delete
│   │   ├── contacts.js      (4 endpoints) # CRUD for customer contacts
│   │   ├── customers.js     (4 endpoints) # CRUD with billing address
│   │   ├── display.js       (1 endpoint)  # Unauthenticated kiosk display board
│   │   ├── equipment.js    (18 endpoints) # CRUD, barcode, checkout/return, maintenance, requests, display board
│   │   ├── exports.js      (12 endpoints) # QuickBooks, Procore, equipment, custom CSV, cross-table builder (sources/preview/download)
│   │   ├── extractions.js   (7 endpoints) # List, detail, confirm, reject, reprocess
│   │   ├── files.js         (5 endpoints) # Bid upload, Contract_PO upload, download, activity log
│   │   ├── financials.js    (3 endpoints) # Cross-project invoices, POs, summary
│   │   ├── inbox.js         (3 endpoints) # Centralized upload: timesheets, invoices, purchase-orders
│   │   ├── inventory.js    (10 endpoints) # CRUD, allocate, receive, low stock
│   │   ├── locations.js     (6 endpoints) # CRUD, union locals list, recalculate miles
│   │   ├── notifications.js (5 endpoints) # List, unread count, mark read, dismiss informational
│   │   ├── projects.js     (15 endpoints) # CRUD, financials, numbers, team, close, cancel, hard delete, payments, contract type
│   │   ├── timesheets.js    (2 endpoints) # List (group by project/worker), summary
│   │   └── users.js         (6 endpoints) # CRUD, profile, deactivate
│   │
│   └── services/storage/
│       ├── LocalBackend.js         # File operations on STORAGE_BASE_PATH
│       └── S3Backend.js            # AWS S3 compatible storage
│
└── tests/unit/ (51 tests, 4 suites)
    ├── extractionService.test.js
    ├── fileService.test.js
    ├── roles.test.js
    └── storageService.test.js
```

---

## 4. TECHNOLOGY STACK

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js 20 (Alpine Docker) | |
| Framework | Express.js | |
| Database | PostgreSQL 16 | 36 tables, UUID PKs |
| Cache | Redis 7 | Session store |
| ORM | Knex.js | Migrations, seeds, query builder |
| Auth | JWT | 15min access, 7-day refresh |
| OCR Primary | Tesseract.js + tesseract-ocr (system) | Local, free, in-container |
| OCR Fallback | AWS Textract | Cloud, paid, better for handwriting |
| AI Primary | Ollama (llama3:8b) | Local, free, runs on host |
| AI Fallback | Claude API (Sonnet/Haiku) | Cloud, paid, higher accuracy |
| Maps | Google Maps Distance Matrix API | Auto-calculates miles from HQ to job sites |
| Excel | ExcelJS | Bid quote spreadsheets |
| Word | docxtemplater + PizZip | Bid template {Field Name} merge |
| File Storage | Local disk or S3 | Configurable via STORAGE_TYPE |
| Frontend | Vanilla JS SPA | No build step, no framework |

---

## 5. USER ROLES & ACCESS CONTROL

### Role-Based Access (configurable via Admin → Roles tab)

| Role | Default Tabs | Bid Visibility | Project Visibility |
|------|-------------|----------------|-------------------|
| admin | All 10 tabs | All | All |
| project_manager | Dashboard, Bids, Projects, Invoices & POs, Inbox, Timesheets, Notifications, Equipment, Exports | Own | Own |
| accounting | Dashboard, Projects, Invoices & POs, Inbox, Timesheets, Notifications, Exports | All | All |
| shop_staff | Notifications, Equipment | None | None |
| field_staff | Projects, Inbox, Notifications | None | Assigned |

### Access Control Hierarchy
1. **Role template** (role_configurations table) — defines default tabs, bid/project visibility
2. **Per-user overrides** (users.tab_overrides + users.access_config JSONB) — admin can override any user
3. **Explicit assignments** (bid_assignments + project_assignments tables) — for "Assigned" visibility mode

### Visibility Modes
- **Own** — sees only bids/projects where user is the estimator/PM
- **All** — sees everything
- **Assigned** — sees only explicitly assigned bids/projects (via Admin → Users → Access modal)
- **None** — hidden entirely

### Custom Roles
Admin can create custom roles via Admin → Roles tab. Creates the DB record AND adds to the PostgreSQL enum. Custom roles can be deleted (blocked if users assigned). System roles (5 defaults) cannot be deleted but can have their tabs/visibility edited.

---

## 6. NOTIFICATION ROUTING (13 types)

| # | Trigger | Goes To | Category |
|---|---------|---------|----------|
| 1 | Timesheet uploaded to inbox | PM + PM delegate | Actionable |
| 2 | Invoice uploaded (project matched) | PM delegate only (fallback: admins) | Actionable |
| 3 | PO uploaded (project matched) | PM only | Actionable |
| 4 | Invoice/PO not matched to project | Admins | Actionable |
| 5 | Timesheet confirmed | PM | Informational |
| 6 | Contract uploaded to Contract_PO | PM | Actionable |
| 7 | Bid won → project created | Admin + PM + PM delegate | Informational |
| 8 | Bid inactive (configurable days) | PM | Actionable |
| 9 | Contract_PO empty after 1 day | PM | Actionable |
| 10 | Invoice payment overdue | PM + PM delegate | Actionable (escalating priority) |
| 11 | Revenue ≥ contract value | PM | Actionable |
| 12 | Equipment request created | All shop staff + select users (inbox_access) | Actionable |
| 13 | Equipment request filled | Requesting PM | Informational |

Actionable = cannot dismiss, stays until action completed.
Informational = dismissable individually or all at once.
Deduplication: #8, #9, #10, #11 check for existing unread before resending.

---

## 7. DATABASE SCHEMA (36 tables, 13 enums)

### Enums
user_role, bid_status, project_status, contract_type, invoice_status, po_status, extraction_status, doc_type, notification_channel, notification_priority, notification_category, equipment_status, equipment_request_status

### Tables by Group
**Auth**: users (+ tab_overrides JSONB, access_config JSONB), refresh_tokens, user_devices
**Customers**: customers, customer_contacts
**Reference**: locations, rate_sheet, global_variables, bid_templates
**Bids**: bids, bid_quote_lines, bid_assignments
**Projects**: projects, project_numbers, project_assignments
**Financials**: invoices, invoice_line_items, purchase_orders, po_line_items, contracts, timesheets
**Equipment**: equipment, equipment_requests, equipment_request_lines, equipment_checkout_log, equipment_documents
**Inventory**: inventory, inventory_allocations
**AI Pipeline**: pending_extractions, vendor_profiles
**System**: notifications, file_activity_log, inbox_access, pm_notification_delegates, audit_log
**Access Control**: role_configurations (allowed_tabs, bid_visibility, project_visibility, is_system)

---

## 8. AI PIPELINE

### Stage 1: OCR
Primary: Tesseract.js (in-container). Fallback: AWS Textract.

### Stage 2: AI field extraction
Primary: Ollama (llama3:8b). Fallback: Claude API. Temperature 0.1, JSON enforced.

### Stage 3: Vendor learning
Corrections stored in vendor_profiles, injected as prompt hints.

---

## 9. DATA EXPORT SYSTEM

### Cross-Table Export Builder
Users pick a source, select columns from any related table, filter by date, preview, and download CSV.

| Source | Joinable Tables |
|--------|----------------|
| Invoices | Projects → Customers, Locations, PM |
| Purchase Orders | Projects → Customers, Locations, PM |
| Timesheets | Projects → Customers, Locations, PM |
| Projects | Customers, Locations, PM |
| Bids | Customers, Locations, Estimator, Contact |
| Equipment | (standalone) |

Example: Export invoices with invoice number + amount + customer billing address + PM name + location union local — all in one CSV.

### Pre-Built Exports (QuickBooks, Procore)
QB Invoices, QB Timesheets (ST/OT/DT), QB Purchase Orders (with line items), Procore Budget, Procore Invoices, Procore Timecards, Equipment inventory.

---

## 10. FRONTEND PAGES (14 pages)

| Page | Route | Features |
|------|-------|----------|
| Login | login | Email/password, persists token |
| Dashboard | dashboard | Bid stats cards, recent bids table |
| Bids | bids | Configurable columns (drag reorder + visibility), delete button, create |
| Create Bid | bid-create | Searchable type-to-filter dropdowns with inline "+" add new, auto-fill union |
| Bid Quoting | bid-quote | Editable table (no arrows, no focus loss), add/remove lines, auto-calc, generate docs, mark won |
| Projects | projects | Configurable columns, cancel/delete button |
| Project Detail | project-detail | Financial cards (revenue, cost, margin, WCI), project numbers, close-out |
| Invoices & POs | financials | Summary cards, toggle invoices/POs, search, status filter, configurable columns |
| Data Export | exports | Source picker, cross-table column checkboxes, date filters, preview, CSV download |
| Inbox | inbox | 3 upload areas, pending extractions list |
| Extraction Verify | extraction-verify | Checkbox field editor, project selector, confidence colors |
| Timesheets | timesheets | All entries, group by project, group by worker |
| Notifications | notifications | Actionable vs informational, dismiss all |
| Equipment | equipment | Grouped by location, barcode, status |
| Admin | admin | 9 tabs (see below) |

### Admin Tabs (9)
1. **Users** — Create user (dynamic role dropdown), user list, Access button (per-user modal), Role button
2. **Roles** — Create/delete custom roles, tab checkbox grid, bid/project visibility dropdowns per role
3. **Rate Sheet** — Add/delete rates (local×classification×ST/OT/DT)
4. **Global Variables** — Inline edit with explicit "Save Changes" button
5. **Templates** — Upload .docx per PM with {Field Name} merge fields
6. **Inbox Access** — Configure who can upload to each inbox (dynamic role dropdown)
7. **Delegates** — Map PM → delegate for notification routing
8. **Bulk Import** — Upload Excel/CSV → parse → map columns → preview → import
9. **Audit Log** — View all changes (table, field, old/new, who, when)

### Per-User Access Modal (Admin → Users → Access button)
- Tab override checkboxes (override role defaults or inherit)
- Bid visibility override dropdown (Own/All/Assigned/None or use role default)
- Project visibility override dropdown (same options)
- Bid assignments list (search + add/remove for "Assigned" mode)
- Project assignments list (search + add/remove)
- Reset to Role Defaults button

---

## 11. DISPLAY BOARD (public/display.html)

Standalone kiosk page for shop floor TV. No login — uses DISPLAY_TOKEN env var.
Access: http://SERVER:3000/display.html?token=shopfloor
Auto-refreshes every 30 seconds.

---

## 12. GOOGLE MAPS INTEGRATION

Auto-calculates driving distance (miles) from HQ to job site on location create/update.
Uses Routes API with `routingPreference: TRAFFIC_AWARE` (shortest time route).

Requires:
- `GOOGLE_MAPS_API_KEY` env var
- `home_location_address` global variable (Admin → Global Variables)
- Distance Matrix API enabled in Google Cloud Console

Falls back gracefully — if no API key, user enters miles manually on the location record.

---

## 13. UI FEATURES

- **Searchable dropdowns**: Customer, location, contact — type to filter, click to select
- **Inline add new**: "+" button expands form below dropdown, saves via API, auto-selects
- **Configurable columns**: Drag-to-reorder modal, checkbox visibility, saves to localStorage per table
- **No number input arrows**: All numeric inputs use type=text with inputmode for mobile
- **Focus-safe quoting table**: Only updates calculated cells on keystroke, never rebuilds inputs
- **All dollar amounts**: Exactly 2 decimal places everywhere (global fmtD helper)
- **Role-based sidebar**: Reads allowed_tabs from API, shows only tabs the user has access to
- **Dark theme**: Professional dark UI

---

## 14. DEPLOYMENT

### Docker (local dev)
```bash
docker compose down -v             # Wipe database (needed after schema changes)
docker compose up --build          # First time
docker compose up                  # Subsequent
```
Requires: Docker Desktop + Ollama (host machine) + `ollama pull llama3:8b`

### Environment Variables
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET,
STORAGE_TYPE, STORAGE_BASE_PATH, OLLAMA_HOST, OLLAMA_MODEL, AI_BACKEND, OCR_BACKEND,
DISPLAY_TOKEN, GOOGLE_MAPS_API_KEY (optional), ANTHROPIC_API_KEY (optional)

---

## 15. DESIGN DECISIONS (76+ confirmed)

Key decisions documented in conversation history. Critical ones:

| # | Decision |
|---|----------|
| 1 | Rates snapshot into bid_quote_lines at bid creation. Projects use locked rates forever. |
| 2 | Personnel defaults: 0 for all, 1 for foreman. |
| 3 | Miles from HQ lives on location record only, auto-calculated via Google Maps. |
| 4 | Notifications: Actionable (can't dismiss) vs Informational ("Dismiss all" button). |
| 5 | Global variables: explicit Save Changes button, not auto-save on blur. |
| 6 | Role-based nav reads from role_configurations table in database, not hardcoded. |
| 7 | Per-user access overrides take priority over role template defaults. |
| 8 | Visibility modes: own, all, assigned, none — enforced on backend, not just UI. |
| 9 | Cross-table exports auto-resolve JOIN dependencies from selected columns. |
| 10 | Google Maps uses TRAFFIC_AWARE routing for shortest time route. |

---

## 16. NOT BUILT

| Item | Status | Notes |
|------|--------|-------|
| Mobile app (React Native) | Not started | Equipment barcode scanning + quick bid. Separate project. |
| Email/Push delivery | Built but needs config | Set EMAIL_PROVIDER + SENDGRID_API_KEY or SES_REGION. Push needs FIREBASE config. |

---

## 17. HOW TO CONTINUE DEVELOPMENT

1. Upload this document to the Claude project file
2. Download the tarball and extract
3. Reference this doc for any questions about what exists, what's decided, and what's pending
4. All code is in the `project/` directory
5. Run `docker compose down -v && docker compose up --build` to test locally (wipe DB for schema changes)
6. Frontend is a single file: `public/index.html` — no build step needed
7. Login: admin@company.com / ChangeMe123!
