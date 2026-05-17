/**
 * Rate Sheet Model
 * 
 * Global: Local Union × Classification × ST/OT/DT Rates.
 * Rates LOCKED into bid_quote_lines at bid creation.
 * Updates here only affect new bids.
 */

const db = require('../config/database');

const RateSheet = {
  async findAll({ local_union, classification, limit = 500, offset = 0 } = {}) {
    const query = db('rate_sheet')
      .orderBy('local_union', 'asc')
      .orderBy('classification', 'asc')
      .limit(limit).offset(offset);
    if (local_union) query.where('local_union', local_union);
    if (classification) query.where('classification', 'ilike', `%${classification}%`);
    const rates = await query;
    const [{ count }] = await db('rate_sheet').count('* as count');
    return { rates, total: parseInt(count, 10) };
  },

  async findById(id) {
    return db('rate_sheet').where({ id }).first();
  },

  async getByLocal(localUnion) {
    if (!localUnion) return [];
    // Exact match first — fast path, no normalization cost.
    const exact = await db('rate_sheet').where('local_union', localUnion).orderBy('classification', 'asc');
    if (exact.length > 0) return exact;

    // Fallback: tolerant match. Bid records and rate-sheet rows are
    // entered by different people, so "Local 3" / "local 3" / "LOCAL 3"
    // / "3" / "Local-3" all need to find the same rates. Strip every
    // non-digit character and compare on the union number alone, which
    // is the load-bearing part of the identifier. If the query has no
    // digits, fall through to case-insensitive whole-string compare.
    const queryDigits = String(localUnion).replace(/\D+/g, '');
    const queryNormalized = String(localUnion).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    if (queryDigits) {
      // Pull all rows once, filter in JS — rate_sheet is small (tens to
      // low hundreds of rows total), so a full scan is fine and lets us
      // do the digit-strip without a Postgres-specific regex function.
      const all = await db('rate_sheet').orderBy('classification', 'asc');
      return all.filter(r => {
        const rowDigits = String(r.local_union || '').replace(/\D+/g, '');
        return rowDigits === queryDigits;
      });
    }

    // No digits in query string — try whole-string case-insensitive
    if (queryNormalized) {
      const all = await db('rate_sheet').orderBy('classification', 'asc');
      return all.filter(r => {
        const rowNorm = String(r.local_union || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        return rowNorm === queryNormalized;
      });
    }

    return [];
  },

  async create(data) {
    const [rate] = await db('rate_sheet').insert(data).returning('*');
    return rate;
  },

  async update(id, data) {
    const [rate] = await db('rate_sheet').where({ id }).update({ ...data, updated_at: db.fn.now() }).returning('*');
    return rate;
  },

  async delete(id) {
    return db('rate_sheet').where({ id }).delete();
  },

  async bulkUpsert(rows) {
    // Batch upsert using ON CONFLICT (requires unique constraint on local_union + classification)
    const results = await db('rate_sheet')
      .insert(rows)
      .onConflict(['local_union', 'classification'])
      .merge(['st_rate', 'ot_rate', 'dt_rate', 'updated_at'])
      .returning('*');
    return results;
  },
};

module.exports = RateSheet;
