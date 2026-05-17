# CHANGELOG — Code Review Fixes + Admin Password Reset + Structured Project Numbers + Outbound POs

> Updated April 26, 2026 · 10 bug patches + 4 feature additions · All 51 unit tests still passing

This changelog documents every change applied on top of the original `construction_pm_v2_complete.tar.gz` build.

---

## Feature — Outbound Purchase Orders with vendor management + Excel generation

PMs can now CREATE purchase orders to send to vendors (in addition to the existing flow that lets them RECEIVE incoming POs through the inbox). Outbound POs are stored in the database, generated as Excel files with embedded formulas (so totals, tax, and shipping recalculate as the customer edits), and saved to the project's `purchase_orders/` folder where they're clickable from the project detail page.

### Why Excel and not PDF

Static PDFs would have meant fixing tax and shipping at generation time. Excel keeps the document live — the customer's accountant can adjust shipping after vendor confirmation, the PM can add a missed line item, and the totals update automatically via formulas. The line item totals are `=qty*unit_price`, the subtotal is `=SUM(...)`, and the grand total is `=subtotal+tax+shipping`. Tax and shipping cells are highlighted yellow to indicate they're editable.

### Vendor management

New `vendors` table with admin CRUD via a new **Admin → Vendors** tab. Vendor records hold name, contact, email, phone, and full address. POs link to vendors via `vendor_id` (nullable — free-text `vendor` is also kept for incoming PO extractions where the vendor may not be in the system).

The PO creation form on the project detail page has a vendor field with autocomplete from the existing vendor list, plus an inline "+" button to add a new vendor on the fly without leaving the modal.

### Files changed

**New backend:**
- `migrations/20260426_003_vendors_and_po_extensions.js` — vendors table + `purchase_orders` adds `vendor_id`, `tax_amount`, `shipping_amount`, `created_by`
- `src/models/Vendor.js` — CRUD model
- `src/routes/vendors.js` — 5 endpoints (list, get, create, update, soft-delete)
- `src/routes/purchase-orders.js` — 4 endpoints (list by project, get detail, create-with-Excel-generation, download, regenerate)
- `src/services/PODocumentService.js` — ExcelJS-based PO generator with embedded formulas, padded empty rows for in-Excel additions, From/To address blocks, project info, line items table, totals block with editable yellow-highlighted tax/shipping cells

**Backend wiring:**
- `src/app.js` — mounted `/api/vendors` and `/api/purchase-orders`

**New frontend:**
- `public/index.html` — Project detail page now shows a Purchase Orders section with clickable PO numbers that download the Excel via authenticated fetch + blob download (avoids the auth header issue with raw `<a>` href). Also new "Create PO" button opens a comprehensive modal with vendor autocomplete, line items table with live totals, tax/shipping inputs, notes field. New Admin → Vendors tab for managing the central vendor list.

### How POs are numbered

`{YY}-{PMInitials}-PO-{seq}` (e.g., `26-MT-PO-001`). Sequence counts up per PM per year. Different from the structured project number format because POs are PM-scoped, not location-scoped.

### How files land on disk

When PO is created, after the database transaction commits, the system generates the Excel and saves to:

```
projects/{year}/{pm_name}/{customer}/{project_name}/purchase_orders/PO-{po_number}.xlsx
```

The relative path is stored on the `purchase_orders.file_path` column for later download. If file generation fails (e.g., no folder), the PO record still exists — the file can be regenerated via the regenerate endpoint.

### How clicking the PO number works

