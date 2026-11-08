# Show the status of every component. Read-only.
. "$PSScriptRoot\common.ps1"
# Native tools (pip, npm, winget, taskkill) write warnings to stderr; check exit codes explicitly instead.
$ErrorActionPreference = "Continue"
$s = Get-AppSettings
$port = $s.port

Write-Step "Backend + web interface"
$proc = Get-AppProcess
if ($proc) { Write-Ok "Process running (PID $($proc.ProcessId))" } else { Write-Bad "Not running (start with scripts\start.ps1)" }
if (Test-Url "http://127.0.0.1:$port/api/health") { Write-Ok "Responding on http://127.0.0.1:$port (mode: $($s.access_mode))" } else { Write-Bad "No response on port $port" }
if (Test-Path (Join-Path $Root "frontend\out\index.html")) { Write-Ok "Frontend build present" } else { Write-Bad "Frontend not built" }

Write-Step "Ollama"
$ov = Get-OllamaVersion
if ($ov) {
    Write-Ok "Ollama $ov on 127.0.0.1:11434"
    $host2 = [Environment]::GetEnvironmentVariable("OLLAMA_HOST", "User")
    if ($host2 -and $host2 -notmatch '^(127\.0\.0\.1|localhost)') { Write-Bad "OLLAMA_HOST=$host2 - Ollama may be exposed to the network!" } else { Write-Ok "Ollama bound to localhost only" }
    try {
        $tags = (Invoke-RestMethod "$OllamaUrl/api/tags").models
        Write-Info ("Installed: " + (($tags | ForEach-Object { "$($_.name) ($([math]::Round($_.size/1GB,2)) GB)" }) -join ", "))
        $ps = (Invoke-RestMethod "$OllamaUrl/api/ps").models
        if ($ps) {
            foreach ($m in $ps) {
                $pct = if ($m.size) { [math]::Round(100 * $m.size_vram / $m.size) } else { 0 }
                $where = if ($pct -ge 99) { "100% GPU" } elseif ($pct -le 0) { "100% CPU" } else { "$pct% GPU / $(100-$pct)% CPU" }
                Write-Info "Loaded: $($m.name) - $where, context $($m.context_length)"
            }
        } else { Write-Info "No model loaded right now (loads on first request)" }
    } catch { }
    if (Test-Command "ollama") { Write-Info "ollama ps:"; & ollama ps }
} else { Write-Bad "Ollama is not running - start it from the Start menu" }

Write-Step "GPU"
if (Test-Command "nvidia-smi") {
    & nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv
} else { Write-Warn2 "nvidia-smi not available - GPU acceleration cannot be verified" }

Write-Step "Database"
if (Test-Path $Python) {
    Invoke-AppPython @("-c", "from backend.database.session import health_check; from backend.rag.store import stats; print('SQLite:', health_check()); print('Vectors:', stats())") | Out-Null  # output is shown by Invoke-AppPython
}
$dbFile = Join-Path $DataDir "database\examcoach.db"
if (Test-Path $dbFile) { Write-Info "DB size: $([math]::Round((Get-Item $dbFile).Length/1MB,2)) MB" }
$latest = Get-ChildItem (Join-Path $DataDir "backups") -Filter "examcoach-backup-*.zip" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latest) { Write-Info "Latest backup: $($latest.Name)" } else { Write-Warn2 "No backups yet - run scripts\backup.ps1" }

Write-Step "Connectivity"
Write-Info "This PC: http://127.0.0.1:$port"
foreach ($ip in Get-LanAddresses) { Write-Info "Address on this PC: $ip $(if ($ip -like '100.*') { '(Tailscale)' })" }
$rule = Get-NetFirewallRule -DisplayName "AI Exam Coach (LAN)" -ErrorAction SilentlyContinue
if ($rule) { Write-Info "Firewall rule 'AI Exam Coach (LAN)': $($rule.Enabled), profile $($rule.Profile)" } else { Write-Info "No LAN firewall rule (LAN access closed)" }
if (Test-Command "tailscale") {
    $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try { Write-Info "Tailscale:"; & tailscale status --self 2>&1 | Select-Object -First 3; & tailscale serve status 2>&1 } finally { $ErrorActionPreference = $old }
}
