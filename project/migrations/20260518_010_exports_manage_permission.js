/**
 * Migration: Grant 'exports:manage' permission to admin and project_manager.
 *
 * Backstops the hardcoded PERMISSIONS list in `src/config/roles.js` with
 * a row-level grant in `role_configurations` so the authorize() middleware
 * matches via DB lookup even if the hardcoded table is bypassed.
 *
 * Accounting intentionally stays on `exports:read` only — they can run
 * saved exports but not create/edit/delete them.
 *
 * IDEMPOTENT — only adds the permission if not already present.
 */

const ROLES_TO_GRANT = ['admin', 'project_manager'];
const NEW_PERMISSION = 'exports:manage';

exports.up = async function (knex) {
  const stringifyJson = (v) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));

  for (const roleName of ROLES_TO_GRANT) {
    const r = await knex('role_configurations').where('role_name', roleName).first();
    if (!r) { console.log(`  ⏭️  Role '${roleName}' not found — skipping`); continue; }
    let perms;
    try {
      perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
    } catch { perms = []; }
    if (!Array.isArray(perms)) perms = [];
    if (!perms.includes(NEW_PERMISSION) && !perms.includes('*') && !perms.includes('exports:*')) {
      perms.push(NEW_PERMISSION);
      await knex('role_configurations').where('role_name', roleName)
        .update({ permissions: stringifyJson(perms) });
      console.log(`  ✅ ${roleName} → +${NEW_PERMISSION}`);
    }
  }
};

exports.down = async function (knex) {
  const stringifyJson = (v) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));
  for (const roleName of ROLES_TO_GRANT) {
    const r = await knex('role_configurations').where('role_name', roleName).first();
    if (!r) continue;
    let perms;
    try {
      perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions;
    } catch { perms = []; }
    if (!Array.isArray(perms)) continue;
    const filtered = perms.filter(p => p !== NEW_PERMISSION);
    if (filtered.length !== perms.length) {
      await knex('role_configurations').where('role_name', roleName)
        .update({ permissions: stringifyJson(filtered) });
    }
  }
};
