'use strict';

const router = require('express').Router();
const pool = require('../db/pool');
const { createSession, getSession, deleteSession, requireAuth } = require('../middleware/auth');

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }
    const result = await pool.query(
      'SELECT id, username, role FROM users WHERE username = $1 AND password = crypt($2, password)',
      [username, password]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const token = createSession(user);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.session });
});

router.post('/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) deleteSession(token);
  res.json({ success: true });
});

module.exports = router;
