@echo off
setlocal
cd /d "C:\Users\Tech Bazaar\Desktop\jju-10Sept26\backend"

set LOG=reset_log.txt
echo ==== %DATE% %TIME% : STOP APP ==== > "%LOG%"
call pm2 stop jju-bank >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo ==== RESET DATA (truncate only, users/_migrations preserved) ==== >> "%LOG%"
node scripts\reset-db.js >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo ==== START APP (runs migrations check on boot) ==== >> "%LOG%"
call pm2 restart jju-bank >> "%LOG%" 2>&1

echo Waiting 10 seconds for the server to finish booting...
timeout /t 10 /nobreak >nul

echo. >> "%LOG%"
echo ==== PM2 STATUS ==== >> "%LOG%"
call pm2 status >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo ==== PM2 LOGS (last 120 lines) ==== >> "%LOG%"
call pm2 logs jju-bank --lines 120 --nostream >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo ==== HEALTH CHECK ==== >> "%LOG%"
powershell -NoProfile -Command "try { (Invoke-RestMethod -Uri http://localhost:4001/api/health -TimeoutSec 15 | ConvertTo-Json) } catch { 'HEALTH CHECK FAILED: ' + $_.Exception.Message }" >> "%LOG%" 2>&1

echo DONE > reset_done.marker
exit
