/**
 * Migration: Add users.must_change_password.
 *
 * First-login forces a password reset. Admin-created accounts and seeded
 * users all start with a known default (ChangeMe123!), which is fine for
 * dev but a real security risk in prod when handed to a new user. With
 * this flag, every new user is routed to a forced "set a new password"
 * screen on their first login regardless of surface (mobile or desktop),
 * and the flag clears the moment they successfully change it.
 *
 * Default true — applies to existing rows too on first run, so any
 * unchanged seeded accounts get prompted on next login. Acceptable for
 * a dev/staging cutover; in prod the operator should set this column
 * to false for users who have already chosen their own password.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('users', 'must_change_password'))) {
    await knex.schema.alterTable('users', (t) => {
      t.boolean('must_change_password').notNullable().defaultTo(true);
    });
    console.log('  ✅ users.must_change_password added (default true)');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('users', 'must_change_password')) {
    await knex.schema.alterTable('users', (t) => t.dropColumn('must_change_password'));
  }
};
