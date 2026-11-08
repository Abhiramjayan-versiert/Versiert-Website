# Shared helpers for the AI Exam Coach management scripts.
# Compatible with Windows PowerShell 5.1 and PowerShell 7. ASCII only.

$ErrorActionPreference = "Stop"
$Script:Root = Split-Path -Parent $PSScriptRoot
$Script:Venv = Join-Path $Root ".venv"
$Script:Python = Join-Path $Venv "Scripts\python.exe"
$Script:DataDir = Join-Path $Root "data"
$Script:RunDir = Join-Path $DataDir "run"
$Script:PidFile = Join-Path $RunDir "backend.pid"
$Script:LogDir = Join-Path $Root "logs"
$Script:SettingsFile = Join-Path $Root "config\settings.json"
$Script:OllamaUrl = "http://127.0.0.1:11434"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Bad($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "         $msg" }

function Confirm-Action([string]$Question) {
    # Explicit user approval for anything that installs, downloads or changes system configuration.
    $answer = Read-Host "$Question [y/N]"
    return ($answer -match '^(y|yes)$')
}

function Get-AppSettings {
    $defaults = @{ port = 8765; access_mode = "local_only" }
    if (Test-Path $SettingsFile) {
        try {
            $json = Get-Content $SettingsFile -Raw | ConvertFrom-Json
            if ($json.port) { $defaults.port = [int]$json.port }
            if ($json.access_mode) { $defaults.access_mode = [string]$json.access_mode }
        } catch { Write-Warn2 "Could not read config\settings.json; using defaults." }
    }
    return $defaults
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-PortOwner([int]$Port) {
    try {
        $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
        if ($c) {
            $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
            return [pscustomobject]@{ Pid = $c.OwningProcess; Name = $(if ($p) { $p.ProcessName } else { "unknown" }) }
        }
    } catch { }
    return $null
}

function Test-Url([string]$Url, [int]$TimeoutSec = 4) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch { return $false }
}

function Get-OllamaVersion {
    try {
        $r = Invoke-RestMethod -Uri "$OllamaUrl/api/version" -TimeoutSec 4
        return $r.version
    } catch { return $null }
}

function Get-AppProcess {
    # Returns the backend process ONLY if the PID file points at our own python running backend.main.
    if (-not (Test-Path $PidFile)) { return $null }
    $procId = [int](Get-Content $PidFile -Raw).Trim()
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
    if ($proc -and $proc.CommandLine -and $proc.CommandLine -like "*backend.main*" -and $proc.CommandLine -like "*$Root*") {
        return $proc
    }
    if ($proc -and $proc.ExecutablePath -and $proc.ExecutablePath -like "$Venv*") { return $proc }
    return $null
}

function Invoke-AppPython([string[]]$Arguments) {
    if (-not (Test-Path $Python)) { throw "Python environment not found. Run scripts\install.ps1 first." }
    Push-Location $Root
    # Python output goes to the console; only the exit code is returned.
    try { & $Python @Arguments | Out-Host; return $LASTEXITCODE } finally { Pop-Location }
}

function Get-LanAddresses {
    try {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixOrigin -ne "WellKnown" } |
            Select-Object -ExpandProperty IPAddress
    } catch { @() }
}
