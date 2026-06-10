# ConstructPM — Manual Test Checklist

Covers web (http://localhost:3000) + mobile (Expo, exp://192.168.1.198:8081).
⭐ = touched by recent review/fix PRs (#54–#57) — test these hardest.
Dev logins: `admin@company.com` / `ChangeMe123!`; switcher has PM (mike.torres, sarah.chen), estimator, accounting, shop_staff, field_staff.

> 🤖 = auto-verified by Claude this session against live :3000 (merged main, rebuilt). Everything else is human/UI/device.

---

## 1. Auth & session
- [x] Login with valid creds → lands on dashboard
- [x] Login wrong password → 401, no session 🤖
- [x] ⭐ First-login forced password change (must_change_password) → reset screen, then normal
- [x] Logout → back to login, protected pages redirect
- [x] Session persists on page refresh (web) / app relaunch (mobile)
- [ ] ⭐ Token auto-refresh: leave idle past access-token expiry, do an action → still works (silent refresh)
- [x] ⭐ Rate limit: 30+ rapid failed logins → 429 (got 30×401 then 5×429) 🤖
- [ ] Password reset link flow (request → email link → set new → login)
- [ ] Dev user switcher swaps roles cleanly

## 2. Role access / visibility ⭐ (IDOR fixes — critical)
- [x] PM (mike) sees only own bids in list (10/15 vs admin) 🤖
- [x] ⭐ PM opens another PM's **bid** by guessing URL/id → blocked (404) 🤖
- [x] ⭐ PM cannot PATCH/quote/archive another PM's bid → 404 🤖
- [x] ⭐ PM opens another PM's **project** (detail, schedule, team, assignments) → 403 🤖
- [x] ⭐ PM cannot PATCH another PM's project schedule → 403 🤖
- [ ] Field/shop staff see only assigned projects
- [x] Admin sees everything (admin GET other PM's bid/project → 200) 🤖
- [ ] Estimator/accounting see per their role config
- [ ] Sidebar tabs match role (feature flags hide disabled tabs)
- [x] Field_staff blocked from admin / user management (403); allowed /projects (200); no-token 401 🤖

## 3. Bids
- [ ] Create bid → auto bid number, folder created (PM initials + seq)
- [ ] ⭐ Bid folder creation with a user missing initials/name → no crash
- [ ] Quoting table: add lines, rates lock, totals compute
- [ ] Generate bid docs (Excel + Word) → downloads open
- [ ] Mark won → OCR Word → verify fields → project created
- [ ] ⭐ Quick Project quote-to-PM → email delivered (Gmail), template `bid_project_quote`
- [ ] Mark lost / archive / snooze / cancel (delete)
- [ ] Bid files list + download

## 4. Projects & scheduling
- [ ] Project list filters (status, customer, PM) + visibility scoping
- [ ] Project detail: assignments, numbers, financials load
- [ ] PATCH project fields (name, dates, contract type)
- [ ] Schedule: set start/length/working days; weekend-only toggle
- [ ] Calendar card: project address shows; "View Crew" button (count-aware, gray→blue)
- [ ] Assignments: add/remove workers, copy-day
- [ ] Day notes: add/edit per date
- [ ] ⭐ Email Day to Staff → Google Maps link + site contact line in email; per-user override applied
- [x] ⭐ Work Order: regen dedupe (2× regen → deduped, no dup version), PDF download valid 🤖
- [ ] Close / cancel project; auto close-out notification at revenue ≥ contract value
- [ ] Project numbers: add/remove, rules
- [ ] Team tab: add/remove members

## 5. Equipment & tickets (org-wide by design)
- [ ] Equipment list, request equipment (PM/field)
- [ ] Shop: fulfill request, checkout/return
- [ ] ⭐ Ticket flow: create → fill (scan list) → ready → confirm-picked → pickup (archive)
- [ ] ⭐ Ticket "ready for pickup" → email/in-app to requestor + admins
- [ ] ⭐ "None in shop" advisory toast (desktop + mobile)
- [ ] Equipment maintenance / docs

## 6. Inventory
- [ ] List, low-stock filter (quantity ≤ min_stock)
- [ ] Allocate to project (stock decrements, transactional)
- [ ] Adjust quantity; total value calc

## 7. Purchase orders
- [ ] Create PO, line items, vendor
- [ ] Download PO (Excel)
- [ ] Regenerate PO doc

## 8. Financials / invoices
- [ ] Invoices list, summary (totals, paid, overdue)
- [ ] Generate invoice (preview → generate); last-invoice-end correct
- [ ] Record payment
- [ ] Contract vs T&M billing behavior

## 9. Timesheets
- [ ] Submit timesheet (hours by classification) → admin notified
- [ ] Admin confirm timesheet (admin-only)
- [ ] Export timesheets per project

## 10. Exports ⭐
- [x] Data Export builder: preview rows align to headers (projects source) 🤖
- [x] ⭐ Download CSV / XLSX / PDF → valid files (csv text, xlsx PK-zip, pdf %PDF) 🤖
- [ ] ⭐ Tiered grouping (up to 3 levels)
- [ ] ⭐ Predicate filters (=, !=, >, <, >=, <=)
- [ ] Typeahead recipient picker (chips, auto-filter, keyboard nav)
- [ ] "Email to me" test button
- [ ] Scheduled export: frequency + columns + email modal; runs and emails attachment
- [ ] ⭐ Scoped fan-out: one export → N emails per role, optional admin-consolidated copy
- [ ] Per-export email config (subject/body, formats)

## 11. Email & notifications
- [ ] In-app notifications: bell count, mark read, unread count
- [ ] ⭐ Email module: template editor, Recipients tab, "My Email Preferences" panel
- [ ] Per-user template overrides resolve (render with userId)
- [ ] Email triggers fire: bid quote, ticket ready, scheduled export, email-day
- [ ] ⭐ Escaped HTML in notification title/body (no XSS, no broken entities)
- [ ] Email-template defaults refreshed; Oil Samples tab hidden by default

## 12. Files / inbox / extractions
- [ ] ⭐ File download: valid path works; path-traversal attempt (`?path=../..`) → 403
- [ ] Upload to bid/project folder (correct folder)
- [ ] Inbox: invoices / purchase-orders / timesheets drop zones
- [ ] AI extraction (Ollama): upload doc → fields extracted → review → confirm
- [ ] ⭐ Malformed/garbage doc upload → graceful error, no server crash
- [ ] Vendor-quote screenshot (image) → vision extraction

## 13. Field notes / oil samples
- [ ] Field note: create (web + mobile "Save Note"), list, view modal, CSV export
- [ ] Oil sample request → confirm data → list
- [ ] Oil Samples tab visibility (off by default)

## 14. Customers / contacts / locations / vendors
- [ ] CRUD each; search; typeahead pickers ("recent 10")
- [ ] Customer billing display address auto-builds
- [ ] Vendor learning (auto-suggest on PO)

## 15. Admin
- [ ] User management: create/edit/deactivate, role + tab overrides, access config
- [ ] Role configurations (visibility, allowed tabs)
- [ ] Feature flags (superadmin) → toggle hides tabs without redeploy
- [ ] Global variables; audit log
- [ ] ⭐ Add custom role (lowercase validation) → enum updated
- [ ] Superadmin tab gated correctly

## 16. Display / kiosk
- [ ] Shop-floor display (`/display.html`) with DISPLAY_TOKEN → equipment status board
- [ ] Wrong/missing token → blocked

## 17. Mobile app (by role) ⭐
- [ ] ⭐ Login works (was fully broken pre-#54): session established, no blank screen
- [ ] ⭐ Profile screen shows name + initials (not "undefined")
- [ ] ⭐ Auto-refresh on 401 (forced expiry → still works)
- [ ] PM: ⭐ Quick Bid → bid created **with contact** (was dropping contact pre-#57)
- [ ] PM: ⭐ Requests screen foreman picker shows real names (not "undefined undefined")
- [ ] PM/Field: create equipment request; field note "Save Note"
- [ ] Shop: ticket fill/ready/pickup; "none in shop" toast
- [ ] Foreman: oil sample photo upload (field `photo`)
- [ ] Notifications screen: list + unread badge
- [ ] ⭐ Push token registers on login (real device); ⭐ push delivered (Expo) on a trigger
- [ ] Error feedback: kill API / wifi mid-action → app shows error (NOTE: some screens still swallow errors silently — known gap)

## 18. Cross-cutting
- [ ] Timezone handling on dates (no off-by-one on schedule/day-notes)
- [ ] Large list pagination
- [ ] Concurrent edits (two tabs) don't corrupt (work-order/version dedupe)
- [ ] 404/500 pages don't leak stack traces

---

### Highest-priority (recent fixes — if short on time, test these)
1. Mobile login + profile name (#54) — ⬜ needs device
2. Mobile Quick Bid contact + foreman picker names (#57) — ⬜ needs device
3. Bid IDOR: PM can't reach another PM's bid (#55/#56) — ✅ 🤖 auto-verified
4. Project IDOR: PM can't reach another PM's project/subroutes (#57) — ✅ 🤖 auto-verified
5. Auth rate-limit 429 (#55) — ✅ 🤖 auto-verified
6. Exports CSV/XLSX/PDF + work-order regen dedupe — ✅ 🤖 auto-verified
7. Push delivery end-to-end (#54) — ⬜ needs device

---

### 🤖 Auto-verified this session (live :3000, merged main)
Rate-limit (30×401→5×429) · Bid IDOR (404 read+write, own 200, admin 200) · Project IDOR (403 detail+schedule+team+assignments, admin 200) · Authz (field_staff 403 admin / 200 projects / 401 no-token) · Exports (csv+xlsx+pdf valid) · Export preview alignment · Work-order regen dedupe + PDF · Wrong-password 401 · PM sees only own bids.

**Not auto-testable (you/device):** all mobile runtime, live email/push, doc generation (bid Excel/Word, PO, invoice), AI extraction, bulk-import CSVs, UI flows, feature-flag tab visibility.
