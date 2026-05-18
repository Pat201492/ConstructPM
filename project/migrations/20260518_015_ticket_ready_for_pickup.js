/**
 * NO-OP STUB.
 *
 * This filename is recorded in the knex_migrations table on Pat's dev
 * database, but the original source was never committed and the file
 * was deleted locally. Without this stub, `knex migrate:latest` refuses
 * to start ("migration directory is corrupt — files missing").
 *
 * The stub exists only so Knex sees the filename and treats it as
 * already-applied. It performs no schema changes.
 *
 * If you later figure out what this migration was supposed to do
 * (something related to a "ready for pickup" state on equipment
 * tickets, based on the filename), replace this stub with the real
 * migration and delete the matching row from knex_migrations so it
 * runs against fresh databases.
 */

exports.up = async function () {
  // intentionally empty
};

exports.down = async function () {
  // intentionally empty
};
