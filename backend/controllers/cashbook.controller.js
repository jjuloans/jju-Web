'use strict';
const pool = require('../db/pool');

// ── acc_no drift guard (OD / Gold Loan paired rows) ────────────────────────
// records.controller.js validates loan_acc_no format before it reaches
// od_loans / gold_loans (isValidOdAccNo / isValidLoanAccNo), but every row
// this file writes into cashbook_entries bypassed that check entirely — this
// was the insert path that check never covered. A batch could still create,
// or a single edit could still leave, two sibling rows for the same
// record_id (e.g. "FD OD Loan" debit + "FD OD Loan Closing" credit) with
// different acc_no values — the exact drift the v5_cashbook_acc_no_drift_repair
// migration only cleans up after the fact. These helpers enforce format at
// write time and keep paired siblings in sync going forward, on both the
// bulk insert path and the single-row update path.
const OD_PAIR_TYPES   = ['FD OD Loan', 'FD OD Loan Closing'];
const GOLD_PAIR_TYPES = ['Gold Loan TRF', 'Interest Received On Gold Loan TRF'];

function pairGroupFor(accType) {
  if (OD_PAIR_TYPES.includes(accType)) return 'od';
  if (GOLD_PAIR_TYPES.includes(accType)) return 'gold';
  return null;
}

function groupTypesFor(group) {
  if (group === 'od') return OD_PAIR_TYPES;
  if (group === 'gold') return GOLD_PAIR_TYPES;
  return [];
}

// Mirrors isValidOdAccNo / isValidLoanAccNo in records.controller.js:
// OD must be exactly 14 digits; Gold genuinely supports the newer 14-digit
// format and the legacy "NN-NNN" dash format, so both are accepted.
function isValidAccNoForGroup(group, val) {
  if (val === null || val === undefined || val === '') return true; // optional field, nothing to check
  const trimmed = String(val).trim();
  if (group === 'od') return /^\d{14}$/.test(trimmed);
  if (group === 'gold') return /^\d{14}$/.test(trimmed) || /^\d+-\d+$/.test(trimmed);
  return true; // unrestricted acc_type — behaviour unchanged
}

// ── GET /api/cashbook?date=&limit=&offset= ────────────────────────────────
async function list(req, res) {
  try {
    const { date, date_from, date_to, limit = 200, offset = 0 } = req.query;
    const where = ['is_deleted=FALSE'];
    const params = [];
    let pi = 1;

    if (date_from || date_to) {
      // Range mode: accepts date_from + date_to (used by day-end summary)
      const from = date_from || date_to;
      const to   = date_to   || date_from;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ error: 'date_from and date_to must be YYYY-MM-DD' });
      }
      // BUG FIX: a reversed range (from > to) silently returns 0 rows —
      // BETWEEN in PostgreSQL requires the left operand to be ≤ the right.
      if (from > to) {
        return res.status(400).json({ error: 'date_from must be on or before date_to' });
      }
      where.push(`date BETWEEN $${pi++} AND $${pi++}`);
      params.push(from, to);
    } else if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: `Invalid date format "${date}" — expected YYYY-MM-DD` });
      }
      where.push(`date=$${pi++}`);
      params.push(date);
    } else {
      // Safety: without a date filter this returns ALL cashbook entries — require it
      return res.status(400).json({ error: 'date query parameter is required (YYYY-MM-DD)' });
    }

    // Fix #4: explicit column list instead of SELECT *
    // Fix #5: LIMIT/OFFSET pagination so large cashbooks don't OOM the process
    const lim = Math.min(parseInt(limit) || 200, 1000);
    const off = parseInt(offset) || 0;

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM cashbook_entries WHERE ${where.join(' AND ')}`,
      params,
    );

    // BUG FIX: $${pi} and $${pi + 1} were evaluated in the same template literal —
    // pi was never incremented between them so both resolved to $2 (same param).
    // Capture explicit param positions before building the query string.
    const limitParam  = pi;
    const offsetParam = pi + 1;
    const { rows } = await pool.query(
      `SELECT id, date, entry_date, record_id, name, task, acc_type, tx_type,
              acc_no, amount, mode, scroll_no, loan_date, sort_order,
              is_deleted, deleted_at, created_at, updated_at
       FROM cashbook_entries
       WHERE ${where.join(' AND ')}
       ORDER BY sort_order ASC, id ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, lim, off],
    );

    res.json({ entries: rows, count: rows.length, total: parseInt(countRes.rows[0].total), limit: lim, offset: off });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/cashbook/bulk ───────────────────────────────────────────────
