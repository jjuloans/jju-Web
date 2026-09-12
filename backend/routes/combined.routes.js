"use strict";

/**
 * combined.routes.js
 *
 * Mounts at: /api/combined
 *
 * Routes:
 *   GET /api/combined/gold-loans        ?status=active|closed|all  &search=  &limit=  &offset=
 *   GET /api/combined/saving-accounts   ?status=active|closed|all  &search=  &limit=  &offset=
 *   GET /api/combined/fd-accounts       ?status=active|closed|all  &search=  &limit=  &offset=
 *   GET /api/combined/od-loans          ?status=active|closed|all  &search=  &limit=  &offset=
 *   GET /api/combined/share-accounts    ?status=active|closed|all  &search=  &limit=  &offset=
 *
 * All five routes JOIN the relevant derived table with the `customers` table
 * so the frontend receives flat rows ready for renderTable().
 *
 * Expected columns returned by each endpoint:
 *   gold-loans       → id, acc_no, customer_name, cust_code, customer_db_id, pan_no, start_date, end_date,
 *                       interest_rate, loan_amount, balance, status, nominee_name,
 *                       photo_ornament, metal_type, ornament_weight, gold_ornaments,
 *                       silver_ornaments, ornament_items
 *   saving-accounts  → id, acc_no, customer_name, cust_code, customer_db_id, start_date, interest_rate, balance, status
 *   fd-accounts      → id, acc_no, customer_name, cust_code, customer_db_id, start_date, end_date,
 *                       interest_rate, duration, fd_amount, balance, maturity_amount, status
 *   od-loans         → id, record_id, acc_no, customer_name, cust_code, customer_db_id, start_date, end_date,
 *                       interest_rate, loan_amount, balance, status
 *   share-accounts   → id, record_id, acc_no, customer_name, cust_code, customer_db_id, start_date,
 *                       num_shares, share_amount, balance, status
 *
 * BUG FIX: this router had no auth at all (unlike records/cashbook/etc.),
 * exposing every customer's loan/FD/saving/OD/share balances to anyone on
 * the LAN without logging in — same class of gap fixed earlier in
 * dashboard.routes.js. Safe to apply router-wide here since this file has
 * no routes that need to be public.
 */

const router = require("express").Router();
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
router.use(requireAuth);

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a WHERE clause fragment for optional status filter.
 * Returns { sql, params, nextIdx } where nextIdx is the next $N placeholder index.
 */
function statusClause(status, tableAlias, startIdx) {
  const col = `${tableAlias}.status::text`;
  if (!status || status === "all") {
    return { sql: "", params: [], nextIdx: startIdx };
  }
  return {
    sql: ` AND ${col} = $${startIdx}`,
    params: [status],
    nextIdx: startIdx + 1,
  };
}

/**
 * Build a WHERE clause fragment for optional search filter.
 * Searches customer_name, acc_no, cust_code, mobile, and Aadhar (case-insensitive).
 *
 * BUG FIX: mobile/Aadhar were never matched here even though the Account
 * Search UI (frontend) explicitly invites "name, mobile, or account number"
 * — a search by mobile number silently returned zero rows from every one
 * of these endpoints. Both now come from the joined `customers` row, since
 * that's the one place they're reliably present across all 5 account types
 * (some derived tables keep their own copy, some don't).
 *
 * @param {string} accNoExpr  SQL expression for the account number column —
 *   defaults to `${tableAlias}.acc_no`, but od_loans has no such column (it's
 *   loan_acc_no/fd_acc_no instead), so that caller passes its own expression.
 * @param {string} customerNameExpr  SQL expression for a table-local customer
 *   name fallback — defaults to `${tableAlias}.customer_name`, but
 *   share_accounts has no such column (confirmed via \d share_accounts —
 *   see the /share-accounts route below), so that caller passes 'NULL'.
 */
function searchClause(search, tableAlias, custAlias, startIdx, accNoExpr, customerNameExpr) {
  if (!search || !search.trim()) {
    return { sql: "", params: [], nextIdx: startIdx };
  }
  const accNoCol = accNoExpr || `${tableAlias}.acc_no`;
  const nameCol = customerNameExpr || `${tableAlias}.customer_name`;
  const raw = search.trim();
  const q = `%${raw.toLowerCase()}%`;
  const digits = raw.replace(/\D/g, "");
  const qDigits = `%${digits}%`;
  const sql = ` AND (
    LOWER(COALESCE(${custAlias}.name, ${nameCol}, '')) LIKE $${startIdx}
    OR LOWER(COALESCE(${accNoCol}, ''))                                 LIKE $${startIdx}
    OR LOWER(COALESCE(${custAlias}.cust_code, ''))                      LIKE $${startIdx}
    ${digits ? `OR COALESCE(${custAlias}.mobile, '') LIKE $${startIdx + 1}
    OR COALESCE(${custAlias}.aadhar, '') LIKE $${startIdx + 1}` : ""}
  )`;
  return {
    sql,
    params: digits ? [q, qDigits] : [q],
    nextIdx: digits ? startIdx + 2 : startIdx + 1,
  };
}

