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
  // Check each column independently so a partial prior application
  // (e.g. subject added but the migration crashed before the body cols)
  // is recoverable by re-running.
  const [hasSubject, hasHtml, hasText] = await Promise.all([
    knex.schema.hasColumn('saved_exports', 'email_subject'),
    knex.schema.hasColumn('saved_exports', 'email_body_html'),
    knex.schema.hasColumn('saved_exports', 'email_body_text'),
  ]);
  if (hasSubject && hasHtml && hasText) return;

  await knex.schema.alterTable('saved_exports', (t) => {
    if (!hasSubject) t.string('email_subject', 500);
    if (!hasHtml) t.text('email_body_html');
    if (!hasText) t.text('email_body_text');
  });
};

exports.down = async function (knex) {
  const [hasSubject, hasHtml, hasText] = await Promise.all([
    knex.schema.hasColumn('saved_exports', 'email_subject'),
    knex.schema.hasColumn('saved_exports', 'email_body_html'),
    knex.schema.hasColumn('saved_exports', 'email_body_text'),
  ]);
  if (!hasSubject && !hasHtml && !hasText) return;
  await knex.schema.alterTable('saved_exports', (t) => {
    if (hasSubject) t.dropColumn('email_subject');
    if (hasHtml) t.dropColumn('email_body_html');
    if (hasText) t.dropColumn('email_body_text');
  });
};
