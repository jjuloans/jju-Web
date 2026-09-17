"use strict";

/**
 * dashboard_routes.js
 *
 * Mounts at: /api
 *
 * Routes:
 *   GET /api/customers/:id/profile       - Get detailed customer profile
 *   GET /api/stats                       - Dashboard summary counters
 *   GET /api/maturing-fds?days=90        - FDs maturing within N days
 *   GET /api/fd-maturity-calendar        - FD maturity grouped by month
 *   GET /api/gold-loans/overdue          - Overdue active gold loans
 *   GET /api/od-loans   ?status=&search=&limit=&offset=
 *   GET /api/shares     ?search=&limit=&offset=
 *   GET /api/memberships?search=&limit=&offset=
 */

const router = require("express").Router();
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

// FIX: this router was mounted at app.use("/api", ...) in server.js with no
// auth check at all — every route below (customer profiles with aadhar/
// mobile/PAN, stats, gold-loans, od-loans, search, closed-history, etc.) was
// reachable by anyone on the LAN with no login token. server.js mounts this
// router AFTER /api/health, so a blanket requireAuth here is safe (unlike
// shares.memberships.routes.js, which is mounted before /api/health and so
// applies requireAuth per-route instead).
router.use(requireAuth);

// ── helpers ──────────────────────────────────────────────────────────────────

function parsePagination(query) {
  const limit = Math.min(parseInt(query.limit || "10000", 10) || 10000, 50000);
  const offset = Math.max(parseInt(query.offset || "0", 10) || 0, 0);
  return { limit, offset };
}

function statusClause(status, tableAlias, startIdx) {
  const col = `${tableAlias}.status`;
  if (!status || status === "all") {
    return { sql: "", params: [], nextIdx: startIdx };
  }
  return {
    sql: ` AND ${col} = $${startIdx}`,
    params: [status],
    nextIdx: startIdx + 1,
  };
}

function searchClause(search, tableAlias, custAlias, startIdx) {
  if (!search || !search.trim()) {
    return { sql: "", params: [], nextIdx: startIdx };
  }
  const q = `%${search.trim().toLowerCase()}%`;
  const sql = ` AND (
    LOWER(COALESCE(${custAlias}.name, ${tableAlias}.customer_name, '')) LIKE $${startIdx}
    OR LOWER(${tableAlias}.acc_no)                                      LIKE $${startIdx}
    OR LOWER(COALESCE(${custAlias}.cust_code, ''))                      LIKE $${startIdx}
  )`;
  return { sql, params: [q], nextIdx: startIdx + 1 };
}

// ── GET /api/customers/:id/profile ──────────────────────────────────────────
/**
 * Fetch customer profile by ID
 *
 * ID Lookup Strategy (Try in order):
 *   Try 1: Numeric ID → customers.id = $1
 *   Try 2: customer_db_id → c.id = $1 (if passed as customer_db_id param)
 *   Try 3: cust_code text match → customers.customer_id = $1
 *   Try 4: Lookup via records table
 *   Try 5: Return 404 if not found
 */
