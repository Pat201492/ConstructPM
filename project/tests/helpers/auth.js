/**
 * Auth Helper for Tests
 * 
 * Logs in as any test user and returns an access token.
 * Caches tokens to avoid redundant login calls within a test suite.
 */

const request = require('supertest');

const tokenCache = {};

/**
 * Get a valid access token for a test user role.
 * @param {object} app - Express app instance
 * @param {string} role - 'admin', 'pm', 'accounting', 'shop', 'field'
 * @returns {string} Bearer token (without "Bearer " prefix)
 */
async function getToken(app, role = 'admin') {
  if (tokenCache[role]) return tokenCache[role];

  const credentials = {
    admin: { email: 'admin@test.com', password: 'TestAdmin123!' },
    pm: { email: 'pm@test.com', password: 'TestPM123!' },
    accounting: { email: 'acct@test.com', password: 'TestAcct123!' },
    shop: { email: 'shop@test.com', password: 'TestShop123!' },
    field: { email: 'field@test.com', password: 'TestField123!' },
  };

  const cred = credentials[role];
  if (!cred) throw new Error(`Unknown test role: ${role}`);

  const res = await request(app)
    .post('/api/auth/login')
    .send(cred);

  if (res.status !== 200) {
    throw new Error(`Login failed for ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  tokenCache[role] = res.body.accessToken;
  return res.body.accessToken;
}

/**
 * Get authorization header for a role
 */
async function authHeader(app, role = 'admin') {
  const token = await getToken(app, role);
  return `Bearer ${token}`;
}

/**
 * Clear token cache (call between test suites if DB is reset)
 */
function clearTokenCache() {
  for (const key of Object.keys(tokenCache)) {
    delete tokenCache[key];
  }
}

module.exports = { getToken, authHeader, clearTokenCache };
