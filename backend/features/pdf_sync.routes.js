'use strict';
const router = require('express').Router();
const pool   = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { upsertCustomer } = require('../controllers/records.controller');

router.use(requireAuth);

function adminOnly(req, res, next) {
  if (req.session?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── Section config ─────────────────────────────────────────────────────────
const MIS_PREFIX = '00103290';

const SECTION_CONFIG = {
  gold:       { recordsSection: 'gold',       mirrorTable: 'gold_loans'     },
  fd:         { recordsSection: 'fd',         mirrorTable: 'fd_accounts'    },
  mis:        { recordsSection: 'fd',         mirrorTable: 'fd_accounts'    },
  saving:     { recordsSection: 'saving',     mirrorTable: 'saving_accounts'},
  od:         { recordsSection: 'od',         mirrorTable: 'od_loans'       },
  membership: { recordsSection: 'membership', mirrorTable: 'memberships'    },
  shares:     { recordsSection: 'shares',     mirrorTable: 'share_accounts' },
  // Current Account has no dedicated mirror table anywhere in this app —
  // records.controller.js's own normal save path for "Current Account" only
  // upserts customers, nothing else (see its "Current Account — record in
  // customers, no dedicated derived table" comment). mirrorTable: null makes
  // upsertMirror() a no-op below and closeRecordAndMirror() return early
  // (it already guards on `if (!table) return;`), matching that same shape.
  current:    { recordsSection: 'current',    mirrorTable: null             },
};

function accNoFilter(section) {
  if (section === 'mis') return `AND account_no LIKE '${MIS_PREFIX}%'`;
  if (section === 'fd')  return `AND account_no NOT LIKE '${MIS_PREFIX}%'`;
  return '';
}

// ── Helpers ────────────────────────────────────────────────────────────────
function toDateStr(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
function toNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// BUG FIX (customer profile / Customers list showing 0 accounts for every
// PDF-synced record): dashboard.routes.js's customer-detail lookup and the
// Customers list' per-type counts both join purely on each mirror table's
// own integer customer_id FK (gold_loans.customer_id, fd_accounts.customer_id,
// saving_accounts.customer_id, od_loans.customer_id — see its "gold_loans has
// its own integer customer_id FK column" comments) — NOT on records.customer_id
// (a different column: a text business code, not this FK). upsertMirror below
// never populated that FK for gold/fd/mis/saving/od, so every account synced
// via PDF Sync is invisible to those aggregations even though the account
// itself shows up fine everywhere that reads its own mirror table directly
// (e.g. the Gold Loans page). shares already resolves this inline; centralize
// it here so every section keeps its mirror table's customer_id FK in sync.
async function resolveCustomerDbId(client, rec) {
  if (!rec.cust_id) return null;
  const { rows } = await client.query(
    `SELECT id FROM customers WHERE customer_id=$1 LIMIT 1`,
    [rec.cust_id],
  );
  return rows[0]?.id || null;
}

function buildDataPatch(section, rec) {
  switch (section) {
    case 'gold':
      // FIX: combined.routes.js's GET /gold-loans reads interest_rate only
      // from records.data->>'interest_rate' (defaulting to 0) — this patch
      // never wrote that key, so every gold loan synced from a PDF showed
      // 0% on the Gold Loans page (same root cause as the OD "0%" bug fixed
      // in the 'od' case below).
      return {
        loan_amount:   toNum(rec.loan_amount || rec.amount),
        balance:       toNum(rec.balance),
        pan:           rec.pan || null,
        loan_date:     toDateStr(rec.start_date),
        interest_rate: toNum(rec.interest_rate),
      };
    case 'fd':
    case 'mis': {
      const patch = {
        fd_amount:          toNum(rec.fd_amount || rec.amount),
        fd_period:          rec.fd_period ?? null,
        fd_interest_rate:   toNum(rec.fd_interest_rate || rec.interest_rate),
        fd_maturity_date:   toDateStr(rec.end_date),
        fd_maturity_amount: toNum(rec.fd_maturity_amount),
        pan:                rec.pan || null,
      };
      if (section === 'mis') patch.mis_acc_no = rec.acc_no || null;
      else                   patch.fd_acc_no  = rec.acc_no || null;
      return patch;
    }
    case 'saving':
      return {
        saving_balance: toNum(rec.balance),
        interest_rate:  toNum(rec.interest_rate),
        pan:            rec.pan || null,
        cust_code:      rec.cust_id || null,
      };
    case 'od':
      // FIX: od_loans has no interest_rate column of its own (rate is read at
      // query time from records.data->>'interest_rate' — see combined.routes.js
      // GET /od-loans) — but this patch never wrote that key, so every OD loan
      // synced from a PDF landed with no rate at all and showed "0%" on the
      // OD Loans page. The client (parsePdfRecords) already extracts
      // rec.interest_rate for every section, OD included — it just wasn't
      // being read here.
      //
      // FIX 2: combined.routes.js's GET /od-loans reads the displayed balance
      // as COALESCE(records.data->>'balance', od_loans.loan_amount) — but this
      // patch never wrote 'balance' either, so every OD sync silently left the
      // page showing the static loan_amount instead of the PDF's real current
      // balance (an OD loan's balance tracks its secured FD's growing
      // maturity value, not the flat principal — confirmed rec.balance ==
      // rec.fd_maturity_amount for every row in the source PDF). gold/shares
      // already write 'balance' the same way; od just needs the same line.
      return {
        loan_amount:      toNum(rec.loan_amount || rec.amount),
        fd_amount:        toNum(rec.fd_amount),
        fd_maturity_date: toDateStr(rec.end_date),
        interest_rate:    toNum(rec.interest_rate),
        balance:          toNum(rec.balance),
      };
    case 'membership':
      return { membership_type: 'PDF Sync' };
    case 'shares':
      return {
        balance:   toNum(rec.balance),
        pan:       rec.pan || null,
        cust_code: rec.cust_id || null,
      };
    case 'current':
      // Matches the exact data shape records.controller.js's normal
      // "Current Account" save path already writes (see its handler —
      // data: {balance, current_acc_no, pan}). No dedicated mirror table.
      return {
        balance:         toNum(rec.balance),
        current_acc_no:  rec.acc_no || null,
        pan:             rec.pan || null,
      };
    default:
      return {};
  }
}

async function insertRecord(client, section, recordsSection, rec) {
  const dataObj = buildDataPatch(section, rec);
  const { rows } = await client.query(
    `INSERT INTO records (date, name, customer_id, customer_type, aadhar, mobile,
       account_no, section, tx_types, data, status, closed_date)
     VALUES ($1,$2,$3,'regular',NULL,NULL,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      toDateStr(rec.start_date),
      rec.customer_name || null,
      rec.cust_id || null,
      rec.acc_no || null,
      recordsSection,
      JSON.stringify(['PDF Sync']),
      JSON.stringify(dataObj),
      rec.status || 'active',
      toDateStr(rec.close_date),
    ],
  );
  return rows[0].id;
}

async function updateRecord(client, recordId, rec, section) {
  const dataPatch = buildDataPatch(section, rec);
  await client.query(
    `UPDATE records
       SET name        = COALESCE($1, name),
           status      = $2,
           closed_date = $3,
           data        = data || $4::jsonb,
           updated_at  = NOW()
     WHERE id=$5`,
    [
      rec.customer_name || null,
      rec.status || 'active',
      toDateStr(rec.close_date),
      JSON.stringify(dataPatch),
      recordId,
    ],
  );
}

// Insert into a mirror table; if it collides on a natural-key unique index
// (e.g. loan_acc_no / fd_acc_no) rather than the record_id constraint,
// update that existing row instead. This handles PDF sub-cases that share
// the same account number across multiple records rows.
async function insertOrClaimByNaturalKey(client, insertSql, insertParams, naturalConstraintFrag, updateSql, updateParams) {
  // BUG FIX: in Postgres, ANY failed statement — including an ordinary
  // unique-violation we fully intend to recover from — aborts the entire
  // surrounding transaction at the database level. Catching the JS
  // rejection does not undo that; every subsequent query (including the
  // "recovery" updateSql right below) kept failing with "current
  // transaction is aborted, commands ignored until end of transaction
  // block" instead of the real error, and that failure then propagated up
  // uncaught. Wrap the attempt in its own SAVEPOINT so a collision can be
  // rolled back to a clean state before the fallback UPDATE runs.
  await client.query('SAVEPOINT sp_natural_key_insert');
  try {
    await client.query(insertSql, insertParams);
    await client.query('RELEASE SAVEPOINT sp_natural_key_insert');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT sp_natural_key_insert');
    if (e.code === '23505' && (e.constraint || '').includes(naturalConstraintFrag)) {
      await client.query(updateSql, updateParams);
    } else {
      throw e;
    }
  }
}

async function upsertMirror(client, section, recordId, rec) {
  const closedDate = toDateStr(rec.close_date);
  const startDate  = toDateStr(rec.start_date);
  const status     = rec.status || 'active';

  // BUG FIX (customer profile / Customers list showing 0 accounts for every
  // PDF-synced record): resolved once here so every case below can write its
  // mirror table's own customer_id FK — see resolveCustomerDbId's comment.
  const customerDbId = await resolveCustomerDbId(client, rec);

  switch (section) {
    case 'gold':
      // BUG FIX: combined.routes.js's GET /gold-loans reads the displayed
      // interest_rate purely from records.data->>'interest_rate' (COALESCE'd
      // to 0) — it never reads gold_loans.interest_rate at all. buildDataPatch
      // never wrote that key for gold, so every gold loan synced from a PDF
      // landed with rate 0 on the Gold Loans page, same root cause as the OD
      // "0%" bug fixed above. Also write it into gold_loans.interest_rate
      // itself (the column already exists — v4_nominee_photo_columns) so the
      // mirror table stays consistent with every other section's pattern.
      await insertOrClaimByNaturalKey(client,
        `INSERT INTO gold_loans
           (record_id, loan_acc_no, acc_no, customer_name, loan_amount, interest_rate, loan_date, status, closed_date, customer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (record_id) DO UPDATE SET
           loan_acc_no   = EXCLUDED.loan_acc_no,
           acc_no        = EXCLUDED.acc_no,
           customer_name = EXCLUDED.customer_name,
           loan_amount   = EXCLUDED.loan_amount,
           interest_rate = EXCLUDED.interest_rate,
           loan_date     = EXCLUDED.loan_date,
           status        = EXCLUDED.status,
           closed_date   = EXCLUDED.closed_date,
           customer_id   = COALESCE(EXCLUDED.customer_id, gold_loans.customer_id),
           updated_at    = NOW()`,
        [recordId, rec.acc_no, rec.acc_no, rec.customer_name || null,
         toNum(rec.loan_amount || rec.amount), toNum(rec.interest_rate), startDate, status, closedDate, customerDbId],
        'gold_loans_unique_acc',
        `UPDATE gold_loans SET
           record_id=$1, acc_no=$2, customer_name=$3, loan_amount=$4,
           interest_rate=$5, loan_date=$6, status=$7, closed_date=$8,
           customer_id=COALESCE($9, customer_id), updated_at=NOW()
         WHERE loan_acc_no=$10`,
        [recordId, rec.acc_no, rec.customer_name || null,
         toNum(rec.loan_amount || rec.amount), toNum(rec.interest_rate), startDate, status, closedDate, customerDbId, rec.acc_no],
      );
      return;

    case 'fd':
    case 'mis': {
      const isMis   = section === 'mis';
      const fdType  = isMis ? 'mis' : 'term';
      const fdAccNo = isMis ? null : (rec.acc_no || null);
      const misAccNo= isMis ? (rec.acc_no || null) : null;
      await client.query(
        `INSERT INTO fd_accounts
           (record_id, fd_acc_no, mis_acc_no, acc_no, acc_code, customer_name,
            fd_amount, fd_period, fd_interest_rate, fd_maturity_date, fd_maturity_amount,
            loan_date, status, closed_date, section, fd_type, customer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (record_id) DO UPDATE SET
           fd_acc_no          = EXCLUDED.fd_acc_no,
           mis_acc_no         = EXCLUDED.mis_acc_no,
           acc_no             = EXCLUDED.acc_no,
           acc_code           = EXCLUDED.acc_code,
           customer_name      = EXCLUDED.customer_name,
           fd_amount          = EXCLUDED.fd_amount,
           fd_period          = EXCLUDED.fd_period,
           fd_interest_rate   = EXCLUDED.fd_interest_rate,
           fd_maturity_date   = EXCLUDED.fd_maturity_date,
           fd_maturity_amount = EXCLUDED.fd_maturity_amount,
           loan_date          = EXCLUDED.loan_date,
           status             = EXCLUDED.status,
           closed_date        = EXCLUDED.closed_date,
           section            = EXCLUDED.section,
           fd_type            = EXCLUDED.fd_type,
           customer_id        = COALESCE(EXCLUDED.customer_id, fd_accounts.customer_id),
           updated_at         = NOW()`,
        [recordId, fdAccNo, misAccNo, rec.acc_no || null, rec.acc_no || null,
         rec.customer_name || null, toNum(rec.fd_amount || rec.amount),
         rec.fd_period ?? null, toNum(rec.fd_interest_rate || rec.interest_rate),
         toDateStr(rec.end_date), toNum(rec.fd_maturity_amount),
         startDate, status, closedDate, section, fdType, customerDbId],
      );
      return;
    }

    case 'saving':
      await client.query(
        `INSERT INTO saving_accounts
           (record_id, saving_acc_no, acc_no, acc_code, customer_name,
            balance, interest_rate, pan_no, cust_code, start_date, status, closed_date, customer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (record_id) DO UPDATE SET
           saving_acc_no = EXCLUDED.saving_acc_no,
           acc_no        = EXCLUDED.acc_no,
           acc_code      = EXCLUDED.acc_code,
           customer_name = EXCLUDED.customer_name,
           balance       = EXCLUDED.balance,
           interest_rate = EXCLUDED.interest_rate,
           pan_no        = COALESCE(EXCLUDED.pan_no, saving_accounts.pan_no),
           cust_code     = COALESCE(EXCLUDED.cust_code, saving_accounts.cust_code),
           start_date    = COALESCE(EXCLUDED.start_date, saving_accounts.start_date),
           status        = EXCLUDED.status,
           closed_date   = EXCLUDED.closed_date,
           customer_id   = COALESCE(EXCLUDED.customer_id, saving_accounts.customer_id),
           updated_at    = NOW()`,
        [recordId, rec.acc_no, rec.acc_no, rec.acc_no, rec.customer_name || null,
         toNum(rec.balance), toNum(rec.interest_rate) || null, rec.pan || null,
         rec.cust_id || null, startDate, status, closedDate, customerDbId],
      );
      return;

    case 'od':
      // BUG FIX: od_loans on the live DB has acc_code AND acc_no columns that
      // were manually added with NOT NULL on some deployments (same drift
      // already fixed for gold_loans.acc_no / fd_accounts.acc_no/acc_code —
      // see migrations.js v9_od_loans_acc_code_nullable and
      // v10_od_loans_acc_no_nullable, which drop both NOT NULLs so this
      // insert can't be blocked by values it doesn't have yet). Write both
      // = loan_acc_no going forward so they stay in sync, same alias pattern
      // every other mirror table already keeps.
      await client.query(
        `INSERT INTO od_loans
           (record_id, loan_acc_no, acc_code, acc_no, customer_name, loan_amount, fd_amount,
            fd_maturity_date, loan_date, status, closed_date, customer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (record_id) DO UPDATE SET
           loan_acc_no      = EXCLUDED.loan_acc_no,
           acc_code         = EXCLUDED.acc_code,
           acc_no           = EXCLUDED.acc_no,
           customer_name    = EXCLUDED.customer_name,
           loan_amount      = EXCLUDED.loan_amount,
           fd_amount        = EXCLUDED.fd_amount,
           fd_maturity_date = EXCLUDED.fd_maturity_date,
           loan_date        = EXCLUDED.loan_date,
           status           = EXCLUDED.status,
           closed_date      = EXCLUDED.closed_date,
           customer_id      = COALESCE(EXCLUDED.customer_id, od_loans.customer_id),
           updated_at       = NOW()`,
        [recordId, rec.acc_no, rec.acc_no, rec.acc_no, rec.customer_name || null,
         toNum(rec.loan_amount || rec.amount), toNum(rec.fd_amount),
         toDateStr(rec.end_date), startDate, status, closedDate, customerDbId],
      );
      return;

    case 'membership': {
      // BUG FIX: memberships also has its own customer_id FK, read the same
      // way by the customer-detail lookup (see resolveCustomerDbId's comment)
      // — this insert never populated it either.
      const vals = [
        recordId, rec.customer_name || null, rec.acc_no || null, rec.acc_no || null,
        'PDF Sync', startDate, status, customerDbId,
      ];
      // BUG FIX: same Postgres transaction-poisoning issue fixed in
      // insertOrClaimByNaturalKey above — this had its own separate copy of
      // the same catch-then-immediately-run-a-recovery-query pattern with no
      // SAVEPOINT, so every acc_code collision (which is exactly what
      // happened on the first real Nominal Membership sync — many rows
      // collided with a pre-existing batch of memberships already sharing
      // this table's "36/N" acc_code numbering) poisoned the whole
      // transaction and the "recovery" UPDATE failed with "current
      // transaction is aborted" instead of ever running.
      await client.query('SAVEPOINT sp_membership_insert');
      try {
        await client.query(
          `INSERT INTO memberships
             (record_id, customer_name, acc_code, acc_no, membership_type, join_date, status, customer_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (record_id) DO UPDATE SET
             customer_name   = EXCLUDED.customer_name,
             acc_code        = EXCLUDED.acc_code,
             acc_no          = EXCLUDED.acc_no,
             membership_type = EXCLUDED.membership_type,
             join_date       = COALESCE(EXCLUDED.join_date, memberships.join_date),
             status          = EXCLUDED.status,
             customer_id     = COALESCE(EXCLUDED.customer_id, memberships.customer_id),
             updated_at      = NOW()`,
          vals,
        );
        await client.query('RELEASE SAVEPOINT sp_membership_insert');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_membership_insert');
        if (e.code === '23505' && (e.constraint || '').includes('acc_code')) {
          await client.query(
            `UPDATE memberships SET
               record_id=$1, customer_name=$2, acc_no=$4, membership_type=$5,
               join_date=COALESCE($6, join_date), status=$7,
               customer_id=COALESCE($8, customer_id), updated_at=NOW()
             WHERE acc_code=$3`,
            vals,
          );
        } else {
          throw e;
        }
      }
      return;
    }

    case 'shares': {
      // share_accounts.customer_id is an FK to customers.id (integer PK),
      // now resolved once for every section by resolveCustomerDbId() above.
      // BUG FIX: share_accounts has NO record_id column at all (confirmed via
      // \d share_accounts, and already documented independently in
      // records.controller.js's own upsert path — "share_accounts has no
      // record_id link to records at all; acc_code is the real unique key").
      // This previously INSERTed a record_id and did ON CONFLICT (record_id),
      // which fails with "column \"record_id\" of relation \"share_accounts\"
      // does not exist" (42703) on every single row — insertOrClaimByNaturalKey's
      // catch only handles 23505 unique-violations, so this never fell back to
      // the acc_code UPDATE either; every shares sync has been erroring out on
      // every row. Real columns: id, acc_code, acc_no, customer_id, cust_code,
      // pan_no, start_date, balance, status, close_date, remarks, is_deleted,
      // deleted_at, created_at, updated_at.
      await client.query(
        `INSERT INTO share_accounts
           (acc_code, acc_no, customer_id, cust_code, pan_no, start_date, balance, status, close_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (acc_code) DO UPDATE SET
           acc_no      = COALESCE(EXCLUDED.acc_no, share_accounts.acc_no),
           customer_id = COALESCE(EXCLUDED.customer_id, share_accounts.customer_id),
           cust_code   = COALESCE(EXCLUDED.cust_code, share_accounts.cust_code),
           pan_no      = COALESCE(EXCLUDED.pan_no, share_accounts.pan_no),
           start_date  = COALESCE(EXCLUDED.start_date, share_accounts.start_date),
           balance     = EXCLUDED.balance,
           status      = EXCLUDED.status,
           close_date  = EXCLUDED.close_date,
           updated_at  = NOW()`,
        [rec.acc_no, rec.acc_no, customerDbId, rec.cust_id || null, rec.pan || null,
         startDate, toNum(rec.balance), status, closedDate],
      );
      return;
    }

    case 'current':
      // No dedicated mirror table (see SECTION_CONFIG's comment) — the
      // records row + buildDataPatch's 'current' case above, plus the
      // maybeUpsertCustomer() call every /wipe row already gets, are the
      // whole story for this section. Nothing to upsert here.
      return;
  }
}

async function closeRecordAndMirror(client, section, recordId) {
  const today = new Date().toISOString().slice(0, 10);
  await client.query(
    `UPDATE records SET status='closed', closed_date=COALESCE(closed_date,$1), updated_at=NOW() WHERE id=$2`,
    [today, recordId],
  );
  const table = SECTION_CONFIG[section]?.mirrorTable;
  if (!table) return;
  if (table === 'share_accounts') {
    // BUG FIX: share_accounts has no record_id column (see upsertMirror's
    // 'shares' case for the full explanation) — filtering by record_id here
    // always matched zero rows and the surrounding .catch(()=>{}) swallowed
    // no error (an UPDATE ... WHERE on a real column with no match isn't an
    // error), so a hard_close sync silently never closed any share account.
    // Look the account code up from the record instead.
    await client.query(
      `UPDATE share_accounts SET status='closed', close_date=COALESCE(close_date,$1), updated_at=NOW()
       WHERE acc_code = (SELECT account_no FROM records WHERE id=$2)`,
      [today, recordId],
    ).catch(() => {});
  } else if (table === 'memberships') {
    await client.query(`UPDATE ${table} SET status='closed', close_date=COALESCE(close_date,$1), updated_at=NOW() WHERE record_id=$2`, [today, recordId]).catch(() => {});
  } else {
    await client.query(
      `UPDATE ${table} SET status='closed', closed_date=COALESCE(closed_date,$1), updated_at=NOW() WHERE record_id=$2`,
      [today, recordId],
    ).catch(() => {});
  }
}

// Fire-and-forget customer upsert using the existing, battle-tested
// upsertCustomer function from records.controller. Passes ALL fields
// extracted by parseCustomerPdfRecords so aadhar/mobile/address etc. are saved.
async function maybeUpsertCustomer(rec) {
  if (!rec.customer_name && !rec.name) return;
  await upsertCustomer({
    customer_id: rec.cust_id || rec.customer_id || null,
    name:        rec.customer_name || rec.name,
    aadhar:      rec.aadhar || null,
    mobile:      rec.mobile || null,
    data: {
      pan:            rec.pan || null,
      dob:            rec.dob || null,
      address:        rec.address || null,
      gender:         rec.gender || null,
      marital_status: rec.marital_status || null,
      caste:          rec.caste || null,
      religion:       rec.religion || null,
      qualification:  rec.qualification || null,
      passport_no:    rec.passport_no || null,
    },
  }).catch(() => {});
}

async function logSync(entry) {
  try {
    await pool.query(
      `INSERT INTO pdf_sync_log
         (section, file_name, record_count, mode, updated, inserted, closed, deleted, skipped, applied, status, errors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        entry.section, entry.file_name || null, entry.record_count || 0, entry.mode,
        entry.updated || 0, entry.inserted || 0, entry.closed || 0, entry.deleted || 0,
        entry.skipped || 0, entry.applied || 0, entry.status || 'applied',
        JSON.stringify(entry.errors || []),
      ],
    );
  } catch (e) {
    console.warn('[pdf-sync] logSync failed:', e.message);
  }
}

// ── GET /api/pdf-sync/history?limit= ──────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 15, 100);
    const { rows } = await pool.query(
      `SELECT section, file_name, record_count, mode, applied, status, created_at
       FROM pdf_sync_log ORDER BY id DESC LIMIT $1`,
      [limit],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pdf-sync/wipe ────────────────────────────────────────────────
// section='customers': upsert-only (no wipe — customers table is a master
//   reference used by FKs all over the schema).
// Other sections: update existing records + insert missing ones.
//   wipe_mode='hard_close': also close any DB records absent from the PDF.
router.post('/wipe', adminOnly, async (req, res) => {
  const { section, records: pdfRecords, file_name, wipe_mode } = req.body;
  if (!Array.isArray(pdfRecords) || !pdfRecords.length) {
    return res.status(400).json({ error: 'No records provided' });
  }

  // ── Customers: upsert biographical data, no deletion ──────────────────
  if (section === 'customers') {
    let updated = 0, inserted = 0, skipped = 0;
    const errors = [];
    for (const rec of pdfRecords) {
      if (!rec.customer_id && !rec.cust_id) { skipped++; continue; }
      try {
        // upsertCustomer handles insert vs update internally
        const before = await pool.query(
          `SELECT id FROM customers WHERE customer_id=$1 LIMIT 1`,
          [rec.customer_id || rec.cust_id],
        );
        await maybeUpsertCustomer(rec);
        if (before.rows.length) updated++; else inserted++;
      } catch (e) {
        errors.push(`${rec.customer_id || rec.cust_id}: ${e.message}`);
      }
    }
    await logSync({
      section, file_name, record_count: pdfRecords.length, mode: 'upsert',
      updated, inserted, skipped, applied: updated + inserted,
      status: errors.length ? 'error' : 'applied', errors,
    });
    return res.json({ updated, inserted, skipped, errors });
  }

  // ── Account sections (gold/fd/mis/saving/od/membership) ───────────────
  const cfg = SECTION_CONFIG[section];
  if (!cfg) return res.status(400).json({ error: `Unsupported section "${section}" for wipe` });

  const mode = wipe_mode === 'hard_close' ? 'hard_close' : 'status_sync';
  let updated = 0, inserted = 0, closed = 0, skipped = 0;
  const errors = [];

  const existingRes = await pool.query(
    `SELECT id, account_no, status FROM records
     WHERE section=$1 AND is_deleted=FALSE ${accNoFilter(section)}`,
    [cfg.recordsSection],
  );
  const existingMap = new Map(existingRes.rows.map(r => [r.account_no, r]));
  const seen = new Set();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const rec of pdfRecords) {
      if (!rec || !rec.acc_no) { skipped++; continue; }
      seen.add(rec.acc_no);
      // SAVEPOINT per record: one bad row can't poison the whole transaction
      await client.query(`SAVEPOINT sp_${updated + inserted + skipped}`);
      try {
        // BUG FIX: maybeUpsertCustomer() used to run AFTER upsertMirror() —
        // but upsertMirror() calls resolveCustomerDbId(), which looks the
        // customer up by customer_id right then. For any customer who only
        // first appears in THIS section's PDF (not already in the customers
        // table), that lookup always missed — the row didn't exist yet — so
        // this record's own mirror row permanently got customer_id NULL even
        // though the customer was created a few lines later (visible
        // immediately: maybeUpsertCustomer runs on the plain pool, a
        // separate auto-committing connection from this transaction's
        // client). Symptom: a brand-new customer's very first account shows
        // up fine on its own page but "0 accounts" on their profile. Ensure
        // the customer row exists first.
        await maybeUpsertCustomer(rec);
        const existing = existingMap.get(rec.acc_no);
        if (existing) {
          await updateRecord(client, existing.id, rec, section);
          await upsertMirror(client, section, existing.id, rec);
          updated++;
        } else {
          const id = await insertRecord(client, section, cfg.recordsSection, rec);
          await upsertMirror(client, section, id, rec);
          inserted++;
        }
        await client.query(`RELEASE SAVEPOINT sp_${updated + inserted + skipped - 1}`);
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT sp_${updated + inserted + skipped}`);
        errors.push(`${rec.acc_no}: ${e.message}`);
      }
    }

    if (mode === 'hard_close') {
      for (const [accNo, row] of existingMap) {
        if (seen.has(accNo) || row.status === 'closed') continue;
        await client.query(`SAVEPOINT sp_close_${closed}`);
        try {
          await closeRecordAndMirror(client, section, row.id);
          closed++;
          await client.query(`RELEASE SAVEPOINT sp_close_${closed - 1}`);
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT sp_close_${closed}`);
          errors.push(`close ${accNo}: ${e.message}`);
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }

  await logSync({
    section, file_name, record_count: pdfRecords.length, mode,
    updated, inserted, closed, skipped, applied: updated + inserted + closed,
    status: errors.length ? 'error' : 'applied', errors,
  });

  res.json({ updated, inserted, closed, skipped, errors });
});

// ── POST /api/pdf-sync/nuclear-wipe ────────────────────────────────────────
// section='customers': same as wipe — safe upsert, no deletion (FK safety).
// Other sections: DELETE all records for that section, then reimport from PDF.
//   Cashbook entries survive (record_id FK is ON DELETE SET NULL).
router.post('/nuclear-wipe', adminOnly, async (req, res) => {
  const { section, records: pdfRecords, file_name } = req.body;
  if (!Array.isArray(pdfRecords) || !pdfRecords.length) {
    return res.status(400).json({ error: 'No records provided' });
  }

  // ── Customers: upsert-only, never delete ──────────────────────────────
  if (section === 'customers') {
    let updated = 0, inserted = 0, skipped = 0;
    const errors = [];
    for (const rec of pdfRecords) {
      if (!rec.customer_id && !rec.cust_id) { skipped++; continue; }
      try {
        const before = await pool.query(
          `SELECT id FROM customers WHERE customer_id=$1 LIMIT 1`,
          [rec.customer_id || rec.cust_id],
        );
        await maybeUpsertCustomer(rec);
        if (before.rows.length) updated++; else inserted++;
      } catch (e) {
        errors.push(`${rec.customer_id || rec.cust_id}: ${e.message}`);
      }
    }
    await logSync({
      section, file_name, record_count: pdfRecords.length, mode: 'upsert',
      updated, inserted, skipped, deleted: 0, applied: updated + inserted,
      status: errors.length ? 'error' : 'applied', errors,
    });
    return res.json({ deleted: 0, inserted, updated, skipped, errors });
  }

  // ── Account sections ───────────────────────────────────────────────────
  const cfg = SECTION_CONFIG[section];
  if (!cfg) return res.status(400).json({ error: `Unsupported section "${section}" for nuclear wipe` });

  let deleted = 0, inserted = 0;
  const errors = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete all records for this section (mirror rows cascade via FK ON DELETE CASCADE,
    // cashbook entries survive via ON DELETE SET NULL)
    const delRes = await client.query(
      `DELETE FROM records WHERE section=$1 ${accNoFilter(section)} RETURNING id, account_no`,
      [cfg.recordsSection],
    );
    deleted = delRes.rowCount;
    // Belt-and-suspenders: also clean up any orphaned mirror rows.
    // BUG FIX: share_accounts has no record_id column (confirmed live via
    // \d share_accounts — see upsertMirror's shares case, which matches on
    // acc_code instead) — deleting by record_id here always threw
    // "column record_id does not exist", and because that error wasn't
    // caught with a SAVEPOINT, it silently poisoned the whole transaction:
    // every later query (including the per-record SAVEPOINTs below) then
    // failed with "current transaction is aborted", the outer catch rolled
    // everything back, and nuclear-wipe of Shares always did nothing at
    // all. Match on acc_code (= records.account_no) for shares, record_id
    // for every other mirror table — and wrap it in its own SAVEPOINT so
    // an unexpected failure here can never take down the whole reimport.
    const deletedIds = delRes.rows.map(r => r.id);
    const deletedAccNos = delRes.rows.map(r => r.account_no).filter(Boolean);
    if (deletedIds.length) {
      await client.query('SAVEPOINT sp_mirror_cleanup');
      try {
        if (section === 'shares') {
          await client.query(`DELETE FROM ${cfg.mirrorTable} WHERE acc_code = ANY($1)`, [deletedAccNos]);
        } else {
          await client.query(`DELETE FROM ${cfg.mirrorTable} WHERE record_id = ANY($1)`, [deletedIds]);
        }
        await client.query('RELEASE SAVEPOINT sp_mirror_cleanup');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_mirror_cleanup');
      }
    }

    for (let i = 0; i < pdfRecords.length; i++) {
      const rec = pdfRecords[i];
      if (!rec || !rec.acc_no) continue;
      // SAVEPOINT per record — one bad row can't poison the whole reimport
      await client.query(`SAVEPOINT sp_${i}`);
      try {
        // BUG FIX: see the identical fix + comment in /wipe above — must run
        // before upsertMirror() so resolveCustomerDbId() can actually find a
        // customer who is only first appearing in this section's PDF.
        await maybeUpsertCustomer(rec);
        const id = await insertRecord(client, section, cfg.recordsSection, rec);
        await upsertMirror(client, section, id, rec);
        await client.query(`RELEASE SAVEPOINT sp_${i}`);
        inserted++;
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT sp_${i}`);
        errors.push(`${rec.acc_no}: ${e.message}`);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }

  await logSync({
    section, file_name, record_count: pdfRecords.length, mode: 'nuclear',
    deleted, inserted, applied: inserted,
    status: errors.length ? 'error' : 'applied', errors,
  });

  res.json({ deleted, inserted, errors });
});

// ── preview / apply: not yet implemented ──────────────────────────────────
router.post('/preview', (req, res) => {
  res.status(501).json({ error: 'Preview mode is not implemented yet — use Wipe or Full Reload.' });
});
router.post('/apply', (req, res) => {
  res.status(501).json({ error: 'Apply (from preview) is not implemented yet — use Wipe or Full Reload.' });
});

module.exports = router;
