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

    // Auto-prepend grouping level columns if the caller picked them as
    // group keys but didn't include them in the visible columns list. The
    // renderer needs the value on every row to detect when a level
    // changes; rather than thread a parallel "hidden columns" channel,
    // we just put the level columns at the front of the output. They
    // appear in headers/rows so the renderer can index by header name.
    const grpLevels = (filters.grouping && Array.isArray(filters.grouping.levels))
      ? filters.grouping.levels.filter(k => typeof k === 'string' && k.length > 0)
      : [];
    if (grpLevels.length > 0) {
      const prepend = [];
      for (const k of grpLevels) {
        if (!columns.includes(k)) prepend.push(k);
      }
      if (prepend.length > 0) columns = [...prepend, ...columns];
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

    // Predicate filters (PR #48). filters.predicates is an array of
    //   { column: <key>, op: '=' | '!=' | '>' | '<' | '>=' | '<=', value: <scalar> }
    // AND-joined onto the existing time-frame / status filters. Each
    // column is resolved against the source's allowed-columns set; an
    // unknown column rejects the whole request rather than silently
    // ignoring (so a typo doesn't quietly return un-filtered data).
    // Value coercion: numeric strings → Number when the column metadata
    // marks it numeric; date-ish strings pass through and let SQL handle
    // the cast.
    const OP_MAP = { '=': '=', '!=': '!=', '<>': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=' };
    if (Array.isArray(filters.predicates) && filters.predicates.length > 0) {
      for (const p of filters.predicates) {
        if (!p || typeof p !== 'object') continue;
        const key = String(p.column || '');
        const op = OP_MAP[String(p.op || '=')];
        if (!op) throw new Error(`Invalid filter operator: ${p.op}`);
        if (!allowed.has(key)) throw new Error(`Invalid filter column for "${source}": ${key}`);
        const r = ensureJoinForKey(key);
        if (!r || r.type === 'enrichment') {
          throw new Error(`Filter column "${key}" cannot be used as a predicate (enrichment column).`);
        }
        let val = p.value;
        // Coerce numeric-looking strings to Number — Excel-friendly write
        // path uses the same heuristic, keeps SQL planner from doing
        // text-comparison on a numeric column.
        if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val) && !/^0\d/.test(val)) {
          const n = Number(val);
          if (!Number.isNaN(n) && Number.isFinite(n)) val = n;
        }
        query = query.whereRaw(`?? ${op} ?`, [r.col, val]);
      }
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
        // The join loop above has already finished, so we can't rely on
        // it to attach this join — append directly. (No need to update
        // neededJoins; nothing else reads it past this point.)
        const j = src.joins[aliasPart];
        if (j.via && !neededJoins.has(j.via)) {
          const via = src.joins[j.via];
          query = query.joinRaw(`LEFT JOIN ?? AS ?? ON ${via.on}`, [via.target, j.via]);
        }
        query = query.joinRaw(`LEFT JOIN ?? AS ?? ON ${j.on}`, [j.target, aliasPart]);
      }
      query = query.where(filters.scope_column, filters.scope_user_id);
    }

    // Sort. When a grouping spec is present, ORDER BY level1, level2,
    // level3, sortBy — every level needs to be a contiguous block in the
    // result set so the renderer can emit a group header each time a key
    // changes. Levels' joins are added on demand so a grouping column
    // doesn't have to also be in the visible columns list (the user can
    // group by PM even if they don't display PM as a column).
    const grouping = filters.grouping && typeof filters.grouping === 'object' && !Array.isArray(filters.grouping)
      ? filters.grouping : null;
    const groupingLevels = (grouping && Array.isArray(grouping.levels)) ? grouping.levels : [];

    function ensureJoinForKey(key) {
      let r;
      try { r = M.resolveColumn(source, key); } catch { return null; }
      if (!r || r.type !== 'joined') return r;
      const alias = r.alias;
      if (neededJoins.has(alias)) return r;
      const j = src.joins[alias];
      if (!j) return r;
      if (j.via && !neededJoins.has(j.via)) {
        const via = src.joins[j.via];
        query = query.joinRaw(`LEFT JOIN ?? AS ?? ON ${via.on}`, [via.target, j.via]);
        neededJoins.add(j.via);
      }
      query = query.joinRaw(`LEFT JOIN ?? AS ?? ON ${j.on}`, [j.target, alias]);
      neededJoins.add(alias);
      return r;
    }

    let appliedOrder = false;
    if (groupingLevels.length > 0) {
      for (const key of groupingLevels) {
        const r = ensureJoinForKey(key);
        if (!r || r.type === 'enrichment') continue; // enrichment cols can't drive SQL order
        query = query.orderByRaw(`?? ASC NULLS LAST`, [r.col]);
        appliedOrder = true;
      }
      if (grouping.sortBy) {
        const r = ensureJoinForKey(grouping.sortBy);
        if (r && r.type !== 'enrichment') {
          const dir = grouping.sortDir === 'desc' ? 'DESC' : 'ASC';
          query = query.orderByRaw(`?? ${dir} NULLS LAST`, [r.col]);
          appliedOrder = true;
        }
      }
    }
    if (!appliedOrder && src.defaultSort) query = query.orderBy(src.defaultSort, 'desc');
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

    // Surface grouping metadata so the renderer can find each level's
    // column index without re-resolving keys. levelHeaders mirrors the
    // human-readable labels in `headers`. When no grouping was requested
    // this is just omitted from the response.
    const out = { headers, rows, total: rows.length };
    if (grpLevels.length > 0) {
      const indexByKey = new Map(columns.map((k, i) => [k, i]));
      out.grouping = {
        levels: grpLevels.map(k => ({ key: k, index: indexByKey.get(k), label: M.headerForColumn(source, k) })),
        sortBy: grouping ? grouping.sortBy : null,
        sortDir: grouping ? grouping.sortDir : null,
      };
    }
    return out;
  },
};

module.exports = ExportBuilder;
