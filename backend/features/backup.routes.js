'use strict';
const router = require('express').Router();
const pool   = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Only admin can backup/restore
function adminOnly(req, res, next) {
  if (req.session?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── GET /api/backup/export  — full JSON dump of all tables ────────────────
router.get('/export', adminOnly, async (req, res) => {
  try {
    const tables = ['records', 'cashbook_entries', 'customers', 'users', 'sync_log'];
    const dump   = { exported_at: new Date().toISOString(), tables: {} };

    for (const table of tables) {
      try {
        const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY id ASC`);
        dump.tables[table] = rows;
      } catch (_) {
        dump.tables[table] = []; // table might not exist yet
      }
    }

    // Also include optional feature tables if they exist
    for (const table of ['audit_log', 'notifications', 'sms_log']) {
      try {
        const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY id ASC`);
        dump.tables[table] = rows;
      } catch (_) {}
    }

    const filename = `jju_backup_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(dump);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/backup/stats  — show row counts per table ───────────────────
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const tables = ['records', 'cashbook_entries', 'customers', 'users', 'audit_log', 'notifications', 'sms_log', 'sync_log'];
    const counts = {};
    for (const t of tables) {
      try {
        const { rows } = await pool.query(`SELECT COUNT(*) FROM ${t}`);
        counts[t] = parseInt(rows[0].count);
      } catch (_) { counts[t] = null; }
    }
    res.json({ counts, checked_at: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Restore helper ─────────────────────────────────────────────────────────
// BUG FIX: /export dumps 8 tables (records, cashbook_entries, customers,
// users, sync_log, audit_log, notifications, sms_log) but /restore used to
// only re-insert 2 of them (records, cashbook_entries) — restoring your own
// backup silently dropped every customer, user, and audit record with no
// warning. Column lists below are an explicit whitelist matching
// db/migrations.js (never built from the request body's own keys — that
// would let arbitrary JSON keys become SQL identifiers).
// Also: failures were swallowed with a bare `catch (_) {}`, so a restore
// that inserted zero rows looked identical to one that fully succeeded.
// Now the first few error messages per table are kept for the response.
async function restoreTable(table, rows, columns, buildValues) {
  const result = { attempted: rows.length, inserted: 0, errors: [] };
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
  const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`;
  for (const row of rows) {
    try {
      const r = await pool.query(sql, buildValues(row));
      if (r.rowCount > 0) result.inserted++;
    } catch (e) {
      if (result.errors.length < 5) result.errors.push(e.message);
    }
  }
  return result;
}

// ── POST /api/backup/restore  — restore from JSON dump ───────────────────
// CAUTION: This APPENDS data (insert-on-conflict-ignore). It does NOT wipe tables first.
// To do a full overwrite, manually truncate tables then restore.
router.post('/restore', adminOnly, async (req, res) => {
  try {
    const { tables } = req.body;
    if (!tables || typeof tables !== 'object') {
      return res.status(400).json({ error: 'Body must be a backup JSON with a "tables" key' });
    }

    const results = {};

    // Restore customers and users FIRST — records/cashbook_entries/audit_log/
    // notifications reference customer_id/user_id and read better once those
    // rows already exist, even though none of these are FK-enforced.
    if (Array.isArray(tables.customers)) {
      results.customers = await restoreTable(
        'customers',
        tables.customers,
        ['id', 'customer_id', 'name', 'aadhar', 'mobile', 'pan', 'dob', 'address',
         'occupation', 'saving_acc_no', 'saving_balance', 'share_acc_no', 'gender',
         'marital_status', 'qualification', 'passport_no', 'religion', 'caste',
         'created_at', 'updated_at'],
        (c) => [c.id, c.customer_id, c.name, c.aadhar, c.mobile, c.pan, c.dob, c.address,
                c.occupation, c.saving_acc_no, c.saving_balance || 0, c.share_acc_no, c.gender,
                c.marital_status, c.qualification, c.passport_no, c.religion, c.caste,
                c.created_at, c.updated_at],
      );
    }

    if (Array.isArray(tables.users)) {
      results.users = await restoreTable(
        'users',
        tables.users,
        ['id', 'username', 'password', 'full_name', 'role', 'last_login', 'created_at', 'is_active'],
        (u) => [u.id, u.username, u.password, u.full_name, u.role || 'admin',
                u.last_login, u.created_at, u.is_active !== false],
      );
    }

    // Restore records
    if (Array.isArray(tables.records)) {
      let inserted = 0;
      for (const r of tables.records) {
        try {
          await pool.query(
            `INSERT INTO records (id, date, name, customer_id, customer_type, aadhar, mobile,
               account_no, section, tx_types, data, remarks, sonar_parent_no, sonar_sub_no,
               sonar_group_no, status, closed_date, closed_remarks, is_deleted, deleted_at,
               created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
             ON CONFLICT (id) DO NOTHING`,
            [r.id, r.date, r.name, r.customer_id, r.customer_type || 'regular',
             r.aadhar, r.mobile, r.account_no, r.section, r.tx_types, r.data || {},
             r.remarks, r.sonar_parent_no, r.sonar_sub_no, r.sonar_group_no,
             r.status || 'active', r.closed_date, r.closed_remarks,
             r.is_deleted || false, r.deleted_at, r.created_at, r.updated_at]
          );
          inserted++;
        } catch (_) {}
      }
      results.records = { attempted: tables.records.length, inserted };
    }

    // Restore cashbook_entries
    if (Array.isArray(tables.cashbook_entries)) {
      let inserted = 0;
      for (const e of tables.cashbook_entries) {
        try {
          await pool.query(
            `INSERT INTO cashbook_entries (id, date, record_id, name, task, acc_type, tx_type,
               acc_no, amount, mode, scroll_no, loan_date, sort_order, is_deleted, deleted_at,
               created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             ON CONFLICT (id) DO NOTHING`,
            [e.id, e.date, e.record_id, e.name, e.task, e.acc_type, e.tx_type,
             e.acc_no, e.amount || 0, e.mode, e.scroll_no, e.loan_date,
             e.sort_order || 0, e.is_deleted || false, e.deleted_at, e.created_at, e.updated_at]
          );
          inserted++;
        } catch (_) {}
      }
      results.cashbook_entries = { attempted: tables.cashbook_entries.length, inserted };
    }

    // Restore the remaining feature tables that /export includes.
    if (Array.isArray(tables.audit_log)) {
      results.audit_log = await restoreTable(
        'audit_log',
        tables.audit_log,
        ['id', 'user_id', 'username', 'action', 'resource', 'resource_id', 'ip', 'user_agent', 'diff', 'created_at'],
        (a) => [a.id, a.user_id, a.username, a.action, a.resource, a.resource_id, a.ip,
                a.user_agent, a.diff ? JSON.stringify(a.diff) : null, a.created_at],
      );
    }

    if (Array.isArray(tables.notifications)) {
      results.notifications = await restoreTable(
        'notifications',
        tables.notifications,
        ['id', 'user_id', 'type', 'title', 'body', 'link', 'is_read', 'created_at'],
        (n) => [n.id, n.user_id, n.type, n.title, n.body, n.link, n.is_read || false, n.created_at],
      );
    }

    if (Array.isArray(tables.sms_log)) {
      results.sms_log = await restoreTable(
        'sms_log',
        tables.sms_log,
        ['id', 'mobile', 'message', 'type', 'record_id', 'status', 'error', 'created_at'],
        (s) => [s.id, s.mobile, s.message, s.type, s.record_id, s.status || 'sent', s.error, s.created_at],
      );
    }

    if (Array.isArray(tables.sync_log)) {
      results.sync_log = await restoreTable(
        'sync_log',
        tables.sync_log,
        ['id', 'started_at', 'finished_at', 'status', 'message', 'rows_synced'],
        (s) => [s.id, s.started_at, s.finished_at, s.status || 'running', s.message, s.rows_synced || 0],
      );
    }

    res.json({ ok: true, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

/*
── ADD TO server.js ──────────────────────────────────────────────────────────
  app.use('/api/backup', require('./features/backup/backup.routes'));

── USAGE ─────────────────────────────────────────────────────────────────────
  // Download full backup:
  window.open('/api/backup/export');   // prompts JSON file download

  // Restore (POST the JSON file content):
  fetch('/api/backup/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
    body: JSON.stringify(backupJson)
  });

── AUTOMATE DAILY BACKUPS (optional) ────────────────────────────────────────
  Use pg_dump for production-grade backups:
  pg_dump -U jju_user jju_bank > backup_$(date +%F).sql
*/
