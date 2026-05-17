/**
 * LocalBackend — file storage backed by the local filesystem.
 *
 * Operates against process.env.STORAGE_BASE_PATH (default ./storage).
 * Used when STORAGE_TYPE=local (the default); StorageService selects
 * S3Backend instead when STORAGE_TYPE=s3.
 *
 * Key model: a "key" is a relative path beneath the base directory,
 * forward-slash-separated (e.g. "projects/2026/MT/Acme/MT26-001/invoices/inv-1.pdf").
 * Keys are normalized and any ../ traversal that escapes the base directory
 * is rejected — the firm's data must never leak out of STORAGE_BASE_PATH.
 *
 * All operations are async and return Promises (matches the S3Backend API
 * surface so StorageService can swap backends without changing call sites).
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function getBasePath() {
  // Re-read on every call so tests that override the env var work.
  // Note: StorageService caches the backend module itself, but the basePath
  // is computed lazily here.
  return path.resolve(process.env.STORAGE_BASE_PATH || './storage');
}

/**
 * Resolve a logical key to an absolute filesystem path while guaranteeing
 * the resolved path stays within the base directory. Throws on traversal
 * attempts (../../etc/passwd, absolute paths, drive-letter prefixes, etc.).
 */
function keyToPath(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('Storage key must be a non-empty string');
  }
  // Strip leading slashes so the key is always relative
  const cleaned = key.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  const base = getBasePath();
  const full = path.resolve(base, cleaned);
  // Confirm the resolved path is still inside the base directory
  const rel = path.relative(base, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Storage key escapes base directory: ${key}`);
  }
  return full;
}

/**
 * Convert an absolute filesystem path back to a storage key. Returns null
 * if the path is outside the base directory. Used by code that has a
 * legacy absolute path and needs to render it via getDownloadUrl.
 */
function pathToKey(fullPath) {
  if (!fullPath) return null;
  const base = getBasePath();
  const resolved = path.resolve(fullPath);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

async function ensureParentDir(absPath) {
  await fsp.mkdir(path.dirname(absPath), { recursive: true });
}

const LocalBackend = {
  /**
   * Move/copy a local file (e.g. multer's temp file) into storage at `key`.
   * Tries rename first (atomic, fast); falls back to read+write for
   * cross-device moves (which happen when /tmp is on a different mount
   * than the storage volume — common in Docker).
   */
  async putFile(key, localPath, _metadata = {}) {
    const dest = keyToPath(key);
    await ensureParentDir(dest);
    try {
      await fsp.rename(localPath, dest);
    } catch (err) {
      if (err.code === 'EXDEV') {
        // Cross-device — copy then unlink
        await fsp.copyFile(localPath, dest);
        try { await fsp.unlink(localPath); } catch {}
      } else {
        throw err;
      }
    }
    const stat = await fsp.stat(dest);
    return { key, size: stat.size };
  },

  async putBuffer(key, buffer, _metadata = {}) {
    const dest = keyToPath(key);
    await ensureParentDir(dest);
    await fsp.writeFile(dest, buffer);
    const stat = await fsp.stat(dest);
    return { key, size: stat.size };
  },

  async getFile(key) {
    return fsp.readFile(keyToPath(key));
  },

  /**
   * For local storage there's no presigned URL — return a server-relative
   * download path that the API can stream from. Routes that need to send
   * the file should use res.download() with the absolute path (via
   * getFullPath) instead of relying on this URL.
   */
  async getDownloadUrl(key, _expiresIn = 3600) {
    return `/api/files/download?key=${encodeURIComponent(key)}`;
  },

  /**
   * For local storage there's no presigned upload — return the API endpoint
   * the frontend should POST to. (The frontend currently doesn't use this
   * for local uploads; multer handles the upload directly. This is here
   * for API parity with S3Backend.)
   */
  async getUploadUrl(_key, _contentType = 'application/octet-stream', _expiresIn = 900) {
    return {
      url: '/api/files/upload',
      method: 'POST',
      headers: {},
    };
  },

  async exists(key) {
    try {
      await fsp.access(keyToPath(key), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  },

  async deleteFile(key) {
    try {
      await fsp.unlink(keyToPath(key));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  },

  async copyFile(sourceKey, destKey) {
    const src = keyToPath(sourceKey);
    const dest = keyToPath(destKey);
    await ensureParentDir(dest);
    await fsp.copyFile(src, dest);
  },

  /**
   * List files directly inside `prefix` (one level deep — does NOT recurse).
   * Returns [{key, name, size, lastModified}]. Returns empty array if the
   * directory doesn't exist (rather than throwing) so callers don't have
   * to check ahead of time.
   */
  async listFiles(prefix) {
    const dir = keyToPath(prefix || '');
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const results = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(dir, entry.name);
      let stat;
      try { stat = await fsp.stat(fullPath); } catch { continue; }
      const cleanedPrefix = (prefix || '').replace(/[\\/]+$/, '');
      const key = cleanedPrefix ? `${cleanedPrefix}/${entry.name}` : entry.name;
      results.push({
        key,
        name: entry.name,
        size: stat.size,
        lastModified: stat.mtime,
      });
    }
    return results;
  },

  async ensureDir(prefix) {
    await fsp.mkdir(keyToPath(prefix), { recursive: true });
  },

  /**
   * Recursively delete a directory and everything under it. ENOENT is
   * swallowed (idempotent — deleting something that's already gone is fine).
   */
  async deleteDir(prefix) {
    try {
      await fsp.rm(keyToPath(prefix), { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  },

  /**
   * Convert a key to its absolute filesystem path. Used by routes that
   * need to res.download() a stored file. Always resolves through the
   * traversal-safe keyToPath, so passing an attacker-controlled key here
   * remains safe.
   */
  async getFullPath(key) {
    return keyToPath(key);
  },

  /**
   * Inverse of getFullPath — convert an absolute path back to a key.
   * Returns null if the path is outside STORAGE_BASE_PATH.
   */
  async getKeyFromPath(fullPath) {
    return pathToKey(fullPath);
  },

  /**
   * Return the absolute base storage path. Used by routes that need to
   * resolve a stored absolute path against the base for traversal-safety
   * checks (see src/routes/files.js download endpoint).
   *
   * Async to match how callers use it (most await it). Synchronous return
   * is also acceptable since await on a non-Promise resolves immediately.
   */
  async getBase() {
    return getBasePath();
  },

  /**
   * Return the absolute path for a top-level category folder (bids,
   * projects, templates, equipment_docs, inbox, etc.). Used by the admin
   * storage-stats endpoint to scan disk usage per category.
   *
   * Goes through the traversal-safe key resolver, so passing an
   * unsanitized category name remains safe.
   */
  async getCategoryPath(category) {
    return keyToPath(category);
  },

  /**
   * No-op on the local backend — we don't cache anything across requests.
   * Exposed so callers (admin.js storage clear) can invoke it
   * unconditionally without checking the backend type.
   */
  clearCache() {
    /* no-op */
  },

  // Exposed for tests
  _keyToPath: keyToPath,
  _pathToKey: pathToKey,
  _getBasePath: getBasePath,
};

module.exports = LocalBackend;
