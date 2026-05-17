/**
 * Equipment Model
 * 
 * Serialized reusable assets tracked by barcode.
 * Independent from inventory (consumables).
 * States: available → checked_out → maintenance_required → in_maintenance → retired
 */

const db = require('../config/database');

const Equipment = {
  async findAll({ status, equipment_type, search, project_id, limit = 100, offset = 0 } = {}) {
    const query = db('equipment')
      .select('equipment.*', 'projects.name as current_project_name')
      .leftJoin('projects', 'equipment.current_project_id', 'projects.id')
      .orderBy('equipment.current_location', 'asc')
      .orderBy('equipment.equipment_name', 'asc')
      .limit(limit).offset(offset);

    if (status) query.where('equipment.status', status);
    if (equipment_type) query.where('equipment.equipment_type', equipment_type);
    if (project_id) query.where('equipment.current_project_id', project_id);
    if (search) {
      query.where(function () {
        this.whereILike('equipment.barcode_id', `%${search}%`)
          .orWhereILike('equipment.equipment_name', `%${search}%`)
          .orWhereILike('equipment.manufacturer', `%${search}%`);
      });
    }

    const items = await query;
    const [{ count }] = await db('equipment').count('* as count');
    return { items, total: parseInt(count, 10) };
  },

  /**
   * Get equipment grouped by location (shop first, then by project).
   *
   * Pat wants the project header in the equipment view to read like
   *   "<project_number> | <customer> : <location>"
   * so the join now pulls customers.name + locations.name + the primary
   * project_number. The grouped result keeps the same shape, with extra
   * fields tucked onto the per-project bucket.
   */
  async findGroupedByLocation() {
    const all = await db('equipment')
      .select(
        'equipment.*',
        'projects.name as current_project_name',
        'customers.name as current_customer_name',
        'locations.name as current_location_name',
      )
      .leftJoin('projects', 'equipment.current_project_id', 'projects.id')
      .leftJoin('customers', 'projects.customer_id', 'customers.id')
      .leftJoin('locations', 'projects.location_id', 'locations.id')
      .orderBy('equipment.equipment_name');

    // Look up the primary project number for each project we touched.
    const projectIds = [...new Set(all.map(e => e.current_project_id).filter(Boolean))];
    let primaryByProject = {};
    if (projectIds.length > 0) {
      const numbers = await db('project_numbers')
        .whereIn('project_id', projectIds)
        .where('label', 'Primary');
      primaryByProject = Object.fromEntries(numbers.map(n => [n.project_id, n.number]));
    }

    const shop = all.filter(e => e.current_location === 'shop' || !e.current_project_id);
    const byProject = {};
    for (const item of all.filter(e => e.current_project_id)) {
      const key = item.current_project_id;
      if (!byProject[key]) byProject[key] = {
        project_name: item.current_project_name,
        project_id: key,
        project_number: primaryByProject[key] || null,
        customer_name: item.current_customer_name || null,
        location_name: item.current_location_name || null,
        items: [],
      };
      byProject[key].items.push(item);
    }

    return { shop, projects: Object.values(byProject) };
  },

  async findById(id) {
    return db('equipment').where({ id }).first();
  },

  async findByBarcode(barcodeId) {
    return db('equipment').where({ barcode_id: barcodeId }).first();
  },

  async create(data) {
    const [item] = await db('equipment').insert(data).returning('*');
    return item;
  },

  async update(id, data) {
    const [item] = await db('equipment').where({ id }).update({ ...data, updated_at: db.fn.now() }).returning('*');
    return item;
  },

  async checkout(equipmentId, projectId, userId, requestLineId = null) {
    const item = await this.findById(equipmentId);
    if (!item) throw new Error('Equipment not found');
    if (item.status === 'maintenance_required' || item.status === 'in_maintenance') {
      throw new Error(`Cannot checkout: item is in ${item.status} status`);
    }
    if (item.status === 'checked_out') throw new Error('Equipment already checked out');

    await db.transaction(async (trx) => {
      await trx('equipment').where({ id: equipmentId }).update({
        status: 'checked_out',
        current_project_id: projectId,
        current_location: projectId,
        updated_at: trx.fn.now(),
      });

      await trx('equipment_checkout_log').insert({
        equipment_id: equipmentId,
        project_id: projectId,
        request_line_id: requestLineId,
        checked_out_by: userId,
      });
    });

    return this.findById(equipmentId);
  },

  async returnToShop(equipmentId, userId) {
    const item = await this.findById(equipmentId);
    if (!item) throw new Error('Equipment not found');
    if (item.status !== 'checked_out') throw new Error('Equipment is not checked out');

    await db.transaction(async (trx) => {
      await trx('equipment').where({ id: equipmentId }).update({
        status: 'available',
        current_project_id: null,
        current_location: 'shop',
        updated_at: trx.fn.now(),
      });

      // Close the checkout log entry
      await trx('equipment_checkout_log')
        .where({ equipment_id: equipmentId })
        .whereNull('returned_at')
        .update({ returned_by: userId, returned_at: trx.fn.now() });
    });

    return this.findById(equipmentId);
  },

  async flagMaintenance(equipmentId) {
    return this.update(equipmentId, { status: 'maintenance_required' });
  },

  async clearMaintenance(equipmentId) {
    return this.update(equipmentId, { status: 'available' });
  },

  async getCheckoutHistory(equipmentId) {
    return db('equipment_checkout_log')
      .select('equipment_checkout_log.*',
        'projects.name as project_name',
        db.raw("co.first_name || ' ' || co.last_name as checked_out_by_name"),
        db.raw("rb.first_name || ' ' || rb.last_name as returned_by_name"))
      .join('projects', 'equipment_checkout_log.project_id', 'projects.id')
      .join('users as co', 'equipment_checkout_log.checked_out_by', 'co.id')
      .leftJoin('users as rb', 'equipment_checkout_log.returned_by', 'rb.id')
      .where('equipment_checkout_log.equipment_id', equipmentId)
      .orderBy('equipment_checkout_log.checked_out_at', 'desc');
  },

  async getDocuments(equipmentId) {
    return db('equipment_documents')
      .where({ equipment_id: equipmentId })
      .orderBy('created_at', 'desc');
  },

  async getExpiringCertifications(daysAhead = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    return db('equipment')
      .whereNotNull('certification_date')
      .where('certification_date', '<=', cutoff.toISOString().split('T')[0])
      .whereNot('status', 'retired')
      .orderBy('certification_date', 'asc');
  },

  async getTypes() {
    const rows = await db('equipment').distinct('equipment_type').whereNotNull('equipment_type').orderBy('equipment_type');
    return rows.map(r => r.equipment_type);
  },
};

module.exports = Equipment;
