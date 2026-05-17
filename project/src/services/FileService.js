/**
 * File Service
 * 
 * Manages folder creation and file storage for the entire system.
 * All operations go through StorageService (supports local + S3).
 * 
 * Folder structure on disk (relative to STORAGE_BASE_PATH, default ./storage):
 * 
 *   storage/
 *   ├── bids/
 *   │   └── {pm_id}/
 *   │       └── {PMInitials}{SeqNum}_{Location}_{Scope}/
 *   │           ├── Bid_26-MT-001.xlsx      (generated)
 *   │           └── Bid_26-MT-001.docx      (generated)
 *   │
 *   ├── projects/
 *   │   └── {year}/
 *   │       └── {PM_Name}/
 *   │           └── {Customer}/
 *   │               └── {Project_Name}/
 *   │                   ├── invoices/        (filed from inbox after confirmation)
 *   │                   ├── timesheets/      (filed from inbox after confirmation)
 *   │                   ├── purchase_orders/ (filed from inbox after confirmation)
 *   │                   └── Contract/        (direct upload, per-project monitoring)
 *   │
 *   ├── inbox/
 *   │   ├── timesheets/       (temporary, moved after confirmation)
 *   │   ├── invoices/         (temporary, moved after confirmation)
 *   │   └── purchase_orders/  (temporary, moved after confirmation)
 *   │
 *   ├── templates/
 *   │   └── bid/
 *   │       └── {pm_id}_timestamp.docx
 *   │
 *   └── equipment_docs/
 *       └── {equipment_id}/
 *           └── timestamp_filename.ext
 */

const path = require('path');
const storage = require('./StorageService');

function sanitizeFolderName(str) {
  if (!str) return '';
  return str
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/\s+/g, '_')
    .trim()
    .substring(0, 100);
}

/**
 * Truncate scope to first 10 chars but extend to end of word if mid-cut.
 */
function truncateScope(scope) {
  if (!scope || scope.length <= 10) return sanitizeFolderName(scope);
  const sub = scope.substring(0, 10);
  // If we're mid-word, extend to end of word
  if (scope[10] && scope[10] !== ' ') {
    const nextSpace = scope.indexOf(' ', 10);
    const extended = nextSpace > 0 ? scope.substring(0, nextSpace) : scope;
    return sanitizeFolderName(extended);
  }
  return sanitizeFolderName(sub);
}

const FileService = {
  sanitizeFolderName,

  // ── BID FOLDERS ───────────────────────────────────────────

  /**
   * Create bid folder with naming: {PMInitials}{SeqNum}_{Location}_{Scope}
   * Example: MT001_Newark_NJ_Office_Renovation
   */
  async createBidFolders(pmInitials, seqNum, location, scope) {
    const folderName = `${pmInitials}${String(seqNum).padStart(3,'0')}_${sanitizeFolderName(location)}_${truncateScope(scope)}`;
    const bidPrefix = `bids/${folderName}`;
    await storage.ensureDir(bidPrefix);
    return await storage.getFullPath(bidPrefix);
  },

  // ── PROJECT FOLDERS ───────────────────────────────────────

  /**
   * Create project folder structure:
   *   projects/{year}/{PM_Name}/{Customer}/{Project}/
   *     ├── invoices/
   *     ├── timesheets/
   *     ├── purchase_orders/
   *     └── Contract/
   */
  /**
   * Create the per-project folder structure on disk/S3.
   *
   * Path format: projects/<year>/<staff>/<customer>/<projectNumber>/
   *
   * Switched from project NAME to project NUMBER for the leaf folder
   * because:
   *   - Project numbers are short, unique, and sortable (M26-1308.1)
   *   - Project names can be long, contain weird characters, change over time
   *   - Project numbers are what foremen and accounting use to find files
   *
   * Subfolders: invoices, timesheets, purchase_orders, Contract
   * (Contract was previously "Contract_PO" — renamed for clarity since
   * vendor contracts will live here too, not just customer POs.)
   */
  async createProjectFolders(year, staffName, customerName, projectNumber) {
    const projectPrefix = [
      'projects', String(year),
      sanitizeFolderName(staffName),
      sanitizeFolderName(customerName),
      sanitizeFolderName(projectNumber),
    ].join('/');

    const subfolders = ['invoices', 'timesheets', 'purchase_orders', 'Contract'];
    for (const sub of subfolders) {
      await storage.ensureDir(`${projectPrefix}/${sub}`);
    }
    return await storage.getFullPath(projectPrefix);
  },

  // ── INBOX → PROJECT FILING ────────────────────────────────

  async fileToProjectFolder(sourceKey, projectFolderPath, subfolder, fileName) {
    const projectKey = await storage.getKeyFromPath(projectFolderPath);
    const destKey = `${projectKey}/${subfolder}/${fileName}`;
    await storage.copyFile(sourceKey, destKey);
    return destKey;
  },

  async copyBidToProject(bidFolderPath, projectFolderPath) {
    try {
      const bidKey = await storage.getKeyFromPath(bidFolderPath);
      const projectKey = await storage.getKeyFromPath(projectFolderPath);
      const files = await storage.listFiles(bidKey + '/');
      for (const file of files) {
        // Bid documents (Excel quote, Word proposal) live under Contract/
        // because the contract folder is now the catch-all for
        // contract-related artifacts (customer POs, vendor contracts,
        // signed quotes).
        await storage.copyFile(file.key, `${projectKey}/Contract/${file.name}`);
      }
    } catch (err) {
      console.error('[FileService] Error copying bid to project:', err.message);
    }
  },

  // ── STORAGE WRAPPERS ──────────────────────────────────────

  async storeUploadedFile(localTempPath, destKey, metadata = {}) {
    const result = await storage.putFile(destKey, localTempPath, metadata);
    const downloadUrl = await storage.getDownloadUrl(destKey);
    return { key: result.key, size: result.size, downloadUrl };
  },

  async getPresignedUpload(key, contentType, expiresIn = 900) {
    return storage.getUploadUrl(key, contentType, expiresIn);
  },

  async getDownloadUrl(key, expiresIn = 3600) {
    return storage.getDownloadUrl(key, expiresIn);
  },

  async listFiles(prefix) {
    const normalized = prefix.endsWith('/') ? prefix : prefix + '/';
    try {
      return await storage.listFiles(normalized);
    } catch {
      return [];
    }
  },

  async listFilesFromPath(fullPath) {
    const key = await storage.getKeyFromPath(fullPath);
    return this.listFiles(key);
  },

  async exists(key) { return storage.exists(key); },
  async getFileBuffer(key) { return storage.getFile(key); },
  async getKeyFromPath(fullPath) { return storage.getKeyFromPath(fullPath); },
  async getFullPath(key) { return storage.getFullPath(key); },
  getStorageType() { return storage.getType(); },
};

module.exports = FileService;
