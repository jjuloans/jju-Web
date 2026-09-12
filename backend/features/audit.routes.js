'use strict';
const router = require('express').Router();
const pool   = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { canRead } = require('./rbac.middleware');

router.use(requireAuth);

// FIX: this router was reachable by any authenticated user, regardless of
// role. The permission matrix in features/rbac.middleware.js only grants
// 'audit:read' to manager and admin (staff and viewer do not have it) —
// canRead('audit') enforces that here instead of leaving audit history
// (who did what, including other users' actions) open to every role.

// GET /api/audit?resource=records&action=DELETE&user=&from=&to=&limit=50&offset=0
router.get('/', canRead('audit'), async (req, res) => {
  try {
    const { resource, action, username, from, to, limit = 50, offset = 0 } = req.query;
    const where = []; const params = []; let pi = 1;

    if (resource) { where.push(`resource=$${pi++}`); params.push(resource); }
    if (action)   { where.push(`action=$${pi++}`);   params.push(action); }
    if (username) { where.push(`username ILIKE $${pi++}`); params.push(`%${username}%`); }
    if (from)     { where.push(`created_at >= $${pi++}`); params.push(from); }
    if (to)       { where.push(`created_at <= $${pi++}`); params.push(to); }

    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [countRes, rows] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM audit_log ${clause}`, params),
      pool.query(
        `SELECT * FROM audit_log ${clause} ORDER BY created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0]
      ),
    ]);

    res.json({ logs: rows.rows, total: parseInt(countRes.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/audit/resource/:resource/:id  — full history for one record
router.get('/resource/:resource/:id', canRead('audit'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE resource=$1 AND resource_id=$2 ORDER BY created_at DESC LIMIT 100`,
      [req.params.resource, req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/audit/stats  — summary counts by action/resource (last 30 days)
router.get('/stats', canRead('audit'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT action, resource, COUNT(*) AS count
      FROM audit_log
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY action, resource
      ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

/*
── ADD TO server.js (one line) ──────────────────────────────────────────────
  app.use('/api/audit', require('./features/audit.routes'));

── auditMiddleware is now wired directly into routes/records.routes.js and
   routes/cashbook.routes.js (see those files) — no further action needed.
   require path is '../features/audit.middleware' (this file lives directly
   under features/, not features/audit/).
*/
