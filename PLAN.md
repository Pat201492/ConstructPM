# Plan — Move email templating to the Scheduler's Email Day to Staff flow

> Branch: `email-day-to-staff-template-fix`
> Approved: Pat, 2026-05-18

## Why

PR #6 added a "Daily Email" panel to the project detail page + a `project_daily_email_configs` table + a `ProjectBriefingRunner` + a FileWatcher tick. That was a misread of the requirement. The system already has an **Email Day to Staff** feature in the Scheduler tab (button at `public/index.html:5586`, popup at `showEmailDayPickerPopup()` line 6202, backend `POST /api/projects/:id/email-day` at `src/routes/projects.js:999`). It picks a date + project, fans out to assigned workers with a hardcoded body. That feature was the one Pat wanted to be template-driven, not a new per-project daily briefing.

This PR removes the misplaced surface and wires the existing Email Day flow through `EmailTemplateService` so the body is editable from Admin → Email Templates.

## What changes

### Removals (the misplaced PR #6 surface)

| File | Action |
|---|---|
| `migrations/20260518_013_email_day_to_staff_template.js` (new) | Drops `project_daily_email_configs`, deletes the `project_daily_briefing` template row, inserts the new `email_day_to_staff` template. Migration history stays additive — migration 011/012 are left alone. |
| `src/services/ProjectBriefingRunner.js` | **Delete** |
| `src/routes/projectDailyEmail.js` | **Delete** |
| `src/services/FileWatcher.js` | Remove `_processDueProjectBriefings`, its line in `_poll()`, and the `ProjectBriefingRunner` import |
| `src/app.js` | Unmount `/api/projects/:projectId/daily-email` route |
| `public/index.html` | Remove `renderProjectDailyEmailPanel()` + its call site in `renderProjectDetail` |

### Refactor

| File | Action |
|---|---|
| `src/routes/projects.js` `POST /:id/email-day` | Compose template variables, call `EmailTemplateService.render('email_day_to_staff', vars)`, fan out per worker: in-app notification via `NotificationService.send({channels:['in_app']})` with the plain-text body; email via `NotificationService.sendEmail()` with the HTML body. Crew query gains `users.email` since we now send the email outside of NotificationService.send's internal recipient lookup. |

### Kept (working from PR #6)

| File | Status |
|---|---|
| `email_templates` table + `EmailTemplateService` + admin routes | Kept — generic template surface, two consumers now (`saved_export_email`, `email_day_to_staff`) |
| `saved_export_email` template + its wiring through `SavedExportRunner` | Untouched |
| Admin → Email Templates editor UI | Untouched; new template shows up automatically because the editor reads `email_templates` table contents |
| `NotificationService.sendEmail()` helper added in PR #6 | Used by the refactored email-day route |

## The new template

**Key:** `email_day_to_staff`
**Subject:** `Schedule: {{project_number}} on {{date}}`
**Variables:**

| Var | Sample |
|---|---|
| `project_number` | `S26-1342.1` |
| `project_name` | `Substation Switchgear Upgrade — Phase 1` |
| `location` | `123 Main St, Springfield, IL` |
| `date` | `2026-05-18` |
| `crew_count` | `5` |
| `crew_names` | `Mike T, Sarah K, Carlos R, Amir N, Jane D` |
| `day_notes` | `Day notes: Bring extra PPE — site safety briefing at 7:00am` (or empty) |

`body_html` and `body_text` seeded with sensible defaults — Pat edits the wording once via the template editor and that's the source of truth from then on.

## Recipient resolution stays unchanged

The existing /email-day uses `worker_assignments WHERE project_id=X AND work_date=DATE` joined to `users`. No fan-out semantics change. Only the body composition moves from inline string to template.

## Risks considered

1. **Existing in-app notifications get a different body shape.** Previously the body was plain text with `\n` separators wrapped by the email sender in a `<p>${body}</p>` (so the newlines didn't render in email). After this PR, the in-app notification body uses the template's `body_text` (same plain text) and the email uses `body_html` (newlines actually render). Net improvement; no regression for anyone.
2. **Migration drops a recently-added table.** `project_daily_email_configs` was added 1 PR ago and (as far as anyone knows) has zero rows in any deployment, since the feature was misplaced and Pat didn't use it. The drop is safe; if there were rows we'd want to migrate them, but there aren't.
3. **Pat's day note is included verbatim in the template via `{{day_notes}}`** (HTML-escaped by default). No XSS path through field input.
4. **Two consumers of the template system** — `saved_export_email` and `email_day_to_staff`. Validates the abstraction has the right shape; was the whole point of building templating generically.

## What does NOT change

- `worker_assignments` schema
- `project_day_notes` schema or behavior
- The Scheduler tab UI (Email Day button + popup)
- `NotificationService.send` semantics
- Permission gates on `/email-day` (still `projects:update`)

## Out of scope (Pass 2 candidates)

- Configurable "include day note?" / "include crew list?" toggles on the template (admin can just edit the template body to remove sections they don't want)
- Per-day customization of the template (one template per firm; if you want per-project tone, that's a bigger feature)
- A worker-centric variant ("for this worker, list all the projects they're on today") — possible follow-up if Pat asks for it; existing flow stays project-centric

## Verification

1. Migration applies cleanly: `project_daily_email_configs` table is gone; `email_templates` has rows `saved_export_email` and `email_day_to_staff` (no `project_daily_briefing`)
2. `GET /api/admin/email-templates` returns both templates
3. `POST /api/projects/:id/daily-email` returns 404 (route removed)
4. `POST /api/projects/:id/email-day` with a date that has a crew → returns `{sent_to: N, date}`; logs show one in-app notify + one sendEmail per worker; email body comes from the template
5. Project detail page no longer renders the "Daily Email" panel
6. Admin → Email Templates: pick `email_day_to_staff`, edit subject, save, fire `POST /:id/email-day` → confirm the edited subject is what arrived
7. FileWatcher tick logs: no more `[FileWatcher] daily briefing for project ...` lines
