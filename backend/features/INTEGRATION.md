# JJU Bank — New Features Integration Guide

All new files are drop-in additions. **Nothing in your existing code needs to be rewritten** —
just add the 8 lines to `server.js` and optionally sprinkle middleware into existing routes.

---

## 1. Audit Log  (`features/audit/`)

Tracks every create/update/delete with who did it, from what IP, and what changed.

**server.js** — add one line:
```js
app.use('/api/audit', require('./features/audit/audit.routes'));
```

**Optional: add to records.routes.js** for per-action tracking:
```js
const { auditMiddleware } = require('../features/audit/audit.middleware');
router.post('/',           auditMiddleware('CREATE',  'records'), c.create);
router.put('/:id',         auditMiddleware('UPDATE',  'records'), c.update);
router.delete('/:id',      auditMiddleware('DELETE',  'records'), c.softDelete);
router.patch('/:id/close', auditMiddleware('CLOSE',   'records'), c.close);
```

**API endpoints:**
- `GET /api/audit` — query logs (filter by resource, action, user, date)
- `GET /api/audit/resource/records/42` — full history of record #42
- `GET /api/audit/stats` — summary counts last 30 days

---

## 2. Role-Based Access Control (`features/rbac/`)

4 roles: `admin > manager > staff > viewer`

**No server.js change needed.** Add to individual routes as needed:
```js
const { requirePermission, adminOnly } = require('../features/rbac/rbac.middleware');

router.get('/',               requirePermission('records:read'),   c.list);
router.post('/',              requirePermission('records:create'), c.create);
router.delete('/:id',         requirePermission('records:delete'), c.softDelete);
router.delete('/:id/permanent', adminOnly,                         c.permanentDelete);
```

**Change a user's role:**
```sql
UPDATE users SET role='manager' WHERE username='john';
```

---

## 3. Notifications (`features/notifications/`)

In-app alerts for FD maturities, overdue loans, system events. Supports SSE live streaming.

**server.js:**
```js
app.use('/api/notifications', require('./features/notifications/notifications.routes'));
```

**Optional: schedule daily checks (add to server.js after start()):**
```js
// npm install node-cron  (if not already installed)
const cron = require('node-cron');
const { checkFDMaturities, checkOverdueLoans } = require('./features/notifications/notifications.service');
cron.schedule('0 8 * * *', async () => {
  await checkFDMaturities();
  await checkOverdueLoans();
});
```

**API endpoints:**
- `GET  /api/notifications` — get unread alerts
- `PATCH /api/notifications/:id/read` — mark read
- `PATCH /api/notifications/read-all` — mark all read
- `POST  /api/notifications/run-checks` — manually trigger FD/loan checks
- `GET   /api/notifications/stream` — SSE live stream

---

## 4. SMS Integration (`features/sms/`)

Supports MSG91 (recommended for India) and Twilio. Falls back to console log in dev.

**server.js:**
```js
app.use('/api/sms', require('./features/sms/sms.routes'));
```

**Add to .env:**
```
SMS_PROVIDER=msg91
MSG91_AUTH_KEY=your_key_here
MSG91_SENDER_ID=JJUBNK
```

**Use in controllers:**
```js
const { sendAndLog, templates } = require('../features/sms/sms.service');

// After opening a gold loan:
if (mobile) {
  await sendAndLog(mobile, templates.loanOpened(name, account_no, loan_amount), 'loan_opened', id);
}
```

**Available templates:** `loanOpened`, `loanClosed`, `fdOpened`, `fdMaturity`, `overdueAlert`, `otp`

---

## 5. Reports & Analytics (`features/reports/`)

**server.js:**
```js
app.use('/api/reports', require('./features/reports/reports.routes'));
```

**API endpoints:**
- `GET /api/reports/daily-summary?date=2024-11-15`
- `GET /api/reports/monthly?year=2024&month=11`
- `GET /api/reports/portfolio` — full portfolio snapshot
- `GET /api/reports/top-customers?limit=10`
- `GET /api/reports/cashbook-summary?from=2024-11-01&to=2024-11-30`

---

## 6. Data Export — CSV & PDF (`features/export/`)

**server.js:**
```js
app.use('/api/export', require('./features/export/export.routes'));
```

**Frontend usage:**
```js
// Download CSV of active gold loans
window.open('/api/export/csv?section=gold&status=active');

// Open print-to-PDF page for FD accounts
window.open('/api/export/html?section=fd&status=active');

// Cashbook for a date
window.open('/api/export/cashbook/csv?date=2024-11-15');
window.open('/api/export/cashbook/html?date=2024-11-15');
```

---

## 7. Interest Calculator (`features/interest/`)

Pure math — no DB queries. All endpoints accept POST with JSON body.

**server.js:**
```js
app.use('/api/interest', require('./features/interest/interest.routes'));
```

**API endpoints:**
```
POST /api/interest/gold-loan   { principal, rate, from_date, to_date? }
POST /api/interest/fd          { principal, rate, months }
POST /api/interest/simple      { principal, rate, days }
POST /api/interest/emi         { principal, rate, tenure_months }
POST /api/interest/amortization { principal, rate, tenure_months }
```

---

## 8. Backup & Restore (`features/backup/`)

Admin-only. Full JSON dump and restore (append-safe, no data wiped).

**server.js:**
```js
app.use('/api/backup', require('./features/backup/backup.routes'));
```

**API endpoints:**
- `GET  /api/backup/export` — downloads full JSON backup
- `GET  /api/backup/stats`  — row counts per table
- `POST /api/backup/restore` — upload a backup JSON to restore data

**Frontend download button:**
```js
window.open('/api/backup/export');  // browser downloads the file
```

---

## Summary: all server.js additions

```js
// Add these 8 lines after your existing app.use('/api/...') routes:
app.use('/api/audit',         require('./features/audit/audit.routes'));
app.use('/api/notifications', require('./features/notifications/notifications.routes'));
app.use('/api/sms',           require('./features/sms/sms.routes'));
app.use('/api/reports',       require('./features/reports/reports.routes'));
app.use('/api/export',        require('./features/export/export.routes'));
app.use('/api/interest',      require('./features/interest/interest.routes'));
app.use('/api/backup',        require('./features/backup/backup.routes'));
// RBAC has no routes of its own — just import requirePermission where needed
```
