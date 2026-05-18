/**
 * Saved & scheduled exports.
 *
 * A `saved_exports` row holds an ExportBuilder config (source + columns +
 * filters) plus a recipient list and (optionally) a cron expression. If
 * `cron` is set the row is picked up by the FileWatcher tick; either way
 * the row can also be manually triggered via POST /api/exports/schedules/:id/trigger.
 *
 * `columns` is an ordered JSON array of column keys — the same shape the
 * ExportBuilder UI sends — so drag-to-reorder is preserved.
 *
 * `recipients` is an array of user UUIDs; the runner looks up each user's
 * email at delivery time (so renaming/deactivating users is handled live).
 */

exports.up = async function (knex) {
  if (await knex.schema.hasTable('saved_exports')) return;

  await knex.schema.createTable('saved_exports', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.uuid('owner_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('source', 64).notNullable();
    t.jsonb('columns').notNullable();
    t.jsonb('filters').defaultTo('{}');
    t.string('cron', 128); // nullable — null = manual-only
    t.jsonb('recipients').notNullable().defaultTo('[]');
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamp('last_run_at');
    t.string('last_status', 32);
    t.text('last_error');
    t.timestamp('next_run_at');
    t.timestamps(true, true);

    t.index('owner_user_id');
    t.index(['enabled', 'next_run_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('saved_exports');
};
