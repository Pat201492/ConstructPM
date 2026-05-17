/**
 * Test Setup
 * 
 * Sets environment variables for the test database BEFORE
 * any app modules are loaded, then provides the configured app.
 * 
 * Usage in test files:
 *   const { app, db, ids, setupSuite, teardownSuite } = require('./helpers/setup');
 */

// Override env BEFORE requiring any app modules
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'construct_mgr_test';
process.env.JWT_SECRET = 'test-jwt-secret-not-for-production';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-not-for-production';
process.env.JWT_EXPIRES_IN = '1h';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.STORAGE_BASE_PATH = '/tmp/test-storage';
process.env.ENABLE_FILE_WATCHER = 'false';

const { setupTestDb, teardownTestDb, resetAndSeed, getDb, getIds } = require('./testDb');

let app;

async function setupSuite() {
  // Setup test database
  const db = await setupTestDb();

  // Override the database module to use our test DB
  // This works because require() caches modules
  const dbModule = require('../../src/config/database');
  // Replace the knex instance's connection
  // We need to ensure the app uses the test DB
  // Since the app is already loaded with the env vars set above,
  // and knexfile reads from process.env, this should work.

  // Create storage directories
  const fs = require('fs').promises;
  await fs.mkdir('/tmp/test-storage/bids', { recursive: true });
  await fs.mkdir('/tmp/test-storage/projects', { recursive: true });
  await fs.mkdir('/tmp/test-storage/temp', { recursive: true });
  await fs.mkdir('/tmp/test-storage/templates/bid', { recursive: true });

  // Now load the app (it will use the test env vars)
  app = require('../../src/app');

  return { app, db };
}

async function teardownSuite() {
  await teardownTestDb();

  // Clean up storage
  const fs = require('fs').promises;
  await fs.rm('/tmp/test-storage', { recursive: true, force: true }).catch(() => {});
}

function getApp() {
  return app;
}

module.exports = {
  setupSuite,
  teardownSuite,
  resetAndSeed,
  getApp,
  getDb,
  getIds,
};
