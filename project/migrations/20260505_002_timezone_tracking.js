/**
 * Migration: Add timezone tracking
 *
 * Why this exists:
 * - Field notes are created at specific times by specific people. When a
 *   foreman in NJ writes "inspector arrived at 2pm", a PM in CA reading
 *   the note later should see "2pm EST", not "11am PST" (their own time).
 *   Storing only UTC + viewer's-local-time loses the author's clock,
 *   which is the meaningful signal.
 * - To fix this we capture the IANA timezone (e.g. 'America/New_York')
 *   of the author at write time, alongside the existing UTC timestamp.
 *
 * What this adds:
 * - users.default_timezone: the user's timezone, populated when the user's
 *   browser sends it on login/profile update. Falls back to America/New_York
 *   for the seeded users.
 * - field_notes.author_timezone: captured at note-creation time, persisted
 *   for the life of the note even if the author later moves timezones.
 *
 * What this does NOT do:
 * - Add timezone tracking to invoices or POs. Per design discussion, those
 *   are date-keyed (less time-sensitive) and we're keeping the data model
 *   minimal. If/when a multi-state firm needs invoice-level timezone, this
 *   migration is the template for that change.
 */

exports.up = async function (knex) {
  // Users: default timezone (IANA name like 'America/New_York')
  if (!(await knex.schema.hasColumn('users', 'default_timezone'))) {
    await knex.schema.alterTable('users', (t) => {
      t.string('default_timezone', 50).defaultTo('America/New_York');
    });
    console.log('  ✅ users.default_timezone column added');
  }

  // Field notes: timezone the author was in when they wrote the note
  if (!(await knex.schema.hasColumn('field_notes', 'author_timezone'))) {
    await knex.schema.alterTable('field_notes', (t) => {
      t.string('author_timezone', 50);
    });
    console.log('  ✅ field_notes.author_timezone column added');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('field_notes', 'author_timezone')) {
    await knex.schema.alterTable('field_notes', (t) => {
      t.dropColumn('author_timezone');
    });
  }
  if (await knex.schema.hasColumn('users', 'default_timezone')) {
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('default_timezone');
    });
  }
};
