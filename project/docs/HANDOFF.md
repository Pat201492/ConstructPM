# Handoff Package — Construction PM Platform

> **Start here.** This document is the master index for the planning package. It tells you what files are included, where each one goes in the project, in what order to upload them to the coding chat, and what to say as your first message.
>
> Planning session date: April 19, 2026
> Status: Design complete for Phase 2 (mobile app + AI preset system + web updates)
> Target hardware (informs AI preset): NVIDIA RTX 4070 Ti 12GB VRAM, 32GB RAM, Windows

---

## 1. PACKAGE CONTENTS (9 files)

| # | File | Type | Destination in project | Purpose |
|---|------|------|------------------------|---------|
| 1 | `HANDOFF.md` | Doc | `docs/` or repo root | This file. Master index + first-message prompt |
| 2 | `PROJECT_REFERENCE.md` | Doc | Repo root (already there in most cases) | Original backend design — current built state |
| 3 | `MOBILE_APP_REFERENCE.md` | Doc | Repo root | Complete mobile app spec — what to build next |
| 4 | `AI_SETUP.md` | Doc | `docs/` | AI preset system guide + Ollama install + troubleshooting |
| 5 | `aiPresets.js` | Code | `src/config/aiPresets.js` | New file — defines AI tier presets |
| 6 | `aiConfig.js` | Code | `src/config/aiConfig.js` | **Replaces** existing file — preset-aware config loader |
| 7 | `env-ai-section.txt` | Snippet | Append into `.env` AND `.env.example` | New env var section (the `AI_PRESET` system) |
| 8 | `setup-ollama-windows.ps1` | Script | `scripts/setup-ollama-windows.ps1` | PowerShell helper — install models for chosen preset |
| 9 | `test-ai-config.js` | Script | `scripts/test-ai-config.js` | Node helper — verify config + models + API keys |

---

## 2. UPLOAD ORDER (coding chat)

Do this exactly once, then use the chat normally.

1. Open the coding chat (or start a new one inside the same Claude Project)
2. Upload these 4 docs to its context (drag-and-drop or paste as project files):
   - `PROJECT_REFERENCE.md`
   - `MOBILE_APP_REFERENCE.md`
   - `AI_SETUP.md`
   - `HANDOFF.md`
3. Upload these 5 code/config files so the chat can reference them when wiring things up:
   - `aiPresets.js`
   - `aiConfig.js`
   - `env-ai-section.txt`
   - `setup-ollama-windows.ps1`
   - `test-ai-config.js`
4. Paste the "First Message" below as your first message

---

## 3. FIRST MESSAGE TO PASTE

Copy this block into the coding chat as your first message:

```
I'm continuing a construction PM platform build from a prior chat. The backend
already exists (see PROJECT_REFERENCE.md). A separate planning session produced
three new reference docs — MOBILE_APP_REFERENCE.md, AI_SETUP.md, and HANDOFF.md —
plus 5 config/script files (aiPresets.js, aiConfig.js, env-ai-section.txt,
setup-ollama-windows.ps1, test-ai-config.js).

Read HANDOFF.md first — it indexes everything and lists what changed.

Then start Phase A, Step 1:

Write the migration file migrations/20260420_001_mobile_app_additions.js that
performs, in order:
  1. ALTER TYPE user_role RENAME VALUE 'field_staff' TO 'foreman'
  2. CREATE TABLE field_notes
  3. CREATE TABLE oil_sample_requests
  4. CREATE TABLE form_templates
  5. CREATE TYPE oil_sample_status AS ENUM (...)
  6. ALTER TABLE equipment_requests ADD COLUMN assigned_foreman_id uuid REFERENCES users(id)
  7. ALTER TYPE doc_type ADD VALUE 'oil_sample_request'
  8. Seed the new global variables (field_note_max_length, vision_ai_backend,
     ollama_vision_model, template_color_tolerance)

Schema details for each table are in MOBILE_APP_REFERENCE.md §6.

Show me the complete migration file as your first output. Do not make any other
changes yet — I want to review the migration before you proceed to Phase A Step 2.
```

That first message is bounded (one deliverable) and gets real code moving immediately.

---

## 4. WHAT'S NEW SINCE THE LAST CODING SESSION

### 4.1 Mobile app — full spec added (was TODO)
Previously `NOT BUILT` in PROJECT_REFERENCE.md §17. Now fully specified across all 4 roles:
- **Admin** — read-only oversight of equipment requests
- **Project Manager** — Equipment Requests tab + Quick Bid tab
- **Shop Staff** — Open Requests / Return / Maintenance (barcode scanning)
- **Foreman** — Field Notes + Oil Sample Requests (new features)

Platform: React Native via Expo (iPhone + Android from one codebase).

### 4.2 Role rename: `field_staff` → `foreman`
Affects everywhere in the codebase. Migration handles the DB enum rename via Postgres 16's `ALTER TYPE ... RENAME VALUE`.

### 4.3 New data models (3 tables)
- `field_notes` — foreman free-text notes tied to project + date
- `oil_sample_requests` — form photo submissions with vision extraction + return tracking
- `form_templates` — admin-uploaded color-coded reference forms that drive extraction schema

