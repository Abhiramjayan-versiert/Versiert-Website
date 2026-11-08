# Restore a backup. Validates checksums and database integrity first, asks for
# confirmation, stops the app, takes a safety backup of the current state, restores.
#   powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -Path data\backups\examcoach-backup-YYYYMMDD-HHMMSS.zip
param([Parameter(Mandatory = $true)][string]$Path)
. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = "Continue"

$full = Resolve-Path $Path -ErrorAction SilentlyContinue
if (-not $full) { Write-Bad "File not found: $Path"; exit 1 }
Write-Step "Validating $full"
$code = Invoke-AppPython @("-m", "backend.services.backup", "verify", "$full")
if ($code -ne 0) { Write-Bad "This backup failed validation and will not be restored."; exit 1 }
Write-Ok "Backup is valid"

Write-Host ""
Write-Warn2 "Restoring REPLACES the current database, uploaded documents, settings and search index."
Write-Info "A safety backup of the current state is created first (label: pre-restore)."
$answer = Read-Host "Type RESTORE to continue"
if ($answer -ne "RESTORE") { Write-Info "Cancelled. Nothing was changed."; exit 0 }

$wasRunning = [bool](Get-AppProcess)
if ($wasRunning) { & "$PSScriptRoot\stop.ps1" }
$code = Invoke-AppPython @("-m", "backend.services.backup", "restore", "$full", "--yes")
if ($code -ne 0) { Write-Bad "Restore failed. Your pre-restore safety backup is in data\backups."; exit 1 }
Write-Ok "Restore complete"
Write-Info "If the backup did not include the vector store, open Document Library and click 'Re-index all'."
if ($wasRunning) { & "$PSScriptRoot\start.ps1" }
