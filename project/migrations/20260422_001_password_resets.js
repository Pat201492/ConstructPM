/**
 * Migration: Password Reset Tokens
 *
 * Adds a `password_resets` table to back admin-initiated password reset flows.
 * Admin generates a link; user clicks it and sets their own new password.
 *
 * Changes:
 *   1. Create password_resets table (token stored as bcrypt hash, never plaintext)
 *   2. Seed global variable for token expiry hours (default: 24)
 */

exports.up = async function (knex) {
  // 1. PASSWORD RESETS TABLE
  await knex.schema.createTable('password_resets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // Bcrypt hash of the token — we never store the plaintext token
    t.string('token_hash', 255).notNullable();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at'); // Null until the user completes the reset
    // Admin who initiated the reset (null for self-initiated "forgot password" flows, if added later)
    t.uuid('created_by_admin_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('delivery_method', 20); // 'email', 'manual_link', 'console' (for dev)
    t.string('client_ip', 45); // Best-effort audit field for who triggered it
    t.timestamps(true, true);
    t.index('user_id');
    t.index('expires_at'); // For cleanup of expired rows
  });
  console.log('  ✅ password_resets table created');

  // 2. GLOBAL VARIABLE for token expiry
  const exists = await knex('global_variables').where('key', 'password_reset_expiry_hours').first();
  if (!exists) {
    await knex('global_variables').insert({
      key: 'password_reset_expiry_hours',
      value: '24',
      description: 'How many hours a password reset link stays valid before expiring',
    });
    console.log('  ✅ password_reset_expiry_hours global seeded (24h default)');
  }
};

exports.down = async function (knex) {
  await knex('global_variables').where('key', 'password_reset_expiry_hours').delete();
  await knex.schema.dropTableIfExists('password_resets');
};
