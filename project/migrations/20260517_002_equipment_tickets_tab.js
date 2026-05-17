/**
 * Migration: Grant 'equipment-tickets' tab to applicable roles.
 *
 * The Equipment Tickets tab (Request / Maintenance / Active Tickets
 * subtabs) goes to the people who handle equipment logistics:
 *   - admin            : full access
 *   - shop_staff       : the primary users (fill/maintain/return)
 *   - project_manager  : create requests for their jobs
 *
 * Field staff (mobile-only) and others don't get it by default; admin
 * can grant per-role later via the Roles UI. The future "special
 * dashboard user" who ONLY sees this tab is created by giving a user a
 * role whose allowed_tabs is exactly ['equipment-tickets'] — no schema
 * change needed for that.
 *
 * JSONB ROUND-TRIP: stringify on write (standard pattern — pg returns
 * parsed arrays on read but expects a string on write).
 *
 * IDEMPOTENT — only adds the tab if not already present.
 */

const ROLES_TO_GRANT = ['admin', 'shop_staff', 'project_manager'];
const NEW_TAB = 'equipment-tickets';

exports.up = async function (knex) {
  const stringifyJson = (v) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));

  for (const roleName of ROLES_TO_GRANT) {
    const r = await knex('role_configurations').where('role_name', roleName).first();
    if (!r) { console.log(`  ⏭️  Role '${roleName}' not found — skipping`); continue; }
    let tabs;
    try {
      tabs = typeof r.allowed_tabs === 'string' ? JSON.parse(r.allowed_tabs) : r.allowed_tabs;
    } catch { tabs = []; }
    if (!Array.isArray(tabs)) tabs = [];
    if (!tabs.includes(NEW_TAB)) {
      tabs.push(NEW_TAB);
      await knex('role_configurations').where('role_name', roleName)
        .update({ allowed_tabs: stringifyJson(tabs) });
      console.log(`  ✅ ${roleName} → +${NEW_TAB}`);
    }
  }
};

exports.down = async function (knex) {
  const stringifyJson = (v) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));
  for (const roleName of ROLES_TO_GRANT) {
    const r = await knex('role_configurations').where('role_name', roleName).first();
    if (!r) continue;
    let tabs;
    try {
      tabs = typeof r.allowed_tabs === 'string' ? JSON.parse(r.allowed_tabs) : r.allowed_tabs;
    } catch { tabs = []; }
    if (!Array.isArray(tabs)) continue;
    const filtered = tabs.filter(t => t !== NEW_TAB);
    if (filtered.length !== tabs.length) {
      await knex('role_configurations').where('role_name', roleName)
        .update({ allowed_tabs: stringifyJson(filtered) });
    }
  }
};
