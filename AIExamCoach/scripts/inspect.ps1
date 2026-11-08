# Phase 1: inspect this Windows PC (read-only). Changes nothing.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\inspect.ps1
. "$PSScriptRoot\common.ps1"

$report = [ordered]@{}
Write-Step "Windows"
$os = Get-CimInstance Win32_OperatingSystem
$report.windows = "$($os.Caption) $($os.Version) build $($os.BuildNumber) ($($os.OSArchitecture))"
Write-Info $report.windows

Write-Step "CPU and memory"
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$report.cpu = "$($cpu.Name.Trim()) - $($cpu.NumberOfCores) cores / $($cpu.NumberOfLogicalProcessors) threads"
$ramGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$freeGb = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$report.ram = "$ramGb GB total, $freeGb GB free"
Write-Info $report.cpu
Write-Info "RAM: $($report.ram)"
if ($ramGb -lt 15) { Write-Warn2 "Less than 16 GB RAM: keep context at 4096 and use one model at a time." }

Write-Step "GPU / VRAM / NVIDIA driver / CUDA"
$gpus = Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion
$report.gpus = @($gpus | ForEach-Object { "$($_.Name) (driver $($_.DriverVersion))" })
$report.gpus | ForEach-Object { Write-Info $_ }
if (Test-Command "nvidia-smi") {
    $smi = & nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,driver_version --format=csv,noheader,nounits
    $report.nvidia_smi = $smi
    Write-Ok "nvidia-smi: $smi  (name, VRAM total/used/free MB, driver)"
    $cudaLine = (& nvidia-smi | Select-String "CUDA Version") -replace '.*CUDA Version:\s*([0-9.]+).*', '$1'
    if ($cudaLine) { $report.cuda_driver_api = $cudaLine; Write-Ok "Driver supports CUDA $cudaLine (Ollama bundles its own CUDA runtime; no CUDA toolkit needed)" }
} else {
    $report.nvidia_smi = $null
    Write-Warn2 "nvidia-smi not found. Install/update the NVIDIA driver (GeForce Experience or nvidia.com) for GPU acceleration. Without it Ollama uses the CPU."
}

Write-Step "Storage"
$drive = (Get-Item $Root).PSDrive.Name
$disk = Get-PSDrive $drive
$report.disk = "Drive ${drive}: $([math]::Round($disk.Free/1GB,1)) GB free of $([math]::Round(($disk.Used+$disk.Free)/1GB,1)) GB"
Write-Info $report.disk
if ($disk.Free -lt 15GB) { Write-Warn2 "Less than 15 GB free. Models (~3.2 GB) + Python packages (~2 GB) + node_modules need space." }

Write-Step "Software"
function Show-Version($name, $cmd, $verArgs) {
    if (Test-Command $cmd) {
        $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        try { $v = (& $cmd $verArgs 2>&1 | Select-Object -First 1) } catch { $v = "installed" } finally { $ErrorActionPreference = $old }
        if ("$v" -match "was not found|Microsoft Store|not recognized") {
            Write-Warn2 "$name : not installed (only the Windows Store placeholder was found)"
            return $null
        }
        Write-Ok "$name : $v"
        return "$v"
    } else { Write-Warn2 "$name : not installed"; return $null }
}
$report.python = Show-Version "Python" "python" "--version"
$report.py_launcher = Show-Version "Python launcher (py)" "py" "--version"
$report.node = Show-Version "Node.js" "node" "--version"
$report.npm = Show-Version "npm" "npm.cmd" "--version"
$report.git = Show-Version "Git" "git" "--version"
$report.docker = Show-Version "Docker (not required)" "docker" "--version"
$report.ollama = Show-Version "Ollama" "ollama" "--version"
$tess = $null
if (Test-Command "tesseract") { $tess = (Get-Command tesseract).Source }
elseif (Test-Path "C:\Program Files\Tesseract-OCR\tesseract.exe") { $tess = "C:\Program Files\Tesseract-OCR\tesseract.exe" }
$report.tesseract = $tess
if ($tess) { Write-Ok "Tesseract OCR: $tess" } else { Write-Warn2 "Tesseract OCR: not installed (needed for scanned PDFs and handwritten answers)" }
$report.tailscale = Show-Version "Tailscale (optional, remote access)" "tailscale" "version"
$report.winget = Show-Version "winget" "winget" "--version"

Write-Step "Ollama service and environment"
$ver = Get-OllamaVersion
$report.ollama_api = $ver
if ($ver) { Write-Ok "Ollama API responding on 127.0.0.1:11434 (version $ver)" } else { Write-Warn2 "Ollama API not responding on 127.0.0.1:11434" }
foreach ($n in "OLLAMA_NO_CLOUD", "OLLAMA_NUM_PARALLEL", "OLLAMA_MAX_LOADED_MODELS", "OLLAMA_CONTEXT_LENGTH", "OLLAMA_KEEP_ALIVE", "OLLAMA_MAX_QUEUE", "OLLAMA_HOST") {
    $v = [Environment]::GetEnvironmentVariable($n, "User")
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, "Machine") }
    Write-Info ("{0,-26} = {1}" -f $n, $(if ($v) { $v } else { "(not set)" }))
    $report["env_$n"] = $v
}
if ($ver) {
    try {
        $tags = Invoke-RestMethod "$OllamaUrl/api/tags" -TimeoutSec 5
        $report.models = @($tags.models | ForEach-Object { "$($_.name) ($([math]::Round($_.size/1GB,2)) GB)" })
        Write-Info ("Installed models: " + $(if ($report.models.Count) { $report.models -join ", " } else { "none" }))
    } catch { }
}
$h = [Environment]::GetEnvironmentVariable("OLLAMA_HOST", "User")
if ($h -and $h -notmatch '^(127\.0\.0\.1|localhost)') { Write-Bad "OLLAMA_HOST=$h exposes Ollama beyond this PC. Set it back to 127.0.0.1:11434." }

Write-Step "Ports"
$s = Get-AppSettings
foreach ($p in @($s.port, 11434, 3000)) {
    $o = Get-PortOwner $p
    if ($o) { Write-Info "Port $p in use by $($o.Name) (PID $($o.Pid))" } else { Write-Info "Port $p free" }
    $report["port_$p"] = $(if ($o) { "$($o.Name):$($o.Pid)" } else { "free" })
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$out = Join-Path $LogDir "system-report.json"
$report | ConvertTo-Json -Depth 4 | Set-Content -Path $out -Encoding UTF8
Write-Host ""
Write-Ok "Report saved to $out"
