const db = require('../config/database');

const Inventory = {
  /**
   * Find all inventory items with filters
   */
  async findAll({ category, search, low_stock, active, limit = 100, offset = 0 } = {}) {
    const query = db('inventory').orderBy('item_name', 'asc');

    if (category) query.where('category', category);
    if (typeof active === 'boolean') query.where('active', active);
    if (search) {
      query.where(function () {
        this.whereILike('item_name', `%${search}%`)
          .orWhereILike('sku', `%${search}%`)
          .orWhereILike('category', `%${search}%`);
      });
    }
    if (low_stock) {
      query.whereRaw('quantity <= min_stock');
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('* as total').first();
    const [items, countResult] = await Promise.all([
      query.limit(limit).offset(offset),
      countQuery,
    ]);

    return { items, total: parseInt(countResult.total, 10) };
  },

  /**
   * Find by ID
   */
  async findById(id) {
    return db('inventory').where({ id }).first();
  },

  /**
   * Find by SKU
   */
  async findBySku(sku) {
    return db('inventory').where({ sku }).first();
  },

  /**
   * Create a new inventory item
   */
  async create(data) {
    const [item] = await db('inventory').insert(data).returning('*');
    return item;
  },

  /**
   * Update an inventory item
   */
  async update(id, data) {
    data.updated_at = db.fn.now();
    delete data.id;
    const [item] = await db('inventory').where({ id }).update(data).returning('*');
    return item;
  },

  /**
   * Adjust quantity (add or subtract)
   */
  async adjustQuantity(id, delta) {
    const [item] = await db('inventory')
      .where({ id })
      .update({
        quantity: db.raw('quantity + ?', [delta]),
        updated_at: db.fn.now(),
      })
      .returning('*');
    return item;
  },

  /**
   * Allocate inventory to a project.
   * Deducts from inventory and creates an allocation record.
   */
  async allocateToProject(inventoryId, projectId, quantity, userId, notes = null) {
    return db.transaction(async (trx) => {
      // Check available quantity
      const item = await trx('inventory').where({ id: inventoryId }).first();
      if (!item) throw new Error('Inventory item not found');
      if (item.quantity < quantity) {
        throw new Error(`Insufficient stock. Available: ${item.quantity} ${item.unit}, Requested: ${quantity}`);
      }

      // Deduct from inventory
      const [updatedItem] = await trx('inventory')
        .where({ id: inventoryId })
        .update({
          quantity: trx.raw('quantity - ?', [quantity]),
          updated_at: trx.fn.now(),
        })
        .returning('*');

      // Create allocation record
      const [allocation] = await trx('inventory_allocations')
        .insert({
          inventory_id: inventoryId,
          project_id: projectId,
          allocated_by: userId,
          quantity,
          notes,
        })
        .returning('*');

      return { item: updatedItem, allocation };
    });
  },

  /**
   * Receive stock from a PO delivery
   */
  async receiveStock(inventoryId, quantity, poId = null, userId = null) {
    const item = await this.adjustQuantity(inventoryId, quantity);
    return item;
  },

  /**
   * Get all items at or below minimum stock level
   */
  async getLowStockItems() {
    return db('inventory')
      .where('active', true)
      .whereRaw('quantity <= min_stock')
      .where('min_stock', '>', 0)
      .orderByRaw('quantity - min_stock ASC');
  },

  /**
   * Get allocation history for an item or project
   */
  async getAllocations({ inventory_id, project_id, limit = 50, offset = 0 } = {}) {
    const query = db('inventory_allocations')
      .select(
        'inventory_allocations.*',
        'inventory.item_name',
        'inventory.unit',
        'inventory.sku',
        'projects.name as project_name',
        db.raw("users.first_name || ' ' || users.last_name as allocated_by_name")
      )
      .join('inventory', 'inventory_allocations.inventory_id', 'inventory.id')
      .join('projects', 'inventory_allocations.project_id', 'projects.id')
      .join('users', 'inventory_allocations.allocated_by', 'users.id')
      .orderBy('inventory_allocations.created_at', 'desc');

    if (inventory_id) query.where('inventory_allocations.inventory_id', inventory_id);
    if (project_id) query.where('inventory_allocations.project_id', project_id);

    return query.limit(limit).offset(offset);
  },

  /**
   * Get distinct categories
   */
  async getCategories() {
    const rows = await db('inventory')
      .distinct('category')
      .whereNotNull('category')
      .orderBy('category');
    return rows.map(r => r.category);
  },

  /**
   * Get inventory summary stats
   */
  async getStats() {
    const [totals, lowStock, categories] = await Promise.all([
      db('inventory')
        .where('active', true)
        .count('* as total_items')
        .sum(db.raw('quantity * COALESCE(unit_cost, 0) as total_value'))
        .first(),
      db('inventory')
        .where('active', true)
        .whereRaw('quantity <= min_stock')
        .where('min_stock', '>', 0)
        .count('* as count')
        .first(),
      db('inventory')
        .where('active', true)
        .countDistinct('category as count')
        .first(),
    ]);

    return {
      total_items: parseInt(totals.total_items, 10),
      total_value: parseFloat(totals.total_value) || 0,
      low_stock_count: parseInt(lowStock.count, 10),
      category_count: parseInt(categories.count, 10),
    };
  },
};

module.exports = Inventory;
