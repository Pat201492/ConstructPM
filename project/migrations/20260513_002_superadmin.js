/**
 * Migration: users.is_superadmin.
 *
 * Two-tier admin model:
 *   - admin role: "admin at the firm" — runs users, roles, templates,
 *     global variables, etc. for their own company.
 *   - is_superadmin flag: "superadmin from Pat" — controls which
 *     feature modules are visible to the firm at all (Feature Toggles
 *     tab is restricted to superadmins).
 *
 * Implemented as a boolean column rather than a new role so a single
 * user can be both a regular admin (for normal admin work) and the
 * superadmin (for feature gating) — they're orthogonal concerns.
 *
 * Backfill: the seed admin user (admin@company.com) gets is_superadmin
 * = true so existing installs continue to work. Everyone else is false.
 * Future superadmin grants are done by direct DB update; there's
 * intentionally no UI to promote someone to superadmin (that would
 * defeat the point — it's a Pat-controlled toggle).
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('users', 'is_superadmin'))) {
    await knex.schema.alterTable('users', (t) => {
      t.boolean('is_superadmin').notNullable().defaultTo(false);
      t.index('is_superadmin');
    });
    console.log('  ✅ users.is_superadmin added');

    // Backfill: grant superadmin to the seed admin only. If you need
    // to grant additional superadmins later, do it via raw DB update —
    // it should be deliberately friction-y.
    const updated = await knex('users')
      .where('email', 'admin@company.com')
      .update({ is_superadmin: true });
    if (updated > 0) console.log('  ✅ Granted superadmin to admin@company.com');
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('users', 'is_superadmin')) {
    await knex.schema.alterTable('users', (t) => t.dropColumn('is_superadmin'));
  }
};