The project detail page lists each PO. The PO number is an `<a>` tag with an `onclick` handler that calls a `downloadPO(id, number)` helper. The helper does an authenticated `fetch()` to `/api/purchase-orders/:id/download` (so the JWT goes in the header — `<a href>` doesn't allow custom headers), gets the Excel as a blob, creates an object URL, and triggers a download. Works for both the PO list on the project page and any future place the PO number needs to be clickable.

### Permissions

- `purchase_orders:create` — admin, project_manager (can create vendors, create POs)
- `purchase_orders:read` — admin, project_manager, accounting, shop_staff (can list and download)
- PMs can only create POs for their own projects (ownership check at the route level)

### What's NOT yet built

The original idea included pulling line items from order confirmations sent by vendors via email (the email-magic-address feature). That's deferred to a Phase 2 add-on as discussed. The current feature handles outbound POs — typed in the app, saved to DB, generated as Excel, saved to disk, downloadable from the web UI. Email-based capture comes later when the customer is ready.

---

## Feature — Structured project numbers + foreman type-to-validate flow

A bigger feature than originally scoped because it required schema changes, a new project-number generation strategy, and rewriting how foremen identify projects on mobile.

### What changed for the foreman

Old design: foremen picked a project from a dropdown. Either restricted to assigned projects only (too restrictive — covering for sick crew, helping on punch lists) or showed every active project (privacy + scaling concerns at 30+ users).

New design: foremen **type a project reference** — either the structured project number (`M26-1308.1`) or part of the project name. The system validates as they type and shows a green confirmation when the input matches an active project. Below the field, the last 5 projects this foreman submitted to appear as one-tap chips.

Result: no list of every project loaded into the mobile app, no privacy concerns, fast for the common case (recent project = one tap), and works for any active project — even ones the foreman has never touched before.

### What changed for the office

**New project number format.** Alongside the existing `2026-MT-001` style internal number, projects now also have a structured number in the format `J26-1308.8`:

| Component | Meaning | Source |
|---|---|---|
| `J` | PM code (single uppercase letter) | New `users.pm_code` column, admin sets per PM |
| `26` | Year (2-digit) | Project year |
| `1308` | Location code (free text) | New `locations.location_code` column |
| `.8` | Sequence — 8th project for this PM at this location this year | Auto-counted by system |

When a PM marks a bid as won, the verification modal now shows an auto-suggested project number pre-filled (`J26-1308.1` for the first project, `J26-1308.2` for the second, etc.). PM can edit before confirming. System enforces uniqueness — if the typed number is already in use, submission is rejected with HTTP 409 and a clear error.

### Backend additions

- **Migration 6** (`20260426_002_pm_and_location_codes.js`): adds `users.pm_code` (varchar 1, partial unique index), `locations.location_code` (varchar 20, free text)
- **`ProjectNumber.generateStructured(project, trx)`**: counts existing project numbers matching the `{pm_code}{yy}-{location_code}.` prefix and returns the next sequence
- **`ProjectNumber.lookup(refText)`**: matches input against project_numbers exact (case-insensitive) → project name substring → returns single match, ambiguous list, or not-found
- **`GET /api/projects/lookup?ref=...`**: foreman validation endpoint, returns `{found, project, ambiguous?, matches?, message?}` — defined BEFORE `/:id` to avoid Express route shadowing
- **`GET /api/projects/suggest-number?pm_id=...&location_id=...&year=...`**: pre-fills the bid-won modal
- **`GET /api/projects/recent`**: now also includes the project's structured numbers so mobile chips can display them
- **`POST /api/users` and `PATCH /api/users/:id`**: accept `pm_code` with regex validation (single uppercase letter), surface 23505 collisions as 409 errors with friendly messages
- **`POST /api/locations` and `PATCH /api/locations/:id`**: accept `location_code` (free text)
- **`POST /api/bids/:id/confirm-won`**: persists the structured project number from `confirmed_fields.project_number`, rejects duplicates with 409

### Frontend additions

- **Bid-won verification modal** auto-fetches and pre-fills the structured number with a hint showing components ("PM: M · Year: 26 · Location: 1308 · Sequence: 1"). PM can edit before confirming.
- **Admin → Users**: PM Code field on both Create User form and Edit User modal, with regex validation and clear placeholder text
- **New Admin → Locations tab**: full CRUD on locations including the location code, with a warning that changing the code doesn't renumber existing projects
- **Inline-add-location form** on the bid creation page also includes location_code

### Mobile additions

- **New `ProjectRefField` component** in `mobile/src/components/UI.js`:
  - Single text input with debounced (350ms) live validation against `/projects/lookup`
  - Status displays: "Looking up..." → "✓ Newark Federal Courthouse · Turner Construction" (green) → "No active project found" (subdued grey) → ambiguous match list (tappable suggestions)
  - "Recent" chip section at the bottom showing last 5 submissions with project number as primary label and project name as subtitle — one-tap to fill
  - Empty Recent state shows "No recent projects yet" — no fallback list of random projects
- **`Field Notes`** (Add + Edit tabs) and **`Oil Samples`** (New flow) now use `ProjectRefField`
- Old `useProjectPickerData` hook replaced with `useRecentProjects` (no longer fetches the all-projects list)

### Seed data updates

- Mike Torres has `pm_code: 'M'`, Sarah Chen has `pm_code: 'S'`
- All 8 seeded locations have 4-digit `location_code` (1308, 1342, 0301, 0312, 2691, 1420, 1330, 0985)
- Won-bid projects now get both legacy (`2026-MT-001`) and structured (`M26-1308.1`) project numbers
- New seeded foremen (Carlos, Danny, Tyrell) — but they don't get `pm_code` since they're not PMs

### How to test

1. `docker compose down -v && docker compose up --build`
2. Watch boot log for migration 6 success
3. Log in as Mike (admin can also test). Open Admin → Locations → see codes populated for seeded locations. Try editing one.
4. Open Admin → Users → Edit Mike → see PM Code field showing "M". Try setting Sarah to "M" — should fail with 409.
5. On mobile, log in as Carlos. Open Field Notes → Add. Type `M26-1308.1` → should show "✓ {project name} · Turner Construction" in green. Type `xyz` → "No active project found".
6. Submit a field note tagged to that project. Reopen Add — Recent now shows that project as a chip.
7. As Mike on web, create a new bid against Newark location. Mark it won. Verification modal shows pre-filled project number `M26-1308.5` (or whatever the next sequence is).

### Files changed for this feature

- `migrations/20260426_002_pm_and_location_codes.js` (new)
- `src/models/ProjectNumber.js` (added two methods)
- `src/models/User.js` (added pm_code to SAFE_FIELDS and create signature)
- `src/routes/projects.js` (3 new endpoints)
- `src/routes/users.js` (pm_code validation + 409 collision handling)
- `src/routes/locations.js` (location_code allowed)
- `src/routes/bids.js` (confirm-won persists structured number)
- `public/index.html` (admin UI + bid-won modal + inline-loc form + new Locations tab)
- `mobile/src/components/UI.js` (ProjectRefField replaces ProjectPicker)
- `mobile/src/screens/foreman/FieldNotesScreen.js`
- `mobile/src/screens/foreman/OilSamplesScreen.js`
- `seeds/002_test_data.js` (codes + structured project numbers)

---

## ~~Feature — Foreman project picker (Recent + Search all)~~ — *superseded by structured project numbers feature above*

> ⚠️ This earlier design was **replaced** by the typed-validation flow above. The `ProjectPicker` component was removed in favor of `ProjectRefField`. The migration that opened up `project_visibility` to `'all'` for foremen is preserved (still useful — foremen can now hit `/projects` without being restricted to assigned ones). What's NO LONGER true: there is no "all active projects" dropdown on mobile anymore.

Original design notes preserved below for reference:

Foremen on mobile can now tag any active project, not just ones they're formally assigned to. The project picker shows their last 5 submissions at the top under "Recent" and a searchable list of all active projects below.

**Why:** field crews routinely help on jobs they aren't formally assigned to — covering for a sick crew member, helping finish a punch list, swinging by another site for an hour. Locking the picker to assigned projects only created friction with no security benefit (foremen are trusted firm employees, and there's no financial data exposed in the picker).

