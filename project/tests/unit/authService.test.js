// AuthService.generateAccessToken — the JWT minting used by /auth/login,
// /auth/refresh and /auth/dev-login. Pure (no DB), so we verify the claims
// and expiry directly by decoding the signed token.

const jwt = require('jsonwebtoken');

describe('AuthService.generateAccessToken', () => {
  const PREV_SECRET = process.env.JWT_SECRET;
  const PREV_EXP = process.env.JWT_EXPIRES_IN;
  let AuthService;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-for-unit';
    process.env.JWT_EXPIRES_IN = '15m';
    AuthService = require('../../src/services/AuthService');
  });

  afterAll(() => {
    process.env.JWT_SECRET = PREV_SECRET;
    process.env.JWT_EXPIRES_IN = PREV_EXP;
  });

  const user = {
    id: 'u1',
    email: 'a@b.com',
    role: 'admin',
    first_name: 'Ada',
    last_name: 'Lovelace',
  };

  it('carries the expected claims (note: name fields are camelCase in the token)', () => {
    const decoded = jwt.verify(AuthService.generateAccessToken(user), 'test-secret-for-unit');
    expect(decoded.id).toBe('u1');
    expect(decoded.email).toBe('a@b.com');
    expect(decoded.role).toBe('admin');
    expect(decoded.firstName).toBe('Ada');
    expect(decoded.lastName).toBe('Lovelace');
  });

  it('honors JWT_EXPIRES_IN for the access-token lifetime', () => {
    const decoded = jwt.verify(AuthService.generateAccessToken(user), 'test-secret-for-unit');
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });

  it('produces a token that fails verification under a different secret', () => {
    const token = AuthService.generateAccessToken(user);
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });
});
