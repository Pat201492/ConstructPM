# Construction PM Platform — Complete Reference

> Authoritative reference for the platform. Start here (and with `CLAUDE.md`)
> for "what exists and why." Pair with `HANDOFF_PACKAGE.md` for build history,
> known debt, and the deployment runbook.
> Metrics last reconciled against the tree: October 12, 2026.
> Build state: actively developed. Counts below are measured from the repo, not
> a point-in-time snapshot — re-measure if they look stale.

---

## 1. CORE PRINCIPLE

**Minimize user input. Maximize user verification.**

Data enters the system through file uploads to centralized inboxes. AI extracts structured fields. Users verify via checkboxes and correct as needed. Database populates.

Manual typing happens during: bid creation (customer/contact/location/scope) and admin setup (rate sheets, global variables, users).

When a user types a new entity during bid creation, they click "+" to expand an inline form, save it, and it auto-selects in the searchable dropdown. All dropdowns are type-to-filter.

---

## 2. BUILD METRICS

Measured from the tree on 2026-10-12. Counts are exact file counts unless marked
approximate; re-run the commands in parentheses to refresh.

| Metric | Value |
|--------|-------|
| Frontend (`public/index.html`) | ~599 KB, ~12,200 lines (vanilla JS SPA, no build) |
| Display board (`public/display.html`) | kiosk board, no login |
| Migrations | 70 files (`ls project/migrations`), `20260410_001` → `20260602_001` |
| API endpoints | ~280 route handlers across the route files (`grep -r "router\.\(get\|post\|put\|patch\|delete\)" src/routes`) |
| Models | 17 (`ls project/src/models`) |
| Service modules | 25 in `src/services/` + 2 storage backends in `src/services/storage/` |
| Route files | 29 (`ls project/src/routes`) |
| Unit test suites / tests | 10 suites, 103 tests passing (`npm run test:unit`) |
| Integration test suites | 2 (`project/tests/integration/`, need a Postgres test DB) |

Schema (tables + enums) is defined and evolved across the 70 migrations rather
than a single file; there is no reliable single-number table count because
tables are added and dropped across migrations. See §7 for the table groups and
`project/migrations/` for the authoritative DDL.

---

## 3. FILE INVENTORY

The repo root is a documentation wrapper; the application lives in `project/`
(see `CLAUDE.md`). Root-level docs: `README.md` (overview + local setup),
`CLAUDE.md` (conventions), `PROJECT_REFERENCE.md` (this file),
`HANDOFF_PACKAGE.md` (build history + runbook), `MOBILE_APP_REFERENCE.md`,
`TESTING.md`, `DEPLOY.md`, `DEPLOYMENT_GUIDE.md`, `PLAN.md`, and others.

