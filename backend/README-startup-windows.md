# JJU Bank — Windows LAN Server Setup

This is the Windows counterpart to `README-startup.md`. It sets the app up as an
always-on server on your LAN: a fixed IP address so it doesn't change, a Windows
Firewall rule so staff phones/laptops on the same WiFi can reach it, a real
Windows Service so it starts automatically at boot (even before anyone logs in)
and restarts itself if it crashes, and power settings so the machine never goes
to sleep mid-shift.

Run every command below in **PowerShell as Administrator** (right-click the
Start menu → "Windows PowerShell (Admin)" or "Terminal (Admin)") unless noted
otherwise.

---

## 0. Prerequisites

- Node.js (LTS) installed — check with `node -v`
- PostgreSQL installed and running, with the same database/user this app already
  uses on your current machine (see `.env`)
- The project folder copied onto this Windows machine
- From the `backend` folder: `npm install`
- A working `.env` file in `backend/` (copy from `.env.example` and fill in
  real values — never commit a real `.env`)

Verify the app runs manually first, before wiring up any of the below:

```powershell
cd path\to\backend
node server.js
```

Visit `http://localhost:4001` — confirm it loads and logs in — then `Ctrl+C` to
stop it before continuing.

---

## 1. Give the machine a fixed (static) IP address

If the machine's IP changes (which happens by default with DHCP), every phone
that bookmarked `http://192.168.x.x:4001` breaks. Pick **one** of these:

### Option A — Router-side DHCP reservation (recommended)

Log into your WiFi router's admin page (usually `192.168.0.1` or `192.168.1.1`),
find "DHCP reservation" / "Address reservation", and pin this machine's current
IP to its MAC address. This is the safest option — it doesn't touch Windows
network settings at all, and survives Windows reinstalls.

Find the MAC address to reserve:

```powershell
ipconfig /all | Select-String "Physical Address" -Context 3,0
```

### Option B — Static IP set directly on the Windows adapter

Only do this if you can't access the router admin page. Pick an IP outside your
router's DHCP range (check the router settings for that range first) — e.g. if
DHCP hands out `.100`–`.200`, use something like `.50`.

```powershell
# List adapters to find the right InterfaceIndex
Get-NetAdapter

# Replace 12 with your adapter's InterfaceIndex, and adjust the IP/gateway
New-NetIPAddress -InterfaceIndex 12 -IPAddress 192.168.1.50 -PrefixLength 24 -DefaultGateway 192.168.1.1
Set-DnsClientServerAddress -InterfaceIndex 12 -ServerAddresses 192.168.1.1
```

---

## 2. Open the port in Windows Firewall

Run the included script (adjust the port if you're not using 4001):

```powershell
cd backend\scripts
.\windows-firewall-setup.ps1
```

Or run the one command directly:

```powershell
New-NetFirewallRule -DisplayName "JJU Bank (4001)" -Direction Inbound -Protocol TCP -LocalPort 4001 -Action Allow -Profile Any
```

Without this, Windows silently drops incoming connections from other devices
on the WiFi even though `localhost:4001` works fine on the server machine
itself — this is the #1 cause of "it works on this computer but not on my
phone."

---

## 3. Stop the machine from sleeping

If the machine sleeps, the server goes down until someone touches the mouse.

```powershell
# Never sleep or turn off the display while plugged in
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

Also check Device Manager → Network adapters → your WiFi/Ethernet adapter →
Properties → Power Management tab → **uncheck** "Allow the computer to turn
off this device to save power". Windows can put the network adapter itself to
sleep independently of the whole machine, which silently drops LAN
connectivity — this is not scriptable from PowerShell and has to be unchecked
by hand per adapter.

---

## 4. Run the server as a real Windows Service (auto-start on boot)

`pm2 startup` (the command used on Mac/Linux) does not work natively on
Windows — it depends on systemd/launchd, neither of which Windows has. The
robust option is **NSSM** (Non-Sucking Service Manager), which wraps the
process as a genuine Windows Service: it starts before anyone logs in, and
Windows itself will restart it if it ever exits, layered on top of PM2's own
crash-restart policy in `ecosystem.config.js`.

1. Download NSSM from https://nssm.cc/download, unzip it, and note the path to
   `nssm.exe` (use the `win64` folder on a 64-bit machine).
2. Edit `backend\scripts\install-service-nssm.ps1` — set `$NssmPath` at the top
   to wherever you unzipped it.
3. Run it (as Administrator):

```powershell
cd backend\scripts
.\install-service-nssm.ps1
```

This installs a service named `JJUBank` that runs `pm2-runtime start
ecosystem.config.js` from the `backend` folder — `pm2-runtime` is PM2's
foreground mode, built specifically for being supervised by something else
(NSSM here), so you get PM2's `max_restarts` / `max_memory_restart` /
`restart_delay` policy from `ecosystem.config.js` *and* a proper Windows
Service on top, which starts at boot without requiring a login and can be
managed like any other service:

```powershell
Start-Service JJUBank
Stop-Service JJUBank
Restart-Service JJUBank
Get-Service JJUBank
```

Logs still land in `backend\logs\out.log` / `error.log` as usual — see the log
rotation note below.

### Simpler alternative (not recommended for an always-on server)

If you'd rather not install NSSM, `pm2-windows-startup` is a lighter option —
it registers PM2 to resume on user logon instead of a true boot-time service
(the machine still needs someone to log in, e.g. via auto-login, for it to
start):

```powershell
npm install -g pm2-windows-startup
pm2-startup install
pm2 start ecosystem.config.js
pm2 save
```

---

## 5. Log rotation (do this once — prevents disk from filling up)

Same as the Mac setup — PM2 never trims its own log files:

```powershell
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

---

## 6. Verify from another device

From a phone or laptop on the **same WiFi**, browse to:

```
http://<the-static-ip-from-step-1>:4001
```

If it doesn't load: re-check the firewall rule (step 2) first — that's the
most common miss — then confirm the machine's IP with `ipconfig`.

---

## Daily commands

| What | Command |
|---|---|
| Check service status | `Get-Service JJUBank` (NSSM) or `pm2 status` |
| View live logs | `pm2 logs jju-bank` |
| Restart | `Restart-Service JJUBank` (NSSM) or `pm2 restart jju-bank` |
| Health check | `http://localhost:4001/api/health` |

## What's already handled in the app code (no Windows-specific action needed)

The server itself already has, unchanged across platforms: startup DB-connection
retries, request/keep-alive timeouts tuned for a busy LAN, a catch-all error
handler so one bad request can't take the process down, and handlers for
uncaught exceptions / unhandled promise rejections that log the failure and let
PM2 (or the Windows Service wrapping it) restart cleanly rather than the
process hanging in a broken state. `ecosystem.config.js`'s restart policy
(`max_restarts`, `restart_delay`, `min_uptime`, `max_memory_restart`) already
applies identically on Windows — nothing there needed to change for this move.
