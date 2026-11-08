# Back up SQLite (consistent online copy), documents, settings, metadata and the vector store.
#   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1 [-NoVectors] [-Destination D:\Backups]
param([switch]$NoVectors, [string]$Destination = "")
. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = "Continue"

Write-Step "Creating backup"
$args2 = @("-m", "backend.services.backup", "create")
if ($NoVectors) { $args2 += "--no-vectors" }
$code = Invoke-AppPython $args2
if ($code -ne 0) { Write-Bad "Backup failed."; exit 1 }
$latest = Get-ChildItem (Join-Path $DataDir "backups") -Filter "examcoach-backup-*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Step "Verifying backup"
$code = Invoke-AppPython @("-m", "backend.services.backup", "verify", $latest.FullName)
if ($code -ne 0) { Write-Bad "Verification failed for $($latest.Name)"; exit 1 }
Write-Ok "Backup verified: $($latest.FullName) ($([math]::Round($latest.Length/1MB,2)) MB)"
if ($Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Copy-Item $latest.FullName -Destination $Destination
    Write-Ok "Copied to $Destination"
}
Write-Info "Tip: copy backups to an external drive or cloud folder you trust. They contain your study data."
