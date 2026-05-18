# Plan — rename `customer_contacts` → `contacts` (Pass 1)

> Branch: `rename-customer-contacts`
> Commit: `9ac4296`
> Approved: Pat, 2026-05-18

## Why

"Customer contacts" was a holdover from when contacts only belonged to customers. After the vendor-customer merge (`20260517_001`), any company — customer or vendor — can carry contacts, so the qualifier is misleading. Rename to plain `contacts`.

## Scope split

**Pass 1 (this branch):** rename the **table** only. 12 files touched. Reviewable as one PR.

**Pass 2 (separate PR if/when worth it):** rename FK **columns** (`customer_contact_id` → `contact_id` on bids/projects), rename **model filename** (`CustomerContact.js` → `Contact.js`), sweep comment prose. ~20 more touch points.

## What changes

| File | Change |
|---|---|
| `migrations/20260518_007_rename_customer_contacts.js` (new) | `knex.schema.renameTable('customer_contacts','contacts')`. Idempotent via `hasTable` guards. Postgres auto-updates FK metadata — no data movement, no FK drop/re-add. |
| `src/models/CustomerContact.js` | `db('customer_contacts')` → `db('contacts')`; all `'customer_contacts.X'` selects → `'contacts.X'`. |
| `src/models/Bid.js` | Selects + `leftJoin('customer_contacts', ...)` → `leftJoin('contacts', ...)`. |
| `src/models/Vendor.js` | `db('customer_contacts').insert(...)` → `db('contacts').insert(...)`. |
| `src/routes/bids.js` | `db('customer_contacts').where(...)` → `db('contacts').where(...)`. |
| `src/routes/contacts.js` | 3× contact-code uniqueness queries. |
| `src/services/ExportBuilder.js` | Join definition + column metadata. `JOINS.customer_contacts` / `COLUMN_OPTIONS.customer_contacts` → `JOINS.contacts` / `COLUMN_OPTIONS.contacts`. **No column-key alias** — column-validation error guides users to re-pick. |
| `src/routes/admin.js` | Bulk-import target list: rename key to `contacts`. **Back-compat alias** (`customer_contacts → contacts`) so any saved import config keeps working. |
| `seeds/002_test_data.js` | 2 inserts (customer contacts + vendor contacts seeded by the merge path). |
| `public/index.html` | 1 label-cleanup hit in export UI. |

## What does NOT change in Pass 1

- `bids.customer_contact_id`, `projects.customer_contact_id` column names
- API endpoint `/api/contacts` (already named correctly)
- Model filename `CustomerContact.js`
- Most comments / docstrings mentioning "customer_contacts"

## Risks considered

1. **FK constraints** — Postgres updates `pg_constraint.confrelid` automatically on rename. Verified pattern; safe.
2. **ExportBuilder map keys** — saved export configs (none known to be persisted) might reference `customer_contacts.X` column keys. Accepting the error message as the back-compat path.
3. **Admin bulk-import target string** — alias provided so this is back-compat.
4. **Knex `renameTable` on Postgres** — well-supported, doesn't fail with FKs in place.

## Verification (to run after merge to main)

1. Wipe-and-rebuild the dev DB → migration runs cleanly
2. `GET /api/contacts` returns list
3. `GET /api/bids/:id` returns `contact_name` (join still works)
4. Create a new contact via UI → save bid that references it
5. `npm test` (unit tests) all pass

## Out of scope (Pass 2 candidates)

- Rename FK columns `customer_contact_id` → `contact_id`
- Rename model file `CustomerContact.js` → `Contact.js` + import updates
- Sweep prose comments referencing "customer_contacts"
