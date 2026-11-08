# Stop AI Exam Coach. Only stops the process recorded in data\run\backend.pid
# after verifying it is this app's Python running backend.main. Never touches
# Ollama or any unrelated process.
. "$PSScriptRoot\common.ps1"
# Native tools (pip, npm, winget, taskkill) write warnings to stderr; check exit codes explicitly instead.
$ErrorActionPreference = "Continue"

$proc = Get-AppProcess
if (-not $proc) {
    if (Test-Path $PidFile) { Remove-Item $PidFile -Force }
    Write-Ok "AI Exam Coach is not running."
    exit 0
}
Write-Step "Stopping AI Exam Coach (PID $($proc.ProcessId))"
# Ask politely first (taskkill without /F), then force only this PID and its children.
& taskkill /PID $proc.ProcessId /T 2>$null | Out-Null
for ($i = 0; $i -lt 10; $i++) {
    if (-not (Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
}
if (Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue) {
    & taskkill /PID $proc.ProcessId /T /F 2>$null | Out-Null
}
Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Write-Ok "Stopped. (SQLite uses write-ahead logging, so no data is lost on stop.)"
Write-Info "Ollama was left running; quit it from the system tray if you want to free memory."
