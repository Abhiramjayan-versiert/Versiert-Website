# Start AI Exam Coach automatically when you sign in to Windows, so the web app
# is always available to your browser, MacBook and iPhone while the PC is on.
#   powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Enable
#   powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Disable
# Uses a shortcut in your personal Startup folder (no administrator rights,
# removable at any time). Ollama's own installer already starts Ollama at sign-in.
param([switch]$Enable, [switch]$Disable)
. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = "Continue"

$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "AI Exam Coach.lnk"

if ($Disable) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Ok "Auto-start removed." } else { Write-Ok "Auto-start was not enabled." }
    exit 0
}
if (-not $Enable) {
    if (Test-Path $lnk) { Write-Ok "Auto-start is enabled ($lnk)" } else { Write-Info "Auto-start is disabled. Use -Enable to turn it on." }
    exit 0
}

Write-Info "This creates '$lnk' which runs scripts\start.ps1 hidden when you sign in to Windows."
if (-not (Confirm-Action "Enable auto-start?")) { Write-Info "Cancelled."; exit 0 }
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSScriptRoot\start.ps1`""
$s.WorkingDirectory = $Root
$s.WindowStyle = 7
$s.Description = "Start AI Exam Coach (local web app)"
$s.Save()
Write-Ok "Auto-start enabled. The web app will start each time you sign in."
Write-Info "For remote use also keep the PC awake: Settings > System > Power > Sleep = Never (when plugged in)."
