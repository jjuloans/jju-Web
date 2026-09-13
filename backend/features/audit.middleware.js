'use strict';
const pool = require('../db/pool');

// BUG FIX: audit_log table creation used to happen here, in a standalone
// call that fired the instant this file was require()'d — completely
// outside server.js's waitForDB() retry gate that everything else in this
// app goes through. If Postgres wasn't fully up yet at that exact moment
// (the same PM2/Windows boot-ordering race documented in server.js's
// waitForDB() and migrations.js's ensureTrackingTable()), this call failed,
// was logged as "[audit] table init failed: ... connection timeout", and
// never retried. Every subsequent audit write also swallows its own errors
// silently (see writeLog below), so a single unlucky startup could leave
// this app running normally for users while producing a completely empty
// audit trail until the next successful restart — a real accountability
// gap for a banking app, not just log noise.
// Fixed by moving table creation into migrations.js (v16_audit_log_table),
// which already runs through waitForDB() + the tracked-migration system
// before the server starts accepting requests, same as every other table.

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
