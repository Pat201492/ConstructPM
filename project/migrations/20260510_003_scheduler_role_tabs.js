/**
 * Migration: Grant schedule + scheduler tabs to applicable roles.
 *
 * - 'schedule' (calendar view) — admin, project_manager, accounting, scheduler
 * - 'scheduler' (worker grid; phase 2 of the scheduler feature) — admin, scheduler
 *
 * Field staff (mobile-only) and shop_staff do not get these tabs by default;
 * admin can grant them via the Roles UI per-user later if needed.
 *
 * JSONB ROUND-TRIP NOTE: stringify on write (per the standard pattern
 * established in 20260505_003 — pg returns parsed arrays on read but
 * expects a string on write).
 *
 * IDEMPOTENT — only adds tabs not already present.
 */

const tabsByRole = {
  admin:           ['schedule', 'scheduler'],
  project_manager: ['schedule'],
  accounting:      ['schedule'],
  scheduler:       ['schedule', 'scheduler'],
};

exports.up = async function (knex) {
  const stringifyJson = (v) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));

  for (const [roleName, newTabs] of Object.entries(tabsByRole)) {
    const r = await knex('role_configurations').where('role_name', roleName).first();
    if (!r) {
      console.log(`  ⏭️  Role '${roleName}' not found — skipping`);
      continue;
    }
    let tabs;
    try {
      tabs = typeof r.allowed_tabs === 'string' ? JSON.parse(r.allowed_tabs) : r.allowed_tabs;
    } catch { tabs = []; }
    if (!Array.isArray(tabs)) tabs = [];
    const before = tabs.length;
    for (const t of newTabs) if (!tabs.includes(t)) tabs.push(t);
    if (tabs.length !== before) {
      await knex('role_configurations')
        .where('role_name', roleName)
        .update({ allowed_tabs: stringifyJson(tabs) });
      console.log(`  ✅ Added ${newTabs.join(', ')} to role: ${roleName}`);
    }
  }
};

exports.down = async function () {
  // No-op — removing tabs from existing role configs isn't useful; admins
  // can hide them via the Roles UI if desired.
};
