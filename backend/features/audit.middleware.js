'use strict';
const pool = require('../db/pool');

// ── Migration: run once on startup ────────────────────────────────────────
async function ensureAuditTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER,
      username    TEXT,
      action      TEXT NOT NULL,
      resource    TEXT NOT NULL,
      resource_id TEXT,
      ip          TEXT,
      user_agent  TEXT,
      diff        JSONB,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_log(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_resource   ON audit_log(resource)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at)`);
}
ensureAuditTable().catch(e => console.error('[audit] table init failed:', e.message));

// ── Core writer ───────────────────────────────────────────────────────────
async function writeLog({ user_id, username, action, resource, resource_id, ip, user_agent, diff }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, resource, resource_id, ip, user_agent, diff)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [user_id || null, username || null, action, resource,
       resource_id ? String(resource_id) : null,
       ip || null, user_agent || null,
       diff ? JSON.stringify(diff) : null]
    );
  } catch (err) {
    console.error('[audit] write failed:', err.message);
  }
}

// ── Express middleware factory ────────────────────────────────────────────
// Usage: router.post('/', auditMiddleware('CREATE', 'records'), controller.create)
function auditMiddleware(action, resource) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = async function (body) {
      if (res.statusCode < 400) {
        const sess = req.session || {};
        await writeLog({
          user_id:     sess.id,
          username:    sess.username,
          action,
          resource,
          resource_id: req.params?.id || body?.id || null,
          ip:          req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
          user_agent:  req.headers['user-agent'],
          diff:        req.auditDiff || null,
        });
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { writeLog, auditMiddleware };
