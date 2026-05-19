# Plan — Email compose module (Send To / CC / Subject / Body, with variables)

> Branch: `add-email-compose-module`
> Approved: Pat, 2026-05-18

## Why

Currently two surfaces fire emails without giving the user a chance to tweak the
recipient / wording before send:
- **Scheduler → Email Day to Staff**: pick date + project, click → instantly
  fans out the templated body to the assigned crew.
- **Saved & Scheduled Exports → Run now**: instantly runs the export and emails
  the CSV using the `saved_export_email` template.

Pat wants a **compose modal** to sit in between the "user clicks send" and the
actual fan-out. Four editable fields: **Send To**, **CC**, **Subject**, **Body**.
Each field can mix free text with `{{variable}}` placeholders pulled from a
context-aware catalog. The template provides the pre-fill; per-send edits
are one-off and don't write back to the template.

Equipment-ticket pickup is the eventual third invocation site — deferred to a
follow-up PR because it lives in an in-flight branch (`feat/ticket-ready-for-
pickup`) that hasn't merged yet. The compose modal is built as a reusable
`composeEmailModal(context, onSend)` function so the pickup branch can wire it
in trivially once it lands.

## What changes

| File | Change |
|---|---|
| `src/services/EmailComposeService.js` (new) | `getCatalog(context)` returns the variable list for the given send context. `resolve(context, rawString)` substitutes `{{var}}` tokens at send time using live data. Reuses `exportMetadata.js` for `projects` source variables; adds context-specific extras (crew names, day note, dates, etc.) |
| `src/routes/emailCompose.js` (new) | `GET /api/email-compose/catalog?context=…&...ids` → `{vars: [{key,label,sample,emailable}], defaults: {to, subject, body_html}}`. `POST /api/email-compose/preview` body `{context, ids, raw_subject, raw_body_html}` → resolved subject + html with `unresolved` array. Authenticated, no extra permission gate (caller's existing route gates the parent send). |
| `src/app.js` | Mount the new routes |
| `src/routes/projects.js` `POST /:id/email-day` | Accept optional `override_subject`, `override_body_html`, `override_to` (array of emails), `extra_cc` (array of emails) in body. When provided, use them in place of the template render; substitute via EmailComposeService for the right context. Existing `{ date }`-only callers keep working unchanged. |
| `src/routes/savedExports.js` `POST /:id/trigger` | Same override surface. SavedExportRunner gains an `overrides` arg; uses it instead of EmailTemplateService.render when present. |
| `src/services/SavedExportRunner.js` | Threads `overrides` through `run(savedExport, overrides)`. When set, uses `EmailComposeService.resolve` over raw strings; otherwise falls back to current `EmailTemplateService.render('saved_export_email', vars)` path. |
| `public/index.html` — `composeEmailModal(opts)` (new top-level function) | Modal with To / CC / Subject / Body. Body uses a `contentEditable` div. Variables insert as styled non-editable chips. Live preview pane below the body renders resolved output. Send button calls `opts.onSend({override_to, extra_cc, override_subject, override_body_html})` with the raw (variable-tokens-not-resolved) strings — backend resolves on send. |
| `public/index.html` — Email Day to Staff popup | Click-to-fire is replaced with click-to-compose. The existing `showEmailDayPickerPopup()` row-click now opens `composeEmailModal({context:'email_day_to_staff', ids:{project_id, date}, ...})` instead of immediately firing. On Send the modal callback POSTs to `/email-day` with overrides. |
| `public/index.html` — Saved Exports Run button | Same swap. Click "▶ Run" → compose modal → POST to `/exports/schedules/:id/trigger` with overrides. |

## Variable catalog shape

```
{
  vars: [
    { key: 'project.name',             label: 'Project: Name',         sample: 'Substation Switchgear Upgrade', emailable: false },
    { key: 'project.primary_number',   label: 'Project: Primary #',     sample: 'S26-1342.1',                    emailable: false },
    { key: 'pm.first_name',            label: 'PM: First Name',         sample: 'Sarah',                         emailable: false },
    { key: 'pm.email',                 label: 'PM: Email',              sample: 'sarah@company.com',             emailable: true  },
    { key: 'customer.name',            label: 'Customer: Name',         sample: 'Acme Industrial',               emailable: false },
    { key: 'customer_contact.email',   label: 'Customer Contact: Email',sample: 'contact@acme.com',              emailable: true  },
    { key: 'date',                     label: 'Date',                   sample: '2026-05-18',                    emailable: false },
    { key: 'crew.count',               label: 'Crew: Count',            sample: 5,                               emailable: false },
    { key: 'crew.names',               label: 'Crew: Names (comma)',    sample: 'Mike T, Sarah K, …',            emailable: false },
    { key: 'day.note',                 label: 'Day Note',               sample: 'Bring extra PPE',               emailable: false },
  ],
  defaults: {
    to: [{ id: 'uuid-1', email: 'mike@company.com', label: 'Mike T' }, …],
    subject: 'Schedule: {{project.primary_number}} on {{date}}',
    body_html: '<p>You\'re on the crew for …</p>',
  },
}
```

`emailable: true` controls which vars appear when picking for the **Send To** or
**CC** fields (those need to resolve to email addresses; `{{project.name}}` in
the To field would be nonsense).

## Context shapes (v1)

| Context | IDs in URL | What's in the catalog |
|---|---|---|
| `email_day_to_staff` | `project_id`, `date` | project columns + joined customer/location/PM/contact columns + `date` + `crew.{count,names,emails}` + `day.note` |
| `saved_export_run` | `saved_export_id` | template defaults (`{{name}}`, `{{source}}`, `{{rowCount}}`, `{{whenUtc}}`) + the saved export's owner email |
| `equipment_ticket_pickup` | (deferred) | not exposed in v1 — added when the pickup branch lands |

## Send-site contract (backend overrides)

The two send routes (`/email-day`, `/exports/schedules/:id/trigger`) gain four
optional body fields:

```
{
  override_to?:        [email_string, …]   // replaces the auto-resolved recipient list
  extra_cc?:           [email_string, …]   // added as CC headers
  override_subject?:   string              // raw, may contain {{var}} tokens
  override_body_html?: string              // raw, may contain {{var}} tokens
}
```

When any override is present, the route resolves the raw strings via
`EmailComposeService.resolve(context, raw)` before sending. When absent, the
existing template-driven path runs unchanged — old callers stay working.

## Chip rendering / serialization

- Body editor: `<div contenteditable="true">` (NOT `<textarea>` — we need rich content for chips).
- Chips: `<span class="evar" contenteditable="false" data-var="project.name">Project: Name</span>` plus a trailing space.
- Insertion: typing `{{` opens an autocomplete dropdown of matching variables. Selection inserts the chip at the cursor.
- Backspace immediately after a chip removes the chip as a unit.
- Send-time serialization: walk the editor's DOM. For text nodes → `textContent`. For `<br>` → `\n`. For `<p>` boundaries → `\n\n`. For chip spans → `{{data-var}}`. Result is the raw template-style string the backend can resolve.
- Live preview pane: renders the body with chips replaced by their sample/resolved values inline. Updates on every input change.

## Risks considered

1. **Variable resolution against unverified data**. `EmailComposeService.resolve` queries based on the IDs in the URL. A user with access to the parent send route also has access to the underlying data, so this doesn't open a new information-disclosure path. Auth gate sits on the send route, not on `/api/email-compose/*`.
2. **Override fields could be used to email arbitrary recipients**. `override_to` and `extra_cc` accept raw email strings. We don't restrict them to known users — the existing route already allows the PM to email "the crew" which is similarly trust-the-caller. Mitigation: log the resolved final recipient list on every send for audit.
3. **HTML in `override_body_html`**. Saved as-is and sent through `NotificationService.sendEmail`. Same XSS-via-self model as the existing template editor — admins (and now PMs for their own sends) can author HTML that lands in inboxes. Acceptable; the surface is logged-in trusted users.
4. **ContentEditable browser quirks**. Cursor placement after chip insertion, paste handling (paste pastes plain text not HTML), Firefox vs Chromium differences. Building defensively but accepting some rough edges in v1.
5. **The `feat/ticket-ready-for-pickup` branch**. Not modified by this PR. When it lands, it'll need to call `composeEmailModal({context:'equipment_ticket_pickup', …})` itself — but the modal will already exist, so the integration is one function call. No coordination drift expected.

## What does NOT change

- The `email_templates` table or the Admin → Email Templates editor
- The existing template-driven send paths when no override is supplied (`saved_export_email`, `email_day_to_staff` templates stay active as the pre-fill source)
- Auth / permission gates on `/email-day` or `/exports/schedules/:id/trigger`
- `EmailTemplateService.render` semantics
- `NotificationService.send` / `sendEmail` signatures

## Out of scope (follow-ups)

- Wiring into equipment ticket pickup (waits for `feat/ticket-ready-for-pickup`)
- A "Save this composed body as a new template" button
- Per-send audit log table (just logged today)
- Inline image / attachment support in the body editor
- Rich-text formatting (bold/italic/links) — body is plain text + chips + `\n`-breaks in v1

## Verification

1. `GET /api/email-compose/catalog?context=email_day_to_staff&project_id=X&date=Y` → returns the variable list with sample values resolved from project X
2. `POST /api/email-compose/preview` with a raw subject `'Schedule: {{project.primary_number}}'` → returns `'Schedule: S26-1342.1'`
3. Compose modal opens on Email Day row click; type `{{` → autocomplete shows variables; pick one → chip inserted; preview pane shows resolved
4. Send button → POSTs to `/email-day` with `override_subject` / `override_body_html` containing raw `{{var}}` tokens
5. Backend resolves via EmailComposeService and sends; logs the final recipient list
6. Saved Export "Run now" → modal opens with the saved_export_email template pre-filled; Send completes the run with the (possibly edited) body
7. Email-parked dev mode: same status='failed' result with the helpful per-recipient reason, but the *send pipeline* now flows through compose+override successfully
