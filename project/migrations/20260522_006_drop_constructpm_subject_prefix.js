/**
 * Migration: strip the "[ConstructPM]" prefix from email subjects.
 *
 * Pat: "remove the little Construct PM tags on the email templates".
 *
 * Three templates carried the prefix:
 *   - saved_export_email
 *   - bid_project_quote
 *   - ticket_ready_pickup
 *
 * IDEMPOTENT — only updates rows whose subject still starts with the
 * prefix. Per-user overrides in email_template_user_overrides are
 * untouched (PMs who customised their own subject keep it; the
 * tag-stripping only fixes the firm defaults).
 */

const PREFIX = '[ConstructPM] ';

exports.up = async function (knex) {
  const rows = await knex('email_templates').whereRaw('subject LIKE ?', [PREFIX + '%']);
  for (const row of rows) {
    const newSubject = row.subject.startsWith(PREFIX) ? row.subject.slice(PREFIX.length) : row.subject;
    if (newSubject === row.subject) continue;
    await knex('email_templates').where({ key: row.key }).update({
      subject: newSubject,
      updated_at: knex.fn.now(),
    });
    console.log(`  ✅ stripped [ConstructPM] from ${row.key}`);
  }
};

exports.down = async function (knex) {
  // Re-prefix the three known templates so a rollback restores the
  // pre-PR-38 state for those subjects.
  const keys = ['saved_export_email', 'bid_project_quote', 'ticket_ready_pickup'];
  const rows = await knex('email_templates').whereIn('key', keys);
  for (const row of rows) {
    if (row.subject.startsWith(PREFIX)) continue;
    await knex('email_templates').where({ key: row.key }).update({
      subject: PREFIX + row.subject,
      updated_at: knex.fn.now(),
    });
  }
};
