/**
 * Migration: Add bids.submit_date.
 *
 * Tracks when a bid was actually submitted to the customer (status flipped
 * to 'submitted'). Distinct from:
 *   - bid_date: the date associated with the bid itself (often the date on
 *     the cover letter / quote document, may be set by the user)
 *   - created_at: when the bid record was first created in the system
 *   - won_date / archived_date: existing post-submission lifecycle stamps
 *
 * Auto-stamped by the bid PATCH route when status transitions to 'submitted'
 * and the column is currently null. Manual edits still allowed via PATCH.
 *
 * Existing bids with status='submitted' or beyond keep submit_date=null
 * (we don't backfill — the original submission date isn't recoverable from
 * audit log without extra plumbing). The bids table column will show "—"
 * for those legacy rows.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('bids', 'submit_date'))) {
    await knex.schema.alterTable('bids', (t) => {
      t.date('submit_date');
      t.index('submit_date');
    });
    console.log('  ✅ bids.submit_date added');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('bids', 'submit_date')) {
    await knex.schema.alterTable('bids', (t) => t.dropColumn('submit_date'));
  }
};
