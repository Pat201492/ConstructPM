/**
 * Scoped fan-out columns on saved_exports — PR #20.
 *
 * One scheduled-export row can now produce N+1 emails: one per user in
 * the chosen role (data filtered to that user via a chosen column) plus
 * an optional consolidated email to an admin recipient list.
 *
 *   fanout_mode             'none' (default) | 'per_user_role'
 *   fanout_role             text — role name to look up users by
 *                           (e.g. 'project_manager'). Honored only when
 *                           fanout_mode = 'per_user_role'.
 *   fanout_filter_column    text — the SQL column ref (relative to the
 *                           export's source) used to scope each user's
 *                           run. e.g. 'projects.pm_id' for the projects
 *                           source. Must be one of the source's declared
 *                           userScopeColumns (exportMetadata).
 *   admin_consolidation     bool — when true and fanout_mode is set, an
 *                           additional unfiltered run is generated and
 *                           emailed to admin_recipients.
 *   admin_recipients        jsonb — array of user UUIDs to receive the
 *                           consolidated output (users.email resolved
 *                           live at send).
 *   export_formats          jsonb — array of file formats to generate
 *                           per run. Subset of ['csv','xlsx','pdf'].
 *                           Default ['csv'] preserves existing behaviour.
 *
 * Down: drops the six columns. Existing rows lose their fan-out config
 * but the non-fan-out rows (fanout_mode='none' default) keep working.
 */

exports.up = async function (knex) {
  const hasMode = await knex.schema.hasColumn('saved_exports', 'fanout_mode');
  if (hasMode) return;

  await knex.schema.alterTable('saved_exports', (t) => {
    t.string('fanout_mode', 32).notNullable().defaultTo('none');
    t.string('fanout_role', 64);
    t.string('fanout_filter_column', 128);
    t.boolean('admin_consolidation').notNullable().defaultTo(false);
    t.jsonb('admin_recipients').notNullable().defaultTo('[]');
    t.jsonb('export_formats').notNullable().defaultTo(JSON.stringify(['csv']));
  });
};

exports.down = async function (knex) {
  const hasMode = await knex.schema.hasColumn('saved_exports', 'fanout_mode');
  if (!hasMode) return;
  await knex.schema.alterTable('saved_exports', (t) => {
    t.dropColumn('fanout_mode');
    t.dropColumn('fanout_role');
    t.dropColumn('fanout_filter_column');
    t.dropColumn('admin_consolidation');
    t.dropColumn('admin_recipients');
    t.dropColumn('export_formats');
  });
};
