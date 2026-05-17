# Mobile App — Complete Reference

> **Companion documents:**
> - `HANDOFF.md` — master index, start here if this is your first time opening this package
> - `PROJECT_REFERENCE.md` — original backend architecture (current built state)
> - `AI_SETUP.md` — AI preset system used by the vision extraction pipeline described here
>
> Single source of truth for the mobile app build.
> Last updated: April 19, 2026
> Status: Design complete. Ready to implement.
> Target platforms: iOS (iPhone) + Android (single React Native codebase via Expo)

---

## 1. CORE PRINCIPLE

**Reuse the existing backend. Minimize mobile-specific logic.**

The mobile app is a thin client for four roles (Admin, PM, Shop Staff, Foreman). ~85% of functionality calls existing REST endpoints. New backend work is scoped to: (a) role rename, (b) three new data models (Field Notes, Oil Sample Requests, Form Templates), (c) one new FK (equipment request → foreman), (d) one new notification type, (e) **a new vision-based extraction pipeline** for forms with visual elements (checkboxes, X-marks, filled circles).

The same philosophy applies as the web app: **minimize user input, maximize user verification.** Field staff take photos of forms; vision AI extracts structured data using an admin-configured color-coded template; users verify via checkbox confirmation and correct before submission.

---

## 2. SCOPE SUMMARY

### In scope (v1)
- React Native app (iOS + Android) via Expo
- 4 role-specific UIs on mobile: Admin, PM, Shop Staff, Foreman
- Barcode scanning (expo-camera)
- Photo capture → **vision AI extraction** (Llava primary / Claude Vision fallback) → checkbox verification
- **Form Template system** — admin uploads color-coded reference forms (blue=labels, red=data zones); system uses them as extraction schema
- Push notifications (expo-notifications)
- JWT auth (reuses existing `/auth/login` + refresh token rotation)
- New Foreman features: Field Notes (Add + Edit sub-tabs), Oil Sample Requests, equipment assignment push notifications
- Role rename: `field_staff` → `foreman` (database enum + all code references)

### Out of scope (Phase 2)
- Offline mode / sync queue
- Timesheet submission on mobile (Foreman does NOT submit timesheets on mobile)
- Mobile Word doc editing (Quick Bid on mobile creates the record only; desktop finalizes the proposal)
- Personnel certifications (worker safety certs, licenses, trade qualifications)
- Vision extraction for other document types (invoices/POs/timesheets stay on text-only pipeline unless added to Form Template system later)

---

## 3. PLATFORM STACK

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | React Native | Single codebase → iOS + Android |
| Build system | Expo (managed workflow) | `expo start`, no Xcode/Android Studio required for dev |
| Navigation | `@react-navigation/bottom-tabs` + `native-stack` | Per-role tab layouts |
| Auth storage | `expo-secure-store` | Stores JWT access + refresh tokens |
| HTTP | `fetch` (built-in) | API client with auto-refresh on 401 |
| Camera | `expo-camera` | Barcode scanning + photo capture |
| Photo picker | `expo-image-picker` | Alternative to live camera |
| Notifications | `expo-notifications` + `expo-device` | Push via Expo Push Service (routes to APN + FCM) |
| State | React Context | AuthContext, NotificationContext |
| Icons | `@expo/vector-icons` | Bundled with Expo |
| Dates | `date-fns` | Lightweight, tree-shakeable |

### Backend integration
The mobile app talks to the existing Node/Express backend at `API_BASE_URL` (configurable per environment). Two backend additions specific to mobile scope:

1. **Vision AI pipeline** — new branch in `ExtractionService` for form-template-driven extraction:
   - Llava (vision model on Ollama, e.g. `llava:13b`) as primary
   - Claude Vision API as fallback (reuses existing `ANTHROPIC_API_KEY`)
   - Configured via the **AI preset system** — set `AI_PRESET=local-standard` in `.env` and the vision backend is auto-configured (full details in `AI_SETUP.md`)
   - Individual overrides: `OLLAMA_VISION_MODEL`, `VISION_AI_BACKEND=auto|ollama|claude`
   - Llava:13b requires ~9GB VRAM; Llava:7b requires ~5GB. Confirm GPU capacity before pulling — see `AI_SETUP.md` for hardware→preset mapping

2. **Template management service** — stores admin-uploaded annotated forms, runs color detection (blue regions = field labels, red regions = data zones), persists the spatial map, and serves it to the extraction pipeline at inference time.

### Expo push setup
Requires Firebase project (Android FCM) + Apple Developer account (iOS APN). Expo Push Service brokers delivery — backend sends to `https://exp.host/--/api/v2/push/send` with device tokens stored in the existing `user_devices` table.

