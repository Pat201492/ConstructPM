/**
 * Trigger events: durable log of "something just happened" rows that
 * an out-of-band job will pick up later (currently: email-on-fill, once
 * Pat has a quotes@ domain — see email_provider_status).
 *
 * Pat's rule: the request /fill button should not send a system
 * notification — it should record a row here. The processor that turns
 * these into emails will land separately.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('trigger_events'))) {
    await knex.schema.createTable('trigger_events', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('event_type', 64).notNullable();
      t.string('reference_type', 64);
      t.uuid('reference_id');
      t.jsonb('payload').notNullable().defaultTo('{}');
      t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('processed_at');
      t.index(['event_type', 'processed_at'], 'trigger_events_unprocessed_idx');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('trigger_events');
};
