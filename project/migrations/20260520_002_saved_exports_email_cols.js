/**
 * Per-export email config columns on saved_exports.
 *
 * Scheduled exports diverge from the other email triggers: instead of
 * rendering from a global template, each saved export carries its own
 * subject + body (admin-edited inline in the Saved Exports row UI).
 * The runner uses these columns to compose the delivery email, falling
 * back to the legacy `saved_export_email` template for rows where the
 * columns are still null. PR #19 wires the runner; this PR only adds
 * the storage so the admin UI can round-trip subject/body edits.
 */

exports.up = async function (knex) {
  const hasSubject = await knex.schema.hasColumn('saved_exports', 'email_subject');
  if (hasSubject) return;

  await knex.schema.alterTable('saved_exports', (t) => {
    t.string('email_subject', 500);
    t.text('email_body_html');
    t.text('email_body_text');
  });
};

exports.down = async function (knex) {
  const hasSubject = await knex.schema.hasColumn('saved_exports', 'email_subject');
  if (!hasSubject) return;
  await knex.schema.alterTable('saved_exports', (t) => {
    t.dropColumn('email_subject');
    t.dropColumn('email_body_html');
    t.dropColumn('email_body_text');
  });
};
