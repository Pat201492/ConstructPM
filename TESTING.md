# ConstructPM — Testing Guide

Run through these tests in order after `docker compose up --build`. Each test builds on the previous one.

---

## PREP: Open Two Windows

- **Browser**: http://localhost:3000 (logged in as admin@company.com / ChangeMe123!)
- **Terminal**: for curl commands (or use Postman/Thunder Client)

Get your auth token for API calls:
```bash
TOKEN=$(curl -s http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@company.com","password":"ChangeMe123!"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

echo $TOKEN
```

If python3 isn't available, just login in the browser and copy the token from localStorage:
```
// In browser console:
localStorage.getItem('token')
```

---

## TEST 1: Admin Setup

### 1A: Add Rate Sheet Entries
**Browser**: Go to Admin → Rate Sheet tab

Add these rates (click "+ Add Rate" for each):
```
Local: 98    Classification: Foreman       ST: 85.50   OT: 128.25   DT: 171.00
Local: 98    Classification: Journeyman    ST: 72.00   OT: 108.00   DT: 144.00
Local: 98    Classification: Apprentice    ST: 45.00   OT: 67.50    DT: 90.00
Local: 164   Classification: Foreman       ST: 92.00   OT: 138.00   DT: 184.00
Local: 164   Classification: Journeyman    ST: 78.00   OT: 117.00   DT: 156.00
```

**Verify**: Table shows all 5 rows. Delete button works (delete one, re-add it).

### 1B: Set Global Variables
**Browser**: Admin → Global Variables tab

Click into the value field and change:
- `dollar_per_mile` → `0.70`
- `home_location_address` → your shop address

**Verify**: Changes save on blur (click away from the field).

### 1C: Create a PM User
```bash
curl -s http://localhost:3000/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "mike@company.com",
    "password": "TestPass123!",
    "first_name": "Mike",
    "last_name": "Thompson",
    "initials": "MT",
    "role": "project_manager"
  }' | python3 -m json.tool
```

**Verify**: Returns user object with `role: "project_manager"`.

### 1D: Create a Shop Staff User
```bash
curl -s http://localhost:3000/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "dave@company.com",
    "password": "TestPass123!",
    "first_name": "Dave",
    "last_name": "Wilson",
    "initials": "DW",
    "role": "shop_staff"
  }' | python3 -m json.tool
```

### 1E: Set Up PM Delegate
**Browser**: Admin → Delegates tab

Select Mike Thompson as PM, System Admin as delegate. Click "+ Add".

**Verify**: Table shows the mapping.

---

## TEST 2: Customer & Location Setup

### 2A: Create Customer
```bash
curl -s http://localhost:3000/api/customers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Riverside Construction Corp",
    "billing_street": "100 Main St",
    "billing_town": "Newark",
    "billing_state": "NJ",
    "billing_zip": "07102"
  }' | python3 -m json.tool
```

Save the `id` from the response. Call it `CUSTOMER_ID`.

### 2B: Create Location
```bash
curl -s http://localhost:3000/api/locations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Newark Office Park",
    "street": "200 Commerce Blvd",
    "town": "Newark",
    "state": "NJ",
    "zip": "07102",
    "local_union": "98",
    "miles_from_hq": 15
  }' | python3 -m json.tool
```

Save the `id`. Call it `LOCATION_ID`.

### 2C: Create Contact
```bash
curl -s http://localhost:3000/api/contacts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sarah Johnson",
    "email": "sarah@riverside.com",
    "phone": "973-555-0100",
    "company": "Riverside Construction"
  }' | python3 -m json.tool
```

Save the `id`. Call it `CONTACT_ID`.

---

## TEST 3: Bid Creation & Quoting

### 3A: Create a Bid
**Browser**: Click "Bids" → "+ New Bid"

- Select customer: Riverside Construction Corp
- Select location: Newark Office Park (union auto-fills to 98)
- Select contact: Sarah Johnson
- Scope: "Electrical Renovation Phase 1"
- Click "Generate Bid & Open Quoting"

