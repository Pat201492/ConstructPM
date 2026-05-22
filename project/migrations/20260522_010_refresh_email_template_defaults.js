/**
 * Migration: refresh email template defaults to current live values.
 *
 * Pat: "take the current email templates and make them the new templates".
 *
 * Snapshot of the email_templates rows taken from the live DB on
 * 2026-05-22. Future installs will seed exactly these strings; existing
 * installs already match (this migration is a no-op on the source DB).
 *
 * UPSERT shape: INSERT...ON CONFLICT (key) DO UPDATE — every existing
 * row is rewritten to these values. Subsequent Admin-UI edits stay
 * intact because this migration runs once per batch.
 *
 * IDEMPOTENT — re-running writes the same bytes.
 */

const TEMPLATES = [
  {
    "key": "bid_project_quote",
    "name": "Quick Project — quote to PM",
    "subject": "Quote for {{project_name}} — {{bid_number}}",
    "body_html": "<p>Hi {{pm_first_name}} —</p>\n<p>The Quick Project flow generated a quote for <strong>{{project_name}}</strong> ({{bid_number}}). The Word doc is attached.</p>\n<p>Total: <strong>{{quote_total}}</strong></p>\n<p style=\"color:#888;font-size:12px;margin-top:24px\">",
    "body_text": null,
    "variables": [
      {
        "key": "pm_first_name",
        "label": "PM's first name",
        "sample": "Sarah"
      },
      {
        "key": "project_name",
        "label": "Project name",
        "sample": "Substation Switchgear Upgrade"
      },
      {
        "key": "bid_number",
        "label": "Bid number",
        "sample": "B26-1342"
      },
      {
        "key": "quote_total",
        "label": "Quote total (formatted)",
        "sample": "$148,200.00"
      },
      {
        "key": "attachment_filename",
        "label": "Attached Word filename",
        "sample": "Quote_B26-1342.docx"
      }
    ]
  },
  {
    "key": "email_day_to_staff",
    "name": "Scheduler — Email Day to Staff",
    "subject": "Schedule: {{project_number}} on {{date}}",
    "body_html": "<p>You're on the crew for <strong>{{project_name}}</strong> ({{project_number}}) on <strong>{{date}}</strong>.</p>\n<p><strong>Location:</strong> {{{location.map_link}}}</p>\n<p><strong>Site Contact:</strong> {{site_contact.name}} — {{site_contact.phone}}</p>\n<p><strong>Crew ({{crew_count}}):</strong> {{crew_names}}</p>\n<p>{{day_notes}}</p>\n<p style=\"color:#888;font-size:12px;margin-top:24px\">Sent from ConstructPM.</p>",
    "body_text": "You're on the crew for {{project_name}} ({{project_number}}) on {{date}}.\nLocation: {{location}}\nCrew ({{crew_count}}): {{crew_names}}\n{{day_notes}}",
    "variables": [
      {
        "key": "project_number",
        "label": "Primary project number",
        "sample": "S26-1342.1"
      },
      {
        "key": "project_name",
        "label": "Project name",
        "sample": "Substation Switchgear Upgrade — Phase 1"
      },
      {
        "key": "location",
        "label": "Project address (may be empty)",
        "sample": "123 Main St, Springfield, IL"
      },
      {
        "key": "date",
        "label": "Date the crew is scheduled (YYYY-MM-DD)",
        "sample": "2026-05-18"
      },
      {
        "key": "crew_count",
        "label": "Number of workers assigned that day",
        "sample": 5
      },
      {
        "key": "crew_names",
        "label": "Comma-joined first+last names of the crew",
        "sample": "Mike T, Sarah K, Carlos R, Amir N, Jane D"
      },
      {
        "key": "day_notes",
        "label": "Pre-formatted day-note line (already includes \"Day notes: \" prefix; empty if no note)",
        "sample": "Day notes: Bring extra PPE — site safety briefing at 7:00am"
      },
      {
        "key": "location.map_link",
        "label": "Location address as clickable Google Maps link",
        "sample": "<a href=\"…\">350 5th Ave, New York, NY</a>"
      },
      {
        "key": "site_contact.name",
        "label": "Site contact name",
        "sample": "Jane Smith"
      },
      {
        "key": "site_contact.phone",
        "label": "Site contact phone",
        "sample": "212-555-0199"
      }
    ]
  },
  {
    "key": "saved_export_email",
    "name": "Scheduled export — delivery email",
    "subject": "{{name}}",
    "body_html": "<p>Hi —</p>\n<p>Your scheduled ConstructPM export <strong>{{name}}</strong> ran at {{whenUtc}} UTC and the CSV is attached.</p>\n<p><strong>{{rowCount}}</strong> rows from the <code>{{source}}</code> source.</p>\n<p style=\"color:#888;font-size:12px;margin-top:24px\">",
    "body_text": null,
    "variables": [
      {
        "key": "name",
        "label": "Saved export name",
        "sample": "Weekly P&L"
      },
      {
        "key": "source",
        "label": "Source key",
        "sample": "projects"
      },
      {
        "key": "rowCount",
        "label": "Number of rows in the CSV",
        "sample": 42
      },
      {
        "key": "whenUtc",
        "label": "Run timestamp (UTC, ISO without ms)",
        "sample": "2026-05-18 13:00:00"
      }
    ]
  },
  {
    "key": "ticket_ready_pickup",
    "name": "Equipment ticket — ready for pickup",
    "subject": "Ticket #{{ticket_number}} ready for pick-up",
    "body_html": "<p>Hi —</p>\n<p>Equipment ticket <strong>#{{ticket_number}}</strong> for project <strong>{{project_number}}</strong> is ready for pick-up.</p>\n<ul>\n  <li>Pick-up person: {{pickup_person}}</li>\n  <li>Pick-up location: {{location}}</li>\n  <li>Flagged ready by: {{created_by_name}}</li>\n</ul>\n<p style=\"margin-top:18px\"><strong>Equipment requested</strong></p>\n{{{equipment_table_html}}}\n<p style=\"color:#888;font-size:12px;margin-top:24px\">",
    "body_text": null,
    "variables": [
      {
        "key": "ticket_number",
        "label": "Ticket number",
        "sample": "T-1042"
      },
      {
        "key": "project_number",
        "label": "Project number",
        "sample": "S26-1342.1"
      },
      {
        "key": "pickup_person",
        "label": "Assigned pick-up person",
        "sample": "Mike Thompson"
      },
      {
        "key": "location",
        "label": "Pick-up location",
        "sample": "Shop — Bay 3"
      },
      {
        "key": "created_by_name",
        "label": "User who flagged the ticket",
        "sample": "Sarah K."
      },
      {
        "key": "equipment_table_html",
        "label": "Equipment list table (server-built HTML)",
        "sample": "<table>…</table>"
      }
    ]
  }
];

exports.up = async function (knex) {
  for (const t of TEMPLATES) {
    await knex('email_templates')
      .insert({
        key: t.key,
        name: t.name,
        subject: t.subject,
        body_html: t.body_html,
        body_text: t.body_text,
        variables: JSON.stringify(t.variables || []),
      })
      .onConflict('key')
      .merge(['name', 'subject', 'body_html', 'body_text', 'variables']);
  }
  console.log(`  ✅ ${TEMPLATES.length} email templates refreshed to canonical defaults`);
};

exports.down = async function () {
  // No down — prior seed values lived in three separate migrations, and
  // we don't want to time-travel an admin's customisations back to
  // whichever stale baseline this migration replaced.
};
