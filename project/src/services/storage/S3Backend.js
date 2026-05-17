/**
 * S3Backend — stub implementation.
 *
 * The S3 wiring was planned in the original design (see PROJECT_REFERENCE
 * §15) but the implementation was never finished. This file exists so
 * StorageService can require('./storage/S3Backend') without crashing on
 * module-not-found when STORAGE_TYPE=s3 is set in the environment.
 *
 * Each method throws a clear error on use rather than silently failing, so
 * if someone enables S3 mode they get an actionable message instead of a
 * mysterious null. To complete this backend, swap the throws with calls
 * into @aws-sdk/client-s3 (already in package.json) using S3_BUCKET,
 * S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY env vars.
 */

const NOT_IMPLEMENTED = 'S3Backend is not yet implemented. Set STORAGE_TYPE=local (the default) or implement the S3 methods in src/services/storage/S3Backend.js using @aws-sdk/client-s3.';

function notImpl() { throw new Error(NOT_IMPLEMENTED); }

module.exports = {
  async putFile() { notImpl(); },
  async putBuffer() { notImpl(); },
  async getFile() { notImpl(); },
  async getDownloadUrl() { notImpl(); },
  async getUploadUrl() { notImpl(); },
  async exists() { notImpl(); },
  async deleteFile() { notImpl(); },
  async copyFile() { notImpl(); },
  async listFiles() { notImpl(); },
  async ensureDir() { /* no-op on S3 — directories are virtual */ },
  async deleteDir() { notImpl(); },
};
