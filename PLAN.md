# Plan — Saved & scheduled exports (with email + manual trigger)

> Branch: `add-export-scheduler`
> Approved: Pat, 2026-05-18

## Why

Pat wants to save an export configuration (source + columns + filters + recipients) so that:
1. It runs automatically on a cron-like schedule and emails the resulting CSV to selected internal users, **and/or**
2. It can be manually triggered with one click and emailed to the same recipient list immediately.

Concretely: "send me my P&L every Monday at 8am, and let me also fire it on demand mid-week if a client asks."

## Status of email

Per [[email-provider-status]]: the email pipeline is wired but `EMAIL_PROVIDER` / `SENDGRID_API_KEY` aren't set in the local `.env`, so dev sends fall through to a no-op (logged, not delivered). This PR builds the plumbing; the day Pat sets `EMAIL_PROVIDER=sendgrid` + `SENDGRID_API_KEY=…` + `EMAIL_FROM=quotes@<domain>`, every saved+scheduled export starts actually delivering with zero further code change.

## What changes

| File | Change |
|---|---|
| `package.json` | Add `cron-parser` (~50KB) for parsing cron strings + computing `next_run_at`. |
| `migrations/20260518_009_saved_exports.js` (new) | New `saved_exports` table — see schema below. |
| `src/services/SavedExportRunner.js` (new) | Given a `saved_exports` row: runs `ExportBuilder.execute()`, writes CSV to a temp file, calls `NotificationService.sendEmailWithAttachment` per recipient, updates `last_run_at` / `last_status` / `last_error`. Returns `{ delivered, failed, rowCount }`. |
| `src/services/FileWatcher.js` | Extend `_poll()` with a new `_processDueSavedExports()` method that selects `saved_exports WHERE enabled = true AND cron IS NOT NULL AND next_run_at <= NOW()`, runs each via `SavedExportRunner`, then recomputes `next_run_at` from the cron string. |
| `src/routes/savedExports.js` (new) | CRUD + manual trigger — `GET/POST /api/exports/schedules`, `PATCH/DELETE /:id`, `POST /:id/trigger`. Authorize via `exports:read` for read paths and `exports:manage` for write/trigger. |
| `src/app.js` (or wherever routes are mounted) | Mount the new router. |
| `migrations/20260518_010_exports_manage_permission.js` (new) | Add `exports:manage` to admin's permissions array on `role_configurations` (also project_manager + accounting if they're allowed to save their own exports — decision below). |
| `src/routes/users.js` | Add `GET /api/users/email-picker` — narrow endpoint returning `{id, first_name, last_name, email}` for any active user. Used by the recipient picker. Authorized by `exports:manage`. |
| `public/index.html` — `renderExports()` | Add a "Saved & Scheduled" section above the picker: list of saved configs with toggle/edit/run-now/delete; a "Save current config" button under the existing column-picker that opens a modal for name + cron + recipients. |
| `docs/EXPORT_METADATA.md` (touched) | Add a short "Scheduling" section pointing at the new flow. |

## Schema (`saved_exports`)

```js
t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
t.string('name', 255).notNullable();              // user-facing label
t.uuid('owner_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
t.string('source', 64).notNullable();             // ExportBuilder source key
t.jsonb('columns').notNullable();                 // ordered column-key array (drag-reorder respected)
t.jsonb('filters');                               // { start_date, end_date, status }
t.string('cron', 128);                            // nullable — null = manual-only
t.jsonb('recipients').notNullable().defaultTo('[]'); // array of user IDs
t.boolean('enabled').notNullable().defaultTo(true);
t.timestamp('last_run_at');
t.string('last_status', 32);                      // 'ok' | 'partial' | 'failed' | 'no_rows'
t.text('last_error');
t.timestamp('next_run_at');                       // recomputed from cron after every run
t.timestamps(true, true);
t.index('owner_user_id');
t.index('next_run_at');
t.index(['enabled', 'next_run_at']);
```

## Permission model

- Read & trigger own saved exports: `exports:read` (already granted to admin, PM, accounting)
- Create/edit/delete: new `exports:manage`. Granted to **admin** by default. **PM** also gets it (so estimators/PMs can wire up their own recurring exports without bothering an admin). Accounting kept on read-only (per the existing pattern of "accounting reads, doesn't author").
- Listing scope: by default, a user only sees saved exports they `owner_user_id` — admins see all (consistent with the rest of the app).

## SavedExportRunner shape

```js
async run(savedExportRow) {
  const { headers, rows } = await ExportBuilder.execute(row.source, row.columns, row.filters);
  if (rows.length === 0) {
    await markRun(row.id, 'no_rows', null);
    return { delivered: 0, failed: 0, rowCount: 0, skipped: 'no_rows' };
  }
  const csv = ExportService.toCSV(headers, rows);
  const tmpPath = await writeTempCsv(csv);
  try {
    const recipients = await fetchActiveEmails(row.recipients);
    let delivered = 0, failed = 0;
    for (const r of recipients) {
      const result = await NotificationService.sendEmailWithAttachment({
        to: r.email,
        subject: `[ConstructPM] ${row.name}`,
        html: emailBody(row, rows.length),
        filePath: tmpPath,
        filename: `${slug(row.name)}_${ymd()}.csv`,
        contentType: 'text/csv',
      });
      if (result.delivered) delivered++; else failed++;
    }
    await markRun(row.id, failed === 0 ? 'ok' : 'partial', failed > 0 ? `${failed} failed deliveries` : null);
    return { delivered, failed, rowCount: rows.length };
  } finally {
    fs.promises.unlink(tmpPath).catch(() => {});
  }
}
```