**Verify**: Bid number appears (format: 26-SA-001). Quoting page opens with rate sheet for Local 98.

### 3B: Fill the Quoting Table
On the quoting page:
- Foreman: Personnel=1, ST=40, OT=8, DT=0
- Journeyman: Personnel=3, ST=40, OT=8, DT=0
- Apprentice: Personnel=2, ST=40, OT=0, DT=0
- Markup: 15%
- Project Length: 20 days

**Verify**: 
- Totals auto-calculate as you type
- Mileage shows: 15mi × 2 × 6 personnel × 20 days × $0.70/mi
- Grand total = (labor + mileage) × 1.15

### 3C: Save & Generate Documents
Click "Save Quote & Generate Docs"

**Verify**: Alert says "Quote saved & documents generated!"

### 3D: Check Generated Files
```bash
ls -la storage/bids/
```

**Verify**: Folder exists with naming like `SA001_Newark_Office_Park_Electrical_Renovation/` containing `.xlsx` and `.docx` files.

---

## TEST 4: Bid Won → Project Creation

### 4A: Mark Bid as Won
**Browser**: On the bid quoting page, click "Mark Won"

**Verify**: Modal appears with all fields pre-populated:
- bid_amount (from calculation)
- customer_name
- location_name
- project_scope
- local_union
- contract_man_hours

### 4B: Confirm Won
Edit bid_amount if needed. Click "Confirm & Create Project".

**Verify**: 
- Alert: "Bid won! Project created: ..."
- Redirects to Projects page
- New project appears in the list

### 4C: Verify Project Folders Created
```bash
ls -la storage/projects/2026/
```

**Verify**: Folder structure: `{year}/{PM_Name}/{Customer}/{Project}/` with subfolders: `invoices/`, `timesheets/`, `purchase_orders/`, `Contract_PO/`

### 4D: Check Notifications
**Browser**: Click "Notifications"

**Verify**: "Bid Won" notification appears (informational — sent to admin + PM + delegate).

---

## TEST 5: Document Inbox Flow

### 5A: Create a Test Document
Create a simple text file to simulate an invoice:
```bash
cat > /tmp/test_invoice.txt << 'EOF'
INVOICE

Invoice Number: INV-2026-0042
Date: 2026-04-14
Customer: Riverside Construction Corp
Project: 2026-SA-001

Description                  Qty    Price      Total
Electrical conduit 1"        200    $3.50      $700.00
Junction boxes               50     $12.00     $600.00
Labor - panel installation   1      $2,500.00  $2,500.00

TOTAL: $3,800.00
EOF
```

### 5B: Upload to Invoice Inbox
**Browser**: Click "Inbox" → under Invoices, select the test file → click "Upload & Process"

**Verify**:
- Response shows "1 processed"
- Under "Pending Verifications" the file appears

### 5C: Verify Extraction
Click "Verify" on the pending extraction.

**Verify**:
- Fields populated (invoice_number, amount, etc.)
- Confidence scores shown (high/medium/low with colors)
- Project dropdown available for assignment

### 5D: Confirm Extraction
Select the project from dropdown. Click "Confirm & Save".

**Verify**: 
- Alert: "Confirmed and saved!"
- Extraction disappears from pending list

### 5E: Check Project Financials
**Browser**: Click "Projects" → click the project name

**Verify**: 
- Revenue card shows $3,800.00
- Invoice count shows 1

### 5F: File Input Methods (drag-drop, paste, click)
All four inbox cards (Timesheets, Invoices, Purchase Orders, Vendor Quotes & Carts) use the same file-input zone, which supports three input methods.

**Click to choose** (baseline behavior):
1. **Browser**: Click "Inbox" → click anywhere on a card's dashed-border drop zone
2. **Verify**: native file picker opens
3. Select 1+ files → file picker closes; thumbnails appear in the zone
4. Click "Upload & Process" → standard processing flow

