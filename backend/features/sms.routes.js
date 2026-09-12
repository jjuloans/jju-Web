'use strict';
const router = require('express').Router();
const pool   = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { sendAndLog, templates } = require('./sms.service');

router.use(requireAuth);

// POST /api/sms/send  — free-form send (admin use)
router.post('/send', async (req, res) => {
  try {
    const { mobile, message, record_id } = req.body;
    if (!mobile || !message) return res.status(400).json({ error: 'mobile and message required' });
    const result = await sendAndLog(mobile, message, 'manual', record_id || null);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/sms/send-template  — send a named template
router.post('/send-template', async (req, res) => {
  try {
    const { template, mobile, params = [], record_id } = req.body;
    if (!templates[template]) return res.status(400).json({ error: `Unknown template: ${template}` });
    const message = templates[template](...params);
    const result  = await sendAndLog(mobile, message, template, record_id || null);
    res.json({ ...result, message });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sms/log?limit=50&record_id=
router.get('/log', async (req, res) => {
  try {
    const { record_id, limit = 50 } = req.query;
    const where = record_id ? `WHERE record_id=$1` : '';
    const params = record_id ? [record_id] : [];
    const { rows } = await pool.query(
      `SELECT * FROM sms_log ${where} ORDER BY created_at DESC LIMIT ${Math.min(parseInt(limit) || 50, 200)}`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sms/templates  — list available templates
router.get('/templates', (req, res) => {
  res.json(Object.keys(templates).map(name => ({ name })));
});

module.exports = router;

/*
── ADD TO server.js ──────────────────────────────────────────────────────────
  app.use('/api/sms', require('./features/sms/sms.routes'));
*/
