/**
 * Migration: superadmin defaults to OFF.
 *
 * Previous behavior: migration 20260513_003 hard-coded pegan604@gmail.com
 * as superadmin and auto-created that user on every fresh install. That's
 * fine for Pat's local box but bad if the same code ever ships to a
 * different customer — they'd inherit a Pat-owned backdoor.
 *
 * New behavior:
 *   1. Revoke is_superadmin from every user (default = off).
 *   2. If process.env.SUPERADMIN_BOOTSTRAP_EMAIL is set, grant superadmin
 *      to that email. Create the user with ChangeMe123! if missing.
 *      This is the deliberate opt-in path: the firm sets the env var in
 *      its local .env (gitignored) and that's the only way superadmin
 *      gets handed out.
 *
 * To re-enable Pat's superadmin locally, add to project/.env:
 *   SUPERADMIN_BOOTSTRAP_EMAIL=pegan604@gmail.com
 *
 * IDEMPOTENT — re-running revokes-then-grants the same target.
 */

exports.up = async function (knex) {
  const revoked = await knex('users').where('is_superadmin', true).update({ is_superadmin: false });
  if (revoked > 0) console.log(`  ✅ Revoked superadmin from ${revoked} user(s) — default-off`);

  const target = (process.env.SUPERADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  if (!target) {
    console.log('  ✓ No SUPERADMIN_BOOTSTRAP_EMAIL set — no superadmin in this install');
    return;
  }

  const existing = await knex('users').whereRaw('LOWER(email) = ?', [target]).first();
  if (existing) {
    await knex('users').where('id', existing.id).update({ is_superadmin: true });
    console.log(`  ✅ Granted superadmin to existing user ${target}`);
    return;
  }

  // Create the user. Lazy-require bcryptjs the same way the previous
  // superadmin migration did — the api image installs it before
  // migrations run.
  const bcrypt = require('bcryptjs');
  const password_hash = await bcrypt.hash('ChangeMe123!', 12);
  await knex('users').insert({
    email: target,
    password_hash,
    first_name: 'Super',
    last_name: 'Admin',
    initials: 'SA',
    role: 'admin',
    active: true,
    is_superadmin: true,
    notification_preferences: JSON.stringify({ in_app: true, email: true, push: true }),
  });
  console.log(`  ✅ Created ${target} with superadmin (password: ChangeMe123! — change immediately)`);
};

exports.down = async function () {
  // No-op. Reverting would either remove a hand-granted superadmin or
  // resurrect the prior hard-coded backdoor — both wrong. Use a fresh
  // migration if you need to change ownership.
};