**Drag and drop**:
1. Open File Explorer / Finder, locate any PDF or image
2. Drag onto the dashed-border drop zone
3. **Verify on dragenter**: zone border turns blue, background tints blue
4. **Verify on drop**: border returns to default; thumbnail appears
5. Drop multiple files at once → multiple thumbnails appear
6. Drop an unsupported type (e.g. a `.exe`) → file is silently rejected; an inline yellow notice reads "1 file skipped — type not accepted here." (clears after a few seconds)

**Paste from clipboard** (the screenshot use case):
1. Open a vendor's website cart in another tab (Home Depot, Grainger, etc.) — or any page with an image
2. Take a screenshot via Snipping Tool / Print Screen → image is on the clipboard
3. **Browser**: Click "Inbox" → click on the **Vendor Quotes & Carts** drop zone (this gives it focus)
4. Press **Ctrl+V** (or Cmd+V on Mac)
5. **Verify**: a thumbnail of the screenshot appears with auto-generated name `pasted_<timestamp>_<rand>.png`
6. Pick a project (required for vendor quotes) → click "Upload & Process"
7. Verify in extraction-verify that the AI extracted vendor + line items from the screenshot

**Remove a staged file**:
- Click the small "×" in the top-right of any thumbnail → file is removed from staging without re-uploading

**Cross-browser sanity** (one each is enough):
- Chrome / Edge: all three methods work
- Firefox: all three methods work
- Safari: paste only works when the zone is focused (click into it first); drag-drop and click-to-pick always work

---

## TEST 6: Timesheets

### 6A: Upload a Timesheet
Create a test timesheet:
```bash
cat > /tmp/test_timesheet.txt << 'EOF'
DAILY TIMESHEET

Project: 2026-SA-001
Date: 2026-04-14

Worker: John Martinez
Classification: Journeyman
ST Hours: 8.0
OT Hours: 2.0
DT Hours: 0
Miles: 30

Worker: Carlos Rivera
Classification: Apprentice
ST Hours: 8.0
OT Hours: 0
DT Hours: 0
Miles: 30
EOF
```

**Browser**: Inbox → Timesheets → upload → "Upload & Process"

### 6B: Verify & Confirm Timesheet
Click "Verify" on the pending extraction. Assign to project. Confirm.

### 6C: Check Timesheet Data
**Browser**: Click "Timesheets"

**Verify**:
- "All Entries" shows the worker entries
- "By Project" groups and totals hours
- "By Worker" groups by worker name
- Revenue calculated from locked rates (Journeyman: 8×$72 + 2×$108 = $792)

---

## TEST 7: Equipment

### 7A: Create Equipment Items
```bash
curl -s http://localhost:3000/api/equipment \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "barcode_id": "EQ-001",
    "equipment_name": "Hilti TE 70-ATC Rotary Hammer",
    "manufacturer": "Hilti",
    "equipment_type": "Power Tool",
    "equipment_cost": 25,
    "certification_date": "2026-05-01"
  }' | python3 -m json.tool

curl -s http://localhost:3000/api/equipment \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "barcode_id": "EQ-002",
    "equipment_name": "Fluke 376 FC Clamp Meter",
    "manufacturer": "Fluke",
    "equipment_type": "Testing",
    "equipment_cost": 0
  }' | python3 -m json.tool
```

### 7B: View Equipment
**Browser**: Click "Equipment"

**Verify**: Both items show under "Shop" with status "available".

### 7C: Create Equipment Request
Get the project ID first:
```bash
PROJECT_ID=$(curl -s http://localhost:3000/api/projects \
  -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['projects'][0]['id'])")

curl -s http://localhost:3000/api/equipment/requests \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_id\": \"$PROJECT_ID\",
    \"personnel_name\": \"John Martinez\",
    \"items\": [
      {\"item_description\": \"Rotary hammer drill\", \"quantity\": 1},
      {\"item_description\": \"Clamp meter\", \"quantity\": 1}
    ]
  }" | python3 -m json.tool
```