---

## 4. ROLES ON MOBILE

All four web roles have mobile access, each with a distinct tab layout.

| Role | Mobile Primary Use | Web Equivalent |
|------|-------------------|----------------|
| Admin | Oversight — see all equipment requests across org | Full web admin panel |
| Project Manager | Create equipment requests, Quick Bid from field | Full PM web access |
| Shop Staff | Fulfill requests, return equipment, flag maintenance | Shop web page |
| Foreman | Receive equipment notifications, submit Field Notes + Oil Sample Requests | Minimal web access (view own projects) |

---

## 5. FEATURES BY ROLE

### 5.1 Admin (mobile)
Single screen — `Equipment Requests` overview.
- List of all equipment requests across the org
- Filter: open / partially filled / filled
- Shows: request #, PM, project, assigned foreman, status, line count
- Tap → detail view with line items and barcode assignments
- Read-only on mobile (admin web has full management)

Admin also sees the **pending oil samples count badge** on the nav if they're viewing the mobile web shell — but Oil Sample confirm-returned happens on the web app, not mobile.

### 5.2 Project Manager (mobile) — 2 tabs

**Tab 1: Equipment Requests**
- List own outstanding requests + history
- Button: `Create Request`
  - Select project (searchable dropdown; only shows projects PM is assigned to)
  - **Select foreman** (searchable dropdown of foremen assigned to that project) — NEW FK
  - Input method toggle:
    - **Typed** — add line items manually (description + qty)
    - **Photo** — snap photo of handwritten list → OCR → Ollama extracts line items + project number → PM verifies extracted items via checkbox UI
  - Submit → request created, foreman auto-notified (new notification #14)

**Tab 2: Quick Bid**
- Same 5-step flow as web bid creation:
  1. Select customer (searchable dropdown, inline `+` to add)
  2. Select location (searchable, inline `+`)
  3. Select primary contact (searchable, inline `+`)
  4. Scope text input
  5. Quoting table (classification × personnel × ST/OT/DT hours)
- On submit: calls same `POST /api/bids` endpoint as web, locked rates pulled from rate_sheet, folder + files generated server-side
- **Does NOT** generate or edit Word documents on mobile — PM opens the bid later on desktop to finalize proposal

### 5.3 Shop Staff (mobile) — 3 tabs

**Tab 1: Open Requests**
- List of unfulfilled + partially filled requests across all projects
- Tap a request → shows line items with status (unassigned / assigned)
- `Scan Barcode` button → opens camera
  - Scan barcode → system finds matching equipment → staff taps which line item it fulfills
  - Handles naming mismatch: PM requests "generator", staff scans Generator #G-4412, assigns to that line
- `Mark Filled` button (enabled only when all lines have barcodes) → request status → `filled`, equipment statuses → `checked_out`, checkout logged

**Tab 2: Return**
- `Scan Barcode` button → camera
- Scan → equipment record shown → `Confirm Return` button
- On confirm: equipment status → `available`, checkout log closed with return date

**Tab 3: Maintenance**
- `Scan Barcode` button → camera
- Flag options: `Maintenance Required` / `In Maintenance` / `Back to Available`
- `Attach Document` button → photo or file picker → uploads to `equipment_documents` table with equipment_id FK
- Flagged items warn/block on future checkout attempts (backend logic in equipment model)

### 5.4 Foreman (mobile) — 2 tabs

No dedicated Notifications tab. Equipment assignment notifications arrive via OS push (expo-notifications) and a bell icon in the app header that surfaces in-app notification history.

**Tab 1: Field Notes** — has 2 sub-tabs, defaults to `Add`

- **Add** (default)
  - Select project (dropdown — only projects foreman is assigned to)
  - Date picker (defaults to today; foreman can set any date)
  - Text input (multi-line, free-form; respects `field_note_max_length` global var)
  - Save → `POST /api/field-notes`

- **Edit**
  - Select project (dropdown — only projects foreman is assigned to)
  - App fetches `GET /api/field-notes?project_id=X&foreman_id=SELF` — only this foreman's notes for this project
  - List of notes sorted by date descending
  - Tap a note → inline edit (text + date editable; project locked)
  - Save → `PUT /api/field-notes/:id`
  - **No edit window** — foreman can edit any of their own notes at any time

**Tab 2: Oil Sample Request**
- `New Oil Sample` button
  - Select project (dropdown)
  - `Take Photo` or `Choose Photo` → photo of filled-out form
  - Photo uploads to `inbox/oil-samples/` with `foreman_id` + `project_id`
  - Backend loads active Oil Sample `form_template`, runs vision extraction (Llava → Claude fallback), returns structured fields including any X-marks / filled circles
  - Checkbox verification screen: foreman sees extracted fields (equipment ID, date, oil hours, condition boxes marked, etc.), ticks each as correct or edits
  - On confirm: record written to `oil_sample_requests`, status = `pending_return`, file copied to both `projects/{year}/{PM}/{Customer}/{Name}/oil_samples/` AND `oil_samples/` (central)
- List view beneath the button: own submitted samples with status (`pending_data_confirm` / `pending_return` / `returned`)

**Header bell icon (all screens)**
- Standard mobile pattern — bell in top-right
- Badge shows unread count
- Tap → drawer slides in showing notification history
- Primary notification type for foreman: `equipment_assigned_to_foreman` (#14)

---

## 6. NEW DATABASE SCHEMA

### 6.1 Role rename (migration)
```sql
-- PostgreSQL 12+ supports ALTER TYPE RENAME VALUE
ALTER TYPE user_role RENAME VALUE 'field_staff' TO 'foreman';
```
Must also update seeds, `config/roles.js`, all `authorize()` middleware calls, frontend role checks.

### 6.2 New table: `field_notes`
```
field_notes
  id            uuid PK
  project_id    uuid FK → projects.id (cascade)
  foreman_id    uuid FK → users.id
  note_date     date (foreman-selected)
  note_text     text
  created_at    timestamptz
  updated_at    timestamptz

Indexes: (project_id, note_date DESC), (foreman_id)
```

### 6.3 New table: `oil_sample_requests`
```
oil_sample_requests
  id                      uuid PK
  project_id              uuid FK → projects.id (cascade)
  foreman_id              uuid FK → users.id
  form_template_id        uuid FK → form_templates.id (which template was used)
  submitted_at            timestamptz
  original_photo_path     text (in inbox initially, final after confirmation)
  filed_path_project      text (null until confirmed)
  filed_path_central      text (null until confirmed)
  extracted_fields        jsonb (raw vision extraction result — includes text values AND checkbox/mark states)
  equipment_id_extracted  text (which equipment sample is from, extracted from form)
  sample_date_extracted   date
  sample_type             text
  condition_notes         text
  confirmed_by_foreman_at timestamptz (when foreman ticked all extraction fields correct)
  sample_returned_at      timestamptz (when admin/PM marks physical sample returned)
  confirmed_returned_by   uuid FK → users.id (nullable)
  status                  enum: pending_data_confirm, pending_return, returned, cancelled
  extraction_id           uuid FK → pending_extractions.id (links to AI pipeline record)
  vision_backend_used     text (llava | claude_vision — for debugging/cost tracking)
  created_at              timestamptz

Indexes: (project_id), (status, submitted_at DESC), (foreman_id), (form_template_id)
```

### 6.4 New table: `form_templates`
The admin-uploaded color-coded reference forms that drive vision extraction.
```
form_templates
  id                  uuid PK
  form_type           text (e.g. 'oil_sample' — future-extensible to other form types)
  name                text (admin-visible name, e.g. 'Standard Oil Sample Form v2')
  template_image_path text (path to the uploaded annotated reference image)
  field_map           jsonb (array of {field_name, label_bbox, data_bbox, data_type})
                           -- data_type ∈ text | number | date | checkbox | filled_circle
  active              boolean (only one active template per form_type at a time)
  created_by          uuid FK → users.id
  activated_at        timestamptz (null until admin confirms + activates)
  created_at          timestamptz

Indexes: (form_type, active), (created_by)
```

The `field_map` is populated when admin uploads the annotated form: the backend uses a vision model to detect blue regions (labels) and red regions (data zones), pairs them spatially, and produces a draft map. Admin reviews and confirms each mapping before `active` can flip to `true`.

### 6.5 Schema addition: `equipment_requests.assigned_foreman_id`
```sql
ALTER TABLE equipment_requests
  ADD COLUMN assigned_foreman_id uuid REFERENCES users(id);

CREATE INDEX idx_eq_req_foreman ON equipment_requests(assigned_foreman_id);
```
PM picks the foreman when creating the request. One foreman per request (not per line item).

### 6.6 Enum additions
```sql
-- Add new doc_type for oil sample form
ALTER TYPE doc_type ADD VALUE 'oil_sample_request';

-- New enum for oil sample status
CREATE TYPE oil_sample_status AS ENUM (
  'pending_data_confirm',  -- awaiting foreman to verify extracted fields
  'pending_return',         -- foreman confirmed data, awaiting physical sample
  'returned',               -- admin/PM confirmed physical sample came back
  'cancelled'
);
```

### 6.7 Global variables (additions)
| Key | Default | Description |
|-----|---------|-------------|
| field_note_max_length | 5000 | Character limit for field notes |
| vision_ai_backend | auto | Force: llava, claude, or auto |
| ollama_vision_model | llava:13b | Vision model name on Ollama host |
| template_color_tolerance | 30 | HSV tolerance for blue/red detection (0–100) |

---

## 7. NEW/MODIFIED API ENDPOINTS

### New routes

**`routes/foremen.js`** (or merge into users.js)
- `GET /api/foremen?project_id=X` — list foremen assigned to a project (for PM equipment request dropdown)

**`routes/field-notes.js`** (new file, 6 endpoints)
- `GET /api/field-notes` — list (filter by project_id, foreman_id, date range)
- `GET /api/field-notes/:id` — detail
- `POST /api/field-notes` — foreman creates note
- `PUT /api/field-notes/:id` — foreman edits own note (no time window)
- `DELETE /api/field-notes/:id` — admin or owner delete
- `GET /api/field-notes/export?project_id=X&start=Y&end=Z` — CSV export

**`routes/oil-samples.js`** (new file, 7 endpoints)
- `POST /api/oil-samples/upload` — foreman uploads photo, triggers vision extraction pipeline
- `GET /api/oil-samples` — list (filter by project_id, status, foreman_id)
- `GET /api/oil-samples/:id` — detail
- `POST /api/oil-samples/:id/confirm-data` — foreman confirms extracted fields accurate
- `POST /api/oil-samples/:id/confirm-returned` — admin/PM marks physical sample returned
- `GET /api/oil-samples/pending-count` — count for nav badge (filtered by user role)
- `DELETE /api/oil-samples/:id` — cancel (admin only)

**`routes/form-templates.js`** (new file, 7 endpoints) — admin-only
- `GET /api/form-templates` — list all templates (filter by form_type, active)
- `GET /api/form-templates/:id` — detail including field_map + rendered overlay
- `POST /api/form-templates/upload` — admin uploads annotated reference image; backend runs color detection, returns draft field_map
- `PUT /api/form-templates/:id/field-map` — admin edits field_map (rename fields, adjust bounding boxes, set data_type per field)
- `POST /api/form-templates/:id/activate` — admin confirms mapping correct → template goes active for that form_type; previously-active template for same form_type is auto-deactivated
- `POST /api/form-templates/:id/deactivate` — admin deactivates a template
- `DELETE /api/form-templates/:id` — admin deletes (only if never activated)

### Modified routes

**`routes/equipment.js`**
- `POST /api/equipment/requests` — add optional `assigned_foreman_id` field
  - When provided, triggers notification #14 to foreman

**`routes/notifications.js`**
- Add notification type `equipment_assigned_to_foreman` to routing logic

**`routes/inbox.js`**
- Add inbox type `oil-samples` (separate endpoint or merge with existing pattern)

---

## 8. MOBILE NAVIGATION STRUCTURE

Login lands on role-specific tab bar. No shared home screen — the app is purpose-built per role.

```
┌─ ADMIN ─────────────────┐   ┌─ PM ────────────────────┐
│ [Equipment Requests]     │   │ [Equipment Req] [Quick Bid] │
│ [Notifications]          │   │ [Notifications]              │
│ [Profile]                │   │ [Profile]                    │
└──────────────────────────┘   └──────────────────────────────┘

┌─ SHOP STAFF ────────────┐   ┌─ FOREMAN ──────────────────┐
│ [Open] [Return] [Maint.] │   │ 🔔 bell icon in header       │
│ [Notifications]          │   │ [Field Notes] [Oil Samples]  │
│ [Profile]                │   │ [Profile]                    │
└──────────────────────────┘   │                              │
                                │ Field Notes sub-tabs:        │
                                │   [Add] (default) [Edit]     │
                                └──────────────────────────────┘
```

Profile tab (shared across roles): user info, logout, push notification permission toggle, server URL (if configurable).

Foreman has no Notifications tab — equipment assignment notifications arrive via (a) OS-level push, (b) bell icon in header with badge count.

---

## 9. DATA FLOWS

### 9.1 Equipment request → foreman notification
1. PM on mobile taps `Create Request` → selects project → **selects foreman** → adds line items → submit
2. `POST /api/equipment/requests` with `assigned_foreman_id` populated
3. Backend creates equipment_requests row, equipment_request_lines rows
4. NotificationService fires notification #14 `equipment_assigned_to_foreman` → push + in-app to the specified foreman
5. Foreman's device receives push → taps → opens request detail in Notifications tab
6. Later: shop staff fulfills request → equipment checked out to project (no additional foreman notification in v1)

### 9.2 Field Note submission
1. Foreman on mobile: Field Notes tab → `New Note` → picks project + date + types text → save
2. `POST /api/field-notes` → row inserted
3. On web app: Field Notes page per project displays notes sorted by date
4. Admin/PM can export project field notes as CSV via `/api/field-notes/export`

### 9.3 Oil Sample Request (full pipeline)
**Prerequisite:** Admin has uploaded and activated a form template (see §9.5).

1. Foreman on mobile: Oil Samples tab → `New Oil Sample` → selects project → takes photo of filled form
2. Photo uploaded via `POST /api/oil-samples/upload` with `foreman_id` + `project_id`
3. Backend saves file to `inbox/oil-samples/{timestamp}_{filename}`, creates `pending_extractions` row, creates `oil_sample_requests` row with status `pending_data_confirm` and links the active `form_template_id`
4. ExtractionService runs the **vision pipeline**:
   - Loads active template's `field_map` (list of fields + their bounding boxes on the reference form)
   - Sends submitted photo + template + field list to Llava via Ollama (`llava:13b`)
   - For each field: Llava reads the value at the corresponding location — text content, X marks, filled circles, checked boxes
   - Returns `{field_name: value, confidence: 0.0-1.0}` per field
   - If overall confidence < threshold OR Llava fails → Claude Vision API fallback with same inputs
5. Foreman sees checkbox verification screen with extracted fields (each field shows its extracted value + a checkbox to confirm correct, or edit inline)
6. Foreman confirms → `POST /api/oil-samples/:id/confirm-data` → status → `pending_return`, FileService copies photo from inbox to BOTH `projects/{year}/{PM}/{Customer}/{Name}/oil_samples/` AND `oil_samples/{year}/{month}/` (central)
7. Admin/PM on web: sees pending count badge on nav → opens Oil Samples page → sees list of samples awaiting physical return
8. When lab returns sample results, admin/PM taps `Confirm Returned` → `POST /api/oil-samples/:id/confirm-returned` → status → `returned`, `sample_returned_at` timestamped, `confirmed_returned_by` populated, badge count decrements

### 9.4 Quick Bid (mobile)
1. PM on mobile: Quick Bid tab → dropdowns (customer, location, contact) populated from existing `/api/customers`, `/api/locations`, `/api/contacts`
2. PM types scope → fills quoting table
3. Submit → `POST /api/bids` (same endpoint as web)
4. Backend generates bid number, creates bid_quote_lines with locked rates, creates folder
5. Mobile shows success screen with bid number + link to "finish on desktop"
6. PM opens bid on desktop later to generate Word + Excel documents

### 9.5 Form Template setup (admin, one-time per form type)
1. Admin on web: Admin → Form Templates → `Upload New`
2. Admin selects `form_type` (`oil_sample`) + gives template a name + uploads the annotated reference image
   - Reference image convention: **field labels drawn/highlighted in blue**, **data zones drawn/highlighted in red**
   - Data zones include text fields AND any checkboxes, X-mark zones, or filled-circle zones
3. `POST /api/form-templates/upload` → backend:
   - Detects blue regions (field labels) using HSV color thresholding
   - Detects red regions (data zones)
   - Pairs each blue label with its nearest red zone (spatial proximity)
   - Uses vision AI to OCR the text inside each blue region → proposes a field name
   - Returns draft `field_map` array: `[{field_name, label_bbox, data_bbox, data_type}, ...]`
4. Admin reviews each mapping on a visual overlay:
   - Corrects field names if OCR misread
   - Sets `data_type` per field: `text` / `number` / `date` / `checkbox` / `filled_circle`
   - Adjusts bounding boxes by dragging if needed
   - Can add/remove field mappings manually
5. `PUT /api/form-templates/:id/field-map` → updated map saved
6. Admin clicks `Activate` → `POST /api/form-templates/:id/activate` → sets `active = true`, deactivates any prior active template for the same `form_type`, stamps `activated_at`
7. From this point forward, all new oil sample submissions use this template for extraction

---

## 10. NOTIFICATION ADDITIONS

Extending the existing 13-notification system:

| # | Trigger | Goes To | Category |
|---|---------|---------|----------|
| 14 | Equipment assigned to foreman (PM creates request with `assigned_foreman_id`) | Foreman | Actionable (clears when they view the request) |
| 15 | Oil sample submitted → data confirmed → pending return | (no notification — passive count badge only) | N/A |

Notification #15 was explicitly requested as passive. Nav badge only; no push/in-app notification when sample moves to `pending_return`.

---

## 11. FILE SYSTEM ADDITIONS

Extending the existing storage layout (§9 of PROJECT_REFERENCE):

| Path | Trigger |
|------|---------|
| `inbox/oil-samples/{timestamp}_{filename}` | Foreman uploads oil sample photo via mobile |
| `projects/{year}/{PM}/{Customer}/{Name}/oil_samples/` | Oil sample confirmed by foreman (copy from inbox) |
| `oil_samples/{year}/{month}/{filename}` | Oil sample confirmed by foreman (second copy, central repo) |
| `form_templates/{form_type}/{template_id}_{filename}` | Admin uploads color-coded reference form |
| `form_templates/{form_type}/{template_id}_overlay.png` | Backend-generated overlay showing detected regions (for admin review UI) |

The project subfolder list grows from 4 to 5: `invoices`, `timesheets`, `purchase_orders`, `Contract_PO`, **`oil_samples`**.

---

## 12. WEB APP CHANGES REQUIRED

### 12.1 New page: Field Notes (`public/index.html`)
- Route: `#field-notes` and `#project-detail?tab=field-notes`
- Accessible to: admin, PM (own projects), accounting (read-only)
- Per-project view: notes grouped by date, newest first
- Columns: date, foreman name, note text (truncated with expand), created_at
- Export button: downloads CSV of filtered notes
- Template formatting for printable view (separate HTML template per user preference)

### 12.2 New page: Oil Samples (`public/index.html`)
- Route: `#oil-samples`
- Accessible to: admin, PM (own projects)
- Two tabs: `Pending Return` (status = pending_return) and `Returned` (status = returned)
- Columns: project, foreman, submitted_at, equipment_id, sample_date, status, actions
- Action button on pending rows: `Confirm Returned` → modal confirms lab result received → updates status
- Nav sidebar: shows count badge of pending samples (polls `/api/oil-samples/pending-count` on page load + every 60s)

### 12.3 Admin tab additions
- **Foreman Assignment** (new tab, or extend Users tab): view project assignments per foreman, bulk assign/unassign
- **Form Templates** (new tab): upload, review, activate, deactivate color-coded form templates
  - Upload form: pick form_type, upload annotated image, name the template
  - Review screen: shows detected blue/red regions overlaid on the uploaded image; admin confirms/edits each field mapping (name + data_type + bounding box)
  - Active template indicator per form_type
  - Version history (deactivated templates preserved for audit)

### 12.4 Timesheet export flow change
User confirmed: Field Notes are NOT appended to the timesheet CSV export. They get their own dedicated export endpoint and web page. No change to existing timesheet exports.

---

## 13. BACKEND MIGRATIONS REQUIRED

Single new migration file: `migrations/20260420_001_mobile_app_additions.js`

Contents:
1. `ALTER TYPE user_role RENAME VALUE 'field_staff' TO 'foreman'`
2. `CREATE TABLE field_notes (...)` with indexes
3. `CREATE TABLE oil_sample_requests (...)` with indexes
4. `CREATE TABLE form_templates (...)` with indexes
5. `CREATE TYPE oil_sample_status AS ENUM (...)`
6. `ALTER TABLE equipment_requests ADD COLUMN assigned_foreman_id uuid`
7. `ALTER TYPE doc_type ADD VALUE 'oil_sample_request'`
8. Seed new global variables: `field_note_max_length`, `vision_ai_backend`, `ollama_vision_model`, `template_color_tolerance`

Code-level renames (not migration):
- `src/config/roles.js`: replace `field_staff` key with `foreman`
- All route `authorize()` calls using `field_staff`
- `seeds/001_admin_user.js` if it references field_staff
- `public/index.html` role checks
- `README.md`, `TESTING.md`, `PROJECT_REFERENCE.md` docs
- Unit tests referencing the old role name

Infrastructure setup (not migration, but required before vision pipeline works):
- On Ollama host: `ollama pull llava:13b` (or lighter variant if GPU constrained)
- Confirm VRAM ≥ 10GB or configure CPU fallback
- Set env vars in `.env`: `OLLAMA_VISION_MODEL`, `VISION_AI_BACKEND`
- If using Claude Vision fallback: existing `ANTHROPIC_API_KEY` is reused, no new credential

---

## 14. DESIGN DECISIONS (continues from PROJECT_REFERENCE #76)

| # | Topic | Decision |
|---|-------|----------|
| 77 | Mobile platform | React Native via Expo. Single codebase deploys to iOS + Android. |
| 78 | Role rename | `field_staff` → `foreman` everywhere (DB enum, config, routes, frontend). |
| 79 | Foreman mobile scope | Field Notes + Oil Sample Requests + equipment assignment push notifications. No timesheet submission. No Quick Bid. No barcode tasks. |
| 80 | Equipment assignment | PM picks foreman at request creation (new `assigned_foreman_id` FK on `equipment_requests`). Triggers notification #14. |
| 81 | Quick Bid on mobile | PM creates bid record only. Word doc finalization stays on desktop. Reuses existing `POST /api/bids`. |
| 82 | Field Notes model | Project + date + foreman + free text. Separate from timesheets (not merged into timesheet export). |
| 83 | Field Notes web | Dedicated page per project with its own template. Own CSV export endpoint. |
| 84 | Oil Sample Request model | New doc_type. Photo → vision AI → foreman verifies → stored + dual-filed. |
| 85 | Oil Sample filing | Dual-write: project subfolder AND central `oil_samples/` folder. |
| 86 | Oil Sample return confirmation | Admin/PM marks physical sample returned via web app. Passive nav badge — no active notification. |
| 87 | Form Template system | Admin uploads color-coded reference form once per form_type (blue=labels, red=data zones including checkboxes/marks). System derives spatial field map. Admin confirms + activates. |
| 88 | Template interpretation | One-time setup per form_type. Foremen submit normal handwritten forms after that; template provides the extraction schema. |
| 89 | Vision AI backend | Llava (Ollama) primary, Claude Vision API fallback. Mirrors existing Ollama→Claude pattern. |
| 90 | Vision scope | Vision pipeline only applied to form-template-backed doc types (oil_sample_request). Existing invoice/PO/timesheet extraction stays text-only. |
| 91 | Checkbox / X-mark / filled circle handling | Vision model reads the graphical mark state at each data zone; field `data_type` tells the system how to interpret the result (checkbox → true/false, text → string, etc.). |
| 92 | Admin mobile scope | Read-only overview of all equipment requests. Full management stays on web. |
| 93 | Foreman mobile UI | 2 primary tabs: Field Notes + Oil Samples. No Notifications tab — push via OS + header bell icon. |
| 94 | Field Notes sub-tabs | Add (default) + Edit. Edit mode: select project first → app fetches only that project's notes by this foreman. |
| 95 | Field Notes edit window | Foreman can edit own notes at any time. No time restriction. |
| 96 | Mobile auth | Reuses existing JWT flow. Tokens stored in `expo-secure-store`. |
| 97 | Mobile push notifications | Expo Push Service (brokers APN + FCM). Device tokens stored in existing `user_devices` table. |
| 98 | Mobile offline mode | Not in v1. Network required. Phase 2 consideration. |
| 99 | Oil Sample Request photos | Client-side compression before upload (target: <2MB per photo). |
| 100 | Template versioning | Only one active template per form_type at a time. Prior templates kept for audit; new active template auto-deactivates old one. |

---

## 15. BUILD SEQUENCE (RECOMMENDED)

Order of work to minimize blocking dependencies:

**Phase A — Backend foundation (1–2 days)**
1. Write migration file (§13) — role rename + new tables + enum additions
2. Update `config/roles.js` with `foreman` key
3. Search-replace `field_staff` → `foreman` across codebase
4. Run migration on dev DB, verify existing data intact
5. Run unit tests, fix any rename-related failures

**Phase B — Vision infrastructure (1–2 days)**
6. On Ollama host: run `scripts/setup-ollama-windows.ps1 -Preset local-standard` (pulls llama3:8b + llava:13b). See `AI_SETUP.md` for other platforms and preset options.
7. Place `aiPresets.js` + `aiConfig.js` in `src/config/`, append `env-ai-section.txt` contents into `.env` and `.env.example`
8. Verify config loads: `node scripts/test-ai-config.js`
9. Add vision methods to `ExtractionService`: `extractWithLlava(imagePath, fieldMap)`, `extractWithClaudeVision(imagePath, fieldMap)`, `extractWithTemplate(imagePath, templateId)` with auto-fallback using the new aiConfig
10. Unit tests for vision extraction with sample images

**Phase C — Form Templates (2–3 days)**
11. Build `FormTemplate` model + `routes/form-templates.js` (7 endpoints)
12. Build color detection service — HSV thresholding for blue/red regions, spatial pairing
13. Build template upload + review UI on web (drag-to-adjust bounding boxes, field name editing, data_type selector)
14. End-to-end test: admin uploads template → reviews → activates

**Phase D — New backend features (2–3 days)**
15. Build `FieldNote` model + `routes/field-notes.js` (6 endpoints)
16. Build `OilSampleRequest` model + `routes/oil-samples.js` (7 endpoints)
17. Wire oil sample upload → ExtractionService.extractWithTemplate → pending extraction pattern
18. Extend `FileService` with oil sample dual-filing logic
19. Extend `NotificationService` with notification type #14 (equipment assigned to foreman)
20. Modify `POST /api/equipment/requests` to accept `assigned_foreman_id` and trigger notification
21. Add pending-count endpoint for nav badge
22. Unit tests for new models + services

**Phase E — Web app updates (1–2 days)**
23. New Field Notes page (per-project view + export)
24. New Oil Samples page (pending/returned tabs + confirm-returned action)
25. Nav badge for pending oil sample count
26. Admin tab for foreman project assignments
27. Admin tab for Form Templates (upload, review, activate)

**Phase F — Mobile app (5–7 days)**
28. Initialize Expo project, add dependencies (§3)
29. Build AuthContext + login flow + token refresh
30. Build API client with auto-retry on 401
31. Build navigation shell with role-based routing + header bell icon (shared component)
32. Build Admin screens (equipment request list)
33. Build PM tabs (Equipment Requests with photo OCR + Quick Bid)
34. Build Shop Staff tabs (Open/Return/Maintenance with barcode scanning)
35. Build Foreman tabs (Field Notes with Add/Edit sub-tabs + Oil Samples with photo vision verification)
36. Integrate push notifications (Expo Push Service + device registration)
37. Profile tab (shared)
38. Dark theme + outdoor-readable styling

**Phase G — Testing + deployment (2–3 days)**
39. End-to-end test: admin uploads oil sample template → activates
40. End-to-end test: foreman submits oil sample → vision extracts fields → foreman confirms → admin marks returned
41. End-to-end test: PM creates equipment request → foreman notified → shop fulfills
42. End-to-end test: foreman adds field note → edits it → admin exports CSV
43. End-to-end test: PM creates Quick Bid on mobile → opens on desktop → generates Word doc
44. Build iOS + Android production bundles via `eas build`
45. Submit to App Store + Play Store (TestFlight + Internal Testing first)

Total estimate: **14–22 days** of focused development.

---

## 16. OPEN ITEMS

| Item | Status | Notes |
|------|--------|-------|
| Reference copy of the Oil Sample form | Needed from admin | Admin must produce the actual color-annotated (blue labels / red data zones) template image before Phase C can complete |
| Llava GPU capacity | Needs verification | Confirm Ollama host has ≥10GB VRAM. If not, options: use smaller vision model, run vision on CPU (slow), or skip Llava and use Claude Vision only |
| Push notification credentials | Needs setup | Firebase project (FCM) for Android, Apple Developer account for iOS APN. Expo abstracts the delivery layer. |
| App Store + Play Store accounts | Needs setup | $99/year Apple, $25 one-time Google |
| EAS Build (Expo's build service) | Free tier available | Paid tier $29/month if build queue gets saturated |
| Server URL in production | Configurable | Mobile app needs production API domain + TLS cert |
| Template confidence threshold | Tunable | After testing real submissions, decide the Llava confidence level that triggers Claude Vision fallback (start at 0.4, adjust) |

---

## 17. INTEGRATION WITH EXISTING DOCS

This document assumes knowledge of `PROJECT_REFERENCE.md`. Cross-references:

| Topic | See PROJECT_REFERENCE |
|-------|----------------------|
| Notification routing table | §6 |
| Database schema base | §7 |
| AI pipeline (OCR + Ollama) | §8 |
| File system layout | §9 |
| Data flows | §10 |
| Web frontend pages | §11 |
| Cost estimate | §15 |
| Earlier design decisions 1–76 | §16 |

When this document is implemented, update `PROJECT_REFERENCE.md`:
- §3 Build Metrics: table count 34 → 37, enum count 13 → 14, notification count 13 → 14, route files 17 → 20
- §5 User Roles: rename field_staff → foreman
- §6 Notifications: add #14 (equipment_assigned_to_foreman)
- §7 Database Schema: add `field_notes`, `oil_sample_requests`, `form_templates`, `oil_sample_status` enum
- §8 AI Pipeline: add vision branch (Llava + Claude Vision) for template-based extraction
- §9 File System: add oil_sample project subfolder + central folder + form_templates folder
- §11 Frontend Pages: add Field Notes page, Oil Samples page, Form Templates admin tab
- §16 Design Decisions: append 77–100
- §17 Not Built: remove "Mobile app (React Native)" line
