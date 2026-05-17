# Handoff — Complete Build State

> Upload this + the tarball to the new chat. This document tells the new session everything that exists, what was decided, and what's left.
> Date: April 21, 2026
> Status: Phases A–F complete. Phase G (E2E testing + app store submission) pending.
> Ready to test — `docker compose down -v && docker compose up --build`

---

## 1. WHAT TO UPLOAD TO THE NEW CHAT

| # | File | Purpose |
|---|------|---------|
| 1 | This document (`HANDOFF_COMPLETE.md`) | Master index — start here |
| 2 | `construction_pm_v2_complete.tar.gz` | Complete codebase (extract to get `project/` directory) |
| 3 | `PROJECT_REFERENCE.md` (inside tarball) | Original design doc — 109 decisions, all schemas |
| 4 | `MOBILE_APP_REFERENCE.md` (inside tarball) | Mobile app spec — decisions 77–100 |

The tarball contains everything. No other files needed.

---

## 2. CURRENT BUILD STATE

### Verified Clean
- All .js files pass syntax check
- App loads without errors
- 51 unit tests passing (4 suites)
- Frontend JS balanced (no bracket mismatches)
- No stale `field_staff` references (renamed to `foreman`)
- No duplicate `require()` statements
- Route ordering correct (`/export` before `/:id`)
- No pregenerated oil sample fields — admin controls everything via Form Templates
- 35 bugs found and fixed during code review

### Counts
| Metric | Value |
|--------|-------|
| Route files | 21 |
| API endpoints | 191 |
| Models | 16 |
| Services | 15 |
| Migrations | 3 |
| Database tables | 39 |
| Enums | 14 |
| Notification types | 15 |
| Frontend pages | 20 |
| Frontend lines | 3,107 |
| Mobile screens | 11 |
| Mobile files | 16 |
| Default templates | 3 (.docx: bid, invoice, timesheet) |
| Unit tests | 51 |
| TESTING.md | 995 lines, 23 tests + mobile smoke test |
| Design decisions | 109 |

---

## 3. TECHNOLOGY STACK

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 (Alpine Docker) |
| Framework | Express.js |
| Database | PostgreSQL 16 (39 tables, UUID PKs) |
| Cache | Redis 7 |
| ORM | Knex.js |
| Auth | JWT (15min access, 7-day refresh) |
| OCR | Tesseract.js (primary) → AWS Textract (fallback) |
| AI Text | Ollama llama3:8b (primary) → Claude API (fallback) |
| AI Vision | Ollama llava:13b (primary) → Claude Vision API (fallback) |
| AI Config | Preset system — 6 hardware tiers, set `AI_PRESET=local-standard` |
| Excel | ExcelJS |
| Word | docxtemplater + PizZip (templates) + docx (programmatic) |
| Frontend | Vanilla JS SPA (no build step) |
| Mobile | React Native / Expo (iOS + Android) |

---

## 4. USER ROLES

| Role | Web | Mobile |
|------|-----|--------|
| admin | All tabs + admin panel (10 tabs) | Equipment request overview (read-only) |
| project_manager | Most tabs (own bids/projects) | Equipment Requests + Quick Bid |
| accounting | Read-only projects + exports | — |
| shop_staff | Equipment only | Open/Return/Maintenance (barcode) |
| foreman | **None** (zero web tabs) | Field Notes + Oil Samples + push |

---

## 5. FILE STRUCTURE

