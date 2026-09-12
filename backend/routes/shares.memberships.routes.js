"use strict";

/**
 * shares_memberships.routes.js
 *
 * Mount in app.js as:
 *   app.use('/api', require('./routes/shares_memberships.routes'));
 *
 * Routes:
 *   GET /api/shares        ?search=  &limit=  &offset=
 *   GET /api/memberships   ?search=  &limit=  &offset=
 *
 * Expected columns returned:
 *   shares       → id, acc_no, customer_name, cust_code, customer_db_id,
 *                  pan_no, start_date, balance, status
 *   memberships  → id, acc_no, customer_name, cust_code, customer_db_id,
 *                  membership_type, saving_acc_no, start_date, status
 */

const router = require("express").Router();
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

// FIX: router.use(requireAuth) here gated every request that entered this
// router. Because this router is mounted at the broad app.use("/api", ...)
// prefix (by design, so it loads before other /api routes), it silently
// intercepted /api/health and returned 401 before the real handler ever
// ran. requireAuth is now applied per-route instead, on just the two
// routes that need it.

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a WHERE clause fragment for optional search.
 * Matches customer name, acc_no, or cust_code (case-insensitive).
 */
function searchClause(search, tableAlias, custAlias, startIdx) {
  if (!search || !search.trim()) {
    return { sql: "", params: [], nextIdx: startIdx };
  }
  const q = `%${search.trim().toLowerCase()}%`;
  const sql = ` AND (
    LOWER(${custAlias}.name)          LIKE $${startIdx}
    OR LOWER(${tableAlias}.acc_no)    LIKE $${startIdx}
    OR LOWER(${custAlias}.cust_code)  LIKE $${startIdx}
  )`;
  return { sql, params: [q], nextIdx: startIdx + 1 };
}

function parsePagination(query) {
  const limit = Math.min(parseInt(query.limit || "10000", 10) || 10000, 50000);
  const offset = Math.max(parseInt(query.offset || "0", 10) || 0, 0);
  return { limit, offset };
}

// ── GET /api/shares ──────────────────────────────────────────────────────────
router.get("/shares", requireAuth, async (req, res, next) => {
  try {
    const { search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];

    const sq = searchClause(search, "sa", "c", idx);
    idx = sq.nextIdx;
    params.push(...sq.params);

    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const sql = `
      SELECT
        sa.id,
        sa.acc_no,
        c.name                                 AS customer_name,
        COALESCE(c.cust_code, '')              AS cust_code,
        c.id                                   AS customer_db_id,
        COALESCE(NULLIF(c.pan_no, ''), NULLIF(sa.pan_no, '')) AS pan_no,
        sa.start_date,
        COALESCE(sa.balance, 0)                AS balance,
        COALESCE(sa.status, 'active')          AS status
      FROM share_accounts sa
      LEFT JOIN customers c ON c.id = sa.customer_id
      WHERE 1=1
        ${sq.sql}
      ORDER BY
        sa.status = 'active' DESC,
        sa.acc_no
      LIMIT  $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/memberships ─────────────────────────────────────────────────────
router.get("/memberships", requireAuth, async (req, res, next) => {
  try {
    const { search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];

    const sq = searchClause(search, "m", "c", idx);
    idx = sq.nextIdx;
    params.push(...sq.params);

    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const sql = `
      SELECT
        m.id,
        m.acc_no,
        COALESCE(c.name, m.customer_name)      AS customer_name,
        COALESCE(c.cust_code, '')              AS cust_code,
        c.id                                   AS customer_db_id,
        m.membership_type,
        m.saving_acc_no,
        m.start_date,
        COALESCE(m.status, 'active')           AS status
      FROM memberships m
      LEFT JOIN customers c  ON c.id  = m.customer_id
      WHERE 1=1
        ${sq.sql}
      ORDER BY
        m.status = 'active' DESC,
        m.acc_no
      LIMIT  $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
