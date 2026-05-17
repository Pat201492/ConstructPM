# ═══════════════════════════════════════════════════════════════════
# Ollama Setup Script — Windows
# ═══════════════════════════════════════════════════════════════════
#
# Usage:
#   .\setup-ollama-windows.ps1 -Preset local-standard
#
# What it does:
#   1. Verifies Ollama is installed (points you to installer if not)
#   2. Starts the Ollama service if not running
#   3. Pulls the models required for the chosen preset
#   4. Runs a quick smoke test
#
# Run from PowerShell in the scripts/ directory.
# If you get an execution policy error, first run:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('cloud-only', 'hybrid-lite', 'local-lite', 'local-standard', 'local-heavy', 'cpu-only')]
    [string]$Preset
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Ollama Setup for preset: $($Preset.PadRight(18)) ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ─── Step 1: Check if Ollama is installed ───
Write-Host "[1/4] Checking Ollama installation..." -ForegroundColor Yellow
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
    Write-Host "  ✗ Ollama not found on PATH." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Install Ollama from: https://ollama.com/download/windows" -ForegroundColor Yellow
    Write-Host "  Run the installer, then re-run this script." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
Write-Host "  ✓ Ollama found: $($ollamaCmd.Source)" -ForegroundColor Green

# ─── Step 2: Ensure Ollama service is running ───
Write-Host ""
Write-Host "[2/4] Checking Ollama service..." -ForegroundColor Yellow
$serviceRunning = $false
try {
    $resp = Invoke-WebRequest -Uri 'http://localhost:11434/api/tags' -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue
    if ($resp.StatusCode -eq 200) { $serviceRunning = $true }
}
catch {
    $serviceRunning = $false
}

if (-not $serviceRunning) {
    Write-Host "  ⚠ Service not running. Starting 'ollama serve' in background..." -ForegroundColor Yellow
    Start-Process 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    Start-Sleep -Seconds 4
    try {
        $resp = Invoke-WebRequest -Uri 'http://localhost:11434/api/tags' -TimeoutSec 3 -UseBasicParsing
        if ($resp.StatusCode -eq 200) {
            Write-Host "  ✓ Ollama service now running on port 11434" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  ✗ Could not start Ollama service. Try 'ollama serve' in a separate terminal." -ForegroundColor Red
        exit 1
    }
}
else {
    Write-Host "  ✓ Ollama service running on port 11434" -ForegroundColor Green
}

# ─── Step 3: Pull required models for the preset ───
Write-Host ""
Write-Host "[3/4] Pulling models for preset '$Preset'..." -ForegroundColor Yellow

$models = @()
switch ($Preset) {
    'cloud-only' {
        Write-Host "  ℹ Cloud-only preset — no local models needed." -ForegroundColor Cyan
        Write-Host "  ℹ Make sure ANTHROPIC_API_KEY is set in your .env file." -ForegroundColor Cyan
    }
    'hybrid-lite' { $models = @('llama3:8b') }
    'local-lite' { $models = @('llama3:8b', 'llava:7b') }
    'local-standard' { $models = @('llama3:8b', 'llava:13b') }
    'local-heavy' { $models = @('llama3:70b', 'llava:34b') }
    'cpu-only' { $models = @('llama3:8b', 'llava:7b') }
}

foreach ($model in $models) {
    Write-Host ""
    Write-Host "  Pulling $model ..." -ForegroundColor Cyan
    Write-Host "  (first pull may take 5-30 minutes depending on model size and connection)"
    & ollama pull $model
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ Failed to pull $model" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✓ $model ready" -ForegroundColor Green
}

# ─── Step 4: Smoke test ───
Write-Host ""
Write-Host "[4/4] Running smoke test..." -ForegroundColor Yellow

if ($models.Count -gt 0) {
    $testModel = $models[0]
    Write-Host "  Querying $testModel with a simple prompt..."
    try {
        $body = @{
            model  = $testModel
            prompt = 'Reply with just the word: ok'
            stream = $false
        } | ConvertTo-Json

        $resp = Invoke-RestMethod -Uri 'http://localhost:11434/api/generate' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 60
        if ($resp.response) {
            Write-Host "  ✓ $testModel responded: $($resp.response.Trim())" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  ⚠ Smoke test failed but models are pulled. You can try the app now." -ForegroundColor Yellow
    }
}

# ─── Done ───
Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  Setup Complete!                             ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Make sure your .env contains: AI_PRESET=$Preset"
Write-Host "  2. Restart the backend:          node src/server.js"
Write-Host "                                   or: docker compose restart"
Write-Host "  3. Verify config:                node scripts/test-ai-config.js"
Write-Host ""
