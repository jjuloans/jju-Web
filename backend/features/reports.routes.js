'use strict';
const router = require('express').Router();
const pool   = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/reports/daily-summary?date=YYYY-MM-DD
router.get('/daily-summary', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const [records, cashbook] = await Promise.all([
      // FIX: "opened" used to be COUNT(*) FILTER (WHERE status='active'),
      // which only counts cases that are STILL active today. A case that
      // opened on this date and has since been closed (on this date or any
      // later date) would silently drop out of "opened" the moment it closed
      // -- so re-checking an old day's report after an account on it closed
      // would wrongly show fewer (or zero) cases opened that day. "opened"
      // and "closed" should each be judged purely by their own date column.
      pool.query(`
        SELECT section,
          COUNT(*) FILTER (WHERE date::text=$1)        AS opened,
          COUNT(*) FILTER (WHERE closed_date::text=$1)  AS closed,
          -- NEW: rupee figures alongside the counts (per-section amount
          -- field varies -- loan_amount for gold/od, fd_amount for fd,
          -- saving_balance for saving, etc.) so staff can see how much
          -- money moved on a day, not just how many cases. FILTER means
          -- Postgres skips evaluating this cast for rows that don't match,
          -- so a section with no amount field (e.g. membership) never
          -- risks a bad-data cast error on an unrelated day.
          COALESCE(SUM(COALESCE((data->>'loan_amount')::numeric,(data->>'fd_amount')::numeric,(data->>'deposit_amount')::numeric,(data->>'transfer_amount')::numeric,(data->>'saving_balance')::numeric,(data->>'to_saving_balance')::numeric,(data->>'share_amount')::numeric,0)) FILTER (WHERE date::text=$1), 0)        AS opened_amount,
          COALESCE(SUM(COALESCE((data->>'loan_amount')::numeric,(data->>'fd_amount')::numeric,(data->>'deposit_amount')::numeric,(data->>'transfer_amount')::numeric,(data->>'saving_balance')::numeric,(data->>'to_saving_balance')::numeric,(data->>'share_amount')::numeric,0)) FILTER (WHERE closed_date::text=$1), 0) AS closed_amount
        FROM records
        WHERE is_deleted=FALSE AND (date::text=$1 OR closed_date::text=$1)
          -- BUG FIX: "Closing - Loan"/"Closing - OD" submissions are saved as a
          -- SEPARATE new records row (account_no suffixed "-C") purely as an
          -- audit/history log of the closing transaction -- see the comment at
          -- app.js's primaryAccNo assignment ("append -C to make it unique").
          -- That row's own 'date' is the closing date and its 'status' defaults
          -- to 'active' (it's never itself opened/closed), so without this
          -- exclusion it was double-counted as a brand-new "Opened" gold/od
          -- case on the very same day the real loan shows up as "Closed".
          AND NOT (section IN ('gold','od') AND account_no LIKE '%-C')
        GROUP BY section`, [date]),

      // BUG FIX: tx_type is stored as 'Credit'/'Debit' (see cbTxType() in
      // app.js) but this compared against lowercase 'credit'/'debit', so that
      // half of the filter never matched anything — total_in/total_out were
      // effectively driven only by the `task ILIKE` fallback, which itself
      // mis-bucketed rows (e.g. a "Payment Received - Online" task landed in
      // total_out just for containing "payment"). Also: "Cash In/Cash Out" is
      // supposed to mean physical cash movement, matching the Daily Cash Book
      // print (which filters mode='Cash' — Transfer-mode rows don't touch the
      // drawer), so add that filter too instead of summing every entry.
      pool.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE UPPER(mode)='CASH' AND UPPER(tx_type)='CREDIT'), 0) AS total_in,
          COALESCE(SUM(amount) FILTER (WHERE UPPER(mode)='CASH' AND UPPER(tx_type)='DEBIT'),  0) AS total_out,
          COUNT(*) AS entries
        FROM cashbook_entries
        WHERE is_deleted=FALSE AND date=$1`, [date]),
    ]);

    res.json({ date, sections: records.rows, cashbook: cashbook.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/cases-detail?section=gold&type=opened&date=YYYY-MM-DD
// GET /api/reports/cases-detail?section=gold&type=opened&year=2024&month=11
// Drill-down for the admin "Account Cases Opened/Closed" report: the actual
// list of records behind one Opened/Closed number, so clicking "110" shows
// which 110 Gold Loan cases opened that month instead of just the count.
router.get('/cases-detail', async (req, res) => {
  try {
    const { section, type } = req.query;
    if (!section) return res.status(400).json({ error: 'section is required' });
    if (type !== 'opened' && type !== 'closed') {
      return res.status(400).json({ error: "type must be 'opened' or 'closed'" });
    }
    const dateCol = type === 'opened' ? 'date' : 'closed_date';

    let whereDate, params;
    if (req.query.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      whereDate = `${dateCol}::text = $2`;
      params = [section, req.query.date];
    } else {
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const month = parseInt(req.query.month) || new Date().getMonth() + 1;
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const to = new Date(year, month, 0).toISOString().split('T')[0];
      whereDate = `${dateCol}::text BETWEEN $2 AND $3`;
      params = [section, from, to];
    }

    const { rows } = await pool.query(`
      SELECT id, account_no, name, date, closed_date, status,
        -- Best-effort single "amount" across the differently-named amount
        -- fields each section's form stores (gold/od use loan_amount, FD
        -- uses fd_amount, etc.) — shows "—" in the UI when none apply
        -- (e.g. a membership case with no single amount).
        COALESCE(
          (data->>'loan_amount')::numeric,
          (data->>'fd_amount')::numeric,
          (data->>'deposit_amount')::numeric,
          (data->>'transfer_amount')::numeric,
          (data->>'saving_balance')::numeric,
          (data->>'to_saving_balance')::numeric
        ) AS amount
      FROM records
      WHERE is_deleted = FALSE AND section = $1 AND ${whereDate}
        -- Same closing-audit-row exclusion as /daily-summary and /monthly --
        -- these "-C" rows are a log entry of the closing transaction, not a
        -- real account case, and must never appear in this drill-down list.
        AND NOT (section IN ('gold','od') AND account_no LIKE '%-C')
      ORDER BY ${dateCol} DESC NULLS LAST, id DESC
      LIMIT 500
    `, params);

    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/monthly?year=2024&month=11
router.get('/monthly', async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const from  = `${year}-${String(month).padStart(2,'0')}-01`;
    const to    = new Date(year, month, 0).toISOString().split('T')[0]; // last day

    const [opened, closed, cashbook, bySection] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND date::text BETWEEN $1 AND $2 AND NOT (section IN ('gold','od') AND account_no LIKE '%-C')`, [from, to]),
      pool.query(`SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND closed_date::text BETWEEN $1 AND $2 AND NOT (section IN ('gold','od') AND account_no LIKE '%-C')`, [from, to]),
      // Same Cash-only + case fix as /daily-summary above.
      pool.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE UPPER(mode)='CASH' AND UPPER(tx_type)='CREDIT'), 0) AS total_in,
          COALESCE(SUM(amount) FILTER (WHERE UPPER(mode)='CASH' AND UPPER(tx_type)='DEBIT'),  0) AS total_out,
          COUNT(*) AS entries
        FROM cashbook_entries
        WHERE is_deleted=FALSE AND date::text BETWEEN $1 AND $2`, [from, to]),
      // NEW: added a per-section `closed` count alongside the existing
      // `count` (opened) so the admin Reports page can show an opened-vs-
      // closed breakdown per account type, not just per-section opens. Also
      // widened the WHERE so a section that only had closures this month
      // (nothing newly opened) still shows up with count=0, closed=N instead
      // of being missing from the list entirely.
      pool.query(`
        SELECT section,
          COUNT(*) FILTER (WHERE date::text BETWEEN $1 AND $2)        AS count,
          COUNT(*) FILTER (WHERE closed_date::text BETWEEN $1 AND $2) AS closed,
          COALESCE(SUM((data->>'loan_amount')::numeric) FILTER (WHERE section IN ('gold','od') AND date::text BETWEEN $1 AND $2), 0) AS loan_total,
          COALESCE(SUM((data->>'fd_amount')::numeric)   FILTER (WHERE section='fd' AND date::text BETWEEN $1 AND $2), 0) AS fd_total,
          -- NEW: same generalized opened/closed amount pair as /daily-summary
          -- (see comment there), for the Cases Report's Monthly view.
          COALESCE(SUM(COALESCE((data->>'loan_amount')::numeric,(data->>'fd_amount')::numeric,(data->>'deposit_amount')::numeric,(data->>'transfer_amount')::numeric,(data->>'saving_balance')::numeric,(data->>'to_saving_balance')::numeric,(data->>'share_amount')::numeric,0)) FILTER (WHERE date::text BETWEEN $1 AND $2), 0)        AS opened_amount,
          COALESCE(SUM(COALESCE((data->>'loan_amount')::numeric,(data->>'fd_amount')::numeric,(data->>'deposit_amount')::numeric,(data->>'transfer_amount')::numeric,(data->>'saving_balance')::numeric,(data->>'to_saving_balance')::numeric,(data->>'share_amount')::numeric,0)) FILTER (WHERE closed_date::text BETWEEN $1 AND $2), 0) AS closed_amount
        FROM records
        WHERE is_deleted=FALSE AND (date::text BETWEEN $1 AND $2 OR closed_date::text BETWEEN $1 AND $2)
          -- Same closing-audit-row exclusion as /daily-summary (see comment there).
          AND NOT (section IN ('gold','od') AND account_no LIKE '%-C')
        GROUP BY section ORDER BY count DESC`, [from, to]),
    ]);

    res.json({
      period: { year, month, from, to },
      opened: parseInt(opened.rows[0].count),
      closed: parseInt(closed.rows[0].count),
      cashbook: cashbook.rows[0],
      by_section: bySection.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/portfolio  — full portfolio snapshot
router.get('/portfolio', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        SUM(CASE WHEN section='gold'   AND status='active' THEN (data->>'loan_amount')::numeric ELSE 0 END) AS gold_portfolio,
        SUM(CASE WHEN section='fd'     AND status='active' THEN (data->>'fd_amount')::numeric   ELSE 0 END) AS fd_portfolio,
        SUM(CASE WHEN section='od'     AND status='active' THEN (data->>'loan_amount')::numeric ELSE 0 END) AS od_portfolio,
        SUM(CASE WHEN section='saving' AND status='active' THEN (data->>'saving_balance')::numeric ELSE 0 END) AS saving_portfolio,
        COUNT(*) FILTER (WHERE section='gold'       AND status='active') AS active_gold,
        COUNT(*) FILTER (WHERE section='fd'         AND status='active') AS active_fds,
        COUNT(*) FILTER (WHERE section='od'         AND status='active') AS active_od,
        COUNT(*) FILTER (WHERE section='saving'     AND status='active') AS active_saving,
        COUNT(*) FILTER (WHERE section='membership' AND status='active') AS members
      FROM records WHERE is_deleted=FALSE
    `);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/top-customers?limit=10