```
project/
├── docker-compose.yml, Dockerfile, .env.example
├── package.json, knexfile.js, jest.config.js
├── README.md, TESTING.md, DEPLOY.md
├── PROJECT_REFERENCE.md, MOBILE_APP_REFERENCE.md
├── public/index.html (3,107 lines — 20 pages)
├── public/display.html (kiosk)
├── mobile/ (React Native app — 16 source files)
├── migrations/ (3 files — 39 tables)
├── seeds/ (001_admin_user.js + 002_test_data.js)
├── templates/defaults/ (bid + invoice + timesheet .docx)
├── docs/ (AI_SETUP.md, HANDOFF.md, 5 Word reference docs)
├── scripts/ (setup-ollama-windows.ps1, test-ai-config.js)
├── src/
│   ├── config/ (database, roles, aiConfig, aiPresets)
│   ├── middleware/ (authenticate, authorize, errorHandler)
│   ├── models/ (16: Bid, BidQuoteLine, Customer, CustomerContact,
│   │           Equipment, Extraction, FieldNote, FormTemplate,
│   │           GlobalVariable, Inventory, Location, OilSampleRequest,
│   │           Project, ProjectNumber, RateSheet, User)
│   ├── services/ (ExtractionService [848 lines, text+vision pipelines],
│   │             BidDocumentService [bid/invoice/timesheet doc gen],
│   │             FileWatcher [daily checks + oil sample reminders],
│   │             + 12 others)
│   ├── routes/ (21 files, 191 endpoints)
│   └── services/storage/ (LocalBackend, S3Backend)
└── tests/unit/ (4 suites, 51 tests)
```

---

## 6. DESIGN DECISIONS (109 total)

### Original (1–76): See PROJECT_REFERENCE.md §16
### Mobile (77–100): See MOBILE_APP_REFERENCE.md §14
### This session (101–109):

| # | Decision |
|---|----------|
| 101 | Per diem: flat daily rate per worker, admin-set global variable |
| 102 | Per diem: pass-through by default (not marked up), configurable via `per_diem_markup_applies` |
| 103 | Active Projects: PM sees own active, admin sees all with PM/customer filters |
| 104 | Active Projects: weekly summary with hours, oil samples, foreman notes |
| 105 | Projects page: click name → full edit modal, all fields editable |
| 106 | Oil sample reminders: configurable days, 1 notification, snoozable 3 days |
| 107 | Oil samples page: live search by equipment ID + location |
| 108 | Foreman: zero web access, mobile only |
| 109 | Oil sample equipment ID: customer's equipment (free text, not our DB) |

---

## 7. WHAT WAS BUILT IN THIS SESSION

### Backend
- Role rename `field_staff` → `foreman` (enum + codebase-wide)
- 3 new tables: `field_notes`, `oil_sample_requests`, `form_templates`
- `oil_sample_status` enum, `oil_sample_request` doc_type
- `equipment_requests.assigned_foreman_id` FK
- Per diem columns on bids + projects + timesheets
- `daily_details` JSONB on timesheets (per-day ST/OT/miles breakdown)
- Timesheet schema: weekly format (not daily)
- FieldNote model + 6 endpoints
- OilSampleRequest model + 8 endpoints (incl. photo upload with vision)
- FormTemplate model + 7 endpoints (incl. AI-powered field detection)
- Notification #14 (equipment → foreman) + #15 (oil sample return reminder)
- Vision pipeline: Llava + Claude Vision extraction in ExtractionService
- Per diem in quoting backend (pass-through, configurable markup)
- Active projects summary endpoint
- Project PATCH expanded to all fields
- Device registration endpoint (push tokens)
- Equipment request mobile endpoints (all, mine, open)
- FileWatcher: configurable schedule (daily at midnight), oil sample reminders
- Remote storage support (global vars for split paths)
- QuickBooks + Procore exports updated with per diem + mileage columns
- Financial rollup includes per diem in total cost
- Invoice generation auto-falls back to default template
- Timesheet Word export: landscape, daily ST/OT grid, up to 8 workers/page
- AI Preset system (6 tiers: cloud-only → cpu-only)