Plus one new FK (`equipment_requests.assigned_foreman_id`), one new enum (`oil_sample_status`), one new `doc_type` value (`oil_sample_request`).

### 4.4 AI pipeline adds a vision branch
The existing text-only extraction pipeline is unchanged. A new parallel branch adds vision capability for the oil sample form (handwritten text + checkboxes + X-marks + filled circles):
- Llava on Ollama (primary) → Claude Vision API (fallback)
- Driven by admin-uploaded Form Templates with color-coded field maps

### 4.5 AI preset system (replaces old config)
Old: set every AI env var individually.
New: set `AI_PRESET=<n>` and all settings snap to tested defaults. Individual env vars still override.

Presets: `cloud-only`, `hybrid-lite`, `local-lite`, **`local-standard`** (recommended for user's RTX 4070 Ti), `local-heavy`, `cpu-only`.

See `AI_SETUP.md` for the complete guide.

### 4.6 New notification type #14
`equipment_assigned_to_foreman` — fires when PM creates a request with `assigned_foreman_id` populated. Push + in-app.

### 4.7 New web pages + admin tabs
- Page: Field Notes (per-project view + its own CSV export)
- Page: Oil Samples (pending/returned tabs + confirm-returned action + nav count badge)
- Admin tab: Form Templates (upload, review, activate)
- Admin tab: Foreman Assignments (bulk assign/unassign foremen to projects)

---

## 5. RECOMMENDED BUILD ORDER

Full 7-phase plan in `MOBILE_APP_REFERENCE.md` §15. Summary:

| Phase | Scope | Days |
|-------|-------|------|
| A | Role rename + migrations | 1–2 |
| B | Vision AI infrastructure (pull Llava, add vision methods to ExtractionService) | 1–2 |
| C | Form Templates system (backend + web admin UI) | 2–3 |
| D | New backend features (FieldNote, OilSampleRequest, notifications, dual-filing) | 2–3 |
| E | Web app updates (2 new pages + 2 new admin tabs + nav badge) | 1–2 |
| F | Mobile app (React Native, all 4 roles, push notifications) | 5–7 |
| G | E2E testing + app store submission | 2–3 |

**Total: 14–22 days of focused development.**

Start here: Phase A, Step 1 — the migration file (see §3 above for the bounded prompt).

---

## 6. DECISIONS THAT OVERRIDE EARLIER ASSUMPTIONS

These supersede earlier defaults where `PROJECT_REFERENCE.md` said otherwise:

| Topic | Old assumption | New decision |
|-------|----------------|--------------|
| Foreman mobile scope | Timesheet submission | **No timesheet submission.** Field Notes + Oil Samples only. |
| Old mobile code | Basic timesheet app exists | **Not salvageable. Rebuild from scratch.** |
| Oil sample extraction | Text-based OCR + Ollama prompt | **Vision-based with color-coded form templates.** |
| AI config | Individual env vars | **`AI_PRESET` system** (individual vars still override) |
| Field Notes in exports | Merged into timesheet CSV | **Separate page, separate export endpoint, separate template.** |
| Oil sample return confirmation | Active notification | **Passive — count badge on nav only.** |
| Role name `field_staff` | Kept | **Renamed to `foreman`** everywhere |
| Foreman mobile UI | 3 tabs | **2 tabs** (Field Notes + Oil Samples) + bell icon in header |
| Field Notes edit window | Decision pending | **No time limit** — foreman can edit own notes anytime |

---

## 7. STILL OPEN (user provides before Phase C completes)

| Item | Blocks | Status |
|------|--------|--------|
| Actual color-annotated oil sample form image | Phase C (Form Template testing) | User provides |
| Llava 13B smoke test on RTX 4070 Ti | Phase B (confirm preset works) | Run `setup-ollama-windows.ps1 -Preset local-standard`, then `test-ai-config.js` |
| Firebase project (FCM) + Apple Developer account | Phase F step 8 (push notifications) | User acquires — $99/yr Apple, free Firebase |
| App Store + Play Store accounts | Phase G (deployment) | Apple $99/yr, Google $25 one-time |

None of these block starting Phase A.

---

## 8. SANITY CHECK FOR THE CODING CHAT

After reading the docs, the coding chat should be able to answer these without asking:

- What are the 4 roles on mobile, and what does each do?
- What 3 new database tables need to be created?
- What's the difference between the text pipeline and the vision pipeline?
- What does `AI_PRESET=local-standard` configure?
- What new FK was added to `equipment_requests`?
- What 2 new web pages and 2 new admin tabs are needed?

If any are unclear, re-read the relevant section of `MOBILE_APP_REFERENCE.md` or `AI_SETUP.md`. Only raise clarifying questions on items flagged in §7 above.

---

## 9. WORKFLOW GOING FORWARD

Since the planning chat and coding chat don't share memory, the working pattern is:

- **Planning chat** (where this package was produced) — handles design questions, updates these reference docs, produces new addenda if scope changes
- **Coding chat** (where you paste the first message) — writes code against the docs, asks for design calls only when something is genuinely undecided

When a decision gets made in planning, update the relevant doc and re-upload to the coding chat. When the coding chat hits an edge case, bring the question back to planning or decide directly.

Think of this chat as the architect, the coding chat as the builder. You carry updated blueprints between them — there's no live sync.
