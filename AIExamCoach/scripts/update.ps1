# Update AI Exam Coach code and dependencies while preserving all data.
# data\ (database, documents, vectors, backups) and config\settings.json are never overwritten.
#   powershell -ExecutionPolicy Bypass -File scripts\update.ps1
. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = "Continue"

Write-Step "Backing up before updating"
& "$PSScriptRoot\backup.ps1"
if ($LASTEXITCODE -ne 0) { Write-Bad "Backup failed - update aborted to protect your data."; exit 1 }

$wasRunning = [bool](Get-AppProcess)
if ($wasRunning) { & "$PSScriptRoot\stop.ps1" }

$repoRoot = $null
if (Test-Command "git") {
    Push-Location $Root
    try { $repoRoot = (& git rev-parse --show-toplevel 2>$null) } finally { Pop-Location }
}
if ($repoRoot) {
    Write-Step "Fetching the latest code"
    Push-Location $Root
    try {
        $dirty = & git status --porcelain -- . 2>$null | Where-Object { $_ -notmatch '^\?\? ' }
        if ($dirty) { Write-Warn2 "You have local code changes:"; $dirty | ForEach-Object { Write-Info $_ } }
        if (Confirm-Action "Run 'git pull --ff-only' now?") { & git pull --ff-only }
    } finally { Pop-Location }
} else { Write-Info "Not a git checkout - copy the new code over the old folder (keep data\ and config\), then run this script." }

Write-Step "Updating backend packages"
& $Python -m pip install -r (Join-Path $Root "backend\requirements.txt") --upgrade-strategy only-if-needed
Write-Step "Rebuilding the web interface"
Push-Location (Join-Path $Root "frontend")
try { $env:NEXT_TELEMETRY_DISABLED = "1"; & npm.cmd ci --no-audit --no-fund; & npm.cmd run build } finally { Pop-Location }
Write-Step "Applying database schema updates (new tables only; existing data untouched)"
Invoke-AppPython @("-c", "from backend.database.session import init_db, health_check; init_db(); print(health_check())") | Out-Null

if ($wasRunning) { & "$PSScriptRoot\start.ps1" }
Write-Ok "Update complete"