### 7D: Check Display Board
**Browser**: Open http://localhost:3000/display.html?token=shopfloor

**Verify**: Request appears as a ticket with 2 unfilled items (red dots), auto-refreshes.

### 7E: Barcode Scan Lookup
```bash
curl -s http://localhost:3000/api/equipment/barcode/EQ-001 \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Verify**: Returns equipment details + checkout history.

### 7F: Checkout Equipment
Get the equipment ID and request line IDs, then assign:
```bash
# Get equipment ID
EQ_ID=$(curl -s http://localhost:3000/api/equipment/barcode/EQ-001 \
  -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Checkout directly
curl -s http://localhost:3000/api/equipment/$EQ_ID/checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\": \"$PROJECT_ID\"}" | python3 -m json.tool
```

**Verify**: Status changes to "checked_out". Display board shows 1 filled, 1 unfilled.

### 7G: Return Equipment
```bash
curl -s http://localhost:3000/api/equipment/$EQ_ID/return \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Verify**: Status back to "available".

---

## TEST 8: Payment Tracking

### 8A: Check Project Financials
**Browser**: Projects → click your project

**Verify**: Revenue shows invoice amount, cost shows PO amounts.

### 8B: Record Payment (via API)
Get the invoice ID:
```bash
# Get project detail which includes financials
curl -s http://localhost:3000/api/projects/$PROJECT_ID \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Note: To record payment you need the invoice ID. Check the invoices in the database or use the project detail endpoint.

---

## TEST 9: CSV Exports

### 9A: QuickBooks Timesheets
```bash
curl -s http://localhost:3000/api/exports/quickbooks/timesheets \
  -H "Authorization: Bearer $TOKEN" -o qb_timesheets.csv

cat qb_timesheets.csv
```

**Verify**: CSV with headers: Worker, Classification, Date, ST Hours, OT Hours, DT Hours, Miles, Project, Rate ST, Rate OT, Rate DT, Revenue

### 9B: Equipment Export
```bash
curl -s http://localhost:3000/api/exports/equipment \
  -H "Authorization: Bearer $TOKEN" -o equipment.csv

cat equipment.csv
```

### 9C: Custom Export
```bash
curl -s http://localhost:3000/api/exports/custom \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source": "projects", "columns": ["name", "status", "contract_value"]}' \
  -o custom.csv

cat custom.csv
```

---

## TEST 10: Bulk Import

### 10A: Create Test CSV
```bash
cat > /tmp/test_locations.csv << 'EOF'
name,street,town,state,zip,local_union,miles_from_hq
Jersey City Warehouse,500 Harbor Blvd,Jersey City,NJ,07302,164,8
Hoboken Office Tower,100 Washington St,Hoboken,NJ,07030,164,5
Paterson Industrial,250 Market St,Paterson,NJ,07501,98,22
EOF
```

### 10B: Upload & Parse
**Browser**: Admin → Bulk Import tab
- Select target: "locations"
- Choose file: test_locations.csv
- Click "Parse File"

**Verify**: Shows 3 rows, 7 columns, column mapping dropdowns auto-match.

### 10C: Import
Click "Import 3 Rows"

**Verify**: Alert shows "Imported: 3 rows, 0 skipped"

### 10D: Verify
**Browser**: Go to bid create page. Location dropdown should show the 3 new locations.

---

## TEST 11: Audit Trail

**Browser**: Admin → Audit Log tab

**Verify**: Shows entries for everything you did:
- User created
- Rates added
- Bid created
- Project created
- Equipment created
- etc.

---

## TEST 12: Notifications Routing

Check that notifications went to the right people:

```bash
# Check admin notifications
curl -s http://localhost:3000/api/notifications?limit=20 \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Verify**:
- Bid won notification (informational) ✅
- Timesheet extraction ready (actionable) ✅ if uploaded
- Invoice extraction ready (actionable) ✅ if uploaded

### Test Dismiss All Informational:
**Browser**: Notifications → click "Dismiss All Informational"

**Verify**: Informational notifications disappear. Actionable ones stay.

---

## TEST 13: Ollama AI (if running)

### 13A: Check Ollama is reachable
```bash
curl -s http://localhost:11434/api/version
```

### 13B: Upload a real PDF/image to test OCR + AI extraction
Use a real scanned invoice or timesheet (PDF or photo).

**Browser**: Inbox → Invoices → upload the real document

**Verify**:
- Tesseract OCR extracts text
- Ollama parses fields into structured JSON
- Fields show up in verification page with confidence scores
- Low confidence fields highlighted in red/yellow

---

## QUICK SMOKE TEST (5 minutes)

If you just want to verify it's working:

1. Login at http://localhost:3000 ✅
2. Admin → Rate Sheet → add one rate ✅
3. Bids → New Bid → fill scope → Generate Bid ✅
4. Quoting page → enter hours → Save Quote ✅
5. Mark Won → Confirm → project created ✅
6. Projects → click project → financials show ✅
7. Equipment page loads ✅
8. Display board loads at /display.html?token=shopfloor ✅

---

## TEST 14: Per Diem in Quoting

### 14A: Set Per Diem Rate
**Browser**: Admin → Global Variables
- Set `per_diem_daily_rate` to `75.00`
- Set `per_diem_markup_applies` to `false`
- Click "Save Changes"

### 14B: Create Bid with Per Diem
**Browser**: Bids → + New Bid → fill customer/location/scope → open quoting

On quoting page:
- Foreman: Personnel=1, ST=40
- Journeyman: Personnel=3, ST=40
- Project Length: 20 days
- Per Diem: 75.00 (should auto-fill from global)
- Markup: 18%

**Verify**:
- Per Diem card shows: `$75/day × 4p × 20d = $6,000`
- Subtotal = Labor + Mileage (per diem NOT included)
- Markup applies to Subtotal only
- Bid Amount = Subtotal + Markup + Per Diem (pass-through)

### 14C: Generate Docs with Per Diem
Click "Save & Generate Docs"

**Verify Excel** (download from project detail or check `storage/bids/.../*.xlsx`):
- Per Diem section appears between Mileage and Grand Summary
- Grand Summary: Labor + Mileage = Subtotal → Markup → Per Diem (pass-through) → Bid Amount

### 14D: Mark Won → Check Project Inherited Per Diem
Mark Won → Confirm → go to Projects page → click project name to open edit modal.

**Verify**: Per Diem Rate field shows `75` (carried from bid).

---

## TEST 15: Project Edit Modal

### 15A: Click Project Name
**Browser**: Projects page → click any project name (underlined blue link)

**Verify**: Edit modal opens with all fields:
- Name, PM dropdown, Customer dropdown, Location dropdown
- Contract Value, Type, Payment Terms, Local Union
- Per Diem Rate, Miles from HQ, Man Hours
- Status, Start/End Dates, Address, Description

### 15B: Edit and Save
Change Contract Value to $500,000. Click "Save Changes".

**Verify**: Alert says "Project updated". Modal closes. Table refreshes.

### 15C: Search Projects
Type part of a project name in the search box at the top.

**Verify**: Table filters live as you type. Clears when emptied.

---

## TEST 16: Active Projects Dashboard

### 16A: View as Admin
**Browser**: Click "Active Projects" in sidebar

**Verify**: Cards appear for each active project showing:
- Project name + customer name
- This Week: hours + worker count
- ST/OT/DT breakdown
- Contract value + type
- Pending oil samples count with ⚠️ (if any exist)
- Recent foreman notes text (if any exist from test data)

### 16B: Filter by PM
Select a PM from the dropdown at the top.

**Verify**: Only that PM's projects show. Clear filter → all return.

### 16C: Filter by Customer
Select a customer from the dropdown.

**Verify**: Filters further. Both filters work together.

### 16D: PM View
Logout → login as `mike.torres@company.com / ChangeMe123!`
Click "Active Projects".

**Verify**: Only Mike's projects appear. No PM/Customer filter dropdowns shown (PM can't filter — they only see their own).