## Scheduler tick (FileWatcher extension)

```js
async _processDueSavedExports() {
  const due = await db('saved_exports')
    .where('enabled', true)
    .whereNotNull('cron')
    .where(function () { this.whereNull('next_run_at').orWhere('next_run_at', '<=', new Date()); });
  for (const row of due) {
    try {
      await SavedExportRunner.run(row);
    } catch (err) {
      await db('saved_exports').where('id', row.id).update({
        last_run_at: new Date(), last_status: 'failed', last_error: err.message,
      });
    }
    // Recompute next_run_at from cron
    const next = parseExpression(row.cron).next().toDate();
    await db('saved_exports').where('id', row.id).update({ next_run_at: next });
  }
}
```

Hooked into the existing `_poll()` alongside `_checkBidInactivity` / `_checkOverduePayments` / etc. — same hourly cadence, same `Promise.all` batch. **Precision is therefore hour-level** (within the FileWatcher tick). Acceptable for "Monday 8am" style schedules; finer scheduling is Pass 2.

## UI changes

A new section above the existing Source picker on the Data Export tab:

```
┌─ Saved & Scheduled Exports ────────────────────────────────┐
│ Name              Source     Schedule         Recipients   │
│ Weekly P&L        invoices   Mon 08:00        2  [▶ Run] [✎] [⏸] [×] │
│ Monthly Equipment equipment  1st of month     1  [▶ Run] [✎] [⏸] [×] │
│ + Save current config                                       │
└────────────────────────────────────────────────────────────┘
```

- Status column shows `last_status` + `last_run_at` ("ok · 2h ago")
- Run icon (▶) does `POST /:id/trigger`, shows toast with rowCount + delivered/failed
- Edit (✎) opens a modal with name + cron (with friendly preset chips: "Daily 8am", "Weekly Monday 8am", "Monthly 1st 8am") + recipient multi-select
- Pause (⏸) toggles `enabled`
- Delete (×) confirms then DELETEs
- "Save current config" only enabled when the user has picked a source + at least one column in the existing builder below; clicking opens the same modal pre-filled

Recipient picker: multi-select of active users from `/api/users/email-picker`. Owner is auto-included unless they uncheck themselves.

## What does NOT change

- ExportBuilder, exportMetadata, the column picker, drag-to-reorder
- QuickBooks / Procore / payroll hardcoded exports
- NotificationService (already supports attachments via `sendEmailWithAttachment`)
- FileWatcher's cadence / global-variable config

## Risks considered

1. **Email is parked** — dev runs will write the temp CSV and return `{delivered:false, provider:'none', reason:'no provider configured'}`. The runner records `last_status='partial'` and `last_error='N failed deliveries'` — that's visible in the UI as a yellow status so Pat knows it ran but didn't deliver. The day email is unparked, status flips to `ok`.
2. **Cron timezone** — `cron-parser` defaults to UTC. PMs work in the user's local timezone. v1 stores `cron` plus interprets it in **server timezone** (the api container has no TZ set, so UTC). Friendly preset chips in the UI compute the right UTC cron for the user's intent (e.g. "Mon 8am ET" → "0 13 * * 1"). Custom cron entry shows a "next run in <server TZ>" preview. Pass 2: per-saved-export timezone column.
3. **Long-running exports inside FileWatcher tick** — `Promise.all` runs concurrently with the bid/payment/equipment checks; an export with 10k rows might take a few seconds. Acceptable; CSV is small enough. If we later have huge exports, push to a Bull queue.
4. **Recipient leaving the org** — if a user in `recipients` is deactivated, `fetchActiveEmails` skips them. `last_error` notes how many were skipped.
5. **Column key validity drift** — if a column key in a saved config later becomes invalid (e.g. a column was removed from metadata), the export fails with the existing "Invalid column(s)" error; the runner catches it and records `last_status='failed'`.

## Out of scope (Pass 2)

- Per-saved-export timezone
- Sub-hour precision (move to true cron daemon or Bull `repeatable` jobs)
- Templated email bodies / attachments other than CSV
- Distribution via Slack / other channels
- Run history table (we only track `last_run_at` / `last_status` / `last_error`; a `saved_export_runs` audit log is a separate PR)

## Verification

1. Migration runs cleanly: `docker compose up -d --build` → table present, indexes present
2. `POST /api/exports/schedules` with `{name, source, columns, filters, cron, recipients, enabled}` returns the row with `next_run_at` populated
3. `POST /api/exports/schedules/:id/trigger` runs the export, returns `{delivered, failed, rowCount}`. With email parked: `delivered=0, failed=N`, `last_status='partial'`, a temp CSV was written and deleted, `last_run_at` updated
4. Edit the row's `cron` to `* * * * *` (every minute), enable, wait one FileWatcher tick — confirm `last_run_at` advances and `next_run_at` rolls forward
5. `GET /api/exports/schedules` returns the user's saved configs; admin sees all
6. UI: Saved & Scheduled section renders, "Save current config" pre-fills, Run-now shows toast with the right counts, Pause toggles enabled, Delete confirms then removes the row
7. `GET /api/exports/schedules` with a deactivated user in `recipients` still runs but skips them and notes the skip in `last_error`
