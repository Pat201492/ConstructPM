# ══════════════════════════════════════════════════════════════
# Construction PM Platform — Full Workflow Test Script
#
# Run this AFTER "docker compose up" is running.
# Open a NEW PowerShell window and run:
#   .\scripts\test-workflow.ps1
# ══════════════════════════════════════════════════════════════

$API = "http://localhost:3000"
$ErrorActionPreference = "Stop"

function Write-Step($num, $desc) {
    Write-Host "`n[$num] $desc" -ForegroundColor Cyan
    Write-Host ("-" * 50)
}

function Test-Response($response, $what) {
    if ($response) {
        Write-Host "  OK: $what" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: $what" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Construction PM — Workflow Test"        -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# ── STEP 1: HEALTH CHECK ──────────────────────────────────
Write-Step "1/12" "Health Check"
try {
    $health = Invoke-RestMethod -Uri "$API/api/health"
    Test-Response ($health.status -eq "ok") "Server is healthy"
} catch {
    Write-Host "  FAIL: Server not reachable at $API" -ForegroundColor Red
    Write-Host "  Make sure 'docker compose up' is running." -ForegroundColor Yellow
    exit 1
}

# ── STEP 2: LOGIN ─────────────────────────────────────────
Write-Step "2/12" "Login as Admin"
$login = Invoke-RestMethod -Uri "$API/api/auth/login" `
    -Method POST -ContentType "application/json" `
    -Body '{"email":"admin@company.com","password":"ChangeMe123!"}'
$token = $login.accessToken
$headers = @{ Authorization = "Bearer $token" }
Test-Response ($token.Length -gt 10) "Got access token"
Write-Host "  User: $($login.user.firstName) $($login.user.lastName) ($($login.user.role))"

# ── STEP 3: VIEW PROFILE ─────────────────────────────────
Write-Step "3/12" "View Profile"
$me = Invoke-RestMethod -Uri "$API/api/auth/me" -Headers $headers
Test-Response ($me.user.email -eq "admin@company.com") "Profile retrieved"

# ── STEP 4: CREATE USERS ─────────────────────────────────
Write-Step "4/12" "Create Test Users (PM, Accounting, Shop, Field)"
$users = @(
    @{email="mike@company.com"; password="MikePM2026!"; first_name="Mike"; last_name="Torres"; role="project_manager"},
    @{email="lisa@company.com"; password="LisaAcct2026!"; first_name="Lisa"; last_name="Park"; role="accounting"},
    @{email="tom@company.com"; password="TomShop2026!"; first_name="Tom"; last_name="Russo"; role="shop_manager"},
    @{email="john@company.com"; password="JohnField2026!"; first_name="John"; last_name="Rivera"; role="field_staff"}
)
foreach ($u in $users) {
    try {
        $created = Invoke-RestMethod -Uri "$API/api/users" `
            -Method POST -Headers $headers -ContentType "application/json" `
            -Body ($u | ConvertTo-Json)
        Write-Host "  Created: $($created.user.first_name) $($created.user.last_name) ($($created.user.role))" -ForegroundColor Green
    } catch {
        Write-Host "  Skipped (may already exist): $($u.email)" -ForegroundColor Yellow
    }
}

# ── STEP 5: CREATE CUSTOMER ──────────────────────────────
Write-Step "5/12" "Create Customer"
$custBody = @{
    name = "Harbor Logistics"
    contact_name = "Mike Johnson"
    email = "mike@harborlogistics.com"
    phone = "201-555-0100"
    address = "50 Meadowlands Pkwy"
    city = "Secaucus"
    state = "NJ"
    zip = "07094"
} | ConvertTo-Json

$cust = Invoke-RestMethod -Uri "$API/api/customers" `
    -Method POST -Headers $headers -ContentType "application/json" `
    -Body $custBody
$custId = $cust.customer.id
Test-Response ($custId) "Customer created: $($cust.customer.name) (ID: $($custId.Substring(0,8))...)"

# ── STEP 6: CREATE BID ──────────────────────────────────
Write-Step "6/12" "Create Bid (with folder generation)"
$bidBody = @{
    bid_number = "B-2026-TEST-001"
    project_location = "Newark, NJ"
    project_scope = "Office Renovation"
    customer_id = $custId
    estimated_value = 285000
    description = "Full office renovation including HVAC, electrical, and finishes"
} | ConvertTo-Json

$bid = Invoke-RestMethod -Uri "$API/api/bids" `
    -Method POST -Headers $headers -ContentType "application/json" `
    -Body $bidBody
$bidId = $bid.bid.id
Test-Response ($bidId) "Bid created: $($bid.bid.bid_number)"
Write-Host "  Folder: $($bid.folder_path)"

# ── STEP 7: LIST BIDS ───────────────────────────────────
Write-Step "7/12" "List Bids + Stats"
$bids = Invoke-RestMethod -Uri "$API/api/bids" -Headers $headers
Write-Host "  Total bids: $($bids.total)"

$stats = Invoke-RestMethod -Uri "$API/api/bids/stats" -Headers $headers
Write-Host "  Win rate: $($stats.stats.win_rate)%"

# ── STEP 8: MARK BID AS WON (CREATES PROJECT) ───────────
Write-Step "8/12" "Mark Bid as Won (triggers project creation)"
$wonBody = @{
    contract_value = 295000
    start_date = "2026-05-01"
} | ConvertTo-Json

$won = Invoke-RestMethod -Uri "$API/api/bids/$bidId/mark-won" `
    -Method POST -Headers $headers -ContentType "application/json" `
    -Body $wonBody
$projectId = $won.project.id
Test-Response ($projectId) "Project created: $($won.project.name)"
Write-Host "  Bid status: $($won.bid.status)"
Write-Host "  Contract value: `$$($won.project.contract_value)"
Write-Host "  Project folder: $($won.project.folder_path)"

# ── STEP 9: VIEW PROJECT WITH FINANCIALS ─────────────────
Write-Step "9/12" "View Project Detail"
$proj = Invoke-RestMethod -Uri "$API/api/projects/$projectId" -Headers $headers
Write-Host "  Name: $($proj.project.name)"
Write-Host "  PM: $($proj.project.pm_name)"
Write-Host "  Contract: `$$($proj.project.contract_value)"
Write-Host "  Subfolders available: invoices, timesheets, purchase_orders, contracts"

# ── STEP 10: CREATE INVENTORY ────────────────────────────
Write-Step "10/12" "Create Inventory Items"
$items = @(
    @{item_name="2x4 Lumber 8ft"; category="Lumber"; sku="LBR-2x4-8"; quantity=200; unit="pcs"; min_stock=50; unit_cost=4.50},
    @{item_name="Portland Cement 94lb"; category="Concrete"; sku="CEM-94"; quantity=10; unit="bags"; min_stock=25; unit_cost=12.00}
)
foreach ($item in $items) {
    try {
        $inv = Invoke-RestMethod -Uri "$API/api/inventory" `
            -Method POST -Headers $headers -ContentType "application/json" `
            -Body ($item | ConvertTo-Json)
        Write-Host "  Created: $($inv.item.item_name) ($($inv.item.quantity) $($inv.item.unit))" -ForegroundColor Green
    } catch {
        Write-Host "  Skipped (may already exist): $($item.item_name)" -ForegroundColor Yellow
    }
}

# Check low stock
$lowStock = Invoke-RestMethod -Uri "$API/api/inventory/low-stock" -Headers $headers
Write-Host "  Low stock items: $($lowStock.count)"

# ── STEP 11: SUBMIT TIMESHEET (as field staff) ──────────
Write-Step "11/12" "Submit Timesheet (as Field Staff)"
$fieldLogin = Invoke-RestMethod -Uri "$API/api/auth/login" `
    -Method POST -ContentType "application/json" `
    -Body '{"email":"john@company.com","password":"JohnField2026!"}'
$fieldHeaders = @{ Authorization = "Bearer $($fieldLogin.accessToken)" }

$tsBody = @{
    project_id = $projectId
    work_date = (Get-Date).ToString("yyyy-MM-dd")
    hours = 8
    overtime_hours = 1.5
    description = "Framing work on 2nd floor"
} | ConvertTo-Json

$ts = Invoke-RestMethod -Uri "$API/api/timesheets/submit" `
    -Method POST -Headers $fieldHeaders -ContentType "application/json" `
    -Body $tsBody
Test-Response ($ts.timesheet) "Timesheet submitted: $($ts.timesheet.hours)h + $($ts.timesheet.overtime_hours)h OT"

# ── STEP 12: CHECK NOTIFICATIONS ─────────────────────────
Write-Step "12/12" "Check Notifications"
$notifs = Invoke-RestMethod -Uri "$API/api/notifications" -Headers $headers
Write-Host "  Notifications: $($notifs.total)"
Write-Host "  Unread: $($notifs.unread)"

# ── DONE ─────────────────────────────────────────────────
Write-Host "`n"
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ALL TESTS PASSED" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your platform is running at: http://localhost:3000"
Write-Host ""
Write-Host "What was created:"
Write-Host "  - 5 users (admin, PM, accounting, shop manager, field staff)"
Write-Host "  - 1 customer (Harbor Logistics)"
Write-Host "  - 1 bid (B-2026-TEST-001) -> marked as WON"
Write-Host "  - 1 active project (Newark Office Renovation)"
Write-Host "  - 2 inventory items (lumber + cement)"
Write-Host "  - 1 timesheet (submitted by field staff)"
Write-Host ""
Write-Host "Next: Try uploading a PDF invoice to test AI extraction:"
Write-Host "  POST http://localhost:3000/api/files/project/$projectId/invoices"
Write-Host "  (Use Postman with form-data, key: 'files', value: select your PDF)"
Write-Host ""
