/**
 * Migration: Add ticket_project.pickup_person_id.
 *
 * Pickup-person was a free-text input on the request form. Per Pat, it
 * should be a real user from the user list so the "Ready for pickup"
 * email automatically reaches the right inbox. Add a nullable FK and
 * keep the existing free-text column as a denormalised display copy
 * (matches how site_contact_id / site_contact_name coexist).
 *
 * No backfill — historical tickets keep their text-only pickup_person.
 * Newly-created tickets after this migration carry both fields.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('ticket_project', 'pickup_person_id'))) {
    await knex.schema.alterTable('ticket_project', (t) => {
      t.uuid('pickup_person_id').references('id').inTable('users').onDelete('SET NULL');
      t.index('pickup_person_id');
    });
    console.log('  ✅ ticket_project.pickup_person_id added (FK → users.id)');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('ticket_project', 'pickup_person_id')) {
    await knex.schema.alterTable('ticket_project', (t) => t.dropColumn('pickup_person_id'));
  }
};