router.get("/customers/:id/profile", async (req, res, next) => {
  try {
    const rawId = req.params.id;
    const customerId = req.query.customer_id; // Optional: direct customer_db_id

    let customer = null;

    const tryQuery = async (sql, params) => {
      try {
        const result = await pool.query(sql, params);
        return result.rows[0] || null;
      } catch (e) {
        console.error("profile lookup query failed:", e.message);
        return null;
      }
    };

    // === Try 1: Use customer_db_id if explicitly provided ===
    if (customerId) {
      customer = await tryQuery(
        "SELECT * FROM customers WHERE id = $1 LIMIT 1",
        [customerId]
      );
    }

    // === Try 2: Numeric ID (likely from a table primary key) ===
    if (!customer && /^\d+$/.test(rawId) && !rawId.startsWith("0")) {
      customer = await tryQuery(
        "SELECT * FROM customers WHERE id = $1 LIMIT 1",
        [parseInt(rawId, 10)]
      );
    }

    // === Try 3: Text ID (zero-padded cust_code or customer_id) ===
    if (!customer) {
      customer =
        (await tryQuery(
          "SELECT * FROM customers WHERE customer_id = $1 OR cust_code = $1 LIMIT 1",
          [rawId]
        )) ||
        (await tryQuery(
          "SELECT * FROM customers WHERE customer_id = $1 LIMIT 1",
          [rawId]
        ));
    }

    // === Try 4: Lookup via records table (last resort) ===
    if (!customer && /^\d+$/.test(rawId)) {
      const recordId = parseInt(rawId, 10);
      const row = await tryQuery(
        // BUG FIX: was 'c.id = r.customer_id' — comparing customers.id
        // (integer PK) directly to records.customer_id (text code) with no
        // cast at all. Postgres has no integer = text operator, so this
        // query always threw and was silently swallowed by tryQuery's catch,
        // meaning this fallback lookup never actually worked. Match the two
        // text customer codes against each other instead.
        `SELECT c.* FROM records r
         LEFT JOIN customers c ON c.customer_id = r.customer_id
         WHERE r.id = $1 AND r.is_deleted = FALSE
         LIMIT 1`,
        [recordId]
      );
      if (row && (row.id || row.customer_id)) {
        customer = row;
      }
    }

    // === Not found ===
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const custId = customer.id ?? null;

    const safeQuery = (sql, params) =>
      pool.query(sql, params).catch((e) => {
        console.error("profile sub-query failed:", e.message);
        return { rows: [] };
      });

    const [goldLoans, savingAccounts, fdAccounts, odLoans, shareAccounts, memberships] =
      await Promise.all([
        safeQuery(
          // BUG FIX: was 'WHERE r.customer_id::integer = $1' — casting the
          // human-readable text code (e.g. "0000003259") to integer and
          // comparing it to custId (customers.id, an unrelated serial PK).
          // gold_loans has its own integer customer_id FK column — use it.
          `SELECT gl.id, gl.acc_no, gl.loan_amount,
                  COALESCE((r.data->>'balance')::numeric, gl.loan_amount) AS balance,
                  COALESCE((r.data->>'interest_rate')::numeric, 0)        AS interest_rate,
                  gl.status, COALESCE(gl.loan_date::text, r.date::text)   AS start_date,
                  r.closed_date::text AS end_date,
                  gl.nominee_name, gl.nominee_relation,
                  gl.customer_photo_url, gl.photo_ornament,
                  gl.photo_aadhar_front, gl.photo_aadhar_back, gl.photo_pan
           FROM gold_loans gl
           LEFT JOIN records r ON r.id = gl.record_id AND r.is_deleted = FALSE
           WHERE gl.customer_id = $1
           ORDER BY gl.status = 'active' DESC, gl.acc_no`,
          [custId]
        ),
        safeQuery(
          `SELECT id, acc_no, start_date, interest_rate, balance, status,
                  nominee_name, nominee_relation,
                  photo_customer, photo_aadhar_front, photo_aadhar_back, photo_pan
           FROM saving_accounts WHERE customer_id = $1
           ORDER BY status = 'active' DESC, acc_no`,
          [custId]
        ),
        safeQuery(
          `SELECT id, acc_no, start_date, end_date, interest_rate, duration,
                  fd_amount, COALESCE(balance, fd_amount) AS balance,
                  maturity_amount, status,
                  nominee_name, nominee_relation,
                  photo_customer, photo_aadhar_front, photo_aadhar_back, photo_pan
           FROM fd_accounts WHERE customer_id = $1
           ORDER BY status = 'active' DESC, acc_no`,
          [custId]
        ),
        safeQuery(
          `SELECT id, acc_no, fd_acc_no, loan_amount, balance, interest_rate,
                  start_date, end_date, status
           FROM od_loans WHERE customer_id = $1
           ORDER BY status = 'active' DESC, acc_no`,
          [custId]
        ),
        safeQuery(
          `SELECT id, acc_no, pan_no, start_date, balance, status
           FROM share_accounts WHERE customer_id = $1
           ORDER BY status = 'active' DESC, acc_no`,
          [custId]
        ),
        safeQuery(
          `SELECT id, acc_no, membership_type, saving_acc_no, start_date, status,
                  nominee_name, nominee_relation,
                  photo_customer, photo_aadhar_front, photo_aadhar_back, photo_pan
           FROM memberships WHERE customer_id = $1
           ORDER BY status = 'active' DESC, acc_no`,
          [custId]
        ),
      ]);

    // Return customer profile
    res.json({
      customer,
      gold_loans: goldLoans.rows,
      saving_accounts: savingAccounts.rows,
      fd_accounts: fdAccounts.rows,
      od_loans: odLoans.rows,
      shares: shareAccounts.rows,
      memberships: memberships.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/stats ───────────────────────────────────────────────────────────
router.get("/stats", async (req, res, next) => {
  try {
    const queries = {
      customers: `SELECT COUNT(*)::int AS n FROM customers`,

      active_gold_loans: `SELECT COUNT(*)::int AS n FROM gold_loans WHERE status = 'active'`,
      closed_gold_loans: `SELECT COUNT(*)::int AS n FROM gold_loans WHERE status = 'closed'`,
      gold_loan_total: `
        SELECT COALESCE(SUM(gl.loan_amount), 0)::numeric AS n
        FROM gold_loans gl WHERE gl.status = 'active'`,

      saving_accounts: `SELECT COUNT(*)::int AS n FROM saving_accounts WHERE status = 'active'`,
      saving_total: `SELECT COALESCE(SUM(balance), 0)::numeric AS n FROM saving_accounts WHERE status = 'active'`,

      active_fds: `SELECT COUNT(*)::int AS n FROM fd_accounts WHERE status = 'active'`,
      closed_fds: `SELECT COUNT(*)::int AS n FROM fd_accounts WHERE status = 'closed'`,
      fd_total: `SELECT COALESCE(SUM(fd_amount), 0)::numeric AS n FROM fd_accounts WHERE status = 'active'`,

      active_od_loans: `SELECT COUNT(*)::int AS n FROM od_loans WHERE status = 'active'`,

      share_accounts: `SELECT COUNT(*)::int AS n FROM share_accounts WHERE status = 'active'`,

      memberships: `SELECT COUNT(*)::int AS n FROM memberships WHERE status = 'active'`,

      overdue_gold: `
        SELECT COUNT(*)::int AS n
        FROM gold_loans gl
        LEFT JOIN records r ON r.id = gl.record_id AND r.is_deleted = FALSE
        WHERE gl.status = 'active' AND r.closed_date IS NULL
          AND (r.data->>'end_date') IS NOT NULL
          AND (r.data->>'end_date')::date < CURRENT_DATE`,

      overdue_od: `
        SELECT COUNT(*)::int AS n FROM od_loans
        WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE`,
    };

    const keys = Object.keys(queries);
    const results = await Promise.all(
      keys.map((k) => pool.query(queries[k]).catch(() => ({ rows: [{ n: 0 }] })))
    );

    const stats = {};
    keys.forEach((k, i) => {
      stats[k] = results[i].rows[0] ? results[i].rows[0].n : 0;
    });

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/maturing-fds ─────────────────────────────────────────────────────
router.get("/maturing-fds", async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || "90", 10) || 90, 1), 3650);

    const sql = `
      SELECT
        fd.id,
        fd.acc_no,
        c.name AS customer_name,
        c.cust_code,
        fd.end_date,
        fd.maturity_amount,
        (fd.end_date - CURRENT_DATE) AS days_remaining
      FROM fd_accounts fd
      LEFT JOIN customers c ON c.id = fd.customer_id
      WHERE fd.status = 'active'
        AND fd.end_date IS NOT NULL
        AND fd.end_date >= CURRENT_DATE
        AND fd.end_date <= CURRENT_DATE + $1::int
      ORDER BY fd.end_date ASC
    `;

    const { rows } = await pool.query(sql, [days]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/fd-maturity-calendar ─────────────────────────────────────────────
router.get("/fd-maturity-calendar", async (req, res, next) => {
  try {
    const sql = `
      SELECT
        to_char(fd.end_date, 'YYYY-MM') AS month,
        COUNT(*)::int AS count,
        COALESCE(SUM(fd.maturity_amount), 0)::numeric AS total_maturity
      FROM fd_accounts fd
      WHERE fd.status = 'active'
        AND fd.end_date IS NOT NULL
        AND fd.end_date >= CURRENT_DATE
      GROUP BY 1
      ORDER BY 1
    `;

    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/fd-maturity-calendar/:month (detail) ─────────────────────────────
router.get("/fd-maturity-calendar/:month", async (req, res, next) => {
  try {
    const { month } = req.params; // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Invalid month format, expected YYYY-MM" });
    }

    const sql = `
      SELECT
        fd.id, fd.acc_no, c.name AS customer_name, c.cust_code,
        fd.end_date, fd.fd_amount, fd.maturity_amount, fd.interest_rate, fd.status
      FROM fd_accounts fd
      LEFT JOIN customers c ON c.id = fd.customer_id
      WHERE fd.status = 'active'
        AND fd.end_date IS NOT NULL
        AND to_char(fd.end_date, 'YYYY-MM') = $1
      ORDER BY fd.end_date ASC
    `;

    const { rows } = await pool.query(sql, [month]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/gold-loans/overdue ───────────────────────────────────────────────
router.get("/gold-loans/overdue", async (req, res, next) => {
  try {
    const sql = `
      SELECT
        gl.id,
        gl.acc_no,
        COALESCE(c.name, gl.customer_name)          AS customer_name,
        COALESCE(c.cust_code, gl.customer_id::text) AS cust_code,
        c.id                                         AS customer_db_id,
        (r.data->>'end_date')::date                 AS end_date,
        (CURRENT_DATE - (r.data->>'end_date')::date)::int AS days_overdue,
        gl.loan_amount,
        COALESCE((r.data->>'balance')::numeric, gl.loan_amount) AS balance,
        COALESCE((r.data->>'interest_rate')::numeric, 0)        AS interest_rate,
        gl.status
      FROM gold_loans gl
      LEFT JOIN records  r ON r.id = gl.record_id AND r.is_deleted = FALSE
      -- BUG FIX: was 'c.id = r.customer_id::integer' — wrong join, see notes
      -- elsewhere in this file. gold_loans.customer_id is the correct FK.
      LEFT JOIN customers c ON c.id = gl.customer_id
      WHERE gl.status = 'active'
        AND r.closed_date IS NULL
        AND (r.data->>'end_date') IS NOT NULL
        AND (r.data->>'end_date')::date < CURRENT_DATE
      ORDER BY (r.data->>'end_date')::date ASC
    `;

    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/od-loans ──────────────────────────────────────────────────────────
router.get("/od-loans", async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];

    const sc = statusClause(status, "od", idx);
    idx = sc.nextIdx;
    params.push(...sc.params);

    const sq = searchClause(search, "od", "c", idx);
    idx = sq.nextIdx;
    params.push(...sq.params);

    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const sql = `
      SELECT
        od.id,
        od.acc_no,
        c.name           AS customer_name,
        c.cust_code,
        c.id             AS customer_db_id,
        od.fd_acc_no,
        od.start_date,
        od.end_date,
        od.interest_rate,
        od.loan_amount,
        COALESCE(od.balance, od.loan_amount) AS balance,
        od.status
      FROM od_loans od
      LEFT JOIN customers c ON c.id = od.customer_id
      WHERE 1=1
        ${sc.sql}
        ${sq.sql}
      ORDER BY
        od.status = 'active' DESC,
        od.acc_no
      LIMIT  $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/shares ──────────────────────────────────────────────────────────
router.get("/shares", async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];

    const sc = statusClause(status, "sh", idx);
    idx = sc.nextIdx;
    params.push(...sc.params);

    const sq = searchClause(search, "sh", "c", idx);
    idx = sq.nextIdx;
    params.push(...sq.params);

    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const sql = `
      SELECT
        sh.id,
        sh.acc_no,
        c.name           AS customer_name,
        c.cust_code,
        c.id             AS customer_db_id,
        COALESCE(NULLIF(c.pan_no, ''), NULLIF(sh.pan_no, '')) AS pan_no,
        sh.start_date,
        sh.balance,
        sh.status
      FROM share_accounts sh
      LEFT JOIN customers c ON c.id = sh.customer_id
      WHERE 1=1
        ${sc.sql}
        ${sq.sql}
      ORDER BY
        sh.status = 'active' DESC,
        sh.acc_no
      LIMIT  $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/memberships ───────────────────────────────────────────────────────
router.get("/memberships", async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];

    const sc = statusClause(status, "m", idx);
    idx = sc.nextIdx;
    params.push(...sc.params);

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
        COALESCE(c.name, m.customer_name) AS customer_name,
        c.cust_code,
        c.id             AS customer_db_id,
        m.membership_type,
        m.saving_acc_no,
        m.start_date,
        m.status
      FROM memberships m
      LEFT JOIN customers c ON c.id = m.customer_id
      WHERE 1=1
        ${sc.sql}
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

// ── GET /api/customers ─────────────────────────────────────────────────────
router.get("/customers", async (req, res, next) => {
  try {
    const { search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];
    let whereSql = "";

    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      whereSql = ` AND (
        LOWER(c.name)       LIKE $${idx}
        OR LOWER(c.cust_code) LIKE $${idx}
        OR LOWER(c.mobile)  LIKE $${idx}
        OR LOWER(c.aadhar)  LIKE $${idx}
        OR LOWER(c.pan_no)  LIKE $${idx}
      )`;
      params.push(q);
      idx++;
    }

    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const sql = `
      SELECT
        c.*,
        COALESCE(gl_agg.active_loans,  0)::int AS active_loans,
        COALESCE(sa_agg.saving_accs,   0)::int AS saving_accs,
        COALESCE(fd_agg.fd_accs,       0)::int AS fd_accs,
        COALESCE(sh_agg.share_accs,    0)::int AS share_accs,
        COALESCE(od_agg.od_accs,       0)::int AS od_accs
      FROM customers c
      -- active gold loans
      -- BUG FIX: was 'r.customer_id::integer = c.id' — gold_loans has its own
      -- integer customer_id FK column; use it directly, no records join needed.
      LEFT JOIN (
        SELECT customer_id AS cid, COUNT(*)::int AS active_loans
        FROM gold_loans WHERE status = 'active'
        GROUP BY customer_id
      ) gl_agg ON gl_agg.cid = c.id
      -- saving accounts
      -- FIX: query saving_accounts directly by customer_id (it has the column),
      -- same as share_accounts/od_loans below. The previous version required an
      -- INNER JOIN through records (sa.record_id -> r.id, r.is_deleted=FALSE),
      -- which silently dropped accounts whose record link was missing/deleted
      -- even though the saving account itself is active and correctly linked.
      LEFT JOIN (
        SELECT customer_id AS cid, COUNT(*)::int AS saving_accs
        FROM saving_accounts WHERE status = 'active'
        GROUP BY customer_id
      ) sa_agg ON sa_agg.cid = c.id
      -- fd accounts
      -- FIX: same issue as saving accounts above — query fd_accounts directly
      -- by customer_id instead of requiring a live records join, which was
      -- causing customers with valid active FDs to show 0/— in this list.
      LEFT JOIN (
        SELECT customer_id AS cid, COUNT(*)::int AS fd_accs
        FROM fd_accounts WHERE status = 'active'
        GROUP BY customer_id
      ) fd_agg ON fd_agg.cid = c.id
      -- share accounts (direct customer_id, no records join needed)
      LEFT JOIN (
        SELECT customer_id AS cid, COUNT(*)::int AS share_accs
        FROM share_accounts WHERE status = 'active'
        GROUP BY customer_id
      ) sh_agg ON sh_agg.cid = c.id
      -- od loans (direct customer_id)
      LEFT JOIN (
        SELECT customer_id AS cid, COUNT(*)::int AS od_accs
        FROM od_loans WHERE status = 'active'
        GROUP BY customer_id
      ) od_agg ON od_agg.cid = c.id
      WHERE 1=1
        ${whereSql}
      ORDER BY c.id
      LIMIT  $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/history/closed ──────────────────────────────────────────────────
router.get("/history/closed", async (req, res, next) => {
  try {
    const { search, from, to, type } = req.query;
    const wantType = (type || "all").toLowerCase();

    const result = { gold: [], fd: [], saving: [], od: [] };

    const searchVal = search && search.trim() ? `%${search.trim().toLowerCase()}%` : null;

    // Gold loans (closed via records.closed_date)
    if (wantType === "all" || wantType === "gold") {
      let idx = 1;
      const params = [];
      let extra = "";
      if (searchVal) {
        extra += ` AND (LOWER(COALESCE(c.name, gl.customer_name)) LIKE $${idx} OR LOWER(gl.acc_no) LIKE $${idx})`;
        params.push(searchVal); idx++;
      }
      if (from) { extra += ` AND r.closed_date >= $${idx}`; params.push(from); idx++; }
      if (to)   { extra += ` AND r.closed_date <= $${idx}`; params.push(to); idx++; }

      const sql = `
        SELECT
          'gold' AS type,
          gl.acc_no,
          COALESCE(c.name, gl.customer_name)          AS customer_name,
          COALESCE(c.cust_code, gl.customer_id::text) AS cust_code,
          c.mobile,
          gl.loan_amount AS amount,
          r.closed_date AS closed_at,
          COALESCE((r.data->>'interest_rate')::numeric, 0) AS interest_rate
        FROM gold_loans gl
        LEFT JOIN records  r ON r.id = gl.record_id AND r.is_deleted = FALSE
        -- BUG FIX: was 'c.id = r.customer_id::integer' — use gl.customer_id directly.
        LEFT JOIN customers c ON c.id = gl.customer_id
        WHERE gl.status = 'closed' AND r.closed_date IS NOT NULL
          ${extra}
        ORDER BY r.closed_date DESC
        LIMIT 1000
      `;
      const { rows } = await pool.query(sql, params);
      result.gold = rows;
    }

    // FD accounts
    if (wantType === "all" || wantType === "fd") {
      let idx = 1;
      const params = [];
      let extra = "";
      if (searchVal) {
        extra += ` AND (LOWER(c.name) LIKE $${idx} OR LOWER(fd.acc_no) LIKE $${idx})`;
        params.push(searchVal); idx++;
      }
      if (from) { extra += ` AND fd.closed_date >= $${idx}`; params.push(from); idx++; }
      if (to)   { extra += ` AND fd.closed_date <= $${idx}`; params.push(to); idx++; }

      const sql = `
        SELECT
          'fd' AS type,
          fd.acc_no,
          c.name AS customer_name,
          c.cust_code,
          c.mobile,
          fd.fd_amount AS amount,
          fd.closed_date AS closed_at,
          fd.interest_rate
        FROM fd_accounts fd
        LEFT JOIN customers c ON c.id = fd.customer_id
        WHERE fd.status = 'closed' AND fd.closed_date IS NOT NULL
          ${extra}
        ORDER BY fd.closed_date DESC
        LIMIT 1000
      `;
      const { rows } = await pool.query(sql, params).catch(() => ({ rows: [] }));
      result.fd = rows;
    }

    // Saving accounts
    if (wantType === "all" || wantType === "saving") {
      let idx = 1;
      const params = [];
      let extra = "";
      if (searchVal) {
        extra += ` AND (LOWER(c.name) LIKE $${idx} OR LOWER(sa.acc_no) LIKE $${idx})`;
        params.push(searchVal); idx++;
      }
      if (from) { extra += ` AND sa.closed_date >= $${idx}`; params.push(from); idx++; }
      if (to)   { extra += ` AND sa.closed_date <= $${idx}`; params.push(to); idx++; }

      const sql = `
        SELECT
          'saving' AS type,
          sa.acc_no,
          c.name AS customer_name,
          c.cust_code,
          c.mobile,
          sa.balance AS amount,
          sa.closed_date AS closed_at,
          sa.interest_rate
        FROM saving_accounts sa
        LEFT JOIN customers c ON c.id = sa.customer_id
        WHERE sa.status = 'closed' AND sa.closed_date IS NOT NULL
          ${extra}
        ORDER BY sa.closed_date DESC
        LIMIT 1000
      `;
      const { rows } = await pool.query(sql, params).catch(() => ({ rows: [] }));
      result.saving = rows;
    }

    // OD loans
    if (wantType === "all" || wantType === "od") {
      let idx = 1;
      const params = [];
      let extra = "";
      if (searchVal) {
        extra += ` AND (LOWER(c.name) LIKE $${idx} OR LOWER(od.acc_no) LIKE $${idx})`;
        params.push(searchVal); idx++;
      }
      if (from) { extra += ` AND od.closed_date >= $${idx}`; params.push(from); idx++; }
      if (to)   { extra += ` AND od.closed_date <= $${idx}`; params.push(to); idx++; }

      const sql = `
        SELECT
          'od' AS type,
          od.acc_no,
          c.name AS customer_name,
          c.cust_code,
          c.mobile,
          od.loan_amount AS amount,
          od.closed_date AS closed_at,
          od.interest_rate
        FROM od_loans od
        LEFT JOIN customers c ON c.id = od.customer_id
        WHERE od.status = 'closed' AND od.closed_date IS NOT NULL
          ${extra}
        ORDER BY od.closed_date DESC
        LIMIT 1000
      `;
      const { rows } = await pool.query(sql, params).catch(() => ({ rows: [] }));
      result.od = rows;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/search?q= ───────────────────────────────────────────────────────
router.get("/search", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) return res.json({ customers: [], gold: [], fd: [] });

    const like = `%${q.toLowerCase()}%`;
    const [custR, goldR, fdR] = await Promise.all([
      pool.query(
        `SELECT id, name, cust_code, pan_no, mobile
         FROM customers
         WHERE is_deleted=false AND (
           LOWER(name) LIKE $1 OR LOWER(cust_code) LIKE $1
           OR LOWER(mobile) LIKE $1 OR LOWER(aadhar) LIKE $1
           OR LOWER(pan_no) LIKE $1 OR LOWER(customer_id) LIKE $1
         ) ORDER BY name LIMIT 8`,
        [like]
      ),
      pool.query(
        `SELECT gl.acc_no, COALESCE(c.name, gl.customer_name) AS customer_name, gl.balance
         FROM gold_loans gl
         LEFT JOIN records r ON r.id = gl.record_id AND r.is_deleted = FALSE
         -- BUG FIX: was 'c.id = r.customer_id::integer' — use gl.customer_id directly.
         LEFT JOIN customers c ON c.id = gl.customer_id
         WHERE gl.is_deleted=false AND (
           LOWER(gl.acc_no) LIKE $1
           OR LOWER(COALESCE(c.name, gl.customer_name)) LIKE $1
         ) ORDER BY gl.status='active' DESC LIMIT 5`,
        [like]
      ),
      pool.query(
        `SELECT fd.acc_no, COALESCE(c.name, fd.customer_name) AS customer_name, fd.fd_amount
         FROM fd_accounts fd
         LEFT JOIN customers c ON c.id = fd.customer_id
         WHERE fd.is_deleted=false AND (
           LOWER(fd.acc_no) LIKE $1
           OR LOWER(COALESCE(c.name, fd.customer_name)) LIKE $1
         ) ORDER BY fd.status='active' DESC LIMIT 5`,
        [like]
      ),
    ]);

    res.json({
      customers: custR.rows,
      gold:      goldR.rows,
      fd:        fdR.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
