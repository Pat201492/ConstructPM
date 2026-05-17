/**
 * Migration: Update role tabs for the financials split + tables tab
 *
 * Splits 'financials' (the combined Invoices & POs page) into separate
 * 'invoices' and 'purchase-orders' top-level tabs. Adds a new 'tables' tab
 * that holds Locations / Customers / Vendors / Contacts (reference data
 * everyone uses).
 *
 * Idempotent — runs the substitution only if the old tab name is still in
 * the allowed_tabs list, and only adds 'tables' if not already present.
 */

exports.up = async function (knex) {
  const roles = await knex('role_configurations').select('role_name', 'allowed_tabs');
  for (const r of roles) {
    let tabs;
    try {
      tabs = typeof r.allowed_tabs === 'string' ? JSON.parse(r.allowed_tabs) : r.allowed_tabs;
    } catch { tabs = []; }
    if (!Array.isArray(tabs)) continue;

    let changed = false;

    // Swap 'financials' → 'invoices' + 'purchase-orders'
    const finIdx = tabs.indexOf('financials');
    if (finIdx >= 0) {
      tabs.splice(finIdx, 1, 'invoices', 'purchase-orders');
      changed = true;
    }

    // Add 'tables' if missing — for any role that has projects access
    if (!tabs.includes('tables') && (tabs.includes('projects') || tabs.includes('bids'))) {
      // Insert after 'projects' or at end
      const projIdx = tabs.indexOf('projects');
      if (projIdx >= 0) tabs.splice(projIdx + 1, 0, 'tables');
      else tabs.push('tables');
      changed = true;
    }

    if (changed) {
      await knex('role_configurations')
        .where('role_name', r.role_name)
        .update({ allowed_tabs: JSON.stringify(tabs) });
      console.log(`  ✅ Updated tabs for role: ${r.role_name}`);
    }
  }
};

exports.down = async function (knex) {
  // Revert the split — combine back to 'financials' and remove 'tables'
  const roles = await knex('role_configurations').select('role_name', 'allowed_tabs');
  for (const r of roles) {
    let tabs;
    try {
      tabs = typeof r.allowed_tabs === 'string' ? JSON.parse(r.allowed_tabs) : r.allowed_tabs;
    } catch { tabs = []; }
    if (!Array.isArray(tabs)) continue;

    const invIdx = tabs.indexOf('invoices');
    if (invIdx >= 0) tabs.splice(invIdx, 1);
    const poIdx = tabs.indexOf('purchase-orders');
    if (poIdx >= 0) tabs.splice(poIdx, 1, 'financials');
    const tblIdx = tabs.indexOf('tables');
    if (tblIdx >= 0) tabs.splice(tblIdx, 1);

    await knex('role_configurations')
      .where('role_name', r.role_name)
      .update({ allowed_tabs: JSON.stringify(tabs) });
  }
};
