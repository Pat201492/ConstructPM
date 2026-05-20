/**
 * Export Builder — driven entirely by exportMetadata.
 *
 * Public surface:
 *   getSources()                      → UI metadata (sources → grouped columns)
 *   execute(source, columns, filters) → { headers, rows, total }
 *
 * Pipeline
 *   1. Validate every requested column against the metadata for the source
 *   2. Resolve each column (native / joined / enrichment)
 *   3. Determine which joins are needed (respecting `via` dependencies)
 *   4. Build SELECT with positional aliases (c0..cN) — enrichment columns
 *      take no SQL slot; they're computed in JS post-query
 *   5. Apply LEFT JOINs (aliased, so the same target table can be joined
 *      multiple times — e.g. customer_contact + site_contact both → contacts)
 *   6. Apply filters (date range via source's dateColumn, status if the
 *      source has a status column)
 *   7. Run the main query
 *   8. If project_numbers enrichment was requested: one follow-up
 *      `whereIn(project_id, …)` query, group in JS, attach to rows
 *   9. Build the response in the EXACT order columns were requested in —
 *      this is what makes drag-to-reorder in the UI actually re-order the
 *      output CSV.
 */

const db = require('../config/database');
const M = require('./exportMetadata');

const MAX_ROWS = 50000;
const DEFAULT_LIMIT = 10000;

const ExportBuilder = {
  getSources() {
    return M.getSourcesForUI();
  },

  /**
   * @param {string} source        Source key (e.g. 'projects')
   * @param {string[]} columns     Relative column keys in display order
   * @param {object} [filters]     { start_date, end_date, status, limit }
   * @returns {{ headers: string[], rows: any[][], total: number }}
   */
  async execute(source, columns, filters = {}) {
    const src = M.getSource(source);
    if (!src) throw new Error(`Unknown source: ${source}`);

    // Default to all native columns if none specified
    if (!columns || columns.length === 0) {
      columns = src.native.map(c => c.key);
    }

    // Validate
    const allowed = M.allowedColumnKeys(source);
    const invalid = columns.filter(c => !allowed.has(c));
    if (invalid.length > 0) {
      throw new Error(`Invalid column(s) for source "${source}": ${invalid.join(', ')}`);
    }

    // Resolve every column once
    const resolved = columns.map(k => ({ key: k, res: M.resolveColumn(source, k) }));

    // Determine needed joins, including `via` dependencies, in dependency order.
    // A JS Set preserves insertion order, so recursing into `via` first puts
    // dependencies ahead of their dependents.
    const neededJoins = new Set();
    function addJoin(alias) {
      if (neededJoins.has(alias)) return;
      const j = src.joins[alias];
      if (!j) return;
      if (j.via) addJoin(j.via);
      neededJoins.add(alias);
    }
    for (const { res } of resolved) {
      if (res.type === 'joined') addJoin(res.alias);
    }

    // Enrichments
    const needsProjectNumbers =
      resolved.some(r => r.res.type === 'enrichment' && r.res.kind === 'project_numbers')
      && !!src.projectIdColumn;

    // SELECT list — positional aliases keep the row→column mapping trivial.
    // Enrichment columns take no SQL slot; we skip them here and fill in JS.
    const selectExprs = [];
    resolved.forEach(({ res }, i) => {
      if (res.type === 'enrichment') return;
      selectExprs.push(db.raw(`?? AS ??`, [res.col, `c${i}`]));
    });
    if (needsProjectNumbers) {
      selectExprs.push(db.raw(`?? AS ??`, [src.projectIdColumn, '__pid']));
    }

    let query = db(src.table).select(selectExprs);

    // Joins — aliased so the same target table can appear multiple times.
    for (const alias of neededJoins) {
      const j = src.joins[alias];
      query = query.joinRaw(`LEFT JOIN ?? AS ?? ON ${j.on}`, [j.target, alias]);
    }

    // Filters
    if (filters.start_date && src.dateColumn) {
      query = query.where(src.dateColumn, '>=', filters.start_date);
    }
    if (filters.end_date && src.dateColumn) {
      query = query.where(src.dateColumn, '<=', filters.end_date);
    }
    if (filters.status && src.native.some(c => c.key === 'status')) {
      query = query.where(`${src.table}.status`, filters.status);
    }

    // User-scope filter (PR #20 fan-out). `scope_column` must be one of
    // the source's declared userScopeColumns; the runner is responsible
    // for validating before reaching here. If the scope column is on a
    // joined table (e.g. `project.pm_id` for the invoices source), the
    // join must already be in `neededJoins` — append it on demand so
    // fan-out queries don't depend on which columns the user picked.
    if (filters.scope_column && filters.scope_user_id) {
      const scopeDef = M.findUserScopeColumn(source, filters.scope_column);
      if (!scopeDef) throw new Error(`Invalid scope column for "${source}": ${filters.scope_column}`);
      const aliasPart = filters.scope_column.includes('.') ? filters.scope_column.split('.')[0] : null;
      if (aliasPart && src.joins?.[aliasPart] && !neededJoins.has(aliasPart)) {
        addJoin(aliasPart);
        const j = src.joins[aliasPart];
        query = query.joinRaw(`LEFT JOIN ?? AS ?? ON ${j.on}`, [j.target, aliasPart]);
      }
      query = query.where(filters.scope_column, filters.scope_user_id);
    }

    // Sort + limit
    if (src.defaultSort) query = query.orderBy(src.defaultSort, 'desc');
    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || DEFAULT_LIMIT, 1), MAX_ROWS);
    query = query.limit(limit);

    const rawRows = await query;

    // Enrichment query — one whereIn covers all rows
    let pnByProject = null;
    if (needsProjectNumbers) {
      const ids = [...new Set(rawRows.map(r => r.__pid).filter(Boolean))];
      pnByProject = new Map();
      if (ids.length > 0) {
        const pns = await db('project_numbers')
          .whereIn('project_id', ids)
          .select('project_id', 'label', 'number');
        for (const pn of pns) {
          if (!pnByProject.has(pn.project_id)) pnByProject.set(pn.project_id, []);
          pnByProject.get(pn.project_id).push(pn);
        }
      }
    }

    // Headers in requested order
    const headers = resolved.map(({ key }) => M.headerForColumn(source, key));

    // Rows in requested order
    const rows = rawRows.map(raw => {
      return resolved.map(({ res }, i) => {
        if (res.type === 'enrichment' && res.kind === 'project_numbers') {
          const list = (pnByProject && pnByProject.get(raw.__pid)) || [];
          if (res.sub === 'primary') {
            const p = list.find(x => x.label === 'Primary');
            return p ? p.number : '';
          }
          if (res.sub === 'all') {
            return list.map(x => `${x.label}: ${x.number}`).join('; ');
          }
          return '';
        }
        const v = raw[`c${i}`];
        return v == null ? '' : v;
      });
    });

    return { headers, rows, total: rows.length };
  },
};

module.exports = ExportBuilder;
