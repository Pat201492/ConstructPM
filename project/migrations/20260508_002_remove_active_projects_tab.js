/**
 * Migration: Drop the 'active-projects' tab from all role_configurations.
 *
 * Pat removed the Active Projects tab (the regular Projects list now does
 * everything that view did, plus filtering and sorting). Existing role rows
 * had 'active-projects' baked into their allowed_tabs JSON; this migration
 * scrubs it so the admin Roles UI doesn't show a checkbox for a tab that
 * no longer exists.
 *
 * JSONB ROUND-TRIP NOTE: pg returns parsed JS arrays for jsonb columns on
 * read but expects strings on write — we re-stringify before update. This
 * is the same pattern that bit us in 20260505_003 and is now standardized.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  const stringifyJson = (v) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));

  const roles = await knex('role_configurations').select('role_name', 'allowed_tabs');
  for (const r of roles) {
    let tabs;
    try {
      tabs = typeof r.allowed_tabs === 'string' ? JSON.parse(r.allowed_tabs) : r.allowed_tabs;
    } catch { tabs = []; }
    if (!Array.isArray(tabs)) continue;
    const before = tabs.length;
    const filtered = tabs.filter(t => t !== 'active-projects');
    if (filtered.length !== before) {
      await knex('role_configurations')
        .where('role_name', r.role_name)
        .update({ allowed_tabs: stringifyJson(filtered) });
      console.log(`  ✅ Removed 'active-projects' from role: ${r.role_name}`);
    }
  }
};

exports.down = async function () {
  // No-op — re-adding a tab everyone removed isn't useful; reinstate via
  // the admin Roles UI if you bring the tab back.
};