function parsePagination(query) {
  const limit = Math.min(parseInt(query.limit || "10000", 10) || 10000, 50000);
  const offset = Math.max(parseInt(query.offset || "0", 10) || 0, 0);
  return { limit, offset };
}

// ── GET /api/combined/gold-loans ─────────────────────────────────────────────
router.get("/gold-loans", async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];

    const sc = statusClause(status, "gl", idx);
    idx = sc.nextIdx;
    params.push(...sc.params);

    const sq = searchClause(search, "gl", "c", idx);
    idx = sq.nextIdx;
    params.push(...sq.params);

    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const sql = `
      SELECT
        gl.id,
        gl.record_id,
        gl.acc_no,
        COALESCE(c.name, gl.customer_name)                         AS customer_name,
        COALESCE(c.mobile, r.mobile)                               AS mobile,
        COALESCE(c.aadhar, r.aadhar)                               AS aadhar,
        COALESCE(c.cust_code, gl.customer_id::varchar)             AS cust_code,
        c.id                                                        AS customer_db_id,
        COALESCE(NULLIF(c.pan_no, ''), r.data->>'pan')             AS pan_no,
        COALESCE(gl.loan_date::text, r.date::text)                 AS start_date,
        r.closed_date::text                                        AS end_date,
        COALESCE((r.data->>'interest_rate')::numeric, 0)           AS interest_rate,
        gl.loan_amount,
        COALESCE((r.data->>'balance')::numeric, gl.loan_amount)    AS balance,
        gl.status,
        COALESCE(r.data->>'nominee_name', r.data->>'nominee')      AS nominee_name,
        COALESCE(gl.photo_ornament, r.data->>'photo_ornament')     AS photo_ornament,
        gl.metal_type,
        gl.ornament_weight,
        gl.gold_ornaments,
        gl.silver_ornaments,
        gl.ornament_items
      FROM gold_loans gl
      LEFT JOIN records  r ON r.id = gl.record_id AND r.is_deleted = FALSE
      -- BUG FIX: was 'c.id = r.customer_id::integer' — records.customer_id is
      -- a TEXT business code (e.g. "0000002205"), not customers.id (an
      -- unrelated serial PK); casting it to integer just parses the digits
      -- and almost never coincides with a real customers.id, so c.* (and
      -- therefore customer_db_id, which every "click a row to open that
      -- customer's profile" link on this page depends on) was silently wrong
      -- for nearly every row. gold_loans has its own resolved customer_id FK
      -- (see pdf_sync.routes.js's resolveCustomerDbId) — join on that instead.
      LEFT JOIN customers c ON c.id = gl.customer_id
      WHERE 1=1
        ${sc.sql}
        ${sq.sql}
      ORDER BY
        gl.status::text = 'active' DESC,
        gl.acc_no
      LIMIT  $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/combined/saving-accounts ────────────────────────────────────────
router.get("/saving-accounts", async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];

    const sc = statusClause(status, "sa", idx);
    idx = sc.nextIdx;
    params.push(...sc.params);

    const sq = searchClause(search, "sa", "c", idx);
    idx = sq.nextIdx;
    params.push(...sq.params);

    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const sql = `
      SELECT
        sa.id,
        sa.record_id,
        sa.acc_no,
        COALESCE(c.name, sa.customer_name)                                AS customer_name,
        COALESCE(c.mobile, r.mobile)                                      AS mobile,
        COALESCE(c.aadhar, r.aadhar)                                      AS aadhar,
        COALESCE(c.cust_code, sa.cust_code)                               AS cust_code,
        c.id                                                               AS customer_db_id,
        COALESCE(sa.start_date::text, r.date::text)                       AS start_date,
        COALESCE(sa.interest_rate, (r.data->>'interest_rate')::numeric)   AS interest_rate,
        COALESCE(sa.balance, (r.data->>'saving_balance')::numeric)        AS balance,
        sa.status
      FROM saving_accounts sa
      LEFT JOIN records   r ON r.id = sa.record_id AND r.is_deleted = FALSE
      -- BUG FIX: same broken customer_id::integer cast as gold-loans above —
      -- join on saving_accounts' own resolved customer_id FK instead.
      LEFT JOIN customers c ON c.id = sa.customer_id
      WHERE 1=1
        ${sc.sql}
        ${sq.sql}
      ORDER BY
        sa.status::text = 'active' DESC,
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