---

## TEST 17: Field Notes

> Field notes are created by foremen on mobile. Test data includes sample notes. The web page is for PMs/admins to view and export.

### 17A: View Field Notes Page
**Browser** (logged in as admin): Click "Field Notes" in sidebar

**Verify** (test data should already have notes):
- Notes appear in table: Date, Foreman, Project, Note
- Note text truncated with "..." for long notes

### 17B: Expand a Note
Click "View" on any note.

**Verify**: Modal opens showing full note text, date, and foreman name. Close button works.

### 17C: Filter by Project
Select a project from the dropdown at the top.

**Verify**: Table filters to only that project's notes.

### 17D: Filter by Date Range
Enter start and end dates. Click "Filter".

**Verify**: Only notes within the range appear.

### 17E: Export CSV
Click "Export CSV" button.

**Verify**: CSV file downloads. Open it — has columns: Date, Foreman, Project, Note.

### 17F: Create a Note (API — simulates mobile foreman action)
> This is what happens when a foreman taps "Save Note" on their phone.

Open browser console (F12 → Console) and paste:
```javascript
fetch('/api/field-notes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('token') },
  body: JSON.stringify({
    project_id: '<paste any project ID from the URL or network tab>',
    note_date: '2026-04-20',
    note_text: 'Test note from browser console — simulating mobile foreman.'
  })
}).then(r => r.json()).then(console.log);
```

