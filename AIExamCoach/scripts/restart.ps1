# Restart AI Exam Coach safely.
param([switch]$Open)
& "$PSScriptRoot\stop.ps1"
Start-Sleep -Seconds 1
if ($Open) { & "$PSScriptRoot\start.ps1" -Open } else { & "$PSScriptRoot\start.ps1" }
