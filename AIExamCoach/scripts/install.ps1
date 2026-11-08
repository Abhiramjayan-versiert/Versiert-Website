# AI Exam Coach installer for Windows 10/11.
# Every download, installation or system change asks for your approval first.
# Usage (from the AIExamCoach folder):
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
param(
    [switch]$SkipModels,
    [switch]$Yes   # answer "yes" to dependency prompts (models and Ollama settings are still asked)
)
. "$PSScriptRoot\common.ps1"
# Native tools (pip, npm, winget, taskkill) write warnings to stderr; check exit codes explicitly instead.
$ErrorActionPreference = "Continue"

function Ask([string]$q) { if ($Yes) { Write-Info "$q -> yes (-Yes)"; return $true } else { return (Confirm-Action $q) } }

Write-Host ""
Write-Host "AI Exam Coach - installation" -ForegroundColor White
Write-Host "Root: $Root"
Write-Host ""

# ---------------------------------------------------------------- 1. inspect
& "$PSScriptRoot\inspect.ps1"
$hasWinget = Test-Command "winget"

# ---------------------------------------------------------------- 2. plan
Write-Host ""
Write-Step "Installation plan"
$plan = @()
$pyOk = $false
foreach ($c in @("py", "python")) {
    if (Test-Command $c) {
        $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        try {
            if ($c -eq "py") { $v = & py -3 -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null } else { $v = & python -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null }
        } catch { $v = $null } finally { $ErrorActionPreference = $old }
        if ($v -and ([version]$v -ge [version]"3.10") -and ([version]$v -lt [version]"3.14")) { $pyOk = $true; $PyCmd = $c; break }
    }
}
if (-not $pyOk) { $plan += "Install Python 3.12 (winget: Python.Python.3.12)" }
if (-not (Test-Command "node")) { $plan += "Install Node.js LTS (winget: OpenJS.NodeJS.LTS) - needed once to build the web interface" }
$tess = (Test-Command "tesseract") -or (Test-Path "C:\Program Files\Tesseract-OCR\tesseract.exe")
if (-not $tess) { $plan += "Install Tesseract OCR (winget: UB-Mannheim.TesseractOCR) - for scanned PDFs and handwritten answers" }
if (-not (Test-Command "ollama")) { $plan += "Install Ollama for Windows (winget: Ollama.Ollama) - https://ollama.com/download/windows" }
$plan += "Create Python virtual environment in .venv and install backend packages (~1.5 GB)"
$plan += "Install frontend packages and build the web interface (frontend\out)"
$plan += "Configure Ollama user environment variables (local-only, 1 model, 4096 context) - asks first"
$plan += "Download models qwen3:4b (~2.5 GB) and embeddinggemma (~0.6 GB) if missing - asks first"
$plan += "Initialise the SQLite database in data\database"
$plan | ForEach-Object { Write-Info "- $_" }
Write-Host ""
if (-not (Confirm-Action "Proceed with this plan? (each download/change will still be confirmed)")) { Write-Warn2 "Cancelled."; exit 1 }

function Install-Winget([string]$id, [string]$label) {
    if (-not $hasWinget) { Write-Bad "winget is not available. Install $label manually, then re-run this script."; return $false }
    if (-not (Ask "Install $label with winget ($id)?")) { Write-Warn2 "Skipped $label"; return $false }
    winget install --id $id --exact --accept-package-agreements --accept-source-agreements --silent
    # refresh PATH for this session
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    return $true
}

# ---------------------------------------------------------------- 3. prerequisites
if (-not $pyOk) { Install-Winget "Python.Python.3.12" "Python 3.12" | Out-Null; $PyCmd = "py" }
if (-not (Test-Command "node")) { Install-Winget "OpenJS.NodeJS.LTS" "Node.js LTS" | Out-Null }
if (-not $tess) { Install-Winget "UB-Mannheim.TesseractOCR" "Tesseract OCR" | Out-Null }
if (-not (Test-Command "ollama")) { Install-Winget "Ollama.Ollama" "Ollama" | Out-Null }

# ---------------------------------------------------------------- 4. directories
Write-Step "Preparing folders (existing files are never overwritten)"
foreach ($d in @("data\database", "data\documents", "data\uploads", "data\vector_store", "data\backups", "data\run", "data\secrets", "logs", "config")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Root $d) | Out-Null
}
Write-Ok "Folders ready"

