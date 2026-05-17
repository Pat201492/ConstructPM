const path = require('path');

/**
 * Storage Service
 * 
 * Unified interface for file storage operations.
 * Automatically selects S3 or local backend based on STORAGE_TYPE env var.
 * 
 * Usage:
 *   const storage = require('./StorageService');
 *   await storage.putFile('bids/user1/bid1/estimate.xlsx', buffer);
 *   const url = await storage.getDownloadUrl('bids/user1/bid1/estimate.xlsx');
 *   const files = await storage.listFiles('projects/2026/pm/customer/project/invoices/');
 */

let backend = null;

function getBackend() {
  if (backend) return backend;

  const type = process.env.STORAGE_TYPE || 'local';

  if (type === 's3') {
    const S3Backend = require('./storage/S3Backend');
    backend = S3Backend;
    console.log(`[Storage] Using S3 backend (bucket: ${process.env.S3_BUCKET})`);
  } else {
    const LocalBackend = require('./storage/LocalBackend');
    backend = LocalBackend;
    console.log(`[Storage] Using local backend (${process.env.STORAGE_BASE_PATH || './storage'})`);
  }

  return backend;
}

const StorageService = {
  /**
   * Store a file from a local path to storage.
   * @param {string} key - Storage key (relative path, e.g. 'bids/user1/bid1/file.pdf')
   * @param {string} localPath - Absolute path to the local file to upload
   * @param {object} metadata - Optional metadata (mimetype, size, etc.)
   * @returns {object} { key, size, etag? }
   */
  async putFile(key, localPath, metadata = {}) {
    return getBackend().putFile(key, localPath, metadata);
  },

  /**
   * Store a buffer directly.
   * @param {string} key - Storage key
   * @param {Buffer} buffer - File contents
   * @param {object} metadata - Optional metadata
   */
  async putBuffer(key, buffer, metadata = {}) {
    return getBackend().putBuffer(key, buffer, metadata);
  },

  /**
   * Get a file's contents as a Buffer.
   * @param {string} key - Storage key
   * @returns {Buffer}
   */
  async getFile(key) {
    return getBackend().getFile(key);
  },

  /**
   * Get a download URL for a file.
   * For S3: returns a presigned URL (valid for specified seconds).
   * For local: returns a server-relative path.
   * 
   * @param {string} key - Storage key
   * @param {number} expiresIn - Seconds until URL expires (S3 only, default 3600)
   * @returns {string} URL
   */
  async getDownloadUrl(key, expiresIn = 3600) {
    return getBackend().getDownloadUrl(key, expiresIn);
  },

  /**
   * Get a presigned upload URL (S3 only).
   * For local: returns the API upload endpoint.
   * 
   * @param {string} key - Storage key where the file should land
   * @param {string} contentType - MIME type
   * @param {number} expiresIn - Seconds until URL expires (default 900)
   * @returns {object} { url, method, headers?, fields? }
   */
  async getUploadUrl(key, contentType = 'application/octet-stream', expiresIn = 900) {
    return getBackend().getUploadUrl(key, contentType, expiresIn);
  },

  /**
   * Check if a file exists.
   * @param {string} key - Storage key
   * @returns {boolean}
   */
  async exists(key) {
    return getBackend().exists(key);
  },

  /**
   * Delete a file.
   * @param {string} key - Storage key
   */
  async deleteFile(key) {
    return getBackend().deleteFile(key);
  },

  /**
   * Copy a file within storage.
   * @param {string} sourceKey - Source key
   * @param {string} destKey - Destination key
   */
  async copyFile(sourceKey, destKey) {
    return getBackend().copyFile(sourceKey, destKey);
  },

  /**
   * List files under a prefix (directory).
   * @param {string} prefix - Key prefix (e.g. 'projects/2026/pm/customer/project/invoices/')
   * @returns {Array<{key, name, size, lastModified}>}
   */
  async listFiles(prefix) {
    return getBackend().listFiles(prefix);
  },

  /**
   * Create a "directory" (for local storage; no-op on S3).
   * @param {string} prefix - Directory path
   */
  async ensureDir(prefix) {
    return getBackend().ensureDir(prefix);
  },

  /**
   * Delete a directory and all contents.
   * @param {string} prefix - Directory path / key prefix
   */
  async deleteDir(prefix) {
    return getBackend().deleteDir(prefix);
  },

  /**
   * Get the storage type currently in use.
   * @returns {'s3'|'local'}
   */
  getType() {
    return (process.env.STORAGE_TYPE || 'local');
  },

  /**
   * Convert a storage key to the full path/URL for the active backend.
   * Useful for storing references in the database.
   */
  async getFullPath(key) {
    const b = getBackend();
    return typeof b.getFullPath === 'function' ? await b.getFullPath(key) : key;
  },

  async getKeyFromPath(fullPath) {
    const b = getBackend();
    return typeof b.getKeyFromPath === 'function' ? await b.getKeyFromPath(fullPath) : fullPath;
  },

  /**
   * Reset the backend (for testing).
   */
  _resetBackend() {
    backend = null;
  },
};

module.exports = StorageService;
