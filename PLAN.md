# Plan — Email templates + daily project briefing

> Branch: `email-templates-and-briefings`
> Approved: Pat, 2026-05-18

## Why

Two related needs:

1. **Editable email content.** The saved-export scheduler currently hardcodes its email body in `SavedExportRunner.js` — you can't tweak the wording without editing source. Pat wants a real template surface to edit.
2. **Per-project daily briefing email.** A single email per project sent every morning to: the PM, the scheduler(s), every assigned staff member, plus any extra recipients the PM adds. Per-project enabled toggle + send-hour, so it behaves like a rule the PM configures and forgets.

(2) is naturally the second consumer of (1)'s template system — building both together keeps the abstraction honest from day one.

## What changes

### Part A — Email templates (foundation)

| File | Change |
|---|---|
| `migrations/20260518_011_email_templates.js` (new) | `email_templates` table + seed two rows: `saved_export_email` (the export scheduler's body, polished) and `project_daily_briefing` (the per-project email body). |
| `src/services/EmailTemplateService.js` (new) | `get(key)`, `render(key, vars)`. `{{var}}` does HTML-escape; `{{{var}}}` is raw (for pre-rendered blocks). Per-key cache, invalidated on PATCH. |
| `src/routes/emailTemplates.js` (new) | `GET /api/admin/email-templates`, `GET/:key`, `PATCH/:key`, `POST/:key/preview` (renders with sample vars from the template's own `variables` jsonb). Admin only. |
| `src/services/SavedExportRunner.js` | Drop the inline `emailBody()` helper, call `EmailTemplateService.render('saved_export_email', vars)` instead. |
| `src/app.js` | Mount the new admin sub-route. |
| `public/index.html` | New section under Admin → "Email Templates": list of templates → pick one → edit subject + body in two textareas, "Available variables" reference panel, live preview with sample data, Save. |

### Part B — Daily project briefing (consumer)

| File | Change |
|---|---|
| `migrations/20260518_012_project_daily_email_configs.js` (new) | `project_daily_email_configs` table — per-project: `{project_id (unique FK), enabled, send_hour_utc (0–23), include_pm, include_scheduler, include_staff, extra_recipient_user_ids jsonb, template_key (default 'project_daily_briefing'), last_run_at, last_status, last_error}`. |
| `src/services/ProjectBriefingRunner.js` (new) | `run(projectId)`: resolves recipients (PM + scheduler users + staff via `project_assignments` + extras → dedupe → active + has email), builds template vars from project state, calls `EmailTemplateService.render(...)`, sends via `NotificationService.sendEmailWithAttachment` (no attachment — plain HTML). Stamps `last_*`. |
| `src/routes/projectDailyEmail.js` (new) | `GET /api/projects/:id/daily-email` returns config (or defaults if no row), `PUT /api/projects/:id/daily-email` upserts, `POST /api/projects/:id/daily-email/trigger` runs immediately. Owner/PM/admin gate. |
| `src/services/FileWatcher.js` | New `_processDueProjectBriefings()` in the existing hourly tick. Selects configs where `enabled=true AND send_hour_utc = <current UTC hour>` and where `last_run_at IS NULL OR last_run_at::date < today_utc::date` — i.e. hasn't already run today. |
| `src/app.js` | Mount the new project sub-route. |
| `public/index.html` | New "Daily Email" panel on the project detail page: enabled toggle, send-hour picker (0–23 UTC), three include checkboxes (PM/Scheduler/Staff), extras multi-select (reuses `/api/users/email-picker`), "Send now" preview-and-send button. |

## Schema

### `email_templates`

```js
t.string('key', 64).primary();        // e.g. 'saved_export_email'
t.string('name', 255).notNullable();  // display name in the editor
t.string('subject', 500).notNullable();
t.text('body_html').notNullable();
t.text('body_text');                  // optional plain-text fallback
t.jsonb('variables').notNullable().defaultTo('[]'); // [{key, label, sample}] — drives the help panel + preview
t.uuid('updated_by').references('id').inTable('users').onDelete('SET NULL');
t.timestamps(true, true);
```

### `project_daily_email_configs`

```js
t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
t.uuid('project_id').notNullable().unique().references('id').inTable('projects').onDelete('CASCADE');
t.boolean('enabled').notNullable().defaultTo(false);
t.integer('send_hour_utc').notNullable().defaultTo(13); // 8am ET ~= 13 UTC
t.boolean('include_pm').notNullable().defaultTo(true);
t.boolean('include_scheduler').notNullable().defaultTo(true);
t.boolean('include_staff').notNullable().defaultTo(true);
t.jsonb('extra_recipient_user_ids').notNullable().defaultTo('[]');
t.string('template_key', 64).notNullable().defaultTo('project_daily_briefing');
t.timestamp('last_run_at');
t.string('last_status', 32);
t.text('last_error');
t.timestamps(true, true);
t.index('project_id');
t.index(['enabled', 'send_hour_utc']);
```

## Recipient resolution (for daily briefing)

```
recipients = []
if include_pm and projects.pm_id:           recipients += [pm_id]
if include_scheduler:                       recipients += active users WHERE role='scheduler'
if include_staff:                           recipients += project_assignments WHERE project_id=X
recipients += extra_recipient_user_ids
recipients = dedupe(recipients)
recipients = filter(active AND email IS NOT NULL)
```

"The scheduler" defaults to org-level (any user with `role='scheduler'`). If you later want per-project scheduler designation, that's a `role_on_project='scheduler'` row in `project_assignments` — picked up automatically by `include_staff`.

## Template variables (initial)

### `saved_export_email`

| Var | Meaning |
|---|---|
| `{{name}}` | Saved export name |
| `{{source}}` | Source key (projects / bids / etc.) |
| `{{rowCount}}` | Number of rows in the attached CSV |
| `{{whenUtc}}` | Run timestamp, UTC, ISO without ms |

### `project_daily_briefing`

| Var | Meaning |
|---|---|
| `{{project_name}}` | `projects.name` |
| `{{project_status}}` | `projects.status` |
| `{{pm_name}}` | "First Last" of the PM |
| `{{today_date}}` | Local date (YYYY-MM-DD UTC) |
| `{{equipment_on_project_count}}` | Count of `equipment.current_project_id = X` |
| `{{open_pos_count}}` | Count of `purchase_orders` where status not in (received, cancelled) |
| `{{recent_timesheet_count}}` | Timesheets entered in the last 24h |
| `{{project_url}}` | Deep link to the project page |

Pat edits the seeded body once via the template editor to taste; the editor is the source of truth from then on.

## Permission model

- Templates editor: **admin only** (`authorize('admin:*')` or similar wildcard — templates affect every email send).
- Daily email config: **PM-or-admin** for read/write/trigger. PMs configure their own projects' briefings; admins can touch any.

## What does NOT change

- `NotificationService` (already supports HTML emails + attachments; the templates feed its existing surface)
- The export-scheduler routes and table from PR #4
- The existing in-app/push notification body strings (out of scope; future work to convert those to templates if desired)

## Risks considered

1. **Email is parked** — same as PR #4. `last_status='failed'` shows up until `EMAIL_PROVIDER`/`SENDGRID_API_KEY` are set; the briefing still ran end-to-end.
2. **Template renderer XSS** — `{{var}}` always HTML-escapes; the explicit `{{{var}}}` triple-mustache is only used internally for pre-rendered blocks the runner builds. Template authors (admins) have no way to inject script via the editor unless they paste it into `body_html` directly — and they own the template, so that's intentional.
3. **"Already ran today" check** — uses `last_run_at::date < today_utc::date`. A briefing scheduled for 23:00 UTC that fails and is then rescheduled past midnight would re-fire the next day. Acceptable.
4. **`send_hour_utc` is a single integer** — no minute precision, no per-day scheduling. Daily is the only cadence; finer cadence is the saved-export scheduler's job (cron-based). Keep them clearly separated.
5. **Cache invalidation on template PATCH** — the service clears its own cache on PATCH; if you ever run multi-process, each process caches independently and won't see edits until its next TTL. Mitigation: keep TTL short (30s) or skip caching for v1. Going with **no cache** for v1 (single-row lookup, cheap).

## Out of scope (Pass 2)

- Per-project scheduler designation (vs org-level scheduler role)
- Per-day-of-week toggles on briefings (e.g. "weekdays only")
- Markdown editor for the template body (currently raw HTML textarea)
- A `briefing_runs` audit table (currently only `last_*` columns)
- Converting in-app/push notification strings to templates

## Verification

1. Migrations apply cleanly; both templates seeded
2. `GET /api/admin/email-templates` returns both
3. `PATCH /api/admin/email-templates/saved_export_email` with new subject/body → saved
4. `POST /:key/preview` renders with sample vars, no errors
5. Trigger a saved export → email body matches the (edited) `saved_export_email` template
6. `PUT /api/projects/:id/daily-email` with `{enabled:true, send_hour_utc:13, include_pm:true, ...}` → upserts
7. `POST /api/projects/:id/daily-email/trigger` → runs, returns `{delivered, failed, skipped, rowCount: <n recipients>}`. Email parked → `failed` but the run completes and `last_run_at` stamps
8. Resolver dedupes correctly: if PM is also on `project_assignments`, they appear once
9. UI: Admin → Email Templates renders both, edit + preview + save works
10. UI: Project detail → Daily Email panel renders config, toggling + saving persists, Send-now shows toast with delivery counts
