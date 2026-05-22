/**
 * Migration: add equipment table to the ticket_ready_pickup email.
 *
 * Pat: "you need to add in on the ticket email the list of equipment
 * do it in like a table format / no equipment numbers just names and
 * qtys".
 *
 * The body_html now renders a 2-column table (Qty + Equipment Name)
 * via the new {{{equipment_table_html}}} variable. Triple-braces
 * because the HTML is server-built (each cell is esc()d before
 * concatenation — see equipmentTickets.js notifyTicketReady); double
 * would escape the table tags and render the markup literally.
 *
 * IDEMPOTENT — only rewrites if the template hasn't already been
 * updated to include the new placeholder.
 */

exports.up = async function (knex) {
  const row = await knex('email_templates').where({ key: 'ticket_ready_pickup' }).first();
  if (!row) {
    console.log('  (ticket_ready_pickup template missing — earlier migration must run first)');
    return;
  }
  if (row.body_html && row.body_html.includes('equipment_table_html')) {
    console.log('  (ticket_ready_pickup already includes equipment_table_html — skipping)');
    return;
  }

  const newBody = `<p>Hi —</p>
<p>Equipment ticket <strong>#{{ticket_number}}</strong> for project <strong>{{project_number}}</strong> is ready for pick-up.</p>
<ul>
  <li>Pick-up person: {{pickup_person}}</li>
  <li>Pick-up location: {{location}}</li>
  <li>Flagged ready by: {{created_by_name}}</li>
</ul>
<p style="margin-top:18px"><strong>Equipment requested</strong></p>
{{{equipment_table_html}}}
<p style="color:#888;font-size:12px;margin-top:24px">Open the ticket in ConstructPM for the full pick-up confirmation.</p>`;

  // Re-parse + extend the variables list.
  let vars = [];
  try { vars = typeof row.variables === 'string' ? JSON.parse(row.variables) : (row.variables || []); } catch {}
  if (!vars.some(v => v.key === 'equipment_table_html')) {
    vars.push({
      key: 'equipment_table_html',
      label: 'Equipment list table (server-built HTML)',
      sample: '<table>…</table>',
    });
  }

  await knex('email_templates').where({ key: 'ticket_ready_pickup' }).update({
    body_html: newBody,
    variables: JSON.stringify(vars),
    updated_at: knex.fn.now(),
  });
  console.log('  ✅ ticket_ready_pickup body_html refreshed with equipment table');
};

exports.down = async function (knex) {
  const row = await knex('email_templates').where({ key: 'ticket_ready_pickup' }).first();
  if (!row) return;
  // Roll back to the pre-table body (matches migration 20260520_001).
  const oldBody = `<p>Hi —</p>
<p>Equipment ticket <strong>#{{ticket_number}}</strong> for project <strong>{{project_number}}</strong> is ready for pick-up.</p>
<ul>
  <li>Pick-up person: {{pickup_person}}</li>
  <li>Pick-up location: {{location}}</li>
  <li>Flagged ready by: {{created_by_name}}</li>
</ul>
<p style="color:#888;font-size:12px;margin-top:24px">Open the ticket in ConstructPM for the equipment list and pick-up confirmation.</p>`;
  await knex('email_templates').where({ key: 'ticket_ready_pickup' }).update({
    body_html: oldBody,
    updated_at: knex.fn.now(),
  });
};