# ---------------------------------------------------------------- 5. python env
Write-Step "Python environment"
if (-not (Test-Path $Python)) {
    if ($PyCmd -eq "py") { & py -3.12 -m venv $Venv 2>$null; if (-not (Test-Path $Python)) { & py -3 -m venv $Venv } }
    else { & python -m venv $Venv }
}
if (-not (Test-Path $Python)) { Write-Bad "Could not create the virtual environment."; exit 1 }
& $Python -m pip install --upgrade pip --quiet
& $Python -m pip install -r (Join-Path $Root "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Bad "pip install failed - see the messages above."; exit 1 }
Write-Ok "Backend packages installed"

# ---------------------------------------------------------------- 6. frontend
Write-Step "Web interface"
if (Test-Command "npm.cmd") {
    Push-Location (Join-Path $Root "frontend")
    try {
        $env:NEXT_TELEMETRY_DISABLED = "1"
        if (Test-Path "package-lock.json") { & npm.cmd ci --no-audit --no-fund } else { & npm.cmd install --no-audit --no-fund }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
        Write-Ok "Web interface built (frontend\out)"
    } finally { Pop-Location }
} else { Write-Bad "npm not found - install Node.js LTS and re-run." }

# ---------------------------------------------------------------- 7. ollama settings
Write-Step "Ollama configuration"
$wanted = [ordered]@{
    OLLAMA_NO_CLOUD = "1"; OLLAMA_NUM_PARALLEL = "1"; OLLAMA_MAX_LOADED_MODELS = "1"; OLLAMA_CONTEXT_LENGTH = "4096";
    OLLAMA_KEEP_ALIVE = "5m"; OLLAMA_MAX_QUEUE = "8"; OLLAMA_HOST = "127.0.0.1:11434"
}
$changes = @()
foreach ($k in $wanted.Keys) {
    $cur = [Environment]::GetEnvironmentVariable($k, "User")
    if ($cur -ne $wanted[$k]) { $changes += $k }
}
if ($changes.Count -eq 0) { Write-Ok "Ollama variables already configured" }
else {
    Write-Info "These user environment variables will be set: "
    foreach ($k in $changes) { Write-Info ("  {0} = {1}  (currently: {2})" -f $k, $wanted[$k], $(if ([Environment]::GetEnvironmentVariable($k, 'User')) { [Environment]::GetEnvironmentVariable($k, 'User') } else { 'not set' })) }
    Write-Info "All are supported by current Ollama for Windows (see 'ollama serve --help')."
    if (Confirm-Action "Apply these Ollama settings (user scope, no admin needed)?") {
        foreach ($k in $changes) { [Environment]::SetEnvironmentVariable($k, $wanted[$k], "User") }
        Write-Ok "Saved. Ollama must be restarted to pick them up."
        if (Confirm-Action "Restart Ollama now? (quits the Ollama tray app and starts it again)") {
            Get-Process -Name "ollama app", "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            foreach ($k in $wanted.Keys) { Set-Item -Path "Env:$k" -Value $wanted[$k] }
            $appExe = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
            if (Test-Path $appExe) { Start-Process $appExe } else { Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden }
            for ($i = 0; $i -lt 20 -and -not (Get-OllamaVersion); $i++) { Start-Sleep -Seconds 1 }
        }
    } else { Write-Warn2 "Skipped. The app still works, but Ollama may use more memory than intended." }
}
$ov = Get-OllamaVersion
if ($ov) { Write-Ok "Ollama $ov is running" } else { Write-Warn2 "Ollama is not running. Start it from the Start menu before using the app." }

# ---------------------------------------------------------------- 8. models
if (-not $SkipModels -and $ov) {
    Write-Step "Models"
    $tags = (Invoke-RestMethod "$OllamaUrl/api/tags").models | ForEach-Object { $_.name -replace ':latest$', '' }
    foreach ($m in @(@{n = "qwen3:4b"; s = "2.5 GB"}, @{n = "embeddinggemma"; s = "0.6 GB"})) {
        if ($tags -contains $m.n) { Write-Ok "$($m.n) already installed" }
        elseif (Confirm-Action "Download $($m.n) ($($m.s))?") { & ollama pull $m.n }
        else { Write-Warn2 "Skipped $($m.n). Download it later from the Model Manager." }
    }
    Write-Info "Larger models (qwen3:8b and up) are never downloaded automatically."
}

# ---------------------------------------------------------------- 9. database
Write-Step "Database"
Push-Location $Root
try {
    & $Python -c "from backend.database.session import init_db, health_check; init_db(); print(health_check())"
    Write-Ok "SQLite database ready (data\database\examcoach.db)"
} finally { Pop-Location }

Write-Host ""
Write-Ok "Installation complete."
Write-Info "Start the app:   powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Open"
Write-Info "Remote access:   see docs\REMOTE_ACCESS.md (LAN or Tailscale)"
