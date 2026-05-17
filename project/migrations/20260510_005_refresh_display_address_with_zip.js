/**
 * Migration: Refresh display_address fields to include zip.
 *
 * As of May 2026 the address-builder helpers in Location.js and
 * Customer.js fold zip into display_address / billing_display_address.
 * Existing rows still have the old format (street, town, state). This
 * migration recomputes them in-place so the project detail pop-up and
 * other surface that reads display_address starts showing zip without
 * waiting for each row to be edited.
 *
 * Done in raw SQL since the model helpers run server-side; raw SQL gives
 * us idempotent behavior at migration time without booting the app.
 *
 * IDEMPOTENT — re-running just rebuilds the same string.
 */

exports.up = async function (knex) {
  // locations.display_address = "<street>, <town>, <state> <zip>"
  // (handles missing fields gracefully via TRIM + NULLIF)
  await knex.raw(`
    UPDATE locations SET display_address = TRIM(BOTH ', ' FROM CONCAT_WS(', ',
      NULLIF(street, ''),
      TRIM(CONCAT_WS(' ',
        NULLIF(TRIM(BOTH ', ' FROM CONCAT_WS(', ', NULLIF(town, ''), NULLIF(state, ''))), ''),
        NULLIF(zip, '')
      ))
    ))
  `);

  // customers.billing_display_address = same shape against billing_* fields
  await knex.raw(`
    UPDATE customers SET billing_display_address = TRIM(BOTH ', ' FROM CONCAT_WS(', ',
      NULLIF(billing_street, ''),
      TRIM(CONCAT_WS(' ',
        NULLIF(TRIM(BOTH ', ' FROM CONCAT_WS(', ', NULLIF(billing_town, ''), NULLIF(billing_state, ''))), ''),
        NULLIF(billing_zip, '')
      ))
    ))
  `);

  console.log('  ✅ display_address fields refreshed with zip');
};

exports.down = async function () {
  // No-op — the new format is a strict superset of the old, no need to
  // strip zip out. If you really need to revert, edit Location.js /
  // Customer.js helpers and re-save each row.
};