// Fix #1: wrap in a transaction so a partial failure rolls back everything
// Fix #6: validate that each entry has at least date and amount
async function bulkInsert(req, res) {
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'No entries provided' });
  }

  // BUG FIX: validate BEFORE acquiring a DB connection — bad requests were
  // consuming a pool connection until the early return released it.
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.date) return res.status(400).json({ error: `Entry ${i + 1}: date is required` });
    if (e.amount === undefined || e.amount === null || e.amount === '') {
      return res.status(400).json({ error: `Entry ${i + 1}: amount is required` });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      return res.status(400).json({ error: `Entry ${i + 1}: invalid date format "${e.date}" — expected YYYY-MM-DD` });
    }
    // BUG FIX: also validate loan_date format if present — an invalid value
    // would cause a silent DB type error inside the transaction.
    if (e.loan_date && !/^\d{4}-\d{2}-\d{2}$/.test(e.loan_date)) {
      return res.status(400).json({ error: `Entry ${i + 1}: invalid loan_date format "${e.loan_date}" — expected YYYY-MM-DD` });
    }
    // FIX: reject a malformed acc_no for OD / Gold rows here, at the only
    // insert path into cashbook_entries — instead of letting it drift in
    // silently and rely on the v5 migration to notice later.
    const group = pairGroupFor(e.acc_type);
    if (group && !isValidAccNoForGroup(group, e.acc_no)) {
      return res.status(400).json({
        error: `Entry ${i + 1}: invalid acc_no "${e.acc_no}" for acc_type "${e.acc_type}" — must be ${
          group === 'od' ? 'exactly 14 numeric digits' : '14 numeric digits or legacy NN-NNN format'
        }.`,
      });
    }
  }

  // Acquire connection only after all validation passes
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FIX (idempotency guard): the frontend's ledger auto-generation step
    // (addCashbookRows in app.js) can end up calling this endpoint more than
    // once for the exact same transaction — e.g. if the Ledger tab is loaded
    // again before its own bookkeeping notices rows already exist, or if a
    // retry fires after a request that actually succeeded server-side but
    // whose response the client never saw. Previously this endpoint had no
    // way to tell "this is the same batch of rows being resent" from "these
    // are genuinely new rows", so every resend inserted a full duplicate set
    // (this is exactly how one transaction ended up with 6 copies of its
    // 7-row set — 42 rows instead of 7). Guard it here, at the only insert
    // path into cashbook_entries: for every incoming row that carries a
    // record_id, check whether an active (non-deleted) row already exists
    // for that record_id with the same task/acc_type/tx_type/acc_no/amount/
    // mode — if so, reuse that existing row instead of inserting a duplicate.
    // A genuinely different row (different amount, different acc_type, a
    // manually added extra line, etc.) still inserts normally — this only
    // catches an exact resend.
    const dedupeKeyOf = (r) => [
      r.record_id,
      r.task || '',
      r.acc_type || '',
      r.tx_type || '',
      r.acc_no || '',
      Number(r.amount) || 0,
      r.mode || '',
    ].join('|');
    const recordIdsInBatch = [...new Set(entries.map(e => e.record_id).filter(v => v != null))];
    const existingByDedupeKey = {};
    if (recordIdsInBatch.length) {
      const { rows: existingRows } = await client.query(
        `SELECT id, date, entry_date, parent_id, record_id, name, task, acc_type, tx_type,
                acc_no, amount, mode, scroll_no, loan_date, sort_order, created_at, updated_at
           FROM cashbook_entries
          WHERE is_deleted=FALSE AND record_id = ANY($1::int[])`,
        [recordIdsInBatch],
      );
      existingRows.forEach((r) => { existingByDedupeKey[dedupeKeyOf(r)] = r; });
    }

    // FIX: determine the canonical acc_no for each (record_id, paired-type
    // group) touched by this batch — preferring a canonical 14-digit value
    // already on file, falling back to the first 14-digit value supplied in
    // this same batch — so every sibling row inserted here shares one acc_no
    // instead of drifting the way the v5 migration had to repair.
    const groupKeys = new Set();
    for (const e of entries) {
      const group = pairGroupFor(e.acc_type);
      if (group && e.record_id) groupKeys.add(`${e.record_id}|${group}`);
    }
    const canonicalByKey = {};
    for (const key of groupKeys) {
      const [recordId, group] = key.split('|');
      const { rows } = await client.query(
        `SELECT acc_no FROM cashbook_entries
          WHERE record_id=$1 AND is_deleted=FALSE AND acc_type = ANY($2::text[])
            AND acc_no ~ '^[0-9]{14}$'
          LIMIT 1`,
        [recordId, groupTypesFor(group)],
      );
      if (rows.length) canonicalByKey[key] = rows[0].acc_no;
    }
    for (const e of entries) {
      const group = pairGroupFor(e.acc_type);
      if (!group || !e.record_id) continue;
      const key = `${e.record_id}|${group}`;
      if (!canonicalByKey[key] && e.acc_no && /^\d{14}$/.test(String(e.acc_no).trim())) {
        canonicalByKey[key] = String(e.acc_no).trim();
      }
    }

    const inserted = [];
    let dedupedCount = 0;
    for (const e of entries) {
      const group = pairGroupFor(e.acc_type);
      const key = group && e.record_id ? `${e.record_id}|${group}` : null;
      const accNoToInsert = key && canonicalByKey[key] ? canonicalByKey[key] : (e.acc_no || null);

      // Idempotency guard (see note above BEGIN): skip inserting a row that's
      // an exact duplicate of one already on file for this record_id.
      if (e.record_id != null) {
        const dedupeKey = dedupeKeyOf({ ...e, acc_no: accNoToInsert });
        const existing = existingByDedupeKey[dedupeKey];
        if (existing) {
          inserted.push(existing);
          dedupedCount++;
          continue;
        }
      }

      const { rows } = await client.query(
        `INSERT INTO cashbook_entries
           (date, parent_id, record_id, name, task, acc_type, tx_type, acc_no, amount, mode, scroll_no, loan_date, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id, date, entry_date, parent_id, record_id, name, task, acc_type, tx_type,
                   acc_no, amount, mode, scroll_no, loan_date, sort_order, created_at, updated_at`,
        [e.date, e.parent_id || null, e.record_id || null, e.name || null, e.task || null,
         e.acc_type || null, e.tx_type || null, accNoToInsert,
         parseFloat(e.amount) || 0, e.mode || null, e.scroll_no || null,
         e.loan_date || null, parseInt(e.sort_order) || 0],
      );
      inserted.push(rows[0]);
      // Guard against duplicates WITHIN this same batch too, not just against
      // rows from an earlier request.
      if (e.record_id != null) {
        existingByDedupeKey[dedupeKeyOf({ ...e, acc_no: accNoToInsert })] = rows[0];
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ entries: inserted, count: inserted.length, deduped: dedupedCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// ── PUT /api/cashbook/:id ─────────────────────────────────────────────────
// FIX: true partial update — only SET the fields that were actually sent in
// the request body. This prevents a single-field inline edit (e.g. amount)
// from wiping every other column with NULL / 0.
async function update(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const body = req.body;
    if (!body || typeof body !== 'object' || !Object.keys(body).length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    // Allowed fields and their DB coercion
    const FIELD_MAP = {
      date:       v => ({ sql: `date=$%`,       val: v || null }),
      name:       v => ({ sql: `name=$%`,       val: v || null }),
      task:       v => ({ sql: `task=$%`,       val: v || null }),
      acc_type:   v => ({ sql: `acc_type=$%`,   val: v || null }),
      tx_type:    v => ({ sql: `tx_type=$%`,    val: v || null }),
      acc_no:     v => ({ sql: `acc_no=$%`,     val: v || null }),
      amount:     v => ({ sql: `amount=$%`,     val: parseFloat(v) || 0 }),
      mode:       v => ({ sql: `mode=$%`,       val: v || null }),
      scroll_no:  v => ({ sql: `scroll_no=$%`,  val: (v != null && v !== '') ? String(v) : null }),
      loan_date:  v => ({ sql: `loan_date=$%`,  val: v || null }),
      sort_order: v => ({ sql: `sort_order=$%`, val: parseInt(v) || 0 }),
    };

    // Validate date format if provided
    if (body.date && !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Invalid date format "${body.date}" — expected YYYY-MM-DD` });
    }
    // Validate loan_date format if provided and non-empty
    if (body.loan_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.loan_date)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Invalid loan_date format "${body.loan_date}" — expected YYYY-MM-DD` });
    }

    const setClauses = [];
    const params     = [];
    let   pi         = 1;

    for (const [key, coerce] of Object.entries(FIELD_MAP)) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        const { sql, val } = coerce(body[key]);
        setClauses.push(sql.replace('$%', `$${pi++}`));
        params.push(val);
      }
    }

    if (!setClauses.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No recognised fields provided' });
    }

    // BUG FIX: validate that :id is actually a positive integer —
    // a non-numeric id (e.g. /api/cashbook/abc) would reach PostgreSQL
    // as a string and cause an unhandled cast error / 500.
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid entry id' });
    }

    params.push(id); // last param = WHERE id
    const { rows } = await client.query(
      `UPDATE cashbook_entries
       SET ${setClauses.join(', ')}, updated_at=NOW()
       WHERE id=$${pi} AND is_deleted=FALSE
       RETURNING id, date, entry_date, parent_id, record_id, name, task, acc_type, tx_type,
                 acc_no, amount, mode, scroll_no, loan_date, sort_order, created_at, updated_at`,
      params,
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Entry not found' });
    }
    const updated = rows[0];

    // FIX: sibling drift guard. Previously only the frontend (app.js's
    // ldgSaveCell) kept a paired OD/Gold row's acc_no in sync with its
    // sibling — any direct API edit (or a client that bypasses app.js)
    // could silently re-introduce the exact drift the v5 migration exists
    // to repair. Enforce it here too, atomically with the edit itself.
    if (Object.prototype.hasOwnProperty.call(body, 'acc_no') && updated.record_id) {
      const group = pairGroupFor(updated.acc_type);
      if (group) {
        if (!isValidAccNoForGroup(group, updated.acc_no)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Invalid acc_no "${updated.acc_no}" for acc_type "${updated.acc_type}" — must be ${
              group === 'od' ? 'exactly 14 numeric digits' : '14 numeric digits or legacy NN-NNN format'
            }.`,
          });
        }
        await client.query(
          `UPDATE cashbook_entries
             SET acc_no=$1, updated_at=NOW()
           WHERE record_id=$2 AND is_deleted=FALSE AND id<>$3
             AND acc_type = ANY($4::text[])
             AND acc_no IS DISTINCT FROM $1`,
          [updated.acc_no, updated.record_id, updated.id, groupTypesFor(group)],
        );
      }
    }

    await client.query('COMMIT');
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// ── PATCH /api/cashbook/:id/soft-delete ──────────────────────────────────
// Fix #3: check rowCount so non-existent IDs return 404
// Fix #8: guard is_deleted=FALSE so re-deleting doesn't corrupt deleted_at
async function softDelete(req, res) {
  try {
    // BUG FIX: validate id is numeric before hitting DB
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) return res.status(400).json({ error: 'Invalid entry id' });
    const result = await pool.query(
      `UPDATE cashbook_entries
       SET is_deleted=TRUE, deleted_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND is_deleted=FALSE`,
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Entry not found or already deleted' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── PATCH /api/cashbook/:id/restore ──────────────────────────────────────
// Fix #3: check rowCount so non-existent IDs return 404
// Fix #9: guard is_deleted=TRUE so restoring active entries is a no-op
async function restore(req, res) {
  try {
    // BUG FIX: validate id is numeric before hitting DB
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) return res.status(400).json({ error: 'Invalid entry id' });
    const result = await pool.query(
      `UPDATE cashbook_entries
       SET is_deleted=FALSE, deleted_at=NULL, updated_at=NOW()
       WHERE id=$1 AND is_deleted=TRUE`,
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Entry not found or not deleted' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── DELETE /api/cashbook/:id ──────────────────────────────────────────────
// Fix #2: require soft-delete first; check existence; check rowCount
async function permanentDelete(req, res) {
  try {
    // BUG FIX: validate id is numeric before hitting DB
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) return res.status(400).json({ error: 'Invalid entry id' });

    // BUG FIX: the original SELECT then DELETE was a race condition —
    // the row could be restored between the two queries. Use a single
    // conditional DELETE and check what was actually deleted.
    const checkRow = await pool.query(
      `SELECT id, is_deleted FROM cashbook_entries WHERE id=$1 LIMIT 1`,
      [id],
    );
    if (!checkRow.rows.length) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    if (!checkRow.rows[0].is_deleted) {
      return res.status(400).json({ error: 'Entry must be soft-deleted first before permanent deletion' });
    }
    // Only delete if still soft-deleted (atomic guard)
    const result = await pool.query(
      `DELETE FROM cashbook_entries WHERE id=$1 AND is_deleted=TRUE`,
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Entry was restored before deletion could complete — try again' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/cashbook/deleted ─────────────────────────────────────────────
async function listDeleted(req, res) {
  try {
    const { rows } = await pool.query(
      // BUG FIX: added parent_id to SELECT (was missing, frontend needs it to
      // re-link entries to their parent transaction on restore).
      // BUG FIX: NULL deleted_at rows (rows soft-deleted before the column
      // existed) sorted unpredictably — NULLS LAST pushes them to the bottom.
      `SELECT id, date, entry_date, parent_id, record_id, name, task, acc_type, tx_type,
              acc_no, amount, mode, scroll_no, loan_date, sort_order, deleted_at, created_at
       FROM cashbook_entries
       WHERE is_deleted=TRUE
       ORDER BY deleted_at DESC NULLS LAST, id DESC
       LIMIT 100`,
    );
    res.json({ entries: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/cashbook/opening-balance?date=YYYY-MM-DD ─────────────────────
// Server-side home for the Cash Book tab's opening balance — previously
// localStorage-only (see v7_daily_cash_balance migration note). Returns
// 0 / not-set rather than 404 so the frontend can treat "no row yet" the
// same as "opening balance of 0" without a special case.
async function getOpeningBalance(req, res) {
  try {
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date query parameter is required (YYYY-MM-DD)' });
    }
    const { rows } = await pool.query(
      `SELECT date, opening_balance, updated_at FROM daily_cash_balance WHERE date=$1`,
      [date],
    );
    if (!rows.length) {
      return res.json({ date, opening_balance: 0, set: false });
    }
    res.json({ date: rows[0].date, opening_balance: parseFloat(rows[0].opening_balance) || 0, set: true, updated_at: rows[0].updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── PUT /api/cashbook/opening-balance ──────────────────────────────────────
// Body: { date, opening_balance }. Upsert — one row per date.
async function setOpeningBalance(req, res) {
  try {
    const { date, opening_balance } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    }
    if (opening_balance === undefined || opening_balance === null || opening_balance === '' || isNaN(Number(opening_balance))) {
      return res.status(400).json({ error: 'opening_balance is required and must be a number' });
    }
    const { rows } = await pool.query(
      `INSERT INTO daily_cash_balance (date, opening_balance)
       VALUES ($1, $2)
       ON CONFLICT (date) DO UPDATE SET opening_balance=$2, updated_at=NOW()
       RETURNING date, opening_balance, updated_at`,
      [date, Number(opening_balance)],
    );
    res.json({ date: rows[0].date, opening_balance: parseFloat(rows[0].opening_balance) || 0, set: true, updated_at: rows[0].updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  list, bulkInsert, update, softDelete, restore, permanentDelete, listDeleted,
  getOpeningBalance, setOpeningBalance,
};