### Frontend (20 pages)
- Active Projects dashboard (weekly cards, notes, oil sample badges, filters)
- Oil Samples page (live search by equipment ID + location, mark returned, snooze)
- Field Notes page (project/date filter, CSV export, expand viewer modal)
- Project Edit Modal (click name → full form with all fields + dropdowns)
- Projects page search
- Per Diem in quoting UI (field + summary card)
- Project detail: mileage + per diem financial cards
- Oil sample sidebar badge (yellow count)
- Timesheet export modal (preview + download .docx)
- Admin Form Templates tab (upload, AI analysis, field editor, activate/deactivate)
- Template type selector includes "timesheet"
- 3 new sidebar tabs: Active Projects, Oil Samples, Field Notes

### Mobile App (React Native / Expo)
- Auth context with JWT + push token registration
- API client with auto-refresh on 401
- Role-based tab navigation (4 distinct layouts)
- Admin: equipment request overview
- PM: create equipment requests + Quick Bid
- Shop: open requests with barcode scanning, return, maintenance
- Foreman: field notes (add/edit), oil samples (photo → vision → verify)
- Shared: login, profile, notifications with bell icon
- Dark theme (outdoor-readable)

### Code Quality (35 bugs fixed)
- 4 crash bugs (StorageService.store→putFile, duplicate const db, missing try/catch, route ordering)
- 3 financial errors (per diem missing from cost, Excel, Word merge fields)
- 2 wrong documents (Excel/Word bid totals excluded per diem)
- 2 incomplete exports (QB timesheet + Procore budget missing columns)
- 1 broken feature (mobile notifications PATCH vs POST)
- 1 data loss (per_diem_rate not carried bid→project)
- 4 resource leaks (temp files not cleaned)
- 18 code quality fixes (redundant requires, test helpers, stray dirs)

---

## 8. TEST DATA (auto-loaded on first boot)

| Data | Count | Details |
|------|-------|---------|
| Users | 5+1 admin | Mike Torres (PM), Sarah Chen (PM), Jennifer Russo (Accounting), Ray Jackson (Shop), Carlos Mendez (Foreman) |
| Customers | 6 | Turner, Skanska, Gilbane, Toll Brothers, Plaza, Torcon |
| Contacts | 7 | Realistic names/emails per customer |
| Locations | 8 | Newark, Jersey City, Manhattan, Brooklyn, Trenton, Edison, Hoboken, Philadelphia |
| Rate Sheet | 12 | 4 unions × 3 classifications |
| Bids | 10 | 4 won, 2 draft, 2 submitted, 1 lost, 1 archived |
| Projects | 4 | Active, with financials |
| Timesheets | 48 | 3 weeks × 4 workers × 4 projects (weekly format with daily_details) |
| Invoices | 8 | 2 per project with line items |
| POs | 8 | 2 per project with line items |
| Equipment | 15 | Hilti, Milwaukee, Greenlee, Fluke |

All passwords: `Password123!` (admin: `ChangeMe123!`)

---

## 9. WHAT'S LEFT (Phase G)

| Item | Status | Notes |
|------|--------|-------|
| E2E testing (TESTING.md) | Ready | 23 browser tests + mobile smoke test |
| Replace mobile placeholder icons | Needs design | `mobile/assets/` has tiny PNGs |
| Firebase project (Android push) | Needs setup | FCM key |
| Apple Developer (iOS push) | Needs account | $99/year |
| `eas build` production binaries | After testing | `cd mobile && eas build` |
| App Store + Play Store submit | After build | TestFlight → production |
| Admin: upload oil sample form template | First boot task | Admin → Form Templates → upload annotated image |
| Google Maps auto-miles | Optional | Needs API key, manual entry works |

---

## 10. FIRST MESSAGE FOR THE NEW CHAT

Paste this after uploading the files:

> "I'm continuing a build from a previous chat. The tarball contains a complete construction PM platform (Node.js/Express/PostgreSQL backend, vanilla JS frontend, React Native mobile app). All code is written and verified — 191 endpoints, 51 tests passing, 35 bugs already found and fixed. I need to continue with [YOUR NEXT TASK]. The HANDOFF_COMPLETE.md has the full state. The TESTING.md inside the project has 23 test scenarios ready to walk through."
