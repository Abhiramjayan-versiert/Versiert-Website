# Start AI Exam Coach.
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1 [-Open]
param([switch]$Open)
. "$PSScriptRoot\common.ps1"
# Native tools (pip, npm, winget, taskkill) write warnings to stderr; check exit codes explicitly instead.
$ErrorActionPreference = "Continue"

$s = Get-AppSettings
$port = $s.port

Write-Step "Checking dependencies"
if (-not (Test-Path $Python)) { Write-Bad "Not installed yet. Run scripts\install.ps1 first."; exit 1 }
if (-not (Test-Path (Join-Path $Root "frontend\out\index.html"))) { Write-Warn2 "Web interface not built. Run scripts\install.ps1 (or 'npm run build' in frontend)." }
Write-Ok "Python environment found"

$existing = Get-AppProcess
if ($existing) { Write-Ok "AI Exam Coach is already running (PID $($existing.ProcessId))."; $already = $true }

Write-Step "Checking Ollama"
$ov = Get-OllamaVersion
if (-not $ov) {
    $appExe = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
    if (Test-Path $appExe) { Write-Info "Starting the Ollama app..."; Start-Process $appExe }
    elseif (Test-Command "ollama") { Write-Info "Starting 'ollama serve'..."; Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden }
    for ($i = 0; $i -lt 30 -and -not $ov; $i++) { Start-Sleep -Seconds 1; $ov = Get-OllamaVersion }
}
if ($ov) { Write-Ok "Ollama $ov on 127.0.0.1:11434" }
else { Write-Warn2 "Ollama is not running. The app will start, but AI features show a recovery message until Ollama runs. No cloud fallback is used." }

if (-not $already) {
    Write-Step "Checking port $port"
    $owner = Get-PortOwner $port
    if ($owner) {
        Write-Bad "Port $port is already used by $($owner.Name) (PID $($owner.Pid))."
        Write-Info "Choose another port: edit config\settings.json (\"port\": 8766) and run start.ps1 again."
        exit 1
    }
    Write-Ok "Port $port is free"

    Write-Step "Checking database"
    $code = Invoke-AppPython @("-c", "from backend.database.session import init_db, health_check; init_db(); h=health_check(); print(h); raise SystemExit(0 if h['ok'] else 3)")
    if ($code -ne 0) { Write-Bad "Database integrity check failed. Restore a backup with scripts\restore.ps1."; exit 1 }

    Write-Step "Starting backend + web interface"
    New-Item -ItemType Directory -Force -Path $RunDir, $LogDir | Out-Null
    $out = Join-Path $LogDir "server.out.log"
    $err = Join-Path $LogDir "server.err.log"
    $p = Start-Process -FilePath $Python -ArgumentList @("-m", "backend.main") -WorkingDirectory $Root -WindowStyle Hidden `
        -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
    Set-Content -Path $PidFile -Value $p.Id
    Write-Info "PID $($p.Id) (logs in logs\server.*.log)"
}

Write-Step "Health check"
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
    if (Test-Url "http://127.0.0.1:$port/api/health") { $ok = $true; break }
    Start-Sleep -Milliseconds 750
}
if (-not $ok) { Write-Bad "The app did not respond. See logs\server.err.log"; exit 1 }
Write-Ok "AI Exam Coach is running"

Write-Host ""
Write-Host "Open it at:" -ForegroundColor White
Write-Info "This PC:       http://127.0.0.1:$port"
if ($s.access_mode -eq "lan") {
    foreach ($ip in (Get-LanAddresses | Where-Object { $_ -notlike "100.*" })) { Write-Info "Same Wi-Fi:    http://${ip}:$port" }
}
if ($s.access_mode -eq "tailscale") {
    if (Test-Command "tailscale") {
        $dns = $null
        try { $dns = ((& tailscale status --json | ConvertFrom-Json).Self.DNSName).TrimEnd(".") } catch { }
        if ($dns) { Write-Info "Tailscale:     https://$dns   (MacBook / iPhone with Tailscale on)" }
        Write-Info "Serve status:"; & tailscale serve status
    } else { Write-Warn2 "Access mode is 'tailscale' but Tailscale is not installed. See docs\REMOTE_ACCESS.md" }
}
if ($s.access_mode -eq "local_only") { Write-Info "(Local-only mode: other devices cannot connect. See scripts\network.ps1.)" }
Write-Info "Keep this PC on and awake for remote access."
if ($Open) { Start-Process "http://127.0.0.1:$port" }
