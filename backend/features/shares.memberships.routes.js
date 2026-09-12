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
// TODO: confirm this path matches how the other router imports requireAuth
const { requireAuth } = require("../middleware/auth");

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
        c.pan_no,
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
        c.name                                 AS customer_name,
        COALESCE(c.cust_code, '')              AS cust_code,
        c.id                                   AS customer_db_id,
        m.membership_type,
        sa.acc_no                              AS saving_acc_no,
        m.start_date,
        COALESCE(m.status, 'active')           AS status
      FROM memberships m
      LEFT JOIN customers c  ON c.id  = m.customer_id
      LEFT JOIN saving_accounts sa ON sa.id = m.saving_account_id
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

// ── GET /api/crud/customer-lookup?q= ─────────────────────────────────────────
// Used by CRUD modal customer search in admin.html
router.get("/crud/customer-lookup", requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) return res.json([]);
    const like = `%${q.toLowerCase()}%`;
    const { rows } = await pool.query(
      `SELECT id, customer_id, name, cust_code, mobile
       FROM customers
       WHERE is_deleted = FALSE AND (
         LOWER(name)        LIKE $1
         OR LOWER(cust_code) LIKE $1
         OR LOWER(mobile)    LIKE $1
         OR LOWER(customer_id) LIKE $1
       )
       ORDER BY name LIMIT 10`,
      [like],
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/crud/shares ─────────────────────────────────────────────────────
router.post("/crud/shares", requireAuth, async (req, res, next) => {
  try {
    const { customer_id, acc_no, share_amount, num_shares, status, start_date } = req.body;
    if (!acc_no) return res.status(400).json({ error: "acc_no is required" });
    if (!customer_id) return res.status(400).json({ error: "customer_id is required" });

    const { rows } = await pool.query(
      `INSERT INTO share_accounts
         (acc_no, customer_id, share_amount, num_shares, balance, status, start_date)
       VALUES ($1, $2, $3, $4, $3, $5, $6)
       RETURNING id`,
      [
        acc_no,
        customer_id,
        share_amount || null,
        num_shares || null,
        status || "active",
        start_date || null,
      ],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Account number already exists" });
    next(err);
  }
});

// ── PUT /api/crud/shares/:id ──────────────────────────────────────────────────
router.put("/crud/shares/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { share_amount, num_shares, status, start_date } = req.body;

    await pool.query(
      `UPDATE share_accounts SET
         share_amount = COALESCE($1, share_amount),
         num_shares   = COALESCE($2, num_shares),
         balance      = COALESCE($1, balance),
         status       = COALESCE($3, status),
         start_date   = COALESCE($4, start_date),
         updated_at   = NOW()
       WHERE id = $5`,
      [
        share_amount || null,
        num_shares || null,
        status || null,
        start_date || null,
        id,
      ],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/crud/shares/:id ───────────────────────────────────────────────
router.delete("/crud/shares/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM share_accounts WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/crud/memberships ────────────────────────────────────────────────
router.post("/crud/memberships", requireAuth, async (req, res, next) => {
  try {
    const { customer_id, acc_no, membership_type, saving_acc_no, saving_balance, status, start_date } = req.body;
    if (!acc_no) return res.status(400).json({ error: "acc_no is required" });
    if (!customer_id) return res.status(400).json({ error: "customer_id is required" });

    const { rows } = await pool.query(
      `INSERT INTO memberships
         (acc_no, customer_id, membership_type, saving_acc_no, saving_balance, status, start_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        acc_no,
        customer_id,
        membership_type || "regular",
        saving_acc_no || null,
        saving_balance || 0,
        status || "active",
        start_date || null,
      ],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Account number already exists" });
    next(err);
  }
});

// ── PUT /api/crud/memberships/:id ─────────────────────────────────────────────
router.put("/crud/memberships/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { membership_type, saving_acc_no, saving_balance, status, start_date } = req.body;

    await pool.query(
      `UPDATE memberships SET
         membership_type = COALESCE($1, membership_type),
         saving_acc_no   = COALESCE($2, saving_acc_no),
         saving_balance  = COALESCE($3, saving_balance),
         status          = COALESCE($4, status),
         start_date      = COALESCE($5, start_date),
         updated_at      = NOW()
       WHERE id = $6`,
      [
        membership_type || null,
        saving_acc_no || null,
        saving_balance ?? null,
        status || null,
        start_date || null,
        id,
      ],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/crud/memberships/:id ──────────────────────────────────────────
router.delete("/crud/memberships/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM memberships WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
