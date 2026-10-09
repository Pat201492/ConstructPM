/**
 * Test Database Helper
 * 
 * Manages a test database lifecycle:
 *   - Runs migrations on setup
 *   - Seeds test data (users, customers)
 *   - Truncates tables between tests
 *   - Destroys connection on teardown
 */

const knex = require('knex');
const bcrypt = require('bcryptjs');

const TEST_DB_CONFIG = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.TEST_DB_NAME || 'construct_mgr_test',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  migrations: { directory: './migrations' },
  pool: { min: 1, max: 5 },
};

let db;

// Test user credentials
const TEST_USERS = {
  admin: {
    email: 'admin@test.com',
    password: 'TestAdmin123!',
    first_name: 'Test',
    last_name: 'Admin',
    role: 'admin',
  },
  pm: {
    email: 'pm@test.com',
    password: 'TestPM123!',
    first_name: 'Test',
    last_name: 'PM',
    role: 'project_manager',
  },
  accounting: {
    email: 'acct@test.com',
    password: 'TestAcct123!',
    first_name: 'Test',
    last_name: 'Accounting',
    role: 'accounting',
  },
  shop: {
    email: 'shop@test.com',
    password: 'TestShop123!',
    first_name: 'Test',
    last_name: 'ShopMgr',
    role: 'shop_staff',
  },
  field: {
    email: 'field@test.com',
    password: 'TestField123!',
    first_name: 'Test',
    last_name: 'FieldStaff',
    role: 'field_staff',
  },
};

const TEST_CUSTOMER = {
  name: 'Test Customer Inc',
  billing_street: '123 Test St',
  billing_town: 'Testville',
  billing_state: 'NJ',
  billing_zip: '07001',
  active: true,
};

// Stored IDs after seeding
const ids = { users: {}, customer: null };

async function setupTestDb() {
  db = knex(TEST_DB_CONFIG);

  // Run migrations
  await db.migrate.latest();

  // Seed test users
  const passwordHash = await bcrypt.hash('TestAdmin123!', 4); // Low rounds for speed

  for (const [key, userData] of Object.entries(TEST_USERS)) {
    const hash = await bcrypt.hash(userData.password, 4);
    const [user] = await db('users')
      .insert({
        email: userData.email,
        password_hash: hash,
        first_name: userData.first_name,
        last_name: userData.last_name,
        role: userData.role,
        active: true,
        notification_preferences: JSON.stringify({ in_app: true, email: true, push: true }),
      })
      .onConflict('email')
      .merge()
      .returning('*');

    ids.users[key] = user.id;
  }

  // Seed test customer
  const [customer] = await db('customers')
    .insert(TEST_CUSTOMER)
    .returning('*');

  ids.customer = customer.id;

  return db;
}

async function teardownTestDb() {
  if (db) {
    // Drop all data but keep schema
    await truncateAll();
    await db.destroy();
    db = null;
  }
}

async function truncateAll() {
  if (!db) return;

  const tables = [
    'file_activity_log', 'pending_extractions', 'notifications',
    'inventory_allocations', 'inventory', 'contracts', 'purchase_orders',
    'timesheets', 'invoices', 'project_assignments', 'projects',
    'bids', 'customers', 'refresh_tokens', 'users',
  ];

  // Disable FK checks, truncate, re-enable
  await db.raw('SET session_replication_role = replica');
  for (const t of tables) {
    await db.raw(`TRUNCATE TABLE "${t}" CASCADE`);
  }
  await db.raw('SET session_replication_role = DEFAULT');
}

async function resetAndSeed() {
  await truncateAll();

  // Re-seed users and customer
  for (const [key, userData] of Object.entries(TEST_USERS)) {
    const hash = await bcrypt.hash(userData.password, 4);
    const [user] = await db('users')
      .insert({
        email: userData.email,
        password_hash: hash,
        first_name: userData.first_name,
        last_name: userData.last_name,
        role: userData.role,
        active: true,
        notification_preferences: JSON.stringify({ in_app: true, email: true, push: true }),
      })
      .returning('*');

    ids.users[key] = user.id;
  }

  const [customer] = await db('customers')
    .insert(TEST_CUSTOMER)
    .returning('*');

  ids.customer = customer.id;
}

function getDb() {
  return db;
}

function getIds() {
  return ids;
}

function getTestUsers() {
  return TEST_USERS;
}

module.exports = {
  setupTestDb,
  teardownTestDb,
  truncateAll,
  resetAndSeed,
  getDb,
  getIds,
  getTestUsers,
  TEST_USERS,
  TEST_CUSTOMER,
};
