// Boot-time superadmin sync. Keeps the bootstrap toggle live (not just
// migration-only): on every boot the single user named by
// SUPERADMIN_BOOTSTRAP_EMAIL is granted is_superadmin and everyone else is
// revoked. With no email configured, every grant is revoked (default off).
//
// Extracted from src/server.js so the semantics can be unit-tested; the
// behaviour is unchanged except that the unset-and-revoked case now logs a
// console.warn naming the env var and the revoked count.

const ENV_VAR = 'SUPERADMIN_BOOTSTRAP_EMAIL';

/**
 * Apply the superadmin bootstrap grant/revoke against the given knex db.
 * @param {import('knex').Knex} db  knex instance
 * @param {string} [email]          raw value of SUPERADMIN_BOOTSTRAP_EMAIL
 * @returns {Promise<{ target: string|null, granted: boolean, created: boolean, revoked: number }>}
 */
async function applySuperadminBootstrap(db, email) {
  const target = (email || '').trim().toLowerCase();
  const currentGrants = await db('users').where('is_superadmin', true).select('email');
  const grantedEmails = currentGrants.map(u => u.email.toLowerCase());

  if (!target) {
    if (grantedEmails.length > 0) {
      await db('users').where('is_superadmin', true).update({ is_superadmin: false });
      // Deployment foot-gun: an unset env var silently strips every grant on
      // boot. Warn loudly so a missing prod config is visible in the logs.
      console.warn(
        `[SUPERADMIN] Revoked is_superadmin from ${grantedEmails.length} user(s) because ${ENV_VAR} is unset`
      );
      return { target: null, granted: false, created: false, revoked: grantedEmails.length };
    }
    console.log(`[SUPERADMIN] None configured (set ${ENV_VAR} to opt-in)`);
    return { target: null, granted: false, created: false, revoked: 0 };
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
    return { target, granted: true, created: false, revoked };
  }

  const bcrypt = require('bcryptjs');
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
  return { target, granted: true, created: true, revoked };
}

module.exports = { applySuperadminBootstrap, ENV_VAR };
