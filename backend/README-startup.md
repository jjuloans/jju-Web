# JJU Bank — Startup Guide

## Folder structure

```
your-project/
├── backend/           ← Node.js server (server.js lives here)
│   ├── server.js
│   ├── ecosystem.config.js
│   ├── .env
│   ├── db/
│   ├── routes/
│   └── features/
└── frontend/          ← All HTML/CSS/JS files
    ├── index.html     ← Staff frontend  → localhost:4001/
    ├── admin.html     ← Admin dashboard → localhost:4001/admin
    ├── pdf-template.js
    ├── css/
    │   └── app.css
    └── js/
        ├── app.js
        └── data/
            └── static-data.js
```

---

## One-time PM2 setup (do this once, never touch again)

```bash
# 1. Install PM2 globally
npm install -g pm2

# 2. Go to your backend folder
cd /path/to/backend

# 3. Start the server with PM2
pm2 start ecosystem.config.js

# 4. Save the process list (survives reboots)
pm2 save

# 5. Set PM2 to auto-start on Mac reboot — run the command it prints
pm2 startup
```

After this, **the server starts automatically on every reboot**. You never need to manually run `node server.js` again.

---

## Daily commands (if you ever need them)

| What | Command |
|---|---|
| Check status | `pm2 status` |
| View live logs | `pm2 logs jju-bank` |
| Restart server | `pm2 restart jju-bank` |
| Stop server | `pm2 stop jju-bank` |
| Start again | `pm2 start jju-bank` |

---

## Accessing the app

| Who | URL |
|---|---|
| Staff (forms, PDFs, ledger) | http://localhost:4001 |
| Admin (database, analytics) | http://localhost:4001/admin |

Both require login. Admin dashboard has its own separate login.  
The staff frontend has a **🔐 Admin** button in the top-right corner.

---

## Log rotation (do this once — prevents disk from filling up)

PM2 writes `logs/out.log` / `logs/error.log` and never trims them on its own — left alone for months they will grow without bound and can eventually fill the disk, which *will* crash the server. Install PM2's log-rotate module once:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

This keeps the last 14 days of logs (gzip-compressed once rotated), capped at 10 MB per active file.

---

## If you get server errors

**Check the logs first:**
```bash
pm2 logs jju-bank --lines 50
```

**Common causes:**
- `.env` file missing or wrong DB password → fix `.env`, then `pm2 restart jju-bank`
- Port 4001 already in use → `lsof -i :4001` to find what's using it
- Missing npm package → `npm install` in the backend folder

**Health check** (tells you if DB is connected):
```
http://localhost:4001/api/health
```
