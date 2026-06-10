/**
 * Migration: password reset attempt counter
 *
 * Adds `attempts` to password_resets so the self-service "forgot password"
 * code flow can lock a reset after too many wrong 6-digit code guesses
 * (brute-force defense on top of the short expiry + auth rate limiter).
 */

exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('password_resets', 'attempts');
  if (!has) {
    await knex.schema.alterTable('password_resets', (t) => {
      t.integer('attempts').notNullable().defaultTo(0);
    });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('password_resets', 'attempts');
  if (has) {
    await knex.schema.alterTable('password_resets', (t) => {
      t.dropColumn('attempts');
    });
  }
};
