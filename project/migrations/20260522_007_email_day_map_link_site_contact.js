/**
 * Migration: refresh email_day_to_staff template body.
 *
 * Pat: "the variable for the send to staff are incorrect it should
 * have location address as a click-able link in to take you to a
 * mapping app / it should also have site contact Name and site
 * contact phone number".
 *
 * New body uses:
 *   - {{{location.map_link}}}   triple-brace, raw anchor → Google Maps deep-link
 *   - {{site_contact.name}}     escaped text
 *   - {{site_contact.phone}}    escaped text
 *
 * The compose service builds location.map_link as a pre-anchored
 * <a href="https://www.google.com/maps/search/?api=1&query=…">addr</a>.
 * Opens native Maps app on iOS / Android; falls back to the web app
 * on desktop.
 *
 * IDEMPOTENT — only updates if the body doesn't already reference
 * location.map_link.
 */

exports.up = async function (knex) {
  const row = await knex('email_templates').where({ key: 'email_day_to_staff' }).first();
  if (!row) {
    console.log('  (email_day_to_staff template missing — skipping)');
    return;
  }
  if (row.body_html && row.body_html.includes('location.map_link')) {
    console.log('  (email_day_to_staff already references location.map_link — skipping)');
    return;
  }

  // Site-contact line is two simple {{var}} subs joined by a dash —
  // substitute() doesn't support Mustache {{#section}} blocks, so a
  // missing phone just shows "Name — " (acceptable; emails go out
  // either way). Keep it on one line so a no-phone case still reads.
  const newBody = `<p>You're on the crew for <strong>{{project_name}}</strong> ({{project_number}}) on <strong>{{date}}</strong>.</p>
<p><strong>Location:</strong> {{{location.map_link}}}</p>
<p><strong>Site Contact:</strong> {{site_contact.name}} — {{site_contact.phone}}</p>
<p><strong>Crew ({{crew_count}}):</strong> {{crew_names}}</p>
<p>{{day_notes}}</p>
<p style="color:#888;font-size:12px;margin-top:24px">Sent from ConstructPM's Email Day to Staff. Reply to your PM with any questions.</p>`;

  // Extend the variables list so the admin Templates UI shows the new
  // placeholders alongside the existing ones.
  let vars = [];
  try { vars = typeof row.variables === 'string' ? JSON.parse(row.variables) : (row.variables || []); } catch {}
  const ensureVar = (k, label, sample) => {
    if (!vars.some(v => v.key === k)) vars.push({ key: k, label, sample });
  };
  ensureVar('location.map_link', 'Location address as clickable Google Maps link', '<a href="…">350 5th Ave, New York, NY</a>');
  ensureVar('site_contact.name', 'Site contact name', 'Jane Smith');
  ensureVar('site_contact.phone', 'Site contact phone', '212-555-0199');

  await knex('email_templates').where({ key: 'email_day_to_staff' }).update({
    body_html: newBody,
    variables: JSON.stringify(vars),
    updated_at: knex.fn.now(),
  });
  console.log('  ✅ email_day_to_staff body refreshed with map link + site contact');
};

exports.down = async function (knex) {
  const row = await knex('email_templates').where({ key: 'email_day_to_staff' }).first();
  if (!row) return;
  // Pre-PR-39 body
  const oldBody = `<p>You're on the crew for <strong>{{project_name}}</strong> ({{project_number}}) on <strong>{{date}}</strong>.</p>
<p><strong>Location:</strong> {{location}}<br>
<strong>Crew ({{crew_count}}):</strong> {{crew_names}}</p>
<p>{{day_notes}}</p>
<p style="color:#888;font-size:12px;margin-top:24px">Sent from ConstructPM's Email Day to Staff. Reply to your PM with any questions.</p>`;
  await knex('email_templates').where({ key: 'email_day_to_staff' }).update({
    body_html: oldBody,
    updated_at: knex.fn.now(),
  });
};
