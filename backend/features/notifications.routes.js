'use strict';
const router  = require('express').Router();
const pool    = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { checkFDMaturities, checkOverdueLoans } = require('./notifications.service');

router.use(requireAuth);

// GET /api/notifications?limit=20  — get notifications for current user (or global)
router.get('/', async (req, res) => {
  try {
    const userId = req.session.id;
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const { rows } = await pool.query(
      `SELECT * FROM notifications
       WHERE (user_id=$1 OR user_id IS NULL)
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    const unread = rows.filter(n => !n.is_read).length;
    res.json({ notifications: rows, unread });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/notifications/:id/read
// FIX: this update had no ownership scoping, unlike GET / and PATCH
// /read-all which both correctly restrict to (user_id=$1 OR user_id IS
// NULL). Any authenticated user could mark ANY other user's notification
// as read just by guessing/incrementing the id.
router.patch('/:id/read', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE notifications SET is_read=TRUE
       WHERE id=$1 AND (user_id=$2 OR user_id IS NULL)`,
      [req.params.id, req.session.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/notifications/read-all
router.patch('/read-all', async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read=TRUE WHERE user_id=$1 OR user_id IS NULL`,
      [req.session.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/notifications/run-checks  — manually trigger alert checks
router.post('/run-checks', async (req, res) => {
  try {
    const [fds, loans] = await Promise.all([checkFDMaturities(), checkOverdueLoans()]);
    res.json({ ok: true, fd_alerts: fds, overdue_alerts: loans });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// SSE stream: GET /api/notifications/stream
// Frontend: const es = new EventSource('/api/notifications/stream', { headers: { 'x-auth-token': token } })
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const userId = req.session.id;
  let lastId = 0;

  const poll = async () => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM notifications
         WHERE id > $1 AND (user_id=$2 OR user_id IS NULL) AND is_read=FALSE
         ORDER BY id ASC LIMIT 10`,
        [lastId, userId]
      );
      if (rows.length) {
        lastId = rows[rows.length - 1].id;
        res.write(`data: ${JSON.stringify(rows)}\n\n`);
      }
    } catch (_) {}
  };

  poll();
  const iv = setInterval(poll, 10000);
  req.on('close', () => clearInterval(iv));
});

module.exports = router;

/*
── ADD TO server.js ──────────────────────────────────────────────────────────
  app.use('/api/notifications', require('./features/notifications/notifications.routes'));

── OPTIONAL: schedule daily alert checks via node-cron ──────────────────────
  const cron = require('node-cron');
  const { checkFDMaturities, checkOverdueLoans } = require('./features/notifications/notifications.service');
  cron.schedule('0 8 * * *', async () => {
    await checkFDMaturities();
    await checkOverdueLoans();
  });
*/
