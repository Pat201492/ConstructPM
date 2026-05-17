# Future Refinement — Native Mobile Data Entry with System-Driven Autofill

> **Status:** Backlog · **Priority:** High once initial deployment stabilizes · **Estimated effort:** 3–5 weeks
> **Drafted:** April 2026 · **Trigger:** Pat (in conversation, post-initial-build)

---

## The vision

The current foreman-facing mobile flow assumes the input is a **photograph** — handwritten timesheets, oil sample forms, etc. — that gets OCR'd and AI-extracted. This works, but has accuracy ceilings on handwriting (40–70% per field) and forces every submission through a verification step.

**The refinement:** add a parallel "type it directly on the phone" path. When the foreman selects a project, the system **prefills everything it already knows** about that project (workers assigned, classifications, billing rates, location, local union, last week's miles), and the foreman just enters today's hours in a typed form. No photo. No OCR. No AI extraction.

This is a fundamentally different data path:
- **Photo path:** unstructured input → AI extracts → user verifies → DB
- **Typed path:** structured input → DB directly (with light client-side validation)

The typed path is faster, more accurate, and works in poor lighting / cold weather where camera-based capture struggles. The photo path stays available for when foremen actually have a paper form they want to scan (legacy timesheet templates, third-party oil sample forms, etc.).

---

## Core principle

**Every field that the system can derive should be derived, not typed.** The foreman should be entering data the system genuinely doesn't already know — primarily hours worked per day. Everything else is metadata the system has.

This is the same minimization principle that drives the rest of the platform — typing is the failure mode, not the intent.

---

## What the system can derive once a project is selected

When the foreman picks a project number on mobile (using the existing `ProjectRefField` typed-validation flow), the backend already has:

| Field | Source | Already in DB? |
|---|---|---|
| Project name, customer, address | `projects` row | Yes |
| Local union | `projects.local_union` | Yes |
| Miles from HQ (round-trip) | `projects.miles_from_hq` × 2 | Yes |
| Per diem rate | `projects.per_diem_rate` | Yes |
| Foreman's classification | `users` row of the foreman | Could be added |
| Locked billing rate (ST/OT/DT) for this project | `bid_quote_lines` joined by classification | Yes |
| Last week's hours for this foreman on this project | most recent timesheet row | Yes |
| Last week's miles driven by this foreman | most recent timesheet row | Yes |
| Co-workers on this project | `project_assignments` filtered to this project | Yes |
| Equipment currently checked out to this project | `equipment_checkout_log` | Yes |
| Open oil samples on this project | `oil_sample_requests.status='pending_return'` | Yes |
| Open equipment requests on this project | `equipment_requests.status IN ('open','partially_filled')` | Yes |

That's a lot of context. The mobile screen should surface the relevant subset for the form being filled.

---

## Forms to build

### 1. Native timesheet entry (highest value)

**Currently:** foreman uploads a photo of a paper timesheet → OCR/AI extract worker name, classification, hours per day → PM verifies in the inbox.

**Proposed:** foreman opens "New Timesheet" on mobile, sees:

- **Project** — typed reference (existing `ProjectRefField`), validates live
- **Worker** — defaults to the foreman themselves; can also enter timesheets for crew members the foreman supervises (if the firm wants foremen filing crew timesheets, which is common)
- **Classification** — pulled from the worker's `users.classification` field (new column needed) or `project_assignments.classification` (better — supports a worker being a journeyman on one project and apprentice on another)
- **Week ending** — date picker, defaults to the most recent Friday, can pick any past Friday
- **Daily hours** — 5 rows (Mon–Fri), each with ST hours, OT hours, miles. Numeric keypad, big tap targets, works in gloves.
- **Miles driven** — defaults to `project.miles_from_hq * 2 * days_with_hours`, editable. Foreman taps "use default" or types actual.
- **Per diem days** — defaults to `days_with_hours` if `project.per_diem_rate > 0`, editable.
- **Notes** — optional free text, same as field notes

**On submit:** writes directly to `timesheets` + `daily_details` JSONB. No `pending_extractions` row. No verification step. Goes straight to confirmed.

This raises a real design question: **should typed timesheets still go through PM verification?** Two camps:

- **Skip verification** — typed input has no OCR error to correct. Verification is a holdover from the photo flow. Save the PM time.
- **Keep verification** — verification isn't only about OCR errors; it's also a "PM saw and approved this" stamp for accountability. Should not be removed without firm policy decision.

I'd default to **keep verification but make it a single-button "approve all" rather than a field-by-field review** for typed timesheets. PM gets a notification, opens the inbox, sees a green badge "Typed (no extraction needed)", clicks Approve. Done.

### 2. Native field note (already exists, minor enhancement)

Field Notes already use typed input (no photo). But they could be enhanced with system-driven autofill:

- When the foreman selects a project, show the **last 3 field notes** for that project as quick reference (so the foreman can see what was reported recently and not duplicate)
- Show a **"flag for PM"** toggle that escalates the note to a notification (currently all notes are passive)
- Show **open equipment requests** for this project so the foreman can reference them in the note text

### 3. Native oil sample submission (replacement for photo path)

**Currently:** foreman photographs the lab form, vision AI extracts customer's equipment ID, location, sample date, etc.

**Proposed alternative:** typed entry. Foreman selects project, sees:

- **Customer's equipment ID** — typed (the foreman is reading off a tag on the transformer/switchgear/etc. anyway, no real benefit to photographing it)
- **Sample location within site** — text or dropdown if pre-loaded by admin
- **Sample date** — defaults to today
- **Sample type** — dropdown if applicable (oil/gas/water — varies by industry)

**Why offer this if the photo flow exists?** Some firms don't use lab paper forms — the lab portal accepts data digitally and the firm just needs to track that the sample was sent. For those firms, the photo step is wasted effort.

The photo flow stays for firms that need the paper form scanned (some labs require a signed paper form returned with the sample bottle).

### 4. Native equipment request

**Currently:** foreman uses the mobile app to type equipment requests. Already typed, but could be enhanced:

- When foreman selects a project, suggest **commonly-requested items** based on what's been requested for similar projects in the past (from `equipment_requests` history)
- Show **what's currently checked out** to this project so the foreman doesn't request something they already have
- Show **inventory levels** for the items requested so the foreman knows ahead of time if something is back-ordered

---

## Architecture sketch

### Backend additions
- `GET /api/projects/:id/foreman-context` — single endpoint that returns everything the mobile app needs to populate forms for that project. Returns: project info, current foreman's classification on this project, locked rates, last timesheet for this foreman, miles default, per diem default, recent field notes, open equipment requests, currently-checked-out equipment, open oil samples. One round-trip from mobile.
- `POST /api/timesheets/native` — direct timesheet creation endpoint. Validates required fields, looks up locked rates from `bid_quote_lines`, calculates `potential_revenue`, writes to `timesheets`. Bypasses the `pending_extractions` flow entirely. Marks `source='mobile_typed'` for audit.
- `POST /api/oil-samples/native` — same pattern as timesheets.
- `users.classification` column or `project_assignments.classification` (the latter is more flexible). Currently classification only exists on timesheets and bid quote lines. To autofill, it has to live on the assignment relationship.

### Mobile additions
- New screen: `TypedTimesheetScreen.js`
- New screen: `TypedOilSampleScreen.js`
- Enhancement: `FieldNotesScreen.js` shows recent notes when project is selected
- Enhancement: equipment request screens show currently-checked-out + suggested-items
- Toggle on each form to switch between **"Type it"** and **"Take a photo"** so foremen can choose per submission

### Client-side caching
For offline use (foremen often work in basements / steel buildings with no signal):
- Cache the `foreman-context` response per project for 24 hours
- Queue typed submissions in local storage when offline; flush when connection returns
- Sync indicator on the home screen showing pending uploads

This is a meaningful additional scope (Phase 1.5 add-on, not part of native typing itself) but worth flagging because it's the natural follow-on.

---

## Tradeoffs to think through before building

### 1. Two paths or one?
**Question:** keep both photo and typed paths, or replace photo entirely?

**My recommendation:** keep both. Some firms have legacy paper forms they're not going to abandon (state DOT prevailing-wage timesheets sometimes mandate paper). The photo path serves them. The typed path serves firms with no paper requirement. Both can coexist with minimal code overhead — they share the same schema endpoints.

### 2. Where does classification live?
**Question:** currently a worker's classification is on each timesheet (because the photo extraction finds it). For typed entry, we need it pre-known. Where does it live?

Options:
- `users.classification` — single classification per worker. Simple but wrong for any firm where a worker is a journeyman on one job and an apprentice on another (this is common in some unions).
- `project_assignments.classification` — per-assignment. More flexible, matches how it actually works in the field.

**My recommendation:** `project_assignments.classification`, with a simple admin UI to set it when assigning a worker to a project.

### 3. PM verification of typed timesheets
**Question:** see "skip vs keep verification" discussion above. Decide before building.

**My recommendation:** keep verification, but as a one-click approval. Don't make PMs feel like they're losing oversight, but don't waste their time either.

### 4. Crew timesheet filing
**Question:** should foremen be able to file timesheets for their crew, or only for themselves?

**Pat's customer is a 30-mobile-user shop.** Workflow likely involves a foreman submitting hours for the whole crew (because not every laborer has the app). This needs explicit support — it's not a free-for-all.

**Suggested rule:** foremen can file timesheets for any worker assigned to projects they're a foreman on. Anyone else, they can't. This requires the `project_assignments` table to track foreman role explicitly (currently doesn't).

### 5. Audit trail and edit window
**Question:** can a foreman correct a timesheet they typed? Can they delete one? Within what time window?

**Suggested rule:** edits allowed within 7 days of submission, then it locks (unless admin overrides). This matches how most payroll systems handle late corrections.

---

## Implementation phasing

If/when the firm is ready to invest in this:

**Phase 1 — Foundation (1 week)**
- Add `project_assignments.classification` column
- Build `GET /api/projects/:id/foreman-context` endpoint
- Admin UI for assigning classifications when a worker is assigned to a project

**Phase 2 — Native timesheet (1.5 weeks)**
- Mobile `TypedTimesheetScreen` with the autofill from foreman-context
- Backend `POST /timesheets/native`
- Inbox handling for typed timesheets (one-click approve)

**Phase 3 — Crew timesheets + edit window (1 week)**
- Foreman files for crew (with assignment-based authorization)
- 7-day edit window for self-filed timesheets
- Audit logging for late edits

**Phase 4 — Native oil samples + field note enhancements (0.5 week)**
- Same pattern as timesheets
- Field note screen surfaces recent project notes

**Phase 5 — Offline support (1 week, optional)**
- Local storage queue
- Sync indicator
- Conflict resolution for offline-edited timesheets

Total realistic scope: **4–5 weeks** for full feature. Phase 2 alone delivers the main value (~2 weeks).

---

## What this is NOT

To be clear about scope, this refinement is **not**:

- A web-based timesheet entry form (already exists)
- A replacement for the photo extraction path (it stays)
- Mobile-side AI/OCR (the whole point is to bypass that)
- A new role or permission model (foremen still file, PMs still approve)

It's specifically about adding a typed-entry alternative on mobile, with system-driven autofill so the foreman types as little as possible.

---

## Pricing implications

For Pat's customer pitch:

- Initial deployment: photo flow only (current build) — $X setup
- Phase 2 of native typing: add as a **Q2/Q3 add-on** — likely $4,000–$6,000 additional engineering
- The full vision (all 5 phases including offline): $12,000–$18,000

Worth flagging to the firm that this is a planned future enhancement so they don't think the photo flow is the only option forever. Some firms will say "we'll never use paper forms anyway, just give us the typed flow" — which is a useful signal that they're a typed-only firm and the photo flow can be deferred or skipped for their deployment.

---

## Open questions for the firm when this gets prioritized

1. Do your foremen always file their own hours, or do they file for their crew? Mix?
2. Are there any timesheets you legally must keep on paper (state DOT, etc.)?
3. What's your edit window policy? Foreman corrects within 24 hours? 7 days? Never (admin only)?
4. Is classification per-worker or per-assignment in your shop?
5. Do you want a "typed" badge on the inbox so PMs can quickly see which entries don't need OCR review?

Answers to those drive the implementation specifics. None should block a committed roadmap; they're just nice-to-have decisions that make the feature land better.

---

*This document is a planning artifact. No code changes implied by its existence. Update when implementation begins.*
