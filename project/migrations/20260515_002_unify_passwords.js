/**
 * Migration: Unify all user passwords to a single standard.
 *
 * Pat wants every test account to share the same password so demos and
 * test sessions don't require flipping a credentials sheet. Standard
 * is ChangeMe123! — name encourages users to change it on first login,
 * matches the existing seed-admin convention.
 *
 * Affects:
 *   - admin@company.com (was ChangeMe123! — no-op)
 *   - pegan604@gmail.com (was ChangeMe123! — no-op)
 *   - every other user (mike.torres, sarah.chen, alex.kim, ray.jackson,
 *     all field staff) — was Password123!, now ChangeMe123!
 *
 * SECURITY NOTE: appropriate for the dev/demo install. For any
 * production rollout the firm admin should rotate the superadmin and
 * firm-admin passwords immediately on first login.
 *
 * IDEMPOTENT — re-running just re-hashes the same password.
 */

exports.up = async function (knex) {
  const bcrypt = require('bcryptjs');
  const STANDARD_PASSWORD = 'ChangeMe123!';

  // bcrypt is salted — every hash is different, but they all verify
  // against the same plaintext. Generate once, apply to every user.
  const password_hash = await bcrypt.hash(STANDARD_PASSWORD, 12);

  const count = await knex('users').update({ password_hash });

  console.log(`  ✅ Reset password to ${STANDARD_PASSWORD} for ${count} user(s)`);
  console.log('  ⚠️  Change admin@company.com and pegan604@gmail.com immediately if this install will be production.');
};

exports.down = async function () {
  // No-op — there's no record of the prior passwords to restore.
};
