# Plan — Data export rework

> Branch: `export-rework`
> Approved: Pat, 2026-05-18

## Why

Three real gaps in the current export builder:

1. **Project number is invisible.** It lives in the 1:many `project_numbers` table (`{project_id, number, label}`) — no `project_number` column on `projects`. ExportBuilder doesn't join it. Only the hardcoded payroll-timesheet XLSX export touches it, and only for the `"Primary"` label.
2. **Aliased joins aren't supported.** `projects` and `bids` each have *two* FKs to `contacts` (`customer_contact_id` and `site_contact_id`) — the user needs both surfaced as separate column groups ("Customer Contact: Phone" vs "Site Contact: Phone"). Current code joins each related table at most once.
3. **Dead parallel code.** `ExportService.getAvailableSources()` and `customExport()` are defined but never called by any route or frontend. Two diverging column lists, no validation in the unused path.

Plus a UX ask: drag-to-reorder selected columns so the CSV column order matches the user's selection order, and a clearer grouped column tree.

## What changes

| File | Change |
|---|---|
| `src/services/exportMetadata.js` (new) | Declarative registry: every source + its native columns + its joins (aliased), keyed by relative column key (e.g. `customer_contact.phone`, `project_numbers.all`). Single source of truth for the UI and the builder. |
| `src/services/ExportBuilder.js` (rewrite) | Reads metadata. Builds `LEFT JOIN <table> AS <alias> ON <fk> = <alias>.id` for each requested alias. Validates every column against the metadata. Enriches rows with `project_numbers` data via one follow-up `whereIn(project_id)` query — gives Primary # and an aggregated "All Project Numbers" column. |
| `src/services/ExportService.js` | Delete `getAvailableSources()` and `customExport()` (both confirmed unused). Keep QB/Procore/payroll exports + `toCSV` helper. |
| `src/routes/exports.js` | Delete `POST /custom` and `GET /sources` (the dead-code surface). `/builder/*` routes unchanged in contract. |
| `public/index.html` — `renderExports()` (rewrite) | Three-region layout: source picker (top), grouped available-columns tree (left, collapsible per alias group), selected-columns panel (right, drag-to-reorder via native HTML5 DnD). Column key search box. Output column order = selected panel order. |
| `docs/EXPORT_METADATA.md` (new) | How to add a source / column / aliased join. |

## Sources covered (9)

`projects`, `bids`, `invoices`, `purchase_orders`, `timesheets`, `equipment`, `customers`, `locations`, `contacts`. Each gets a curated native column list (file paths, password hashes, internal IDs excluded) plus its aliased joins.

## Aliased join examples

- `projects` → `customer_contact` (contacts via `customer_contact_id`) AND `site_contact` (contacts via `site_contact_id`) AND `customer` (customers) AND `location` (locations) AND `pm` (users via `pm_id`) AND `won_bid` (bids via `bid_id`)
- `bids` → `customer_contact` AND `site_contact` AND `customer` AND `location` AND `estimator` (users via `estimator_id`)
- Through-joins (e.g. `invoices` → `project` → `customer`) handled by `requires` field on join definitions

## Project numbers (special)

Pat's `project_numbers` table is 1:many with extensible labels. Approach:
- **Native column** `project_numbers.primary` on the `projects` source: just the number where `label = 'Primary'` (most common ask).
- **Native column** `project_numbers.all` on the `projects` source: every label:number pair concatenated as `Primary: 25-001; Customer PO #: 4711; Internal #: PROJ-A`. Survives new labels without code changes.
- Enrichment happens post-query: pull all matching `project_numbers` rows in one `whereIn` keyed by project IDs, attach to rows in JS.

## Drag-to-reorder UI

- Native HTML5 `draggable="true"` on each selected-column chip; `dragover`/`drop` swap positions in `selectedColumns[]`
- Re-render the panel on each drop
- Output CSV header + cell order respect array order

## What does NOT change

- QuickBooks / Procore / payroll hardcoded exports (different purpose; not part of the column-picker)
- Schema (no migration)
- Auth (`exports:read` permission gate unchanged)
- The `/builder/preview` and `/builder/download` route contracts — same `{source, columns, filters}` body shape

## Risks considered

1. **Aliased self-join SQL** — Postgres handles `LEFT JOIN contacts AS customer_contact … LEFT JOIN contacts AS site_contact …` fine. Knex `.leftJoin('contacts as customer_contact', ...)` syntax is standard.
2. **Column-key namespace change** — keys go from `invoices.invoice_number` (absolute) to `invoice_number` / `project.name` (source-relative). Saved export configs (if any persisted; none known) won't round-trip.
3. **`project_numbers.all` cell content** — concatenated string in CSV; user spreadsheets will see it as one cell. Acceptable per design discussion.
4. **DnD on touch** — native HTML5 DnD doesn't work on mobile. Mobile export is not a current use case (admin/accounting roles on desktop); deferring.

## Out of scope (Pass 2 candidates)

- Saved export presets ("Monthly P&L" reusable templates)
- Per-column filters (date ranges per column, status sub-filters)
- Server-side aggregations (SUM, COUNT, GROUP BY)
- Touch-friendly reorder

## Verification

1. Pick `projects` source → check `Customer Contact: Phone`, `Site Contact: Phone`, `PM: First Name`, `Primary #`, `All Project Numbers`, plus a few native columns → download CSV → confirm two distinct contact phones, correct PM name, primary number, and the aggregated label:number string
2. Drag the `Site Contact: Phone` chip above `Customer Contact: Phone` → download → verify CSV column order reflects the drag
3. Each of the 9 sources opens its picker without error; at least one join column from each works
4. `POST /api/exports/custom` returns 404 (route removed)
5. Dev login → Admin → Exports tab → all three actions (Preview, Download, Clear All) work
