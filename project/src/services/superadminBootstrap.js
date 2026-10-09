// Syncs is_superadmin from SUPERADMIN_BOOTSTRAP_EMAIL on every boot, so the
// bootstrap toggle is live, not migration-only. Default off: with no email
// set, every is_superadmin grant gets revoked on each boot (see
// migrations/20260518_002_superadmin_default_off.js for the original intent).

const bcrypt = require('bcryptjs');

/**
 * @param {import('knex').Knex} db
 * @param {string} email - raw SUPERADMIN_BOOTSTRAP_EMAIL env value (may be undefined/empty)
 */
async function applySuperadminBootstrap(db, email) {
  const target = (email || '').trim().toLowerCase();
  const currentGrants = await db('users').where('is_superadmin', true).select('email');
  const grantedEmails = currentGrants.map(u => u.email.toLowerCase());

  if (!target) {
    if (grantedEmails.length > 0) {
      await db('users').where('is_superadmin', true).update({ is_superadmin: false });
      console.warn(
        `[SUPERADMIN] Revoked from ${grantedEmails.length} user(s); SUPERADMIN_BOOTSTRAP_EMAIL is not set`
      );
    } else {
      console.log('[SUPERADMIN] None configured (set SUPERADMIN_BOOTSTRAP_EMAIL to opt-in)');
    }
    return;
  }

  // Revoke everyone except target
  const revoked = await db('users')
    .where('is_superadmin', true)
    .whereRaw('LOWER(email) != ?', [target])
    .update({ is_superadmin: false });
  if (revoked > 0) console.log(`[SUPERADMIN] Revoked from ${revoked} user(s) outside the target`);

  const existing = await db('users').whereRaw('LOWER(email) = ?', [target]).first();
  if (existing) {
    if (!existing.is_superadmin) {
      await db('users').where('id', existing.id).update({ is_superadmin: true });
      console.log(`[SUPERADMIN] Granted to existing user ${target}`);
    } else {
      console.log(`[SUPERADMIN] ${target} (active)`);
    }
    return;
  }

  const password_hash = await bcrypt.hash('ChangeMe123!', 12);
  await db('users').insert({
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
  console.log(`[SUPERADMIN] Created ${target} (must change password on first login)`);
}

module.exports = { applySuperadminBootstrap };
