/**
 * Bid Model (v2)
 * 
 * Bid lifecycle: draft → submitted → pending → won/lost/archived/cancelled
 * Bid number format: YY-PMInitials-NextNum (per-PM sequence)
 * Quoting data stored in bid_quote_lines (separate table)
 * Rates locked at bid creation from rate_sheet snapshot
 */

const db = require('../config/database');

const Bid = {
  async findAll({ status, estimator_id, assigned_pm_id, visible_to_user_id, customer_id, location_id, search, limit = 50, offset = 0 } = {}) {
    // Subquery: each bid's "Primary" project number (only set once a bid
    // has been won and a project created from it). Left-joined so bids
    // without a project still come back; the column is null for those.
    const primaryNumberSub = db('projects')
      .select('projects.bid_id', 'project_numbers.number as won_project_number')
      .leftJoin('project_numbers', function () {
        this.on('projects.id', 'project_numbers.project_id')
          .andOn(db.raw("project_numbers.label = ?", ['Primary']));
      })
      .as('won_proj');

    const query = db('bids')
      .select(
        'bids.*',
        'customers.name as customer_name',
        'locations.name as location_name',
        'locations.display_address as location_address',
        'locations.local_union as location_local_union',
        'customer_contacts.name as contact_name',
        'won_proj.won_project_number',
        db.raw("users.first_name || ' ' || users.last_name as estimator_name"),
        db.raw("pm.first_name || ' ' || pm.last_name as assigned_pm_name"),
      )
      .leftJoin('customers', 'bids.customer_id', 'customers.id')
      .leftJoin('locations', 'bids.location_id', 'locations.id')
      .leftJoin('customer_contacts', 'bids.customer_contact_id', 'customer_contacts.id')
      .leftJoin('users', 'bids.estimator_id', 'users.id')
      .leftJoin('users as pm', 'bids.assigned_pm_id', 'pm.id')
      .leftJoin(primaryNumberSub, 'bids.id', 'won_proj.bid_id')
      .orderBy('bids.created_at', 'desc');

    if (status) query.where('bids.status', status);
    if (estimator_id) query.where('bids.estimator_id', estimator_id);
    if (assigned_pm_id) query.where('bids.assigned_pm_id', assigned_pm_id);
    if (customer_id) query.where('bids.customer_id', customer_id);
    if (location_id) query.where('bids.location_id', location_id);

    // visible_to_user_id: OR-match — show bids where this user is EITHER the estimator
    // OR the assigned PM. This is how the bid hand-off works: an estimator creates
    // a bid and assigns it to a PM; both should see it in their list.
    if (visible_to_user_id) {
      query.where(function () {
        this.where('bids.estimator_id', visible_to_user_id)
          .orWhere('bids.assigned_pm_id', visible_to_user_id);
      });
    }

    if (search) {
      query.where(function () {
        this.whereILike('bids.bid_number', `%${search}%`)
          .orWhereILike('bids.project_scope', `%${search}%`)
          .orWhereILike('customers.name', `%${search}%`)
          .orWhereILike('locations.name', `%${search}%`);
      });
    }

    const countQuery = db('bids').count('id as total');
    if (status) countQuery.where('status', status);
    if (estimator_id) countQuery.where('estimator_id', estimator_id);
    if (assigned_pm_id) countQuery.where('assigned_pm_id', assigned_pm_id);
    if (visible_to_user_id) {
      countQuery.where(function () {
        this.where('estimator_id', visible_to_user_id)
          .orWhere('assigned_pm_id', visible_to_user_id);
      });
    }

    const [bids, countResult] = await Promise.all([
      query.limit(limit).offset(offset),
      countQuery.first(),
    ]);

    return { bids, total: parseInt(countResult.total, 10) };
  },

  async findById(id) {
    return db('bids')
      .select(
        'bids.*',
        'customers.name as customer_name',
        'customers.billing_display_address as customer_address',
        'locations.name as location_name',
        'locations.display_address as location_address',
        'locations.local_union as location_local_union',
        'locations.miles_from_hq as location_miles',
        'customer_contacts.name as contact_name',
        'customer_contacts.phone as contact_phone',
        'customer_contacts.email as contact_email',
        'customer_contacts.company as contact_company',
        db.raw("users.first_name || ' ' || users.last_name as estimator_name"),
        'users.email as estimator_email',
        'users.initials as estimator_initials',
        db.raw("pm.first_name || ' ' || pm.last_name as assigned_pm_name"),
        'pm.email as assigned_pm_email',
        'pm.initials as assigned_pm_initials',
      )
      .leftJoin('customers', 'bids.customer_id', 'customers.id')
      .leftJoin('locations', 'bids.location_id', 'locations.id')
      .leftJoin('customer_contacts', 'bids.customer_contact_id', 'customer_contacts.id')
      .leftJoin('users', 'bids.estimator_id', 'users.id')
      .leftJoin('users as pm', 'bids.assigned_pm_id', 'pm.id')
      .where('bids.id', id)
      .first();
  },

  async findByNumber(bidNumber) {
    return db('bids').where({ bid_number: bidNumber }).first();
  },

  /**
   * Generate next bid number for a PM: YY-PMInitials-NextNum
   * Per-PM sequence — each PM has their own counter.
   */
  async generateBidNumber(userId) {
    const user = await db('users').where({ id: userId }).first();
    if (!user) throw new Error('User not found');

    const initials = user.initials || (user.first_name[0] + user.last_name[0]).toUpperCase();
    const year = new Date().getFullYear().toString().slice(-2);
    const prefix = `${year}-${initials}-`;

    // Find the highest number for this PM this year
    const lastBid = await db('bids')
      .where('bid_number', 'like', `${prefix}%`)
      .orderByRaw("CAST(SUBSTRING(bid_number FROM '\\d+$') AS INTEGER) DESC")
      .first();

    let nextNum = 1;
    if (lastBid) {
      const match = lastBid.bid_number.match(/(\d+)$/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }

    return `${prefix}${String(nextNum).padStart(3, '0')}`;
  },

  async create(data) {
    const [bid] = await db('bids').insert(data).returning('*');
    return bid;
  },

  async update(id, data) {
    data.updated_at = db.fn.now();
    delete data.id;
    delete data.created_at;
    const [bid] = await db('bids').where({ id }).update(data).returning('*');
    return bid;
  },

  async markWon(id, bidAmount) {
    const [bid] = await db('bids')
      .where({ id })
      .update({
        status: 'won',
        won_date: db.fn.now(),
        bid_amount: bidAmount || null,
        updated_at: db.fn.now(),
      })
      .returning('*');
    return bid;
  },

  async markLost(id) {
    const [bid] = await db('bids').where({ id })
      .update({ status: 'lost', updated_at: db.fn.now() }).returning('*');
    return bid;
  },

  async markArchived(id) {
    const [bid] = await db('bids').where({ id })
      .update({ status: 'archived', archived_date: db.fn.now(), updated_at: db.fn.now() }).returning('*');
    return bid;
  },

  async snooze(id, days) {
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + days);
    const [bid] = await db('bids').where({ id })
      .update({ snooze_until: snoozeUntil, updated_at: db.fn.now() }).returning('*');
    return bid;
  },

  async cancel(id) {
    const [bid] = await db('bids').where({ id })
      .update({ status: 'cancelled', updated_at: db.fn.now() }).returning('*');
    return bid;
  },

  async getStats({ estimator_id = null, customer_id = null, visible_to_user_id = null } = {}) {
    const query = db('bids')
      .select('status')
      .count('* as count')
      .sum('bid_amount as total_value')
      .groupBy('status');
    if (estimator_id) query.where('estimator_id', estimator_id);
    if (customer_id) query.where('customer_id', customer_id);
    if (visible_to_user_id) {
      query.where(function () {
        this.where('estimator_id', visible_to_user_id)
          .orWhere('assigned_pm_id', visible_to_user_id);
      });
    }
    const rows = await query;

    const stats = { total: 0, by_status: {}, total_bid_value: 0, win_rate: 0 };
    let won = 0, decided = 0;
    for (const row of rows) {
      stats.by_status[row.status] = {
        count: parseInt(row.count, 10),
        value: parseFloat(row.total_value) || 0,
      };
      stats.total += parseInt(row.count, 10);
      stats.total_bid_value += parseFloat(row.total_value) || 0;
      if (row.status === 'won') won = parseInt(row.count, 10);
      if (row.status === 'won' || row.status === 'lost') decided += parseInt(row.count, 10);
    }
    stats.win_rate = decided > 0 ? Math.round((won / decided) * 100) : 0;
    return stats;
  },
};

module.exports = Bid;