**Behavior:**
- Recent section shows last 5 distinct projects this foreman has submitted to (across field notes + oil samples), ordered by most recent activity
- No fallback — new foremen with no submission history see an empty Recent section labeled "No recent projects yet"
- Below Recent, all active + on-hold projects are listed alphabetically
- Search box filters across both lists by project name and customer name
- Picker shows project name + customer in each row (more context for foremen who don't memorize project names)

**What changed:**
- New migration `migrations/20260426_001_foreman_project_visibility.js` updates the foreman role configuration `project_visibility` from `assigned` to `all`. Idempotent.
- New backend endpoint `GET /api/projects/recent?limit=5` returns the last N distinct projects the calling user submitted to (field notes + oil samples), filtered to active + on_hold. Defined BEFORE `/:id` to avoid Express route shadowing.
- New mobile component `ProjectPicker` in `mobile/src/components/UI.js` — extends the existing `SearchDropdown` pattern with a Recent header section and customer-name subtitles
- `mobile/src/screens/foreman/FieldNotesScreen.js` — both AddNote and EditNotes use the new picker via a shared `useProjectPickerData()` hook
- `mobile/src/screens/foreman/OilSamplesScreen.js` — NewSample uses the new picker

**Note for the deployment conversation:** project ownership/visibility for office-side roles (PM, accounting, admin) is unchanged. Only foremen got opened up.

**Files changed:**
- `migrations/20260426_001_foreman_project_visibility.js` (new, 30 lines)
- `src/routes/projects.js` (~50 lines added before `/:id` route)
- `mobile/src/components/UI.js` (~95 lines for ProjectPicker component)
- `mobile/src/screens/foreman/FieldNotesScreen.js` (refactored to share picker hook)
- `mobile/src/screens/foreman/OilSamplesScreen.js` (4 lines changed)

---

## Feature — Admin-initiated password reset via emailed link

Admins can now send any user a one-time password reset link from the Users tab in the admin panel. User clicks the link, sets their own password, done. No admin ever sees or types the new password.

**User flow:**
1. Admin opens **Admin → Users → [Edit user]**
2. Clicks **Send Reset Link** in the new "Send Password Reset Link" section
3. If email is configured (SendGrid or SES), the link is emailed directly to the user
4. If email is NOT configured, the link is printed to the server console AND displayed in the admin UI with a Copy Link button — admin shares it out-of-band (Slack, text, etc.)
5. User clicks the link, lands on a clean standalone reset page at `/?reset=<token>`
6. User enters new password twice, submits, sees confirmation, and can log in

**Security design:**
- Token format is `<resetId>.<secret>` — 32 bytes of randomness (48 base64url chars)
- Server stores a **bcrypt hash** of the secret, never the plaintext. If the DB leaks, the links aren't usable.
- Expiry configurable via new global variable `password_reset_expiry_hours` (default 24)
- Single-use — `used_at` set atomically on consumption inside a transaction
- Rate limit: max 5 unused + unexpired tokens per user at a time (prevents spam)
- Admin action logged to `audit_log` with target user email
- User's current password **stays active until they complete the reset** (per your spec — convenient)
- Consume endpoint uses `FOR UPDATE` to prevent parallel-request races

**What was added:**
- New migration `migrations/20260422_001_password_resets.js` creating `password_resets` table + seeding `password_reset_expiry_hours` global var
- New backend endpoint `POST /api/admin/users/:id/password-reset` (admin-only)
- New public endpoint `POST /api/auth/reset-password/verify` (checks token validity)
- New public endpoint `POST /api/auth/reset-password` (consumes token, sets password)
- New frontend function `renderResetPassword(token)` — handles the `?reset=` URL parameter at app bootstrap and shows a clean standalone reset form (no login required)
- New admin UI section in the edit-user modal: "Send Password Reset Link" button + inline link display + Copy Link button (fallback when email isn't configured)
- Retained existing "Set Password Directly" feature (admin types new password) alongside the new flow

**Files changed for this feature:**
- `migrations/20260422_001_password_resets.js` (new, 42 lines)
- `src/routes/admin.js` (imports + ~100 lines for the new endpoint)
- `src/routes/auth.js` (imports + ~110 lines for two new public endpoints)
- `public/index.html` (~75 lines: new `renderResetPassword` function + new admin UI section + modified bootstrap to detect `?reset=` before normal login flow)

---

## Bug Fixes (10 patches)

## P0 — Blocked core functionality

### BUG #5 — Mobile auth field-name mismatch (camelCase vs snake_case)
**Impact:** Mobile login appeared to succeed, but the next API call returned 401 (saveTokens received undefined), the 401 triggered a refresh attempt with the wrong body shape, and the user was kicked out. Blocked every mobile feature.
**Fix:** Mobile now uses camelCase (accessToken, refreshToken) everywhere.
**Files:** `mobile/src/services/api.js` (3 lines), `mobile/src/contexts/AuthContext.js` (1 line)

### BUG #6 — LoginScreen wrong relative import paths
**Impact:** Metro bundler threw module-not-found when login screen rendered. Mobile couldn't even show login.
**Fix:** Changed `../` to `../../` to match every other mobile screen.
**Files:** `mobile/src/screens/shared/LoginScreen.js` (3 import lines)

### BUG #13 — Three-way device_token column name mismatch
**Impact:** Migration defined `device_token`, users route wrote `push_token` (crash caught silently by mobile), NotificationService read `fcm_token` (would crash on push). Push never worked.
**Fix:** All three aligned to `device_token` (matches the migration). API request field stays `push_token` for external compat; route explicitly maps it.
**Files:** `src/routes/users.js` (3 lines), `src/services/NotificationService.js` (1 line)

---

## P1 — Blocked specific features

### BUG #1 — docx package missing from package.json
**Impact:** Timesheet Word export crashed with MODULE_NOT_FOUND. Most likely path since it's what fires when no custom template is passed.
**Fix:** Added `"docx": "^9.0.0"` to dependencies.
**Files:** `package.json` (1 line)

### BUG #4 — POST /api/auth/change-password didn't exist
**Impact:** Frontend Profile page Change Password returned 404.
**Fix:** Added authenticated endpoint. Validates current password (≥1 char) and new password (≥8 chars), fetches user with password_hash directly from db (since `User.findById` filters it out), verifies via `User.verifyPassword`, then calls `User.update(id, { password })` which handles hashing.
**Files:** `src/routes/auth.js` (37 lines added before module.exports)

### BUG #7 — @aws-sdk/client-textract missing from package.json
**Impact:** Textract OCR fallback crashed when `AWS_TEXTRACT_REGION` was set.
**Fix:** Added `"@aws-sdk/client-textract": "^3.1025.0"` to dependencies.
**Files:** `package.json` (1 line)

### BUG #15 — config.claude.maxTokens read but never defined
**Impact:** ExtractionService passed `max_tokens: undefined` to Anthropic API, which rejected with 400. Every Claude escalation silently failed, leaving empty extraction results.
**Fix:** Added `maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10)` to config.claude compat object.
**Files:** `src/config/aiConfig.js` (1 line)

---

## P2 — Broken behavior, not blocking

### BUG #11 — FileWatcher used `channel:` (singular) where `send()` expects `channels:` (plural)
**Impact:** Bid-inactivity, Contract_PO-empty, revenue-threshold, and oil-sample-reminder notifications each fired email + push too (because singular `channel` was dropped as unknown field, and `channels` defaulted to all three).
**Fix:** Changed all 4 call sites to `channels: ['in_app']`.
**Files:** `src/services/FileWatcher.js` (lines 149, 187, 227, 269)

### BUG #3 — FileWatcher.start() dropped its mode argument
**Impact:** Cosmetic. `server.js:83` passed `FILE_WATCHER_MODE` but method was no-arg.
**Fix:** Accept mode param, store on instance, include in startup log.
**Files:** `src/services/FileWatcher.js` (3 lines in start())

### BUG #8 — Dead permission keys timesheets:upload / timesheets:confirm
**Impact:** Keys defined but never used by any route. A unit test asserted them anyway, locking in a false behavioral claim that contradicted the real model.
**Fix:** Removed the two dead keys; replaced the test with one that asserts the real permission (`extractions:confirm`).
**Files:** `src/config/roles.js` (2 lines removed), `tests/unit/roles.test.js` (3 lines updated)

---

## Dependency changes

```json
"@aws-sdk/client-textract": "^3.1025.0",
"docx": "^9.0.0"
```

Run `npm install` before `docker compose up --build`.

---

## Test status

Before: 51 passing, 4 suites. After: 51 passing, 4 suites. No regressions.

---

## Not addressed (intentionally downgraded from review)

- BUG #2 (timesheet verification roles): code was internally consistent; dead keys were the real issue — now fixed by #8
- BUG #9 (SQL injection): input validated by strict regex before raw SQL; not exploitable
- BUG #10 (directory traversal): server-controlled keys; latent hardening, not an exploit
- BUG #12 / #14 (field leaks): false alarms — User.findById filters via SAFE_FIELDS
- Soft issue (project detail bypasses resolveProjectVisibility): minor consistency, left as-is

---

## Next steps

1. Extract: `tar -xzf construction_pm_v2_fixed.tar.gz`
2. Wipe any previous state: `docker compose down -v`
3. Rebuild: `docker compose up --build` (pulls new deps + runs new migration)
4. Log in: admin@company.com / ChangeMe123!
5. Walk TESTING.md (23 scenarios)
6. Mobile: update `mobile/src/services/api.js:7` BASE_URL to your laptop LAN IP, then `cd mobile && npx expo start`

### Testing the new password reset flow

1. Log in as admin → go to **Admin → Users**
2. Click **Edit** on any user (e.g., Carlos Mendez the foreman)
3. Scroll to the "Send Password Reset Link" section → click **Send Reset Link**
4. Since email isn't configured, the link will appear in an orange box in the modal. Also in the server console:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   [PasswordReset] EMAIL NOT CONFIGURED — link printed below
   [PasswordReset] To:      carlos@company.com
   [PasswordReset] Subject: Password reset for ConstructPM
   [PasswordReset] Link:    http://localhost:3000/?reset=<uuid>.<secret>
   [PasswordReset] Expires: 2026-04-23T04:05:00.000Z
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```
5. Click the Copy Link button or grab it from console
6. Open that URL in an incognito window → you'll see the reset page with Carlos's name
7. Enter a new password twice → submit → success page
8. Go to `/` → log in as Carlos with the new password — should work
9. Carlos's OLD password also still works until he uses the link (confirmed by spec)
10. Clicking the same reset link a second time shows "already used"
