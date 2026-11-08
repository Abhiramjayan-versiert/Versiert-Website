# Configure how other devices reach AI Exam Coach.
#   powershell -ExecutionPolicy Bypass -File scripts\network.ps1 -Mode local_only
#   powershell -ExecutionPolicy Bypass -File scripts\network.ps1 -Mode lan          (needs an Administrator PowerShell for the firewall rule)
#   powershell -ExecutionPolicy Bypass -File scripts\network.ps1 -Mode tailscale
# Never opens the Ollama port (11434). Never configures router port forwarding.
param([Parameter(Mandatory = $true)][ValidateSet("local_only", "lan", "tailscale")][string]$Mode)
. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = "Continue"

$s = Get-AppSettings
$port = $s.port
$ruleName = "AI Exam Coach (LAN)"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Set-Mode([string]$m) {
    $code = Invoke-AppPython @("-c", "from backend.config import update_settings; print(update_settings({'access_mode': '$m'}).access_mode)")
    if ($code -ne 0) { throw "Could not update config\settings.json" }
}

function Remove-LanRule {
    if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
        if (-not $isAdmin) { Write-Warn2 "Run as Administrator to remove the firewall rule '$ruleName'."; return }
        if (Confirm-Action "Remove firewall rule '$ruleName'?") { Remove-NetFirewallRule -DisplayName $ruleName; Write-Ok "Firewall rule removed" }
    }
}

function Remove-TailscaleServe {
    if (Test-Command "tailscale") {
        $st = (& tailscale serve status 2>&1 | Out-String)
        if ($st -match "127\.0\.0\.1:$port") {
            if (Confirm-Action "Stop Tailscale Serve for this app (https:443 -> 127.0.0.1:$port)?") { & tailscale serve --https=443 off; Write-Ok "Tailscale Serve stopped" }
        }
    }
}

switch ($Mode) {
    "local_only" {
        Remove-LanRule
        Remove-TailscaleServe
        Set-Mode "local_only"
        Write-Ok "Local-only: the app listens on 127.0.0.1:$port only."
    }
    "lan" {
        Write-Info "LAN mode makes the app listen on all network interfaces, port $port."
        Write-Info "A Windows Firewall rule will allow TCP $port ONLY from your local subnet and ONLY on Private networks."
        Write-Info "Make sure your Wi-Fi is set to 'Private' in Windows Settings > Network & Internet."
        if (-not $isAdmin) { Write-Bad "Open PowerShell as Administrator to create the firewall rule, then re-run."; exit 1 }
        if (-not (Confirm-Action "Create the firewall rule and switch to LAN mode?")) { Write-Info "Cancelled."; exit 0 }
        Remove-TailscaleServe
        if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port `
                -Profile Private -RemoteAddress LocalSubnet -Program $Python -Description "AI Exam Coach web app (not Ollama)" | Out-Null
        }
        Set-Mode "lan"
        Write-Ok "LAN mode enabled. Restart the app: scripts\restart.ps1"
        foreach ($ip in (Get-LanAddresses | Where-Object { $_ -notlike "100.*" })) { Write-Info "Other devices: http://${ip}:$port" }
    }
    "tailscale" {
        if (-not (Test-Command "tailscale")) {
            Write-Bad "Tailscale is not installed. Install it from https://tailscale.com/download/windows (see docs\REMOTE_ACCESS.md), sign in, then re-run."
            exit 1
        }
        $self = $null
        try { $self = (& tailscale status --json | ConvertFrom-Json).Self } catch { }
        if (-not $self -or -not $self.Online) { Write-Bad "Tailscale is not connected. Open Tailscale and sign in first."; exit 1 }
        Write-Info "Tailscale Serve will publish https://$($self.DNSName.TrimEnd('.')) to devices in YOUR tailnet only (not the public internet)."
        Write-Info "The app itself stays bound to 127.0.0.1; Tailscale terminates HTTPS and forwards locally."
        if (-not (Confirm-Action "Enable Tailscale Serve for this app?")) { Write-Info "Cancelled."; exit 0 }
        Remove-LanRule
        & tailscale serve --bg --https=443 "http://127.0.0.1:$port"
        if ($LASTEXITCODE -ne 0) { Write-Bad "tailscale serve failed. You may need to enable HTTPS certificates for your tailnet in the Tailscale admin console (DNS > HTTPS Certificates)."; exit 1 }
        Set-Mode "tailscale"
        Write-Ok "Tailscale mode enabled. Restart the app: scripts\restart.ps1"
        & tailscale serve status
        Write-Warn2 "Do NOT use 'tailscale funnel' - that would expose the app to the public internet."
    }
}
