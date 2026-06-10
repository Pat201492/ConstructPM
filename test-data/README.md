# Bulk-Import Test Data

CSVs for the **Admin → Bulk Import** flow (`POST /api/admin/import/parse` → map columns → `POST /api/admin/import`). Requires `admin:bulk_import` permission (log in as admin).

Each file has the target's **valid** columns PLUS deliberate **junk** columns that don't map to any DB field — leave them unmapped in the mapping step; the importer drops them. Use them to confirm unknown columns are ignored (not imported, no error).

| File | Import target | Valid columns (map these) | Junk columns (leave unmapped) |
|------|---------------|---------------------------|-------------------------------|
| `customers.csv` | customers | name, billing_street, billing_town, billing_state, billing_zip | account_rep, credit_rating, legacy_system_id |
| `contacts.csv` | contacts | name, email, phone, company | title, preferred_contact_method *(customer_id omitted — link after)* |
| `locations.csv` | locations | name, street, town, state, zip, local_union, miles_from_hq, location_code | square_footage, parking_notes, site_phone |
| `rate_sheet.csv` | rate_sheet | local_union, classification, st_rate, ot_rate, dt_rate | effective_year, fringe_rate |
| `equipment.csv` | equipment | barcode_id, equipment_name, manufacturer, equipment_type, certification_date, serial_number, notes | purchase_price, warranty_expiry |
| `inventory.csv` | inventory | item_name, category, sku, quantity, unit, min_stock, unit_cost, location | supplier_phone, last_audit_date, bin_color |
| `users.csv` | users | email, first_name, last_name, initials, role, pm_code, phone, on_schedule, password | department, hire_date, emergency_contact |

## Notes / edge cases baked in (to stress the parser)
- Quoted fields containing commas: `"Skanska USA, Inc."`, `"Inspect outriggers, hyd leak watch"`.
- Empty optional cells: equipment `certification_date` / `warranty_expiry` blank on some rows.
- `users.csv` `password` left blank → importer defaults to `ChangeMe123!` (user must change on first login).
- `users.csv` roles use valid enum values: project_manager, estimator, accounting, shop_staff, field_staff, scheduler.
- `on_schedule` boolean as `true`/`false` strings.
- One messy value (`Steve brANNON` casing) to eyeball normalization.

## How to test
1. Admin → Bulk Import → pick target (e.g. customers) → upload the CSV.
2. Mapping screen lists all file columns incl. junk. Map the valid ones; **don't** map junk.
3. Import. Verify rows land, junk values absent, count matches (minus header).
4. Re-upload same file → check duplicate handling.
5. Try mapping a junk column to a real field on purpose → confirm sane behavior/validation.
