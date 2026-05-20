/**
 * Email module backend — PR #18.
 *
 * Adds three pieces on top of the existing email_templates table:
 *
 * 1. email_template_user_overrides — per-(user, template) override of
 *    subject / body_html / body_text. Null fields inherit from the admin
 *    row at render time so a user can override just one of the three.
 *
 * 2. email_trigger_recipients — admin-configured static recipient list
 *    per template key. The runtime merges these with the auto-resolved
 *    modular recipients each trigger computes (e.g. ticket pickup
 *    auto-resolves PM + assignee; the admin static list adds shop
 *    manager + extras).
 *
 * 3. Seeds two new templates that the four-trigger rewire (PR #19) will
 *    read: bid_project_quote (Quick Project quote-to-PM) and
 *    ticket_ready_pickup (Equipment ticket ready). Both are currently
 *    hardcoded HTML strings in their routes; seeding now lets the admin
 *    editor surface them before the route swap lands.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('email_template_user_overrides'))) {
    await knex.schema.createTable('email_template_user_overrides', (t) => {
      t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('key', 64).notNullable().references('key').inTable('email_templates').onDelete('CASCADE');
      t.string('subject', 500);
      t.text('body_html');
      t.text('body_text');
      t.timestamps(true, true);
      t.primary(['user_id', 'key']);
    });
  }

  if (!(await knex.schema.hasTable('email_trigger_recipients'))) {
    await knex.schema.createTable('email_trigger_recipients', (t) => {
      t.string('key', 64).primary().references('key').inTable('email_templates').onDelete('CASCADE');
      t.jsonb('static_emails').notNullable().defaultTo('[]');
      t.jsonb('static_user_ids').notNullable().defaultTo('[]');
      t.jsonb('cc_emails').notNullable().defaultTo('[]');
      t.uuid('updated_by').references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
  }

  // ── Seed two new templates idempotently ─
  const existing = await knex('email_templates').pluck('key');
  const rows = [];

  if (!existing.includes('bid_project_quote')) {
    rows.push({
      key: 'bid_project_quote',
      name: 'Quick Project — quote to PM',
      subject: '[ConstructPM] Quote for {{project_name}} — {{bid_number}}',
      body_html: `<p>Hi {{pm_first_name}} —</p>
<p>The Quick Project flow generated a quote for <strong>{{project_name}}</strong> ({{bid_number}}). The Word doc is attached.</p>
<p>Total: <strong>{{quote_total}}</strong></p>
<p style="color:#888;font-size:12px;margin-top:24px">Open the project in ConstructPM to review line items and trigger downstream work.</p>`,
      body_text: null,
      variables: JSON.stringify([
        { key: 'pm_first_name', label: "PM's first name", sample: 'Sarah' },
        { key: 'project_name', label: 'Project name', sample: 'Substation Switchgear Upgrade' },
        { key: 'bid_number', label: 'Bid number', sample: 'B26-1342' },
        { key: 'quote_total', label: 'Quote total (formatted)', sample: '$148,200.00' },
        { key: 'attachment_filename', label: 'Attached Word filename', sample: 'Quote_B26-1342.docx' },
      ]),
    });
  }

  if (!existing.includes('ticket_ready_pickup')) {
    rows.push({
      key: 'ticket_ready_pickup',
      name: 'Equipment ticket — ready for pickup',
      subject: '[ConstructPM] Ticket #{{ticket_number}} ready for pick-up',
      body_html: `<p>Hi —</p>
<p>Equipment ticket <strong>#{{ticket_number}}</strong> for project <strong>{{project_number}}</strong> is ready for pick-up.</p>
<ul>
  <li>Pick-up person: {{pickup_person}}</li>
  <li>Pick-up location: {{location}}</li>
  <li>Flagged ready by: {{created_by_name}}</li>
</ul>
<p style="color:#888;font-size:12px;margin-top:24px">Open the ticket in ConstructPM for the equipment list and pick-up confirmation.</p>`,
      body_text: null,
      variables: JSON.stringify([
        { key: 'ticket_number', label: 'Ticket number', sample: 'T-1042' },
        { key: 'project_number', label: 'Project number', sample: 'S26-1342.1' },
        { key: 'pickup_person', label: 'Assigned pick-up person', sample: 'Mike Thompson' },
        { key: 'location', label: 'Pick-up location', sample: 'Shop — Bay 3' },
        { key: 'created_by_name', label: 'User who flagged the ticket', sample: 'Sarah K.' },
      ]),
    });
  }

  if (rows.length > 0) await knex('email_templates').insert(rows);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('email_template_user_overrides');
  await knex.schema.dropTableIfExists('email_trigger_recipients');
  await knex('email_templates').whereIn('key', ['bid_project_quote', 'ticket_ready_pickup']).del();
};
