/**
 * Migration: Reassign superadmin to pegan604@gmail.com.
 *
 * Replaces the earlier backfill (20260513_002) that granted superadmin
 * to admin@company.com. Pat wants the superadmin role tied to their
 * personal email, not the firm's seed admin.
 *
 * What this does:
 *   1. Revokes is_superadmin from any user that currently has it
 *      (clean slate — superadmin is intentionally hard to grant)
 *   2. Creates pegan604@gmail.com if it doesn't exist (role: admin,
 *      is_superadmin: true, default password ChangeMe123!)
 *   3. Or, if pegan604@gmail.com already exists, just flips
 *      is_superadmin true on that row
 *
 * admin@company.com keeps its admin role (so firm-level admin work
 * still works); it just loses superadmin powers (Feature Toggles tab
 * disappears).
 *
 * IDEMPOTENT — re-running is a no-op.
 */

const SUPERADMIN_EMAIL = 'pegan604@gmail.com';

exports.up = async function (knex) {
  // 1. Revoke superadmin everywhere except the target email. Skip
  //    the target by negation so a re-run doesn't briefly flip it
  //    off-then-on.
  const revoked = await knex('users')
    .where('is_superadmin', true)
    .whereNot('email', SUPERADMIN_EMAIL)
    .update({ is_superadmin: false });
  if (revoked > 0) console.log(`  ✅ Revoked superadmin from ${revoked} user(s)`);

  // 2. Ensure target user exists and is flagged superadmin
  const existing = await knex('users').where('email', SUPERADMIN_EMAIL).first();
  if (existing) {
    if (!existing.is_superadmin) {
      await knex('users').where('id', existing.id).update({ is_superadmin: true });
      console.log(`  ✅ Granted superadmin to existing user ${SUPERADMIN_EMAIL}`);
    } else {
      console.log(`  ✓ ${SUPERADMIN_EMAIL} already has superadmin`);
    }
  } else {
    // Create the user. Require bcryptjs lazily because migrations run
    // before node_modules are guaranteed wired into the migration tool
    // — but in practice the api container has bcryptjs installed at
    // boot time before migrations run, so this is safe.
    const bcrypt = require('bcryptjs');
    const password_hash = await bcrypt.hash('ChangeMe123!', 12);
    await knex('users').insert({
      email: SUPERADMIN_EMAIL,
      password_hash,
      first_name: 'Pat',
      last_name: 'Egan',
      initials: 'PE',
      role: 'admin',
      active: true,
      is_superadmin: true,
      notification_preferences: JSON.stringify({ in_app: true, email: true, push: true }),
    });
    console.log(`  ✅ Created ${SUPERADMIN_EMAIL} (password: ChangeMe123! — change immediately)`);
  }
};

exports.down = async function (knex) {
  // No-op — reverting would be confusing (the previous state varies by
  // install). To re-grant superadmin to admin@company.com manually:
  //   UPDATE users SET is_superadmin = TRUE WHERE email = 'admin@company.com';
};
