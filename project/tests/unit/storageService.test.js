// LocalBackend tests — exercise the on-disk storage backend against a
// scratch directory in /tmp. The test creates and tears down the scratch
// dir per suite so it doesn't pollute the project storage.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

describe('LocalBackend', () => {
  const scratch = path.join(os.tmpdir(), 'constructpm-storage-test-' + Date.now());
  let LocalBackend;
  let originalBasePath;

  beforeAll(async () => {
    originalBasePath = process.env.STORAGE_BASE_PATH;
    process.env.STORAGE_BASE_PATH = scratch;
    await fsp.mkdir(scratch, { recursive: true });
    // Require AFTER setting env so the module reads the right base path
    LocalBackend = require('../../src/services/storage/LocalBackend');
  });

  afterAll(async () => {
    if (originalBasePath === undefined) delete process.env.STORAGE_BASE_PATH;
    else process.env.STORAGE_BASE_PATH = originalBasePath;
    try { await fsp.rm(scratch, { recursive: true, force: true }); } catch {}
  });

  describe('putBuffer / getFile', () => {
    it('writes a buffer and reads it back', async () => {
      const result = await LocalBackend.putBuffer('test/hello.txt', Buffer.from('hello world'));
      expect(result.key).toBe('test/hello.txt');
      expect(result.size).toBe(11);

      const back = await LocalBackend.getFile('test/hello.txt');
      expect(back.toString('utf8')).toBe('hello world');
    });

    it('creates parent directories automatically', async () => {
      await LocalBackend.putBuffer('a/b/c/d/deep.txt', Buffer.from('deep'));
      expect(fs.existsSync(path.join(scratch, 'a/b/c/d/deep.txt'))).toBe(true);
    });
  });

  describe('putFile (move from temp)', () => {
    it('moves a temp file into storage', async () => {
      const tmp = path.join(scratch, '.tmp-source.txt');
      await fsp.writeFile(tmp, 'moved content');
      const result = await LocalBackend.putFile('moved/dest.txt', tmp);
      expect(result.key).toBe('moved/dest.txt');
      expect(fs.existsSync(tmp)).toBe(false);
      expect(fs.existsSync(path.join(scratch, 'moved/dest.txt'))).toBe(true);
    });
  });

  describe('exists / deleteFile', () => {
    it('reports existence correctly', async () => {
      await LocalBackend.putBuffer('exists/file.txt', Buffer.from('x'));
      expect(await LocalBackend.exists('exists/file.txt')).toBe(true);
      expect(await LocalBackend.exists('exists/missing.txt')).toBe(false);
    });

    it('deletes a file (and is idempotent)', async () => {
      await LocalBackend.putBuffer('to-delete/f.txt', Buffer.from('x'));
      await LocalBackend.deleteFile('to-delete/f.txt');
      expect(await LocalBackend.exists('to-delete/f.txt')).toBe(false);
      await expect(LocalBackend.deleteFile('to-delete/f.txt')).resolves.toBeUndefined();
    });
  });

  describe('copyFile', () => {
    it('copies a file and leaves the source intact', async () => {
      await LocalBackend.putBuffer('copy/src.txt', Buffer.from('original'));
      await LocalBackend.copyFile('copy/src.txt', 'copy/dest.txt');
      expect(await LocalBackend.exists('copy/src.txt')).toBe(true);
      expect((await LocalBackend.getFile('copy/dest.txt')).toString('utf8')).toBe('original');
    });
  });

  describe('listFiles', () => {
    it('lists files in a prefix (non-recursive)', async () => {
      await LocalBackend.putBuffer('list-test/a.txt', Buffer.from('a'));
      await LocalBackend.putBuffer('list-test/b.txt', Buffer.from('bb'));
      await LocalBackend.putBuffer('list-test/sub/c.txt', Buffer.from('ccc'));
      const files = await LocalBackend.listFiles('list-test');
      const names = files.map(f => f.name).sort();
      expect(names).toEqual(['a.txt', 'b.txt']); // 'sub' is a directory, excluded
      expect(files.find(f => f.name === 'a.txt').size).toBe(1);
      expect(files.find(f => f.name === 'b.txt').size).toBe(2);
    });

    it('returns empty array for a missing directory', async () => {
      const files = await LocalBackend.listFiles('does-not-exist');
      expect(files).toEqual([]);
    });
  });

  describe('ensureDir / deleteDir', () => {
    it('creates and removes a directory recursively', async () => {
      await LocalBackend.ensureDir('dirs/x/y/z');
      expect(fs.existsSync(path.join(scratch, 'dirs/x/y/z'))).toBe(true);
      await LocalBackend.putBuffer('dirs/x/y/z/file.txt', Buffer.from('content'));
      await LocalBackend.deleteDir('dirs/x');
      expect(fs.existsSync(path.join(scratch, 'dirs/x'))).toBe(false);
    });
  });

  describe('path traversal safety', () => {
    it('rejects keys that escape the base directory via ../', async () => {
      await expect(LocalBackend.putBuffer('../../etc/passwd', Buffer.from('x'))).rejects.toThrow(/escapes base directory/);
    });

    it('strips leading slashes from keys', async () => {
      await LocalBackend.putBuffer('/leading/slash.txt', Buffer.from('ok'));
      expect(fs.existsSync(path.join(scratch, 'leading/slash.txt'))).toBe(true);
    });

    it('rejects empty / non-string keys', async () => {
      await expect(LocalBackend.putBuffer('', Buffer.from('x'))).rejects.toThrow();
      await expect(LocalBackend.putBuffer(null, Buffer.from('x'))).rejects.toThrow();
    });
  });

  describe('getFullPath / getKeyFromPath', () => {
    it('round-trips key → absolute path → key', async () => {
      const full = await LocalBackend.getFullPath('round/trip.txt');
      expect(full).toBe(path.join(scratch, 'round/trip.txt'));
      const back = await LocalBackend.getKeyFromPath(full);
      expect(back).toBe('round/trip.txt');
    });

    it('returns null for paths outside the base directory', async () => {
      expect(await LocalBackend.getKeyFromPath('/etc/passwd')).toBeNull();
    });
  });

  describe('legacy compat methods (getBase / getCategoryPath / clearCache)', () => {
    // These are needed by src/routes/files.js (download path resolution)
    // and src/routes/admin.js (storage stats + cache clear). Without them
    // those routes crash with "X is not a function".
    it('getBase returns the absolute base directory', async () => {
      expect(await LocalBackend.getBase()).toBe(scratch);
    });

    it('getCategoryPath joins the base with a category name', async () => {
      expect(await LocalBackend.getCategoryPath('bids')).toBe(path.join(scratch, 'bids'));
      expect(await LocalBackend.getCategoryPath('projects')).toBe(path.join(scratch, 'projects'));
    });

    it('clearCache is callable and returns nothing', () => {
      expect(LocalBackend.clearCache()).toBeUndefined();
    });

    it('getCategoryPath rejects path traversal in category names', async () => {
      await expect(LocalBackend.getCategoryPath('../escape')).rejects.toThrow(/escapes/);
    });
  });
});
