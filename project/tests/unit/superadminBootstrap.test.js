// applySuperadminBootstrap — the boot-time grant/revoke sync extracted from
// src/server.js. Exercised against a tiny in-memory knex stub so we can assert
// the resulting is_superadmin state without a live Postgres. The stub supports
// only the exact query chains the function uses.

const { applySuperadminBootstrap, ENV_VAR } = require('../../src/services/superadminBootstrap');

function makeDb(initialUsers) {
  const tables = { users: initialUsers.map((u, i) => ({ id: i + 1, ...u })) };
  let nextId = tables.users.length + 1;

  function builder(tableName) {
    const rows = tables[tableName];
    const predicates = [];
    const qb = {
      where(col, val) {
        if (typeof col === 'object') {
          predicates.push(r => Object.entries(col).every(([k, v]) => r[k] === v));
        } else {
          predicates.push(r => r[col] === val);
        }
        return qb;
      },
      whereRaw(sql, bindings) {
        const [val] = bindings;
        if (/LOWER\(email\)\s*!=\s*\?/.test(sql)) {
          predicates.push(r => r.email.toLowerCase() !== val);
        } else if (/LOWER\(email\)\s*=\s*\?/.test(sql)) {
          predicates.push(r => r.email.toLowerCase() === val);
        } else {
          throw new Error('unsupported whereRaw in stub: ' + sql);
        }
        return qb;
      },
      _match() {
        return rows.filter(r => predicates.every(p => p(r)));
      },
      select(...cols) {
        return Promise.resolve(qb._match().map(r => {
          const o = {};
          cols.forEach(c => { o[c] = r[c]; });
          return o;
        }));
      },
      first() {
        return Promise.resolve(qb._match()[0]);
      },
      update(patch) {
        const matched = qb._match();
        matched.forEach(r => Object.assign(r, patch));
        return Promise.resolve(matched.length);
      },
      insert(data) {
        const arr = Array.isArray(data) ? data : [data];
        arr.forEach(d => rows.push({ id: nextId++, ...d }));
        return Promise.resolve(arr.map(() => nextId - 1));
      },
    };
    return qb;
  }

  const db = tableName => builder(tableName);
  db.users = () => tables.users;
  return db;
}

describe('applySuperadminBootstrap', () => {
  let warnSpy;
  let logSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('grants an existing user (case-insensitively) and revokes everyone else', async () => {
    const db = makeDb([
      { email: 'pegan604@gmail.com', is_superadmin: false },
      { email: 'old@admin.com', is_superadmin: true },
      { email: 'other@user.com', is_superadmin: false },
    ]);

    const result = await applySuperadminBootstrap(db, 'PEGAN604@Gmail.com');

    const users = db.users();
    expect(users.find(u => u.email === 'pegan604@gmail.com').is_superadmin).toBe(true);
    expect(users.find(u => u.email === 'old@admin.com').is_superadmin).toBe(false);
    expect(users.find(u => u.email === 'other@user.com').is_superadmin).toBe(false);
    expect(result).toMatchObject({ target: 'pegan604@gmail.com', granted: true, created: false });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('creates the user when the configured email is not yet in the DB', async () => {
    const db = makeDb([
      { email: 'old@admin.com', is_superadmin: true },
    ]);

    const result = await applySuperadminBootstrap(db, 'new@admin.com');

    const users = db.users();
    expect(users.find(u => u.email === 'old@admin.com').is_superadmin).toBe(false);
    const created = users.find(u => u.email === 'new@admin.com');
    expect(created).toBeDefined();
    expect(created.is_superadmin).toBe(true);
    expect(created.role).toBe('admin');
    expect(created.password_hash).toEqual(expect.any(String));
    expect(result).toMatchObject({ target: 'new@admin.com', granted: true, created: true });
  });

  it('revokes all grants and warns (naming the env var + count) when unset', async () => {
    const db = makeDb([
      { email: 'a@admin.com', is_superadmin: true },
      { email: 'b@admin.com', is_superadmin: true },
      { email: 'plain@user.com', is_superadmin: false },
    ]);

    const result = await applySuperadminBootstrap(db, '');

    const users = db.users();
    expect(users.every(u => u.is_superadmin === false)).toBe(true);
    expect(result).toMatchObject({ target: null, granted: false, revoked: 2 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0];
    expect(msg).toContain(ENV_VAR);
    expect(msg).toContain('2');
  });

  it('does not warn when unset and there was nothing to revoke', async () => {
    const db = makeDb([
      { email: 'plain@user.com', is_superadmin: false },
    ]);

    const result = await applySuperadminBootstrap(db, undefined);

    expect(result).toMatchObject({ target: null, granted: false, revoked: 0 });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
