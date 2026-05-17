const db = require('../config/database');

/**
 * Vendor Learning Service
 * 
 * Learns from confirmed extractions to improve future accuracy.
 * When a user confirms or corrects an extraction, this service:
 *   1. Records the vendor's typical document format
 *   2. Tracks which fields commonly need correction
 *   3. Generates vendor-specific hints for the AI prompt
 * 
 * Over time, the system builds a "vendor profile" that helps the AI
 * know where to look for invoice numbers, how dates are formatted, etc.
 */

const VendorLearning = {
  /**
   * Record a confirmed extraction for learning.
   * Called after a user confirms (or corrects) an extraction.
   * 
   * @param {object} extraction - The pending_extractions record
   * @param {object} confirmedData - What the user approved
   * @param {object} originalData - What the AI originally extracted
   */
  async recordConfirmation(extraction, confirmedData, originalData) {
    const vendorName = this._normalizeVendor(
      confirmedData.vendor || confirmedData.parties || originalData.vendor || originalData.parties
    );

    if (!vendorName) return; // Can't learn without a vendor name

    try {
      // Check if we have an existing profile for this vendor + doc type
      const existing = await db('vendor_profiles')
        .where({ vendor_name: vendorName, doc_type: extraction.doc_type })
        .first();

      // Calculate which fields were corrected
      const corrections = this._findCorrections(originalData, confirmedData);

      if (existing) {
        // Update existing profile
        const profile = typeof existing.profile_data === 'string'
          ? JSON.parse(existing.profile_data)
          : existing.profile_data;

        profile.confirmation_count = (profile.confirmation_count || 0) + 1;
        profile.last_confirmed_at = new Date().toISOString();

        // Track correction patterns
        if (!profile.correction_history) profile.correction_history = {};
        for (const corr of corrections) {
          if (!profile.correction_history[corr.field]) {
            profile.correction_history[corr.field] = { count: 0, examples: [] };
          }
          profile.correction_history[corr.field].count++;
          // Keep last 5 examples
          profile.correction_history[corr.field].examples =
            [{ from: corr.original, to: corr.corrected }, ...profile.correction_history[corr.field].examples].slice(0, 5);
        }

        // Update format hints based on confirmed data
        profile.format_hints = this._buildFormatHints(profile.format_hints || {}, confirmedData, extraction.doc_type);

        await db('vendor_profiles')
          .where({ id: existing.id })
          .update({
            profile_data: JSON.stringify(profile),
            updated_at: db.fn.now(),
          });

      } else {
        // Create new vendor profile
        const profile = {
          confirmation_count: 1,
          last_confirmed_at: new Date().toISOString(),
          correction_history: {},
          format_hints: this._buildFormatHints({}, confirmedData, extraction.doc_type),
        };

        for (const corr of corrections) {
          profile.correction_history[corr.field] = {
            count: 1,
            examples: [{ from: corr.original, to: corr.corrected }],
          };
        }

        await db('vendor_profiles').insert({
          vendor_name: vendorName,
          doc_type: extraction.doc_type,
          profile_data: JSON.stringify(profile),
        });
      }

      console.log(`[VendorLearning] Recorded ${corrections.length} correction(s) for vendor "${vendorName}" (${extraction.doc_type})`);
    } catch (err) {
      // Learning failures should never block the confirmation
      console.error('[VendorLearning] Error recording confirmation:', err.message);
    }
  },

  /**
   * Get vendor-specific hints to include in the extraction prompt.
   * Returns additional context that helps the AI extract more accurately.
   */
  async getVendorHints(vendorName, docType) {
    if (!vendorName) return null;

    const normalized = this._normalizeVendor(vendorName);

    try {
      const profile = await db('vendor_profiles')
        .where({ vendor_name: normalized, doc_type: docType })
        .first();

      if (!profile) return null;

      const data = typeof profile.profile_data === 'string'
        ? JSON.parse(profile.profile_data)
        : profile.profile_data;

      if (data.confirmation_count < 2) return null; // Need at least 2 confirmations

      return this._generatePromptHints(data, docType);
    } catch {
      return null;
    }
  },

  /**
   * Search for matching vendor profiles from raw document text.
   * Scans the text for known vendor names.
   */
  async findMatchingVendor(rawText, docType) {
    try {
      const vendors = await db('vendor_profiles')
        .where({ doc_type: docType })
        .select('vendor_name', 'profile_data');

      const textLower = rawText.toLowerCase();

      for (const v of vendors) {
        if (textLower.includes(v.vendor_name.toLowerCase())) {
          const data = typeof v.profile_data === 'string' ? JSON.parse(v.profile_data) : v.profile_data;
          if (data.confirmation_count >= 2) {
            return { name: v.vendor_name, hints: this._generatePromptHints(data, docType) };
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  },

  /**
   * Get extraction accuracy stats for a vendor
   */
  async getVendorStats(vendorName) {
    const normalized = this._normalizeVendor(vendorName);

    const profiles = await db('vendor_profiles')
      .where({ vendor_name: normalized })
      .select('*');

    return profiles.map(p => {
      const data = typeof p.profile_data === 'string' ? JSON.parse(p.profile_data) : p.profile_data;
      const correctionCount = Object.values(data.correction_history || {})
        .reduce((sum, c) => sum + c.count, 0);

      return {
        doc_type: p.doc_type,
        confirmations: data.confirmation_count || 0,
        total_corrections: correctionCount,
        accuracy_rate: data.confirmation_count > 0
          ? Math.round(((data.confirmation_count - correctionCount) / data.confirmation_count) * 100)
          : 0,
        commonly_corrected_fields: Object.entries(data.correction_history || {})
          .sort((a, b) => b[1].count - a[1].count)
          .map(([field, c]) => ({ field, corrections: c.count })),
      };
    });
  },

  // ── PRIVATE HELPERS ─────────────────────────────────────────

  _normalizeVendor(name) {
    if (!name) return null;
    return name
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/,?\s*(inc|llc|ltd|co|corp|company|incorporated|limited)\.?$/i, '')
      .trim();
  },

  _findCorrections(original, confirmed) {
    const corrections = [];
    for (const [key, confirmedVal] of Object.entries(confirmed)) {
      if (Array.isArray(confirmedVal)) continue; // Skip arrays (line_items, etc.)
      const origVal = original[key];
      if (origVal !== undefined && origVal !== null && String(origVal) !== String(confirmedVal)) {
        corrections.push({ field: key, original: origVal, corrected: confirmedVal });
      }
    }
    return corrections;
  },

  _buildFormatHints(existing, confirmedData, docType) {
    const hints = { ...existing };

    // Learn date formats
    if (confirmedData.invoice_date) hints.date_format_example = confirmedData.invoice_date;
    if (confirmedData.order_date) hints.date_format_example = confirmedData.order_date;

    // Learn number formats
    if (confirmedData.invoice_number) hints.number_format_example = confirmedData.invoice_number;
    if (confirmedData.po_number) hints.number_format_example = confirmedData.po_number;
    if (confirmedData.contract_number) hints.number_format_example = confirmedData.contract_number;

    return hints;
  },

  _generatePromptHints(profileData, docType) {
    const hints = [];
    const fh = profileData.format_hints || {};

    if (fh.number_format_example) {
      const label = docType === 'invoice' ? 'invoice' : docType === 'purchase_order' ? 'PO' : 'document';
      hints.push(`This vendor's ${label} numbers typically look like: "${fh.number_format_example}"`);
    }

    if (fh.date_format_example) {
      hints.push(`Dates from this vendor are typically formatted like: "${fh.date_format_example}"`);
    }

    // Warn about commonly corrected fields
    const corrections = profileData.correction_history || {};
    const frequentCorrections = Object.entries(corrections)
      .filter(([_, c]) => c.count >= 2)
      .sort((a, b) => b[1].count - a[1].count);

    if (frequentCorrections.length > 0) {
      const fields = frequentCorrections.map(([f]) => f).join(', ');
      hints.push(`Pay extra attention to these fields which are often misread: ${fields}`);
    }

    return hints.length > 0 ? hints.join('\n') : null;
  },
};

module.exports = VendorLearning;
