/**
 * Migration: Seed feature flags as global_variables rows.
 *
 * Pat wants the major feature areas (Invoices / Purchase Orders /
 * Timesheets / Inbox) to be toggleable without redeploying — see them
 * disappear from the sidebar and other entry points by flipping a
 * checkbox in Admin → Feature Toggles.
 *
 * Storing in global_variables (key/value strings) instead of creating a
 * dedicated feature_flags table because:
 *   (1) the existing global_variables PATCH endpoint already exists and
 *       is admin-only — reuse the access control,
 *   (2) we're only adding 4 rows, not 40, so a dedicated table would be
 *       overkill,
 *   (3) namespacing the keys with `feature.` keeps them easy to spot.
 *
 * Defaults true — existing installations don't lose any features on
 * upgrade. Pat can then flip them off as they trim the lean version.
 *
 * IDEMPOTENT — uses ON CONFLICT DO NOTHING so re-running won't
 * overwrite already-set values (in case admin has already flipped them).
 */

const FEATURE_FLAGS = [
  { key: 'feature.invoices_enabled',        value: 'true', description: 'Show the Invoices tab and related project detail sections' },
  { key: 'feature.purchase_orders_enabled', value: 'true', description: 'Show the Purchase Orders tab and related project detail sections' },
  { key: 'feature.timesheets_enabled',      value: 'true', description: 'Show the Timesheets tab and related project detail sections' },
  { key: 'feature.inbox_enabled',           value: 'true', description: 'Show the Inbox tab and AI extraction pipeline (vendor quotes, invoice/PO/timesheet upload)' },
];

exports.up = async function (knex) {
  for (const flag of FEATURE_FLAGS) {
    // ON CONFLICT DO NOTHING — keeps any admin-set value untouched
    await knex.raw(
      `INSERT INTO global_variables (key, value, description) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`,
      [flag.key, flag.value, flag.description]
    );
  }
  console.log(`  ✅ ${FEATURE_FLAGS.length} feature flags seeded`);
};

exports.down = async function (knex) {
  for (const flag of FEATURE_FLAGS) {
    await knex('global_variables').where('key', flag.key).del();
  }
};
