<#
  JJU Bank — install as a Windows Service via NSSM
  Wraps `pm2-runtime start ecosystem.config.js` (PM2's foreground mode,
  designed to be supervised by something else) as a real Windows Service
  named "JJUBank". Starts at boot, before any user logs in, and Windows will
  restart it if it ever exits — on top of PM2's own restart policy already
  configured in ecosystem.config.js.

  BEFORE RUNNING:
    1. Download NSSM from https://nssm.cc/download and unzip it anywhere.
    2. Set $NssmPath below to the nssm.exe inside the matching win64/win32
       folder for this machine.
    3. `npm install -g pm2` once, globally, if not already installed
       (this script uses pm2-runtime.cmd from that global install).

  Run as Administrator:
    cd backend\scripts
    .\install-service-nssm.ps1
#>

# ── EDIT THIS ────────────────────────────────────────────────────────────
$NssmPath = "C:\nssm\win64\nssm.exe"
# ──────────────────────────────────────────────────────────────────────────

$ServiceName = "JJUBank"
$BackendDir  = Split-Path -Parent $PSScriptRoot   # backend\scripts\.. = backend\

if (-not (Test-Path $NssmPath)) {
    Write-Error "nssm.exe not found at '$NssmPath'. Download it from https://nssm.cc/download, unzip it, and set `$NssmPath at the top of this script."
    exit 1
}

# Locate the global pm2-runtime.cmd (installed via `npm install -g pm2`)
$pm2Runtime = (Get-Command pm2-runtime.cmd -ErrorAction SilentlyContinue).Source
if (-not $pm2Runtime) {
    Write-Error "pm2-runtime.cmd not found on PATH. Run 'npm install -g pm2' first, then re-open this PowerShell window."
    exit 1
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Service '$ServiceName' already exists. Stopping and removing it first..."
    & $NssmPath stop $ServiceName confirm | Out-Null
    & $NssmPath remove $ServiceName confirm | Out-Null
}

& $NssmPath install $ServiceName $pm2Runtime "start ecosystem.config.js"
& $NssmPath set $ServiceName AppDirectory $BackendDir
& $NssmPath set $ServiceName DisplayName "JJU Bank Server"
& $NssmPath set $ServiceName Description "JJU Bank Node/Express server, supervised by PM2 (pm2-runtime), managed as a Windows Service via NSSM."
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppStdout (Join-Path $BackendDir "logs\service-stdout.log")
& $NssmPath set $ServiceName AppStderr (Join-Path $BackendDir "logs\service-stderr.log")
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 10485760

Write-Host ""
Write-Host "Service '$ServiceName' installed. Starting it now..."
Start-Service $ServiceName
Start-Sleep -Seconds 2
Get-Service $ServiceName | Format-Table -AutoSize

Write-Host ""
Write-Host "Check it's actually serving:  Invoke-WebRequest http://localhost:4001/api/health"
Write-Host "Manage it with: Start-Service / Stop-Service / Restart-Service $ServiceName"