**Verify**: Returns note object. Refresh Field Notes page → note appears.

---

## TEST 18: Oil Samples

> Oil samples are submitted by foremen on mobile via photo upload. The web page is for PMs/admins to track return status.

### 18A: View Oil Samples Page
**Browser**: Click "Oil Samples" in sidebar

**Verify**: Page loads with search fields and status filter.

### 18B: Create a Sample (API — simulates mobile foreman action)
> This is what happens when a foreman photographs a form on their phone.

Browser console:
```javascript
fetch('/api/oil-samples', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('token') },
  body: JSON.stringify({
    project_id: '<any project ID>',
    equipment_id_field: 'CAT-D6T-3204',
    equipment_location: 'Newark Office Park',
    sample_date: '2026-04-18',
    sample_type: 'Engine Oil',
    condition_notes: 'Dark color, slight metal particles'
  })
}).then(r => r.json()).then(d => { console.log('Sample ID:', d.id); console.log(d); });
```

Refresh the Oil Samples page.

**Verify**: Sample appears with status "pending data confirm".

### 18C: Live Search — Equipment ID
Type `CAT` in the Equipment ID box.

**Verify**: Filters instantly to matching samples. Clear it → all return.

### 18D: Live Search — Location
Type `Newark` in the Location box.

**Verify**: Filters by location.

### 18E: Status Filter
Select "Pending Return" from the status dropdown.

**Verify**: Only pending_return samples show (may be empty if none confirmed yet).

### 18F: Confirm Data (API — simulates foreman tapping "Confirm")
Browser console:
```javascript
fetch('/api/oil-samples/<SAMPLE_ID>/confirm-data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('token') },
  body: JSON.stringify({})
}).then(r => r.json()).then(console.log);
```

Refresh page.

**Verify**: Status changes to "pending_return". "Mark Returned" button appears.

### 18G: Mark Returned (Browser)
Click "Mark Returned" on the sample row.

**Verify**: Confirmation dialog → click OK → status changes to "returned".

### 18H: Sidebar Badge
Create another sample (repeat 18B with different equipment ID). Confirm data (18F).

**Verify**: Oil Samples tab in sidebar shows yellow badge with count of pending_return samples.

---

## TEST 19: Timesheet Export

