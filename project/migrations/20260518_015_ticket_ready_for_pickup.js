/**
 * Migration: add "ready for pickup" stamp to ticket_project.
 *
 * Inserts a manual gate between /fill (status='filled' — shop has scanned
 * the items) and /pickup (status='picked_up' — crew has physically taken
 * them). Clicking the new "Ready for Pick-up" button calls
 * POST /equipment-tickets/:n/ready, which:
 *   - flips ticket_project.status to 'ready_for_pickup'
 *   - stamps ready_at = now()
 *   - stamps ready_by = req.user.id
 *   - fires a NotificationService.send to created_by + admins so the
 *     requestor gets an in-app + email notification (email is no-op log
 *     in dev until EMAIL_PROVIDER + a verified domain are configured —
 *     same path every other notification in the app uses).
 *
 * Status is varchar(20), not a true enum, so no enum migration is
 * needed — just the two new audit columns.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  const hasReadyAt = await knex.schema.hasColumn('ticket_project', 'ready_at');
  const hasReadyBy = await knex.schema.hasColumn('ticket_project', 'ready_by');
  if (hasReadyAt && hasReadyBy) return;

  await knex.schema.alterTable('ticket_project', (t) => {
    if (!hasReadyAt) t.timestamp('ready_at').nullable();
    if (!hasReadyBy) t.uuid('ready_by').references('id').inTable('users').onDelete('SET NULL');
  });
  console.log('  ✅ ticket_project: ready_at / ready_by added');
};

exports.down = async function (knex) {
  const hasReadyAt = await knex.schema.hasColumn('ticket_project', 'ready_at');
  const hasReadyBy = await knex.schema.hasColumn('ticket_project', 'ready_by');
  if (!hasReadyAt && !hasReadyBy) return;
  await knex.schema.alterTable('ticket_project', (t) => {
    if (hasReadyBy) t.dropColumn('ready_by');
    if (hasReadyAt) t.dropColumn('ready_at');
  });
};