router.get('/top-customers', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const { rows } = await pool.query(`
      SELECT name, aadhar, mobile,
        COUNT(*) AS total_accounts,
        COALESCE(SUM((data->>'loan_amount')::numeric) FILTER (WHERE section IN ('gold','od')), 0) AS total_loan,
        COALESCE(SUM((data->>'fd_amount')::numeric)   FILTER (WHERE section='fd'), 0) AS total_fd
      FROM records
      WHERE is_deleted=FALSE AND status='active'
      GROUP BY name, aadhar, mobile
      ORDER BY (total_loan + total_fd) DESC
      LIMIT $1`, [limit]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/cashbook-summary?from=&to=
router.get('/cashbook-summary', async (req, res) => {
  try {
    const from = req.query.from || new Date().toISOString().split('T')[0];
    const to   = req.query.to   || from;
    // Same Cash-only + case fix as /daily-summary above.
    const { rows } = await pool.query(`
      SELECT date,
        COALESCE(SUM(amount) FILTER (WHERE UPPER(mode)='CASH' AND UPPER(tx_type)='CREDIT'), 0) AS total_in,
        COALESCE(SUM(amount) FILTER (WHERE UPPER(mode)='CASH' AND UPPER(tx_type)='DEBIT'),  0) AS total_out,
        COUNT(*) AS entries
      FROM cashbook_entries
      WHERE is_deleted=FALSE AND date BETWEEN $1 AND $2
      GROUP BY date ORDER BY date ASC`, [from, to]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

/*
── ADD TO server.js ──────────────────────────────────────────────────────────
  app.use('/api/reports', require('./features/reports/reports.routes'));
*/
