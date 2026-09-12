<#
  JJU Bank — Windows Firewall setup
  Opens the port the server listens on (default 4001) to inbound TCP traffic
  from other devices on the LAN, so staff phones/laptops on the same WiFi can
  reach http://<this-machine's-ip>:<port>.

  Run as Administrator:
    cd backend\scripts
    .\windows-firewall-setup.ps1
    # or with a custom port:
    .\windows-firewall-setup.ps1 -Port 4001
#>

param(
    [int]$Port = 4001
)

$ruleName = "JJU Bank ($Port)"

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Firewall rule '$ruleName' already exists — leaving it as-is."
} else {
    New-NetFirewallRule -DisplayName $ruleName `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort $Port `
        -Action Allow `
        -Profile Any | Out-Null
    Write-Host "Created inbound firewall rule '$ruleName' for TCP port $Port."
}

Write-Host ""
Write-Host "This machine's LAN IP address(es):"
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object IPAddress, InterfaceAlias |
    Format-Table -AutoSize

Write-Host "From another device on the same WiFi, browse to: http://<one-of-the-IPs-above>:$Port"