### 19A: Open Export Modal
**Browser**: Projects → click project "Detail" button → click "Export Timesheets"

**Verify**: Modal opens with date range inputs, template selector, "Preview" button.

### 19B: Preview
Enter dates covering test data (2026-03-01 to 2026-03-31). Click "Preview".

**Verify**:
- Summary cards show: Workers count, Entries count, Pages count
- Worker table: Name, Classification, Week Ending, Days, ST, OT, DT, Miles, Per Diem, Labor, Total

### 19C: Download .docx
Click "Download .docx".

**Verify**: File downloads. Open in Word/LibreOffice:
- Landscape orientation
- Header: project name, week ending, PM, local union
- Grid: Worker | Class | Mon ST/OT | Tue ST/OT | Wed ST/OT | Thu ST/OT | Fri ST/OT | Week ST | OT | DT | Miles | Per Diem
- Up to 8 workers per page
- Totals row at bottom
- Page breaks between weeks

---

## TEST 20: Form Templates (Admin)

### 20A: View Tab
**Browser**: Admin → "Form Templates" tab

**Verify**: Upload form with Type dropdown, Name input, File input, "Upload & Analyze" button.

### 20B: Upload (with or without AI)
Select type "Oil Sample", name it "Test Template v1", pick any image file.
Click "Upload & Analyze".

**Verify**:
- If Ollama/Claude running: AI proposes fields, template card shows field list
- If no AI available: Card appears with "No fields detected" message
- Either way: template is saved and can be edited manually

### 20C: Edit Fields
Click "Edit Fields" on the template card.

**Verify**: Modal with editable rows:
- Each row: field name, label text, type dropdown, description, delete button
- "+ Add Field" adds blank row
- "Save Field Map" persists changes

Add a field: name=`test_field`, type=`text`. Save.

**Verify**: Card refreshes showing the new field.

### 20D: Activate / Deactivate
Click "Activate".

**Verify**: Badge changes to "ACTIVE". Any other template for same type becomes inactive.

Click "Deactivate".

**Verify**: Badge changes to "Inactive".

---

## TEST 21: Equipment → Foreman Notification

### 21A: Create Request with Foreman
**Browser** (logged in as admin or PM): Equipment page → or use browser console:

```javascript
// Get a project and foreman ID from the network tab, then:
fetch('/api/equipment/requests', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('token') },
  body: JSON.stringify({
    project_id: '<PROJECT_ID>',
    assigned_foreman_id: '<FOREMAN_USER_ID>',
    items: [{ item_description: 'Generator 5kW', quantity: 1 }]
  })
}).then(r => r.json()).then(console.log);
```

**Verify**: Response shows request with `assigned_foreman_id` populated.

### 21B: Check Notifications
**Browser**: Notifications page (as admin)

**Verify**: 
- Notification #12 exists: "New equipment request" (to shop staff)
- Notification #14 exists: "Equipment request assigned to you" (to foreman)

### 21C: Verify Foreman Received It
Logout → login as `carlos.mendez@company.com / ChangeMe123!`

**Verify**: Sidebar is empty (no web tabs — mobile only). But if you check via console:

```javascript
fetch('/api/notifications', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') } })
  .then(r => r.json()).then(d => console.log(d.notifications?.map(n => n.type)));
```

**Verify**: Shows `equipment_assigned_to_foreman` in the list.

---

## TEST 22: Financial Accuracy

### 22A: Project Detail Cost Breakdown
**Browser** (as admin): Projects → click "Detail" on a project with test data

**Verify financial cards**:
- **Total Cost** = PO + Equipment + Mileage + Per Diem (all 4 components)
- **Mileage** shows as separate card
- **Per Diem** shows as separate card (if > $0)
- **Margin** = Revenue - Total Cost (per diem is included in cost)

### 22B: QuickBooks Timesheet Export
**Browser**: Data Export → or download via console:

```javascript
window.open('/api/exports/quickbooks/timesheets', '_blank');
```

