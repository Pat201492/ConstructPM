/**
 * One-shot backfill for `saved_exports.email_subject` / `email_body_html`
 * / `email_body_text`.
 *
 * Before PR #19, SavedExportRunner rendered every scheduled-export email
 * from the global `saved_export_email` template (see migration
 * 20260518_011). PR #19 moves to per-export config — subject and body
 * live on the saved_exports row itself, edited inline in the admin UI.
 *
 * This migration copies the current `saved_export_email` template's
 * subject/body into every existing saved_exports row that hadn't already
 * set its own. Rows that already have a non-null value are left alone so
 * an admin who edited a row before this migration ran doesn't get
 * overwritten on re-deploy.
 *
 * The legacy `saved_export_email` template row is intentionally left in
 * place. PR #20 may delete it once we've confirmed no other surface
 * reads from it; keeping it here makes the migration reversible and
 * leaves an obvious audit trail.
 */

exports.up = async function (knex) {
  // Skip cleanly when prerequisites are missing (fresh install where
  // the columns or template aren't there yet — knex runs migrations in
  // filename order, so this should always find both, but a defensive
  // check keeps re-runs and test snapshots stable).
  const hasCols = await knex.schema.hasColumn('saved_exports', 'email_subject');
  if (!hasCols) return;

  const tpl = await knex('email_templates').where('key', 'saved_export_email').first();
  if (!tpl) return;

  await knex('saved_exports')
    .whereNull('email_subject')
    .update({ email_subject: tpl.subject });

  await knex('saved_exports')
    .whereNull('email_body_html')
    .update({ email_body_html: tpl.body_html });

  if (tpl.body_text) {
    await knex('saved_exports')
      .whereNull('email_body_text')
      .update({ email_body_text: tpl.body_text });
  }
};

exports.down = async function (knex) {
  // Non-destructive down: we can't tell which rows were backfilled vs.
  // hand-edited, and clearing every column would risk wiping admin
  // edits. Drop-the-columns lives in 20260520_002.down.
};