// ── GET /api/combined/fd-accounts ────────────────────────────────────────────
router.get("/fd-accounts", async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];

    const sc = statusClause(status, "fd", idx);
    idx = sc.nextIdx;
    params.push(...sc.params);

    const sq = searchClause(search, "fd", "c", idx);
    idx = sq.nextIdx;
    params.push(...sq.params);

    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const sql = `
      SELECT
        fd.id,
        fd.record_id,
        -- BUG FIX: fd.acc_no was selected raw with no fallback. The
        -- records.controller.js upsert for "New FD" / "MIS Interest" never
        -- wrote acc_no (only fd_acc_no/acc_code/mis_acc_no) — see the fix
        -- there — so every FD created through the app, MIS or regular term,
        -- had acc_no permanently NULL and showed as a blank account-code
        -- badge on the Fixed Deposits list. COALESCE to the authoritative
        -- per-type column as a second line of defense even after that fix.
        COALESCE(NULLIF(fd.acc_no,''), fd.fd_acc_no, fd.mis_acc_no)                                  AS acc_no,
        COALESCE(c.name, fd.customer_name)                                                          AS customer_name,
        COALESCE(c.mobile, r.mobile)                                                                 AS mobile,
        COALESCE(c.aadhar, r.aadhar)                                                                 AS aadhar,
        COALESCE(c.cust_code, fd.acc_code)                                                           AS cust_code,
        c.id                                                                                          AS customer_db_id,
        COALESCE(fd.loan_date::text, r.date::text)                                                   AS start_date,
        COALESCE(fd.fd_maturity_date::text, r.data->>'fd_maturity_date')                             AS end_date,
        COALESCE(fd.fd_interest_rate::numeric, (r.data->>'fd_interest_rate')::numeric)               AS interest_rate,
        COALESCE(fd.fd_period::numeric, (r.data->>'fd_period')::numeric)                             AS duration,
        COALESCE(fd.fd_amount::numeric, (r.data->>'fd_amount')::numeric)                             AS fd_amount,
        COALESCE(fd.fd_amount::numeric, (r.data->>'fd_amount')::numeric)                             AS balance,
        COALESCE(fd.fd_maturity_amount::numeric, (r.data->>'fd_maturity_amount')::numeric)           AS maturity_amount,
        -- BUG FIX: the two FD types (regular Term vs MIS Special) were never
        -- surfaced to the list at all — fd_type/fd_sub_type exist on the
        -- table but weren't selected, so the UI had no way to show which
        -- type a row was, which is a big part of why the combined list
        -- reads as one undifferentiated pile instead of two account series.
        COALESCE(fd.fd_type, CASE WHEN fd.mis_acc_no IS NOT NULL THEN 'mis' ELSE 'term' END) AS fd_type,
        COALESCE(fd.fd_sub_type, '')                                                          AS fd_sub_type,
        fd.status
      FROM fd_accounts fd
      LEFT JOIN records   r ON r.id = fd.record_id AND r.is_deleted = FALSE
      -- BUG FIX: same broken customer_id::integer cast as gold-loans above —
      -- join on fd_accounts' own resolved customer_id FK instead.
      LEFT JOIN customers c ON c.id = fd.customer_id
      WHERE 1=1
        ${sc.sql}
        ${sq.sql}
      ORDER BY
        fd.status::text = 'active' DESC,
        fd.fd_maturity_date NULLS LAST,
        fd.acc_no
      LIMIT  $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/combined/od-loans ───────────────────────────────────────────────
// NOTE: od_loans does NOT have acc_no/interest_rate/balance/customer_id columns
// of its own (unlike gold_loans/fd_accounts/saving_accounts) — only record_id,
// loan_acc_no, fd_acc_no, customer_name, aadhar, mobile, loan_amount, fd_amount,
// loan_date, fd_maturity_date, status. Interest rate and live balance are read
// from the linked records.data JSONB instead, the same place the existing
// "Closing - OD" flow already reads them from (see openClosingOdForm in
// app.js, which uses d.fd_interest_rate / d.loan_interest_rate as the rate).
router.get("/od-loans", async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];

    const sc = statusClause(status, "od", idx);
    idx = sc.nextIdx;
    params.push(...sc.params);

    // od_loans has no acc_no column — pass the same COALESCE expression used
    // in the SELECT below so search matches the account number that's
    // actually displayed.
    const sq = searchClause(search, "od", "c", idx, "COALESCE(NULLIF(od.loan_acc_no,''), od.fd_acc_no)");
    idx = sq.nextIdx;
    params.push(...sq.params);

    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const sql = `
      SELECT
        od.id,
        od.record_id,
        COALESCE(NULLIF(od.loan_acc_no,''), od.fd_acc_no)                                          AS acc_no,
        COALESCE(c.name, od.customer_name)                                                          AS customer_name,
        COALESCE(c.mobile, od.mobile, r.mobile)                                                      AS mobile,
        COALESCE(c.aadhar, od.aadhar, r.aadhar)                                                      AS aadhar,
        COALESCE(c.cust_code, od.record_id::varchar)                                                AS cust_code,
        c.id                                                                                          AS customer_db_id,
        COALESCE(od.loan_date::text, r.date::text)                                                  AS start_date,
        COALESCE(od.fd_maturity_date::text, r.data->>'fd_maturity_date')                            AS end_date,
        -- FIX: admin.html's own "Add OD Loan" quick-entry form (showOdForm,
        -- ~line 2425) saves the rate as a plain "interest_rate" key, not
        -- "fd_interest_rate"/"loan_interest_rate" — verified live: every OD
        -- loan created that way showed "0%" here despite having a real rate
        -- on file. Regex-guarded so a blank/non-numeric value never 500s the
        -- whole page (::numeric on '' throws).
        COALESCE(
          (r.data->>'fd_interest_rate')::numeric,
          (r.data->>'loan_interest_rate')::numeric,
          CASE WHEN (r.data->>'interest_rate') ~ '^[0-9]+(\.[0-9]+)?$'
               THEN (r.data->>'interest_rate')::numeric ELSE NULL END,
          0
        ) AS interest_rate,
        od.loan_amount,
        COALESCE((r.data->>'balance')::numeric, od.loan_amount)                                     AS balance,
        od.status
      FROM od_loans od
      LEFT JOIN records   r ON r.id = od.record_id AND r.is_deleted = FALSE
      -- BUG FIX: same broken customer_id::integer cast as gold-loans above —
      -- join on od_loans' own resolved customer_id FK instead.
      LEFT JOIN customers c ON c.id = od.customer_id
      WHERE 1=1
        -- FIX: this LEFT JOIN nulls out r.* when the parent records row was
        -- soft-deleted (the ON clause's r.is_deleted=FALSE), but a LEFT JOIN
        -- still keeps the od_loans row itself in the result — so a deleted
        -- OD loan kept showing here as "active" with its real balance even
        -- after vanishing from the Database tab. Require a live parent row.
        AND r.id IS NOT NULL
        ${sc.sql}
        ${sq.sql}
      ORDER BY
        od.status::text = 'active' DESC,
        od.loan_acc_no
      LIMIT  $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/combined/share-accounts ─────────────────────────────────────────
// NOTE: share_accounts' real columns (confirmed live via \d share_accounts,
// and again by the production crash this comment replaces — column sh.record_id
// does not exist) are: id, acc_code, acc_no, customer_id, cust_code, pan_no,
// start_date, balance, status, close_date, remarks, is_deleted, deleted_at,
// created_at, updated_at. In particular there is no record_id (share_accounts
// is never linked back to a `records` row — see records.controller.js's
// "Shares Account" upsert, which upserts by acc_code, not record_id), no
// customer_name, and no per-share count/amount columns separate from balance.
// Every share row is therefore "no linked transaction to close" — the
// frontend already renders that whenever record_id is absent, which for
// this endpoint is always.
router.get("/share-accounts", async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const { limit, offset } = parsePagination(req.query);

    let idx = 1;
    const params = [];

    const sc = statusClause(status, "sh", idx);
    idx = sc.nextIdx;
    params.push(...sc.params);

    // share_accounts has no customer_name column — pass 'NULL' so the shared
    // search-clause builder doesn't reference one that doesn't exist.
    const sq = searchClause(search, "sh", "c", idx, undefined, "NULL");
    idx = sq.nextIdx;
    params.push(...sq.params);

    params.push(limit, offset);
    const limitIdx = idx;
    const offsetIdx = idx + 1;

    const sql = `
      SELECT
        sh.id,
        sh.acc_no,
        c.name                              AS customer_name,
        c.mobile                            AS mobile,
        c.aadhar                            AS aadhar,
        COALESCE(c.cust_code, sh.cust_code) AS cust_code,
        c.id                                 AS customer_db_id,
        COALESCE(NULLIF(c.pan_no, ''), NULLIF(sh.pan_no, '')) AS pan_no,
        sh.start_date,
        COALESCE(sh.balance, 0)             AS balance,
        COALESCE(sh.status, 'active')       AS status
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

module.exports = router;
