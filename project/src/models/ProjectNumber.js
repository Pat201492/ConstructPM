/**
 * Project Number Model
 * 
 * Multiple numbers per project for external bookkeeping.
 * Generation rules configurable by admin (decision #56):
 *   - PM prefix
 *   - Year
 *   - Customer ref
 *   - Sequence per customer
 *   - Open to custom coding for edge cases
 * 
 * Default format: YYYY-{PM_INITIALS}-{SEQ}
 */

const db = require('../config/database');

const ProjectNumber = {
  async findByProject(projectId) {
    return db('project_numbers')
      .where('project_id', projectId)
      .orderBy('created_at', 'asc');
  },

  async create(projectId, number, label = null) {
    const [pn] = await db('project_numbers')
      .insert({ project_id: projectId, number, label })
      .returning('*');
    return pn;
  },

  async delete(id) {
    return db('project_numbers').where({ id }).delete();
  },

  /**
   * Generate a project number based on rules.
   * Falls back to a simple format if no rules are configured.
   * 
   * @param {Object} project - The project record
   * @param {Object} bid - The associated bid record
   * @param {Object} trx - Knex transaction (optional)
   */
  async generate(project, bid, trx = null) {
    const knex = trx || db;

    // Get PM initials
    const user = await knex('users').where({ id: project.pm_id }).first();
    const initials = user?.initials || (user ? (user.first_name[0] + user.last_name[0]).toUpperCase() : 'XX');

    const year = project.year || new Date().getFullYear();

    // Count existing projects for this PM this year
    const [{ count }] = await knex('projects')
      .where('pm_id', project.pm_id)
      .where('year', year)
      .count('* as count');

    const seq = String(parseInt(count, 10)).padStart(3, '0');

    // Default format: YYYY-PM_INITIALS-SEQ
    return `${year}-${initials}-${seq}`;
  },

  /**
   * Match a number string to find its project.
   */
  async findProjectByNumber(number) {
    const pn = await db('project_numbers')
      .where('number', number.trim())
      .first();
    return pn ? pn.project_id : null;
  },

  /**
   * Generate the new structured project number: {pm_code}{YY}-{location_code}.{seq}
   *
   * Example: M26-1308.8 = Mike Torres, 2026, Newark Office Complex, 8th project
   * for that PM at that location this year.
   *
   * Returns { number, components } or { error } if pm_code or location_code is missing.
   */
  async generateStructured(project, trx = null) {
    const knex = trx || db;

    const user = await knex('users').where({ id: project.pm_id }).first();
    if (!user?.pm_code) {
      return { error: `PM ${user?.first_name || project.pm_id} has no pm_code set. Admin must set it under Admin → Users.` };
    }

    const location = await knex('locations').where({ id: project.location_id }).first();
    if (!location?.location_code) {
      return { error: `Location ${location?.name || project.location_id} has no location_code set. Admin must set it under Admin → Locations.` };
    }

    const year = project.year || new Date().getFullYear();
    const yearShort = String(year).slice(-2);

    // Count existing structured project numbers for this PM × location × year combo.
    // Match on the prefix `{pm_code}{yy}-{location_code}.` to find prior projects.
    const prefix = `${user.pm_code}${yearShort}-${location.location_code}.`;
    const existing = await knex('project_numbers')
      .where('number', 'like', `${prefix}%`)
      .pluck('number');

    // Pull max sequence number from existing matches
    let maxSeq = 0;
    for (const num of existing) {
      const after = num.slice(prefix.length);
      const seq = parseInt(after, 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
    const next = maxSeq + 1;

    return {
      number: `${prefix}${next}`,
      components: {
        pm_code: user.pm_code,
        year_short: yearShort,
        location_code: location.location_code,
        sequence: next,
      },
    };
  },

  /**
   * Look up a project by reference text.
   *
   * Matching strategy (most precise → least):
   *   1. Exact match on project_numbers.number (handles both old format
   *      "2026-MT-001" and new format "M26-1308.8")
   *   2. Substring match on projects.name (case-insensitive)
   *
   * Returns:
   *   { found: true, project: {...}, project_numbers: [...] } when single match
   *   { found: false, ambiguous: true, matches: [...] } when multiple matches
   *   { found: false } when no match
   *
   * Only returns active or on_hold projects.
   */
  async lookup(refText) {
    const ref = String(refText || '').trim();
    if (!ref) return { found: false };

    // Strategy 1: exact project_number match (case-insensitive for safety)
    const numberMatches = await db('project_numbers')
      .whereRaw('LOWER(number) = LOWER(?)', [ref])
      .pluck('project_id');

    if (numberMatches.length > 0) {
      const projects = await db('projects')
        .whereIn('id', numberMatches)
        .whereIn('status', ['active', 'on_hold'])
        .leftJoin('customers', 'projects.customer_id', 'customers.id')
        .select('projects.*', 'customers.name as customer_name');

      if (projects.length === 1) {
        const numbers = await db('project_numbers').where('project_id', projects[0].id).select('number', 'label');
        return { found: true, project: projects[0], project_numbers: numbers };
      }
      if (projects.length > 1) {
        return { found: false, ambiguous: true, matches: projects };
      }
      // numberMatches all pointed to non-active projects → no usable match
    }

    // Strategy 2: substring match on project name
    const nameMatches = await db('projects')
      .whereRaw('LOWER(name) LIKE LOWER(?)', [`%${ref}%`])
      .whereIn('status', ['active', 'on_hold'])
      .leftJoin('customers', 'projects.customer_id', 'customers.id')
      .select('projects.*', 'customers.name as customer_name')
      .limit(5);

    if (nameMatches.length === 1) {
      const numbers = await db('project_numbers').where('project_id', nameMatches[0].id).select('number', 'label');
      return { found: true, project: nameMatches[0], project_numbers: numbers };
    }
    if (nameMatches.length > 1) {
      return { found: false, ambiguous: true, matches: nameMatches };
    }

    return { found: false };
  },
};

module.exports = ProjectNumber;
