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
      pool.query(`
        SELECT section,
          COUNT(*) FILTER (WHERE status='active')  AS opened,
          COUNT(*) FILTER (WHERE status='closed' AND closed_date::text=$1) AS closed
        FROM records
        WHERE is_deleted=FALSE AND (date::text=$1 OR closed_date::text=$1)
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

// GET /api/reports/monthly?year=2024&month=11
router.get('/monthly', async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const from  = `${year}-${String(month).padStart(2,'0')}-01`;
    const to    = new Date(year, month, 0).toISOString().split('T')[0]; // last day

    const [opened, closed, cashbook, bySection] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND date::text BETWEEN $1 AND $2`, [from, to]),
      pool.query(`SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND closed_date::text BETWEEN $1 AND $2`, [from, to]),
      // Same Cash-only + case fix as /daily-summary above.
      pool.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE UPPER(mode)='CASH' AND UPPER(tx_type)='CREDIT'), 0) AS total_in,
          COALESCE(SUM(amount) FILTER (WHERE UPPER(mode)='CASH' AND UPPER(tx_type)='DEBIT'),  0) AS total_out,
          COUNT(*) AS entries
        FROM cashbook_entries
        WHERE is_deleted=FALSE AND date::text BETWEEN $1 AND $2`, [from, to]),
      pool.query(`
        SELECT section, COUNT(*) AS count,
          COALESCE(SUM((data->>'loan_amount')::numeric) FILTER (WHERE section IN ('gold','od')), 0) AS loan_total,
          COALESCE(SUM((data->>'fd_amount')::numeric)   FILTER (WHERE section='fd'), 0) AS fd_total
        FROM records
        WHERE is_deleted=FALSE AND date::text BETWEEN $1 AND $2
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