Open the CSV.

**Verify columns**: Worker, Classification, **Week Ending**, **Days**, ST Hours, OT Hours, DT Hours, Miles, **Mileage Cost**, **Per Diem**, Project, Rate ST, Rate OT, Rate DT, Revenue

### 22C: Procore Budget Export
```javascript
window.open('/api/exports/procore/budget', '_blank');
```

Open the CSV.

**Verify columns**: Project, Customer, Contract Value, Revenue, **PO Cost**, **Mileage**, **Per Diem**, **Total Cost**, Margin, Margin %

**Verify math**: Total Cost = PO Cost + Mileage + Per Diem (not just PO cost).

---

## TEST 23: Foreman Web Access Blocked

### 23A: Login as Foreman
Logout → login as `carlos.mendez@company.com / ChangeMe123!`

**Verify**: 
- Sidebar shows Account section only (name, role, Settings, Logout)
- **No navigation tabs** — no Dashboard, no Projects, no Equipment, nothing
- This is intentional: foreman uses the mobile app only

---

## QUICK SMOKE TEST (5 minutes)

If you just need to confirm the system is working after a deploy:

1. Login at http://localhost:3000 (admin) ✅
2. Dashboard loads with bid stats ✅
3. Admin → Global Variables → per_diem_daily_rate visible ✅
4. Bids → + New Bid → quoting page → Per Diem field visible ✅
5. Projects page → click project name → Edit Modal opens ✅
6. Projects → Detail → Mileage + Per Diem cards show ✅
7. Active Projects page loads with weekly data cards ✅
8. Oil Samples page → search fields + status filter load ✅
9. Field Notes page → project filter + Export CSV button load ✅
10. Admin → Form Templates tab → upload UI loads ✅
11. Timesheets page → weekly entries with Per Diem column ✅
12. Project Detail → Export Timesheets → preview works ✅
13. Equipment page loads ✅
14. Display board loads at /display.html?token=shopfloor ✅
15. Login as foreman → empty sidebar (mobile only) ✅

---

## MOBILE APP TEST (requires phone + Expo Go)

### Setup
```bash
cd mobile && npm install
# Edit src/services/api.js line 7 → your computer's local IP (not localhost)
# e.g., const BASE_URL = __DEV__ ? 'http://192.168.1.50:3000' : ...
npx expo start
# Scan QR code with Expo Go on your phone
# Phone and computer must be on the same WiFi
```

### Login Tests
1. Login as **PM** (`mike.torres@company.com / ChangeMe123!`) → see Equipment Requests + Quick Bid tabs ✅
2. Login as **Shop Staff** (`ray.jackson@company.com / ChangeMe123!`) → see Open / Return / Maintenance tabs ✅
3. Login as **Foreman** (`carlos.mendez@company.com / ChangeMe123!`) → see Field Notes + Oil Samples tabs ✅
4. Login as **Admin** (`admin@company.com / ChangeMe123!`) → see Requests overview tab ✅

### Feature Tests (per role)

**PM:**
5. Equipment Requests tab → "New Equipment Request" → pick project → add items → Submit ✅
6. Quick Bid tab → pick customer + location → type scope → "Create Bid" → bid number shows ✅
7. Bell icon in header shows notification count ✅

**Shop Staff:**
8. Open Requests tab → request list loads → "Scan" button opens camera ✅
9. Return tab → "Scan Barcode" opens camera ✅
10. Maintenance tab → "Scan Barcode" → flag equipment status ✅

**Foreman:**
11. Field Notes → Add tab → pick project → type note → "Save Note" ✅
12. Field Notes → Edit tab → pick project → notes load → tap to edit ✅
13. Oil Samples → "New Oil Sample" → pick project → "Take Photo" → camera opens ✅
14. Bell icon → notification drawer shows equipment assignment notifications ✅

**All roles:**
15. Profile tab → name, role, email display → "Sign Out" works ✅
