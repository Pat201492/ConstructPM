/**
 * Migration: add 'on_ticket' to the equipment_status enum.
 *
 * Pat's rule: when a piece of equipment is scanned to (or manually added
 * to) an active equipment ticket, its status flips to 'on_ticket' so the
 * shop can see it's reserved — distinct from both 'available' (free to
 * pull) and 'checked_out' (already at a jobsite). The transition happens
 * on /equipment-tickets/:tn/fill (and is reversed when the item is
 * removed from a ticket without pickup); pickup then promotes
 * 'on_ticket' → 'checked_out'.
 *
 * Postgres won't let `ALTER TYPE ... ADD VALUE` run inside a transaction,
 * so this migration disables knex's wrapping transaction — same pattern
 * as 20260505_002a_enum_additions.js for the doc-type enum.
 */

exports.config = { transaction: false };

exports.up = async function (knex) {
  // IF NOT EXISTS guards an idempotent re-run on installs that already
  // applied this manually.
  await knex.raw(`ALTER TYPE equipment_status ADD VALUE IF NOT EXISTS 'on_ticket'`);
  console.log("  ✅ equipment_status enum: 'on_ticket' added");
};

exports.down = async function () {
  // Postgres has no DROP VALUE for enums. Manual recovery would require
  // recreating the enum type without the value, casting every column,
  // and dropping the old type. Not worth automating — leave the value
  // in place if rolling back.
};
