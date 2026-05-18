# Export Metadata

The cross-table export builder (Data Export tab in the UI) is driven entirely by `src/services/exportMetadata.js`. That file is the single source of truth for:

- Which **sources** a user can start an export from
- Which **native columns** each source exposes
- Which **related tables** each source can join in, under what **alias**, via what FK
- Which **columns** each joinable table exposes (regardless of which source pulls it in)
- Whether the source can produce `project_numbers` enrichment columns

The UI calls `getSourcesForUI()` and renders whatever it returns. The SQL builder (`ExportBuilder.js`) calls `resolveColumn`, `allowedColumnKeys`, etc. — neither knows anything beyond what the metadata says. Add a column once; it shows up in the picker and validates in the query.

## Column key format

All keys are **relative to the source**:

| Type       | Format                          | Example                          |
|------------|---------------------------------|----------------------------------|
| Native     | `<column>`                      | `name`, `contract_value`         |
| Joined     | `<alias>.<column>`              | `customer_contact.phone`         |
| Enrichment | `project_numbers.<sub>`         | `project_numbers.primary`        |

The CSV header is computed by `headerForColumn`:
- Native: just the column's label (e.g. `"Project Name"`)
- Joined: `"<Alias Label>: <Column Label>"` (e.g. `"Customer Contact: Phone"`)
- Enrichment: just the column's label (e.g. `"Primary #"`)

## Adding a column to an existing source

Append to the source's `native` array in `SOURCES`:

```js
projects: {
  native: [
    // ...existing...
    { key: 'snooze_until', label: 'Snooze Until' },
  ],
  // ...
}
```

If `col` is omitted, it defaults to `<table>.<key>`. Override only when the SQL column differs from the relative key.

## Adding a joinable table

Edit `JOINABLE` once — every source that joins this table picks up the new column automatically:

```js
contacts: [
  // ...existing...
  { key: 'title', label: 'Title' },   // new — now appears under every contacts alias
],
```

## Adding a new join (aliased)

Edit the source's `joins` map. The alias key is the SQL alias and the relative-key prefix. The `on` clause is raw SQL written from the perspective *after* the alias is bound:

```js
projects: {
  joins: {
    // ...existing...
    backup_pm: { target: 'users', on: 'projects.backup_pm_id = backup_pm.id' },
  },
}
```

Now `backup_pm.first_name`, `backup_pm.email`, etc. are valid. The UI shows them under a group labeled `"Backup Pm"` (`aliasLabel` title-cases the underscore-split alias).

## Aliased self-joins (same table, different FKs)

Already used for `customer_contact` vs `site_contact` on projects/bids and for `pm` vs `estimator` on bids (both `users`). Each entry just picks its own alias and points its `on` clause at the right FK:

```js
projects: {
  joins: {
    customer_contact: { target: 'contacts', on: 'projects.customer_contact_id = customer_contact.id' },
    site_contact:     { target: 'contacts', on: 'projects.site_contact_id = site_contact.id' },
  },
}
```

Both produce `LEFT JOIN contacts AS <alias>` statements with no collision.

## Through-joins (`via`)

Many sources don't directly FK to customers/locations/PMs — they FK to `projects`, and *projects* points to the rest. Use `via` to declare the dependency:

```js
invoices: {
  joins: {
    project:  { target: 'projects',  on: 'invoices.project_id = project.id' },
    customer: { target: 'customers', on: 'project.customer_id = customer.id', via: 'project' },
    pm:       { target: 'users',     on: 'project.pm_id = pm.id',             via: 'project' },
  },
}
```

The builder ensures `project` is added before `customer` or `pm`, even if the user only ticks a customer column.

## Adding a new source

```js
new_thing: {
  table: 'new_thing',
  label: 'New Things',
  native: [
    { key: 'name', label: 'Name' },
    // ...
  ],
  joins: { /* optional */ },
  dateColumn: 'new_thing.created_at',   // optional, enables from/to filters
  defaultSort: 'new_thing.name',        // optional
  projectIdColumn: 'new_thing.project_id', // optional, enables project_numbers cols
},
```

The UI picker will pick it up on next request; no other code changes needed.

## Project number enrichment

`project_numbers` is 1:many with **user-extensible labels** (Primary, Customer PO #, Internal #, Contract #, …). Two enrichment columns are exposed on any source with `projectIdColumn` set:

- `project_numbers.primary` — just the number where `label = 'Primary'`
- `project_numbers.all` — `Label: Number; Label: Number; …` for every entry

Implementation: the builder issues **one** follow-up `whereIn(project_id, …)` against `project_numbers` after the main query and attaches the result to each row in JS. No JOIN on the main query; no row multiplication.

If you ever need a per-label column (e.g. always-on "Customer PO #"), prefer adding it as a hardcoded entry to `PROJECT_NUMBER_COLUMNS` and handle it in `ExportBuilder.execute`'s enrichment block — but the `all` aggregator handles unknown labels for free.

## What lives where

| File | Responsibility |
|---|---|
| `src/services/exportMetadata.js` | Sources, joins, columns, enrichment defs |
| `src/services/ExportBuilder.js`  | Reads metadata → builds SQL, runs query, enriches |
| `src/routes/exports.js`          | `/builder/sources`, `/builder/preview`, `/builder/download` (and the QB/Procore hardcoded routes) |
| `public/index.html` `renderExports` | Picker UI, drag-to-reorder selected panel |

## Not in scope here

- Saved presets ("Monthly P&L")
- Per-column filters (date ranges per column, status sub-filters)
- Server-side aggregations (SUM, COUNT, GROUP BY)
- QuickBooks / Procore / payroll hardcoded exports — those stay in `ExportService.js` and are not driven by metadata
