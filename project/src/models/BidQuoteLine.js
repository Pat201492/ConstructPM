/**
 * Bid Quote Line Model
 * 
 * Each row in the quoting table: classification × personnel × hours × rates.
 * Rates are LOCKED at bid creation (snapshot from rate_sheet).
 * These locked rates carry through to the project for timesheet cost lookups.
 */

const db = require('../config/database');

const BidQuoteLine = {
  async findByBid(bidId) {
    return db('bid_quote_lines')
      .where('bid_id', bidId)
      .orderBy('classification', 'asc');
  },

  /**
   * Create all quote lines for a bid.
   * Locks rates from the rate_sheet at this moment.
   * Calculates totals (personnel × per-person hours).
   */
  async createForBid(bidId, lines) {
    const rows = lines.map(line => ({
      bid_id: bidId,
      classification: line.classification,
      personnel: line.personnel || 1,
      st_hours: line.st_hours || 0,
      ot_hours: line.ot_hours || 0,
      dt_hours: line.dt_hours || 0,
      // Calculated totals
      total_st_hours: (line.personnel || 1) * (line.st_hours || 0),
      total_ot_hours: (line.personnel || 1) * (line.ot_hours || 0),
      total_dt_hours: (line.personnel || 1) * (line.dt_hours || 0),
      // Locked rates (snapshot)
      st_rate: line.st_rate,
      ot_rate: line.ot_rate,
      dt_rate: line.dt_rate,
      // Calculated line cost
      line_total_cost: this._calculateLineCost(line),
    }));

    const inserted = await db('bid_quote_lines').insert(rows).returning('*');
    return inserted;
  },

  /**
   * Replace all quote lines for a bid (used when editing the quoting table).
   */
  async replaceForBid(bidId, lines) {
    await db('bid_quote_lines').where('bid_id', bidId).delete();
    if (!lines || lines.length === 0) return [];
    return this.createForBid(bidId, lines);
  },

  /**
   * Get totals for a bid's quote lines.
   */
  async getTotals(bidId) {
    const lines = await this.findByBid(bidId);
    let totalPersonnel = 0;
    let totalLaborCost = 0;
    let totalManHours = 0;

    for (const line of lines) {
      totalPersonnel += line.personnel;
      totalLaborCost += parseFloat(line.line_total_cost || 0);
      totalManHours += parseFloat(line.total_st_hours || 0)
        + parseFloat(line.total_ot_hours || 0)
        + parseFloat(line.total_dt_hours || 0);
    }

    return {
      lines,
      total_personnel: totalPersonnel,
      total_labor_cost: totalLaborCost,
      total_man_hours: totalManHours,
    };
  },

  _calculateLineCost(line) {
    const personnel = line.personnel || 1;
    const totalST = personnel * (line.st_hours || 0);
    const totalOT = personnel * (line.ot_hours || 0);
    const totalDT = personnel * (line.dt_hours || 0);
    return (totalST * line.st_rate) + (totalOT * line.ot_rate) + (totalDT * line.dt_rate);
  },
};

module.exports = BidQuoteLine;