```
project/
├── docker-compose.yml / docker-compose.prod.yml   # Postgres 16 + Redis 7 + API
├── Dockerfile / Dockerfile.prod                    # Node 20 Alpine + Tesseract OCR
├── .env.example / .env.production.example          # Documented env vars
├── knexfile.js, jest.config.js, package.json
├── nginx/nginx.conf, deploy.sh, backup.sh
│
├── public/
│   ├── index.html                  # Main web SPA (~599 KB, vanilla JS, no build)
│   ├── display.html                # Kiosk display board (no login, auto-refresh)
│   └── mobile/                      # Installable PWA (pm/shop/shell views, service worker)
│
├── migrations/ (70 files)          # Knex, run in filename order: 20260410_001 → 20260602_001
│                                    # 20260410_001_target_schema.js lays the base schema;
│                                    # later files add scheduler, email module, tickets,
│                                    # feature flags, superadmin, saved exports, etc.
│
├── seeds/
│   ├── 001_admin_user.js           # admin@company.com / ChangeMe123!
│   └── 002_test_data.js            # Full test dataset
│
├── docs/
│   ├── TERMINOLOGY.md              # Authoritative glossary
│   ├── AI_SETUP.md, EXPORT_METADATA.md, MOBILE_APP_CONTRACTS.md
│   ├── diagrams/                   # 4 system .svg diagrams + README (canonical copy)
│   ├── FUTURE_REFINEMENTS/         # Deferred-feature design docs
│   └── *.docx                      # Generated Word reference documents
│
├── mobile/                         # React Native / Expo app (screens per role)
│
├── templates/defaults/             # Default .docx: bid, invoice, timesheet
│
├── scripts/                        # setup, deploy, db-backup, test-ai-config, setup-ollama-windows.ps1
│
├── src/
│   ├── app.js                      # Express app, middleware, route mounts (see §route list)
│   ├── server.js                   # HTTP + Socket.IO startup
│   │
│   ├── config/
│   │   ├── database.js             # Knex PostgreSQL connection
│   │   ├── roles.js                # Role + permission matrix (RBAC)
│   │   ├── aiConfig.js             # Ollama/Claude + Tesseract/Textract routing
│   │   └── aiPresets.js            # AI_PRESET hardware tiers
│   │
│   ├── middleware/
│   │   ├── authenticate.js         # JWT verification
│   │   ├── authorize.js            # RBAC permission checking
│   │   └── errorHandler.js         # Global error handler
│   │
│   ├── models/ (17)
│   │   Bid, BidQuoteLine, Customer, CustomerContact, Equipment, Extraction,
│   │   FieldNote, FormTemplate, GlobalVariable, Inventory, Location,
│   │   OilSampleRequest, Project, ProjectNumber, RateSheet, User, Vendor
│   │
│   ├── services/ (25 modules + storage/)
│   │   AuditService, AuthService, BidDocumentService, DocumentQueue,
│   │   EmailComposeService, EmailTemplateService, EmailTriggerRecipientsService,
│   │   ExportBuilder, ExportFileGenerator, ExportService, ExtractionService,
│   │   FileService, FileWatcher, NotificationService, PODocumentService,
│   │   PaymentReminderService, PdfStampService, SavedExportFanoutRunner,
│   │   SavedExportRunner, StorageService, VendorLearning, WorkOrderService,
│   │   exportMetadata, projectDates, superadminBootstrap
│   │   └── storage/ { LocalBackend.js, S3Backend.js }
│   │
│   └── routes/ (29)
│       admin, auth, bids, contacts, customers, display, emailCompose,
│       emailTemplates, emailTemplatesUser, equipment, equipmentTickets,
│       exports, extractions, field-notes, files, financials, form-templates,
│       inbox, inventory, locations, notifications, oil-samples, projects,
│       purchase-orders, savedExports, scheduler, timesheets, users, vendors
│
└── tests/
    ├── unit/ (10 suites, 103 tests)
    │   aiConfig, authService, emailTemplateService, extractionService,
    │   fileService, notificationPush, projectDates, roles, storageService,
    │   superadminBootstrap
    ├── integration/ (2 suites — need a Postgres test DB)
    │   emailDay, scheduler-add-by-code
    └── helpers/ { auth, setup, testDb }
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

## 16. SCOPE NOTES

The original version of this doc listed the mobile app and several flows as
"not built." They have since been built; the current tree includes a React
Native / Expo app (`project/mobile/`), an installable PWA (`project/public/
mobile/`), the email module, project scheduler, equipment tickets, saved
exports, feature flags, and a superadmin tier. For the running list of known
debt and anything still pending, see `HANDOFF_PACKAGE.md` §15.

| Item | Status | Notes |
|------|--------|-------|
| Email/Push delivery | Built; delivery needs config | Configure the email provider env vars; push needs Expo/Firebase config. |
| Google Maps auto-miles | Optional | Works with `GOOGLE_MAPS_API_KEY`; manual miles entry otherwise. |

---

## 17. HOW TO CONTINUE DEVELOPMENT

1. Read `CLAUDE.md` for conventions and the root-vs-`project/` boundary, then
   this doc for what exists and why.
2. All code is in the `project/` directory. The repo root holds only docs.
3. From `project/`, run `docker compose down -v && docker compose up --build`
   to test locally (the `-v` wipe is needed after schema changes).
4. Frontend is a single file, `public/index.html` — no build step needed.
5. Schema changes are always a new Knex migration in `project/migrations/`.
6. Run `npm run test:unit` from `project/`; keep it green.
7. Login: admin@company.com / ChangeMe123!
