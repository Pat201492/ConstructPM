/**
 * Migration: feature toggles default OFF.
 *
 * Pat's correction to the earlier feature-flag seed (20260513_001), which
 * defaulted Invoices / Purchase Orders / Timesheets / Inbox to ON. The
 * intent is the other direction — every feature module should be
 * explicitly opted-in by the firm's superadmin via the Feature Toggles
 * tab, not silently turned on.
 *
 * What this does: flip every `feature.*_enabled` global_variable to
 * 'false' so a freshly installed system comes up with all feature
 * modules hidden. Pat (or whoever holds the superadmin flag) ticks them
 * on as needed.
 *
 * Note: this overrides any manual on-flips the admin may have already
 * made. The intent of "default to off" is a hard reset, not a
 * gentle nudge — confirmed in the conversation that led to this.
 *
 * IDEMPOTENT.
 */

exports.up = async function (knex) {
  const updated = await knex('global_variables')
    .where('key', 'like', 'feature.%_enabled')
    .update({ value: 'false' });
  console.log(`  ✅ Feature toggles reset to OFF (${updated} flag(s))`);
};

exports.down = async function (knex) {
  // No-op. Re-enabling everything by default would silently turn modules
  // back on for any operator who relied on the new default — too
  // surprising. Toggle them back on individually via the UI if needed.
};
