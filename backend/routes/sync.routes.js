'use strict';
const router = require('express').Router();
const c = require('../controllers/sync.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

// Fix #3: allow CORS preflight OPTIONS through before auth check
router.options('*', (req, res) => res.sendStatus(204));

// All other sync routes require a valid session
router.use(requireAuth);

// Fix #1: removed duplicate GET / — /status is the single canonical URL
router.get('/status', c.status);

// Fix #2: trigger is admin-only
router.post('/', requireRole('admin'), c.trigger);

// Fix #4: explicit 405 for unsupported methods on known routes
router.all('/status', (req, res) => res.status(405).json({ error: `Method ${req.method} not allowed` }));
router.all('/',       (req, res) => res.status(405).json({ error: `Method ${req.method} not allowed` }));

module.exports = router;
