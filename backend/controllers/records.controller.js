"use strict";
const pool = require("../db/pool");

// ── NEW ROUTES TO REGISTER IN YOUR ROUTER FILE ───────────────────────────
// router.get('/od-loans/list',           ctrl.odLoansList);
// router.post('/od-loans/backfill-fd-acc', ctrl.odLoansBackfillFdAcc);
// router.post('/gold-loans/backfill',    ctrl.goldLoansBackfill);
// ─────────────────────────────────────────────────────────────────────────

// ── SMS (optional — silently skipped if service not configured) ───────────
let _sms = null;
try {
  _sms = require("../features/sms.service");
} catch (_) {}
async function _trySMS(mobile, message, type, recordId) {
  if (!_sms || !mobile) return;
  try {
    await _sms.sendAndLog(mobile, message, type, recordId);
  } catch (_) {}
}

// ── helpers ───────────────────────────────────────────────────────────────

// Validates that a saving_acc_no is complete — not just a bare prefix like "43-"
function isValidSavingAccNo(val) {
  if (!val || typeof val !== "string") return false;
  const trimmed = val.trim();
  // Reject if it ends with a dash and nothing after (e.g. "43-", "A-")
  if (/^[A-Za-z0-9]+-$/.test(trimmed)) return false;
  // Must be non-empty after trimming
  return trimmed.length > 0;
}

// Validates that fd_acc_no is strictly 14 numeric digits — no dashes, no suffixes.
// e.g. "00103046000421" is valid. "46-001", "00103046000421-CLOSE" are not.
function isValidFdAccNo(val) {
  if (!val || typeof val !== "string") return false;
  return /^\d{14}$/.test(val.trim());
}

// Validates that an OD loan_acc_no is strictly 14 numeric digits — same rule
// as fd_acc_no (e.g. "00104017000106"). Nothing previously enforced this for
// od_loans, so a truncated/typo'd value (e.g. "001040170001", 12 digits)
// could be saved and then drift across the linked cashbook_entries rows
// generated from it (see cashbook acc_no drift repair migration).
function isValidOdAccNo(val) {
  if (!val || typeof val !== "string") return false;
  return /^\d{14}$/.test(val.trim());
}

// An FD-OD loan can be secured against 2+ FDs. od_loans.fd_acc_no (and the
// "fd_acc_no" field submitted from a "New FD-OD Loan" form) stores these as
// a comma-separated list, e.g. "00103046000421,00103046000455". This parses
// that into individual trimmed, non-empty codes for validation/lookup —
// for a single-FD loan (the common case) it just returns a one-element array.
function parseFdAccNoList(val) {
  if (!val || typeof val !== "string") return [];
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Validates a gold loan_acc_no. Unlike OD, gold loans genuinely support TWO
// live formats: the newer 14-digit format (prefix "00104003" + 6-digit seq,
// see LOAN_14_DIGIT_PREFIX_GOLD below) and the legacy short dash format
// (e.g. "03-001"). A strict 14-digit-only check would wrongly reject valid
// legacy accounts, so this only rejects values that are neither shape —
// e.g. a truncated/malformed number that's neither a clean dash pair nor
// 14 digits.
function isValidLoanAccNo(val) {
  if (!val || typeof val !== "string") return false;
  const trimmed = val.trim();
  return /^\d{14}$/.test(trimmed) || /^\d+-\d+$/.test(trimmed);
}

function parseTxTypes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [raw];
  }
}

function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}

// FIX 6 (MEDIUM): validate and coerce numeric amount fields.
// Returns NULL for empty/undefined (not 0), throws for negative or non-numeric values.
function validateAmount(val, fieldName) {
  if (val === undefined || val === null || val === "") return null;
  const num = parseFloat(val);
  if (isNaN(num))
    throw new Error(`Invalid ${fieldName}: "${val}" is not a valid number`);
  if (num < 0) throw new Error(`${fieldName} cannot be negative`);
  return num;
}

// FIX (PAN corruption): upsertCustomer() already rejects a bad-looking PAN
// before writing to the customers table, but create()/update()/importBulk()
// were writing the raw, unvalidated value straight into records.data — the
// JSONB blob the Database tab actually displays — so junk like an amount
// string with a "cr"/"dr" suffix pasted into the PAN field (e.g. a ledger
// export artifact) sat there untouched. Same regex, applied at the same
// point every save actually persists.
//
// BUG FIX: this used to silently `delete dataObj.pan` whenever the value
// didn't match the strict PAN pattern — including a PAN a person typed by
// hand on the data-entry form (a stray space, lowercase mix, or a genuine
// typo). The user never saw any error; the value just vanished from what
// got saved. That silent-strip behavior is now reserved for `strict` mode
// (importBulk() — CSV/ledger data where a "500 cr"-style artifact really is
// garbage, not a person's typed PAN). For manual entry (create()/update()),
// pass strict:false — a non-conforming value is trimmed/uppercased and
// still saved as-is, since the whole point is to keep whatever the user
// actually typed rather than discard it without telling them. Returns
// whether the value was stripped, so callers can warn instead of staying
// silent.
function sanitizePan(dataObj, strict = true) {
  let stripped = false;
  if (dataObj && typeof dataObj.pan === "string") {
    const trimmed = dataObj.pan.trim();
    const looksValid = /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(trimmed);
    if (!trimmed) {
      delete dataObj.pan;
    } else if (!looksValid && strict) {
      delete dataObj.pan;
      stripped = true;
    } else {
      dataObj.pan = trimmed.toUpperCase();
    }
  }
  return stripped;
}

// FIX (importBulk preservation): strip blank-string/null/undefined keys before
// merging a bulk-import row's data blob into an existing records.data JSONB
// column. Without this, re-importing a ledger where e.g. "Aadhar" or "PAN"
// happens to be blank for a given row would jsonb-merge an empty string over
// an already-filled value, silently wiping it out on every re-import.
function stripBlank(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== "" && v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

// FIX 9 (LOW): validate FD period is a positive integer in range 1–120 months.
// Returns null for empty/undefined, throws for out-of-range values.
function validateFdPeriod(val) {
  if (val === undefined || val === null || val === "") return null;
  const n = parseInt(val, 10);
  if (isNaN(n))
    throw new Error(`Invalid fd_period: "${val}" is not a valid integer`);
  if (n < 1) throw new Error("fd_period must be at least 1 month");
  if (n > 120) throw new Error("fd_period cannot exceed 120 months");
  return n;
}


// ── Shared form-field list ────────────────────────────────────────────────
// Single source of truth for fields that arrive as top-level body keys and
// must be merged into records.data. Used by both create() and update().
const FORM_FIELDS = [
  "address",
  "customer_photo_url",
  "photo_customer",
  "photo_ornament",
  "photo_aadhar_front",
  "photo_aadhar_back",
  "photo_pan",
  "ornament_weight",
  "silver_ornaments",
  "gold_ornaments",
  "transaction_type",
  "interest_rate",
  "loan_interest_rate",
  "loan_end_date",
  // nominee fields — stored in records.data and synced to derived tables
  "nominee",
  "nominee_name",
  "nominee_relation",
];
// ── GET /api/records ───────────────────────────────────────────────────────
async function list(req, res) {
  try {
    const {
      section,
      status,
      limit = 50,
      offset = 0,
      date_from,
      date_to,
      q,
      date,
      customer_type,
      customer_id,
      aadhar,
      mobile,
    } = req.query;

    const where = [
      "r.is_deleted = FALSE",
    ];
    const params = [];
    let pi = 1;

    if (section) {
      where.push(`r.section       = $${pi++}`);
      params.push(section);
    }
    if (status && status !== 'all') {
      where.push(`r.status        = $${pi++}`);
      params.push(status);
    }
    if (customer_type) {
      where.push(`r.customer_type = $${pi++}`);
      params.push(customer_type);
    }
    // BUG FIX: these three were silently accepted but never applied — callers
    // like loadCustomerLoanAccounts() (Closing - Loan picker) have been
    // sending ?aadhar=/?mobile= here for a long time believing they scoped
    // the query, when in fact this endpoint only ever filtered on section/
    // status/date/customer_type/q. Every one of those calls actually
    // returned the N most recent records for the section regardless of
    // customer, relying entirely on weak client-side re-filtering (loose
    // first/last-word name matching) to narrow it back down — which readily
    // matches a completely different customer who happens to share a common
    // surname. Add real, exact-match support for the identifiers this app
    // already treats as authoritative elsewhere (customer_id first, then
    // aadhar/mobile) so a caller that has one can get a properly scoped
    // result straight from the database.
    if (customer_id) {
      where.push(`r.customer_id   = $${pi++}`);
      params.push(customer_id);
    }
    if (aadhar) {
      where.push(`r.aadhar        = $${pi++}`);
      params.push(aadhar);
    }
    if (mobile) {
      where.push(`r.mobile        = $${pi++}`);
      params.push(mobile);
    }
    if (date) {
      where.push(`r.date          = $${pi++}`);
      params.push(date);
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (date_from) {
      if (!dateRe.test(date_from))
        return res
          .status(400)
          .json({ error: "Invalid date_from format — expected YYYY-MM-DD" });
      where.push(`r.date >= $${pi++}`);
      params.push(date_from);
    }
    if (date_to) {
      if (!dateRe.test(date_to))
        return res
          .status(400)
          .json({ error: "Invalid date_to format — expected YYYY-MM-DD" });
      where.push(`r.date <= $${pi++}`);
      params.push(date_to);
    }
    if (q) {
      where.push(
        `(LOWER(r.name)              LIKE $${pi}` +
          ` OR r.aadhar                LIKE $${pi}` +
          ` OR r.mobile                LIKE $${pi}` +
          ` OR r.account_no            LIKE $${pi}` +
          ` OR LOWER(r.data->>'loan_acc_no') LIKE $${pi}` +
          ` OR LOWER(r.data->>'customer_name') LIKE $${pi})`,
      );
      params.push(`%${q.toLowerCase()}%`);
      pi++;
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM records r ${whereClause}`,
      params,
    );
    const total = parseInt(countRes.rows[0].total);

    const lim = Math.min(parseInt(limit) || 50, 500);
    const off = parseInt(offset) || 0;

    // BUG FIX: $${pi} and $${pi+1} were evaluated in the same template literal —
    // both resolved to the same number so OFFSET was never applied correctly.
    const limitParam = pi;
    const offsetParam = pi + 1;
    const dataRes = await pool.query(
      // BUG FIX: LEFT JOIN saving_accounts so that balance, pan_no, interest_rate,
      // and cust_code come from the authoritative saving_accounts table rather than
      // the stale records.data JSONB blob (which is never updated after import).
      `SELECT r.id, r.date, r.name, r.customer_id, r.customer_type,
              r.aadhar, r.mobile, r.account_no, r.section, r.tx_types,
              r.data, r.remarks, r.sonar_parent_no, r.sonar_sub_no, r.sonar_group_no,
              r.status, r.closed_date, r.closed_remarks, r.closed_tx_types, r.created_at, r.updated_at,
              -- Saving account live fields (override JSONB stale values for saving section)
              sa.balance        AS saving_balance,
              sa.saving_acc_no  AS saving_acc_no,
              sa.pan_no         AS saving_pan,
              sa.interest_rate  AS saving_interest_rate,
              sa.start_date     AS saving_start_date,
              sa.cust_code      AS saving_cust_code
       FROM records r
       LEFT JOIN saving_accounts sa ON sa.record_id = r.id
       ${whereClause}
       ORDER BY r.id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, lim, off],
    );

    const records = dataRes.rows.map((r) => {
      const data =
        typeof r.data === "string" ? JSON.parse(r.data || "{}") : r.data || {};
      // BUG FIX: For saving section — overlay live values from saving_accounts
      // over the stale JSONB blob. The blob is written once at import and never
      // updated when deposits/withdrawals change the balance.
      if (r.section === "saving") {
        if (r.saving_balance != null) data.saving_balance = r.saving_balance;
        if (r.saving_acc_no != null) data.saving_acc_no = r.saving_acc_no;
        if (r.saving_pan != null) data.pan = r.saving_pan;
        if (r.saving_interest_rate != null)
          data.interest_rate = r.saving_interest_rate;
        if (r.saving_start_date != null) data.start_date = r.saving_start_date;
        if (r.saving_cust_code != null) data.cust_code = r.saving_cust_code;
      }
      // Strip the flat JOIN aliases — their values are now inside `data`
      const {
        saving_balance,
        saving_acc_no,
        saving_pan,
        saving_interest_rate,
        saving_start_date,
        saving_cust_code,
        ...rest
      } = r;
      return {
        ...rest,
        tx_types: parseTxTypes(r.tx_types),
        data,
      };
    });

    res.json({ records, total, limit: lim, offset: off });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/stats ────────────────────────────────────────────────
async function stats(req, res) {
  try {
    const today = getTodayStr();
    // Use date from query param if provided (global date selector), else today
    const targetDate = req.query.date || today;

    const [
      total,
      todayCount,
      activeGold,
      activeFD,
      closedGold,
      todayOpened,
      todayClosed,
      goldAmt,
      fdAmt,
      bySection,
      recent,
      recentClosed,
      missingLoan,
      missingName,
      missingDate,
      dupAcc,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM records WHERE is_deleted=FALSE`),
      pool.query(
        `SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND date=$1`,
        [targetDate],
      ),
      pool.query(
        `SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND section='gold' AND status='active'`,
      ),
      pool.query(
        `SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND section='fd'  AND status='active'`,
      ),
      pool.query(
        `SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND section='gold' AND status='closed'`,
      ),
      pool.query(
        `SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND section='gold' AND status='active' AND date=$1`,
        [targetDate],
      ),
      pool.query(
        `SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND section='gold' AND status='closed' AND closed_date=$1`,
        [targetDate],
      ),

      // total active gold loan amount  (data is JSONB — no text cast needed)
      pool.query(`SELECT COALESCE(SUM(
                    CASE WHEN (data->>'loan_amount') ~ '^[0-9]+(\\.[0-9]+)?$'
                    THEN (data->>'loan_amount')::numeric ELSE NULL END
                  ), 0) AS amt
                  FROM records WHERE is_deleted=FALSE AND section='gold' AND status='active'`),
      // total active FD deposit amount
      pool.query(`SELECT COALESCE(SUM(
                    CASE WHEN (data->>'fd_amount') ~ '^[0-9]+(\\.[0-9]+)?$'
                    THEN (data->>'fd_amount')::numeric ELSE NULL END
                  ), 0) AS amt
                  FROM records WHERE is_deleted=FALSE AND section='fd' AND status='active'`),

      // by section counts
      pool.query(
        `SELECT section, COUNT(*) AS count FROM records WHERE is_deleted=FALSE GROUP BY section ORDER BY count DESC`,
      ),

      // 10 most recent records
      pool.query(
        `SELECT id, date, name, section, tx_types, account_no, sonar_sub_no, status FROM records WHERE is_deleted=FALSE ORDER BY id DESC LIMIT 10`,
      ),

      // 5 most recently closed
      pool.query(
        `SELECT id, name, account_no, closed_date, section, data->>'loan_amount' AS loan_amount FROM records WHERE is_deleted=FALSE AND status='closed' ORDER BY id DESC LIMIT 5`,
      ),

      // data errors
      pool.query(
        `SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND section='gold' AND (data->>'loan_amount' IS NULL OR data->>'loan_amount'='')`,
      ),
      pool.query(
        `SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND (name IS NULL OR name='')`,
      ),
      // Fix #1: date is now a DATE column — can't compare to '' — just check IS NULL
      pool.query(
        `SELECT COUNT(*) FROM records WHERE is_deleted=FALSE AND date IS NULL`,
      ),
      // Fix #11: explicit AS count alias so all clients can read it reliably
      pool.query(
        `SELECT account_no, COUNT(*) AS count FROM records WHERE is_deleted=FALSE AND account_no IS NOT NULL AND account_no<>'' GROUP BY account_no HAVING COUNT(*)>1 LIMIT 10`,
      ),
    ]);

    res.json({
      total: parseInt(total.rows[0].count),
      today: parseInt(todayCount.rows[0].count),
      activeGold: parseInt(activeGold.rows[0].count),
      activeFD: parseInt(activeFD.rows[0].count),
      closedGold: parseInt(closedGold.rows[0].count),
      todayOpenedGold: parseInt(todayOpened.rows[0].count),
      todayClosedGold: parseInt(todayClosed.rows[0].count),
      totalGoldLoanAmt: parseFloat(goldAmt.rows[0].amt),
      totalFDDepositAmt: parseFloat(fdAmt.rows[0].amt),
      bySection: bySection.rows.map((r) => ({
        section: r.section,
        count: parseInt(r.count),
      })),
      recent: recent.rows.map((r) => ({
        ...r,
        tx_types: parseTxTypes(r.tx_types),
      })),
      recentClosed: recentClosed.rows,
      dataErrors: {
        missingLoanAmt: parseInt(missingLoan.rows[0].count),
        missingName: parseInt(missingName.rows[0].count),
        missingDate: parseInt(missingDate.rows[0].count),
        dupLoanAcc: dupAcc.rows.reduce((sum, r) => sum + parseInt(r.count), 0),
        dupLoanAccList: dupAcc.rows.map((r) => ({
          account_no: r.account_no,
          count: r.count,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/deleted ───────────────────────────────────────────────
async function listDeleted(req, res) {
  try {
    // BUG FIX: NULL deleted_at rows (soft-deleted before the column existed)
    // caused ORDER BY deleted_at DESC to sort unpredictably or crash —
    // NULLS LAST pushes them to the bottom safely.
    // BUG FIX: secondary ORDER BY id DESC ensures stable ordering when
    // deleted_at timestamps are identical or NULL.
    let rows;
    try {
      ({ rows } = await pool.query(
        `SELECT id, date, name, section, tx_types, account_no, deleted_at
         FROM records
         WHERE is_deleted = TRUE
         ORDER BY deleted_at DESC NULLS LAST, id DESC
         LIMIT 100`,
      ));
    } catch (_colErr) {
      // deleted_at column may not exist yet — fall back without it
      ({ rows } = await pool.query(
        `SELECT id, date, name, section, tx_types, account_no, NULL AS deleted_at
         FROM records
         WHERE is_deleted = TRUE
         ORDER BY id DESC
         LIMIT 100`,
      ));
    }
    const ids = rows.map((r) => r.id);
    let cbCounts = {};
    if (ids.length) {
      const cbRes = await pool
        .query(
          `SELECT record_id, COUNT(*) AS cb_count
         FROM cashbook_entries
         WHERE record_id = ANY($1) AND is_deleted = TRUE
         GROUP BY record_id`,
          [ids],
        )
        .catch(() => ({ rows: [] }));
      cbCounts = Object.fromEntries(
        cbRes.rows.map((r) => [r.record_id, parseInt(r.cb_count, 10)]),
      );
    }
    res.json({
      records: rows.map((r) => ({
        ...r,
        tx_types: parseTxTypes(r.tx_types),
        cashbook_rows: cbCounts[r.id] || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Loan number format constants ──────────────────────────────────────────
// All gold/OD loans use a 14-digit format:
//   00104003NNNNNN  — fixed prefix "00104003" + 6-digit sequence (gold)
//   00104017NNNNNN  — fixed prefix "00104017" + 6-digit sequence (OD)
const LOAN_14_DIGIT_PREFIX_GOLD = "00104003"; // gold loans
const LOAN_14_DIGIT_PREFIX_OD = "00104017"; // OD loans
const LOAN_14_DIGIT_SEQ_LEN = 6; // last 6 digits are the sequence

// ── GET /api/records/next-loan-no-auto?section=gold ──────────────────────
// Returns the next 14-digit loan number for the given section.
// Returns: { next: "00104003004774", format: "14digit" } for gold
//       or { next: "00104017000001", format: "14digit" } for OD
async function nextLoanNoAuto(req, res) {
  try {
    const section = (req.query.section || "gold").toLowerCase();
    const prefix =
      section === "od" ? LOAN_14_DIGIT_PREFIX_OD : LOAN_14_DIGIT_PREFIX_GOLD;

    // Find the max sequence number for this section's prefix
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(
         CASE WHEN account_no ~ '^[0-9]{14,}$'
         THEN CAST(RIGHT(account_no, $1) AS BIGINT)
         ELSE NULL END
       ), 0) AS max_seq
       FROM records
       WHERE section = $2
         AND account_no LIKE $3
         AND is_deleted = FALSE`,
      [LOAN_14_DIGIT_SEQ_LEN, section, prefix + "%"],
    );

    const maxSeq = parseInt(rows[0].max_seq) || 0;
    const nextSeq = String(maxSeq + 1).padStart(LOAN_14_DIGIT_SEQ_LEN, "0");
    res.json({ next: `${prefix}${nextSeq}`, format: "14digit" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Internal helper: compute next short-format loan number ─────────────────
// Queries THREE sources (Bug 1 + Bug 3 fix) so sub-loans are never skipped.
async function _nextShortLoanNo(prefix) {
  const escapedPrefix =
    "^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-";
  const likePattern = prefix + "-%";

  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(v), 0) AS max_num FROM (
       -- source 1: records.account_no
       SELECT CASE
         WHEN REGEXP_REPLACE(account_no, $1, '') ~ '^[0-9]+$'
         THEN REGEXP_REPLACE(account_no, $1, '')::integer
         ELSE NULL END AS v
       FROM records
       WHERE account_no LIKE $2 AND is_deleted = FALSE

       UNION ALL

       -- source 2: gold_loans.loan_acc_no (may differ from records.account_no)
       SELECT CASE
         WHEN REGEXP_REPLACE(loan_acc_no, $1, '') ~ '^[0-9]+$'
         THEN REGEXP_REPLACE(loan_acc_no, $1, '')::integer
         ELSE NULL END AS v
       FROM gold_loans
       WHERE loan_acc_no LIKE $2

       UNION ALL

       -- source 3: sonar sub-loans in records.sonar_sub_no e.g. "03-1122-A"
       SELECT CASE
         WHEN REGEXP_REPLACE(REGEXP_REPLACE(sonar_sub_no, '-[A-Za-z]+$', ''), $1, '') ~ '^[0-9]+$'
         THEN REGEXP_REPLACE(REGEXP_REPLACE(sonar_sub_no, '-[A-Za-z]+$', ''), $1, '')::integer
         ELSE NULL END AS v
       FROM records
       WHERE sonar_sub_no LIKE $2 || '%' AND is_deleted = FALSE
     ) combined`,
    [escapedPrefix, likePattern],
  );

  const next = (parseInt(rows[0].max_num) || 0) + 1;
  const padded = String(next).padStart(3, "0");
  return `${prefix}-${padded}`;
}

// ── GET /api/records/next-loan-no/:prefix ─────────────────────────────────
// Kept for backwards compatibility. Handles both short (03, 17) and 14-digit
// prefixes. The frontend's prefillNextLoanNo now calls next-loan-no-auto
// instead, but the old endpoint still works for explicit prefix requests.
async function nextLoanNo(req, res) {
  try {
    const prefix = req.params.prefix;

    // If caller passed the full 14-digit prefix (or a 14-digit acc number)
    if (/^\d{8,}$/.test(prefix)) {
      const fixedPrefix = prefix.length >= 8 ? prefix.slice(0, 8) : prefix;
      const { rows } = await pool.query(
        // BUG FIX: added is_deleted=FALSE — soft-deleted records with high
        // sequence numbers were inflating the next generated loan number.
        `SELECT COALESCE(MAX(
           CASE WHEN account_no ~ '^[0-9]{14,}$'
           THEN CAST(RIGHT(account_no, $1) AS BIGINT)
           ELSE NULL END
         ), 0) AS max_seq
         FROM records
         WHERE account_no LIKE $2 AND is_deleted = FALSE`,
        [LOAN_14_DIGIT_SEQ_LEN, fixedPrefix + "%"],
      );
      const nextSeq = String((parseInt(rows[0].max_seq) || 0) + 1).padStart(
        LOAN_14_DIGIT_SEQ_LEN,
        "0",
      );
      return res.json({ next: `${fixedPrefix}${nextSeq}`, format: "14digit" });
    }

    // Short format (03, 17, etc.)
    const next = await _nextShortLoanNo(prefix);
    res.json({ next, format: "short" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/check-loan-no/:no ───────────────────────────────────
// Fix (Bug 1 + Bug 3): check THREE sources for the loan number so the
// "already exists" warning fires correctly even when:
//   - records.account_no and gold_loans.loan_acc_no have drifted out of sync
//   - the number being checked is a sonar sub-loan (stored in sonar_sub_no,
//     not in account_no, so the old query silently missed them)
// Priority: records.account_no > gold_loans.loan_acc_no > sonar_sub_no
async function checkLoanNo(req, res) {
  try {
    const no = req.params.no;

    // 1. Check records.account_no (primary source)
    const { rows: recRows } = await pool.query(
      `SELECT id, name, date, status, closed_date, account_no
       FROM records WHERE account_no=$1 AND is_deleted=FALSE
       ORDER BY id DESC LIMIT 1`,
      [no],
    );
    if (recRows.length) {
      const r = recRows[0];
      return res.json({
        exists: true,
        source: "records.account_no",
        record: {
          id: r.id,
          name: r.name,
          date: r.date,
          status: r.status,
          closed_date: r.closed_date,
          account_no: r.account_no,
        },
      });
    }

    // 2. Check gold_loans.loan_acc_no (may differ from records if they drifted)
    const { rows: glRows } = await pool.query(
      `SELECT r.id, r.name, r.date, r.status, r.closed_date, gl.loan_acc_no AS account_no
       FROM gold_loans gl
       JOIN records r ON r.id = gl.record_id AND r.is_deleted = FALSE
       WHERE gl.loan_acc_no = $1
       ORDER BY r.id DESC LIMIT 1`,
      [no],
    );
    if (glRows.length) {
      const r = glRows[0];
      return res.json({
        exists: true,
        source: "gold_loans.loan_acc_no",
        record: {
          id: r.id,
          name: r.name,
          date: r.date,
          status: r.status,
          closed_date: r.closed_date,
          account_no: r.account_no,
        },
      });
    }

    // 3. Check records.sonar_sub_no (sub-loans like "03-1122-A")
    const { rows: subRows } = await pool.query(
      `SELECT id, name, date, status, closed_date, sonar_sub_no AS account_no
       FROM records WHERE sonar_sub_no=$1 AND is_deleted=FALSE
       ORDER BY id DESC LIMIT 1`,
      [no],
    );
    if (subRows.length) {
      const r = subRows[0];
      return res.json({
        exists: true,
        source: "records.sonar_sub_no",
        record: {
          id: r.id,
          name: r.name,
          date: r.date,
          status: r.status,
          closed_date: r.closed_date,
          account_no: r.account_no,
        },
      });
    }

    res.json({ exists: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/next-fd-acc-no/:prefix ───────────────────────────────
// prefix must be a numeric string of 6+ digits (e.g. "00103046").
// Returns next 14-digit fd_acc_no: prefix + 6-digit zero-padded sequence.
// Queries fd_accounts.fd_acc_no directly (authoritative source).
// Legacy dash-format (e.g. "46-001") is NOT supported — reject it.
async function nextFdAccNo(req, res) {
  try {
    let prefix = req.params.prefix;
    if (!/^\d{6,}$/.test(prefix)) {
      return res.status(400).json({
        error: `Invalid fd_acc_no prefix "${prefix}". Must be numeric digits only (e.g. "00103046"). Dash formats are not allowed.`,
      });
    }
    // BUG FIX: caller can pass a full 14-digit fd_acc_no (e.g. clicking
    // "Use next" after typing an existing account number with no dash) —
    // normalise anything longer than the real 8-digit prefix down to 8
    // digits first. Without this, SUBSTRING(fd_acc_no, prefix.length+1, 6)
    // below comes back shorter than 6 chars (or empty for a 14-digit
    // prefix), which fails to cast to integer and crashed with a 500.
    if (prefix.length > 8) prefix = prefix.slice(0, 8);
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Query fd_accounts (authoritative) AND records.data JSONB for any legacy rows
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(v), 0) AS max_num FROM (
         SELECT CASE
           WHEN fd_acc_no ~ '^[0-9]{14}$'
            AND SUBSTRING(fd_acc_no, 1, $2) = $1
           THEN SUBSTRING(fd_acc_no, $2 + 1, 6)::integer
           ELSE NULL END AS v
         FROM fd_accounts WHERE fd_acc_no LIKE $3
         UNION ALL
         SELECT CASE
           WHEN data->>'fd_acc_no' ~ '^[0-9]{14}$'
            AND SUBSTRING(data->>'fd_acc_no', 1, $2) = $1
           THEN SUBSTRING(data->>'fd_acc_no', $2 + 1, 6)::integer
           ELSE NULL END AS v
         FROM records WHERE is_deleted=FALSE AND data->>'fd_acc_no' LIKE $3
       ) combined`,
      [prefix, prefix.length, prefix + "%"],
    );
    const next = (parseInt(rows[0].max_num) || 0) + 1;
    res.json({ next: `${prefix}${String(next).padStart(6, "0")}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/check-fd-acc-no/:no ─────────────────────────────────
async function checkFdAccNo(req, res) {
  try {
    const no = req.params.no;
    // Enforce 14-digit format at the check endpoint too
    if (!isValidFdAccNo(no)) {
      return res.status(400).json({
        error: `Invalid fd_acc_no "${no}". Must be exactly 14 numeric digits (e.g. "00103046000421").`,
      });
    }
    // Check fd_accounts first (authoritative)
    const { rows: faRows } = await pool.query(
      `SELECT fa.id, fa.customer_name AS name, fa.status, fa.loan_date AS date, fa.closed_date
       FROM fd_accounts fa WHERE fa.fd_acc_no=$1 OR fa.acc_code=$1 LIMIT 1`,
      [no],
    );
    if (faRows.length) {
      const r = faRows[0];
      return res.json({
        exists: true,
        record: {
          id: r.id,
          name: r.name,
          date: r.date,
          status: r.status,
          closed_date: r.closed_date,
        },
      });
    }
    // Fallback: check records.data JSONB (for older records not yet in fd_accounts)
    const { rows } = await pool.query(
      `SELECT id, name, date, status, closed_date
       FROM records WHERE is_deleted=FALSE AND data->>'fd_acc_no'=$1
       ORDER BY id DESC LIMIT 1`,
      [no],
    );
    if (!rows.length) return res.json({ exists: false });
    const r = rows[0];
    res.json({
      exists: true,
      record: {
        id: r.id,
        name: r.name,
        date: r.date,
        status: r.status,
        closed_date: r.closed_date,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/fd-linked-od-loans/:fdAccNo ──────────────────────────
// FD Closing form guard: before staff closes an FD, check whether that FD
// account is currently securing an ACTIVE FD-OD loan. od_loans.fd_acc_no can
// hold a comma-separated list when a loan is secured by 2+ FDs (see
// parseFdAccNoList above), so this matches against each element of that list
// rather than an exact string match.
async function fdLinkedOdLoans(req, res) {
  try {
    const fdAccNo = (req.params.fdAccNo || "").trim();
    if (!fdAccNo) return res.json({ loans: [] });
    const { rows } = await pool.query(
      `SELECT ol.id, ol.record_id, ol.loan_acc_no, ol.customer_name, ol.status
       FROM od_loans ol
       WHERE ol.status = 'active'
         AND ol.fd_acc_no IS NOT NULL
         AND ol.fd_acc_no <> ''
         AND $1 = ANY(string_to_array(REPLACE(ol.fd_acc_no, ' ', ''), ','))`,
      [fdAccNo],
    );
    res.json({ loans: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/next-mis-acc-no/:prefix ──────────────────────────────
// Accepts 8-digit numeric prefix e.g. "00103290" → returns "00103290000002" (14-digit)
// Legacy "290" / "290-" is normalised to "00103290" automatically.
async function nextMisAccNo(req, res) {
  try {
    let prefix = req.params.prefix.trim();
    // Normalise legacy short prefix "290" → "00103290"
    if (prefix === '290' || prefix === '290-') prefix = '00103290';
    if (!/^\d{6,}$/.test(prefix)) {
      return res.status(400).json({
        error: `Invalid mis_acc_no prefix "${prefix}". Must be numeric digits (e.g. "00103290").`
      });
    }
    // BUG FIX: same class of bug as nextFdAccNo/nextOdAccNo — a full
    // 14-digit mis_acc_no passed as "prefix" made the SUBSTRING below come
    // back empty, crashing with a 500.
    if (prefix.length > 8) prefix = prefix.slice(0, 8);
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(v), 0) AS max_num FROM (
         SELECT CASE
           WHEN data->>'mis_acc_no' ~ '^[0-9]{14}$'
            AND SUBSTRING(data->>'mis_acc_no', 1, $2) = $1
           THEN SUBSTRING(data->>'mis_acc_no', $2 + 1, 6)::integer
           ELSE NULL END AS v
         FROM records WHERE is_deleted=FALSE AND data->>'mis_acc_no' LIKE $3
       ) combined`,
      [prefix, prefix.length, prefix + '%'],
    );
    const next = (parseInt(rows[0].max_num) || 0) + 1;
    res.json({ next: `${prefix}${String(next).padStart(6, '0')}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/check-mis-acc-no/:no ────────────────────────────────
async function checkMisAccNo(req, res) {
  try {
    const no = req.params.no;
    // Enforce 14-digit format at the check endpoint too (mis_acc_no uses the
    // same 14-digit rule as fd_acc_no — see nextMisAccNo above).
    if (!isValidFdAccNo(no)) {
      return res.status(400).json({
        error: `Invalid mis_acc_no "${no}". Must be exactly 14 numeric digits (e.g. "00103290000002").`,
      });
    }
    // Check fd_accounts first (authoritative) — same drift class as OD/gold:
    // fd_accounts.mis_acc_no is a real column written at FD creation and was
    // never checked here before, only records.data->>'mis_acc_no'.
    const { rows: faRows } = await pool.query(
      `SELECT fa.id, fa.customer_name AS name, fa.status, fa.loan_date AS date, fa.closed_date
       FROM fd_accounts fa WHERE fa.mis_acc_no=$1 LIMIT 1`,
      [no],
    );
    if (faRows.length) {
      const r = faRows[0];
      return res.json({
        exists: true,
        source: "fd_accounts.mis_acc_no",
        record: {
          id: r.id,
          name: r.name,
          date: r.date,
          status: r.status,
          closed_date: r.closed_date,
        },
      });
    }
    // Fallback: check records.data JSONB (for older records not yet in fd_accounts)
    const { rows } = await pool.query(
      `SELECT id, name, date, status, closed_date
       FROM records WHERE is_deleted=FALSE AND data->>'mis_acc_no'=$1
       ORDER BY id DESC LIMIT 1`,
      [no],
    );
    if (!rows.length) return res.json({ exists: false });
    const r = rows[0];
    res.json({
      exists: true,
      source: "records.data.mis_acc_no",
      record: {
        id: r.id,
        name: r.name,
        date: r.date,
        status: r.status,
        closed_date: r.closed_date,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/customers/search?q= ─────────────────────────────────
async function customerSearch(req, res) {
  try {
    // BUG FIX: frontend duplicate-detection calls this endpoint with ?aadhar=...
    // or ?mobile=... (not ?q=). The old code only read req.query.q and returned []
    // immediately for those calls, so duplicate detection never worked.
    // Now we support three modes:
    //   ?q=<text>       — general name/aadhar/mobile search (existing)
    //   ?aadhar=<value> — exact aadhar match (duplicate detection)
    //   ?mobile=<value> — exact mobile match (duplicate detection)
    const q = (req.query.q || "").trim();
    const aadhar = (req.query.aadhar || "").trim();
    const mobile = (req.query.mobile || "").trim();

    if (!q && !aadhar && !mobile) return res.json([]);

    let custRows, fallbackRows;

    if (aadhar || mobile) {
      // Exact-match mode — used by duplicate detection
      const col = aadhar ? "aadhar" : "mobile";
      const val = aadhar || mobile;
      ({ rows: custRows } = await pool.query(
        `SELECT id AS customer_db_id, customer_id, name, aadhar, mobile,
                COALESCE(pan,'') AS pan, COALESCE(dob::text,'') AS dob,
                COALESCE(address,'') AS address, COALESCE(occupation,'') AS occupation,
                COALESCE(saving_acc_no,'') AS saving_acc_no,
                COALESCE(saving_balance::text,'0') AS saving_balance,
                COALESCE(share_acc_no,'') AS share_acc_no
         FROM customers
         WHERE ${col} = $1
         ORDER BY id DESC LIMIT 10`,
        [val],
      ));
      if (!custRows.length) {
        ({ rows: fallbackRows } = await pool.query(
          `SELECT customer_id, name, aadhar, mobile,
                  data->>'pan' AS pan, data->>'dob' AS dob,
                  data->>'address' AS address, data->>'occupation' AS occupation,
                  data->>'saving_acc_no' AS saving_acc_no,
                  data->>'saving_balance' AS saving_balance,
                  data->>'share_acc_no' AS share_acc_no
           FROM records
           WHERE is_deleted=FALSE AND ${col} = $1
           ORDER BY id DESC LIMIT 10`,
          [val],
        ));
        return res.json(fallbackRows);
      }
      return res.json(custRows);
    }

    // General search mode (?q=)
    const pattern = `%${q.toLowerCase()}%`;
    ({ rows: custRows } = await pool.query(
      // FIX: customers table is the single source of truth. Always query it first.
      // Each customer_id is one row here — no duplicates possible.
      `SELECT id AS customer_db_id, customer_id, name, aadhar, mobile,
              COALESCE(pan,'') AS pan, COALESCE(dob::text,'') AS dob,
              COALESCE(address,'') AS address, COALESCE(occupation,'') AS occupation,
              COALESCE(saving_acc_no,'') AS saving_acc_no,
              COALESCE(saving_balance::text,'0') AS saving_balance,
              COALESCE(share_acc_no,'') AS share_acc_no
       FROM customers
       WHERE (NULLIF(customer_id,'') IS NOT NULL OR NULLIF(aadhar,'') IS NOT NULL OR NULLIF(mobile,'') IS NOT NULL)
         AND (LOWER(COALESCE(name,'')) LIKE $1 OR COALESCE(aadhar,'') LIKE $2 OR COALESCE(mobile,'') LIKE $3)
       ORDER BY
         -- Prefer rows with more identity data filled in
         (CASE WHEN aadhar IS NOT NULL AND aadhar <> '' THEN 1 ELSE 0 END +
          CASE WHEN mobile IS NOT NULL AND mobile <> '' THEN 1 ELSE 0 END) DESC,
         id DESC
       LIMIT 10`,
      [pattern, pattern, pattern],
    ));

    if (!custRows.length) {
      // Fallback: search records then JOIN to customers table so we always
      // return the canonical customers row — never raw records rows which have
      // one row per product (gold loan, FD etc) causing duplicates in dropdown.
      ({ rows: fallbackRows } = await pool.query(
        `SELECT DISTINCT ON (c.customer_id)
                c.id AS customer_db_id, c.customer_id, c.name, c.aadhar, c.mobile,
                COALESCE(c.pan,'')                   AS pan,
                COALESCE(c.dob::text,'')             AS dob,
                COALESCE(c.address,'')               AS address,
                COALESCE(c.occupation,'')            AS occupation,
                COALESCE(c.saving_acc_no,'')         AS saving_acc_no,
                COALESCE(c.saving_balance::text,'0') AS saving_balance,
                COALESCE(c.share_acc_no,'')          AS share_acc_no
         FROM records r
         JOIN customers c ON c.customer_id = r.customer_id
         WHERE r.is_deleted=FALSE
           AND (LOWER(r.name) LIKE $1 OR r.aadhar LIKE $2 OR r.mobile LIKE $3)
         ORDER BY c.customer_id,
           (CASE WHEN c.aadhar IS NOT NULL AND c.aadhar <> '' THEN 1 ELSE 0 END +
            CASE WHEN c.mobile IS NOT NULL AND c.mobile <> '' THEN 1 ELSE 0 END) DESC
         LIMIT 10`,
        [pattern, pattern, pattern],
      ));
      return res.json(fallbackRows);
    }

    res.json(custRows);
  } catch (err) {
    console.error("customerSearch error:", err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/:id ──────────────────────────────────────────────────
async function getOne(req, res) {
  try {
    // BUG FIX: validate id is a positive integer — a non-numeric id like
    // /api/records/abc causes a PostgreSQL cast error and an unhandled 500.
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1)
      return res.status(400).json({ error: "Invalid record id" });
    // Fix #3: exclude soft-deleted records from getOne
    const { rows } = await pool.query(
      `SELECT id, date, name, customer_id, customer_type, aadhar, mobile, account_no, section, tx_types, data, remarks, sonar_parent_no, sonar_sub_no, sonar_group_no, status, closed_date, closed_remarks, closed_tx_types, created_at, updated_at FROM records WHERE id=$1 AND is_deleted=FALSE LIMIT 1`,
      [id],
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const r = rows[0];
    res.json({ ...r, tx_types: parseTxTypes(r.tx_types), data: r.data || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/records ─────────────────────────────────────────────────────
async function create(req, res) {
  try {
    const {
      date,
      name,
      customer_id,
      customer_type = "regular",
      aadhar,
      mobile,
      account_no,
      section,
      tx_types,
      data = {},
      remarks,
      sonar_parent_no,
      sonar_sub_no,
      sonar_group_no,
    } = req.body;

    // ── Merge top-level data-entry form fields into data blob ─────────────
    const mergedData = typeof data === "object" ? { ...data } : {};
    for (const field of FORM_FIELDS) {
      if (
        req.body[field] !== undefined &&
        req.body[field] !== null &&
        req.body[field] !== ""
      ) {
        mergedData[field] = req.body[field];
      }
    }
    sanitizePan(mergedData, false); // manual entry (form) — don't silently drop what the user typed

    // BUG FIX: JSON.parse(tx_types) throws synchronously on malformed input —
    // wrap in try/catch so the caller gets a clear 400 instead of a 500.
    let txArr2;
    try {
      txArr2 = Array.isArray(tx_types)
        ? tx_types
        : typeof tx_types === "string"
          ? JSON.parse(tx_types || "[]")
          : [];
    } catch (_) {
      return res
        .status(400)
        .json({ error: "tx_types must be a valid JSON array" });
    }
    const isBankTx = txArr2.some((t) =>
      [
        "RTGS",
        "Bank Charges",
        "Other Bank - Cash Withdrawal",
        "Other Bank - Cash Deposit",
        "TDS",
        "Interest Received on FD from Other Bank",
      ].includes(t),
    );
    if ((!name || !name.trim()) && !isBankTx)
      return res.status(400).json({ error: "Customer name is required" });
    const safeName = name && name.trim() ? name.trim() : "—";
    if (!date) return res.status(400).json({ error: "Date is required" });
    if (!section) return res.status(400).json({ error: "Section is required" });

    // ── Duplicate account-opening guard ──────────────────────────────────
    // Block creating a second Saving Account / Shares Account / New Sadasya /
    // New Naammatr Sabhasad for a customer who already has an active one.
    // See customerHasActiveAccount() above for why this checks each mirror
    // table's own customer_id column rather than records.customer_id.
    //
    // NOTE: tx_types (and therefore this whole INSERT) can bundle several
    // checked task types into ONE record — e.g. "Gold Loan" + "New Sadasya"
    // + "Saving Account" saved together. A violation here rejects the WHOLE
    // record, not just the offending type, so a legitimate bundled Gold Loan
    // is also blocked until the extra box is unchecked. That's intentional:
    // this app has no way to save "everything except one checked type" out
    // of a single combined record, and silently dropping the duplicate type
    // server-side would save something the clerk never actually asked for.
    // app.js's selectCustomer() already warns as soon as the customer is
    // picked — before the rest of the form is filled in — specifically so
    // this rejection is rare in practice.
    const guardedTypesInThisRecord = txArr2.filter((t) => DUPLICATE_ACCOUNT_GUARD[t]);
    if (guardedTypesInThisRecord.length) {
      const guardCustomerDbId = await resolveCustomerId({ customer_id, aadhar, mobile });
      if (guardCustomerDbId) {
        for (const guardedType of guardedTypesInThisRecord) {
          const { kind, label } = DUPLICATE_ACCOUNT_GUARD[guardedType];
          if (await customerHasActiveAccount(guardCustomerDbId, kind)) {
            return res.status(400).json({
              error: `${safeName} already has an active ${label} — uncheck "${guardedType}" and save again.`,
            });
          }
        }
      }
    }

    const txStr = Array.isArray(tx_types)
      ? JSON.stringify(tx_types)
      : tx_types || "[]";

    // BUG FIX: idx_records_unique_saving_acc is a partial unique index on
    // records(account_no) WHERE section='saving'. Only ONE records row can exist
    // per saving account number with section='saving' — the original account-opening
    // record. Deposit/withdrawal transactions must NOT use section='saving' or the
    // INSERT crashes with a duplicate key error.
    // Rule: if tx_types are deposit/withdrawal only (no account-opening type),
    // store as section='general' so the unique index is never hit.
    const SAVING_OPEN_TYPES = new Set([
      "Saving Account",
      "New Sadasya",
      "New Naammatr Sabhasad",
    ]);
    // BUG FIX (caught in testing, before this ever reached production): a
    // "Saving Acc Transfer" record has no natural account-opening tie, same
    // as Deposit/Withdrawal — belongs in this set for the same reason. Without
    // this, EVERY transfer record after the very first one would hit the
    // idx_records_unique_saving_acc collision below and fail outright
    // (confirmed against a real Postgres instance with that exact index: the
    // first transfer insert succeeds, the second throws a duplicate-key
    // error) — the feature would have broken after one use.
    const SAVING_TX_ONLY = new Set([
      "Saving Deposit",
      "Saving Withdrawal",
      "Closing - Saving Account",
      "Saving Acc Transfer",
    ]);
    const isDepositOnlyRecord =
      section === "saving" &&
      txArr2.length > 0 &&
      txArr2.every((t) => SAVING_TX_ONLY.has(t)) &&
      !txArr2.some((t) => SAVING_OPEN_TYPES.has(t));

    // Same class of bug, FD side: idx_records_unique_fd_acc is a partial unique
    // index on records(account_no) WHERE section='fd'. Only ONE records row can
    // exist per FD account number with section='fd' — the original account-opening
    // record. "Closing - FD" reuses the existing FD's account_no, so submitting it
    // with section='fd' collides with that opening row.
    // Rule: if tx_types are FD-closing only (no account-opening type), store as
    // section='general' so the unique index is never hit.
    const FD_OPEN_TYPES = new Set([
      "New FD",
      "New FD - Term",
      "New FD - MIS",
    ]);
    const FD_TX_ONLY = new Set([
      "Closing - FD",
    ]);
    const isFdCloseOnlyRecord =
      section === "fd" &&
      txArr2.length > 0 &&
      txArr2.every((t) => FD_TX_ONLY.has(t)) &&
      !txArr2.some((t) => FD_OPEN_TYPES.has(t));

    const effectiveSection = isDepositOnlyRecord || isFdCloseOnlyRecord ? "general" : section;

    const { rows } = await pool.query(
      `INSERT INTO records
         (date, name, customer_id, customer_type, aadhar, mobile, account_no,
          section, tx_types, data, remarks, sonar_parent_no, sonar_sub_no, sonar_group_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        date,
        safeName,
        customer_id || null,
        customer_type,
        aadhar || "",
        mobile || "",
        // BUG FIX (schema drift): records.account_no is NOT NULL DEFAULT ''
        // on the live database (never captured in migrations.js until
        // v15) — inserting NULL here 500'd every create() call for a
        // record with no account number (most transaction types: cash
        // entries, deposits/withdrawals, bank transactions, etc.).
        account_no || "",
        effectiveSection,
        txStr,
        typeof mergedData === "object"
          ? JSON.stringify(mergedData)
          : mergedData || "{}",
        remarks || "",
        sonar_parent_no || null,
        sonar_sub_no || null,
        sonar_group_no || null,
      ],
    );

    const id = rows[0].id;

    // Upsert into customers table
    if (name) {
      await upsertCustomer({
        customer_id,
        name,
        aadhar,
        mobile,
        data: mergedData,
      });
    }

    res.status(201).json({ id, ok: true });
  } catch (err) {
    console.error("[create record]", err.message, err.stack);
    if (err.code === "23505") {
      // Unique constraint violation — give a human-readable message
      const constraint = err.constraint || "";
      let msg = "A record with this account number already exists.";
      if (constraint.includes("fd_acc"))
        msg = `An FD account with account number "${req.body.account_no}" already exists. Use a different account number.`;
      if (constraint.includes("saving_acc"))
        msg = `A Saving account with account number "${req.body.account_no}" already exists. Use a different account number.`;
      if (constraint.includes("gold_acc"))
        msg = `A Gold Loan with account number "${req.body.account_no}" already exists. Use a different account number.`;
      if (constraint.includes("od_acc"))
        msg = `An OD Loan with account number "${req.body.account_no}" already exists. Use a different account number.`;
      if (constraint.includes("customer_id"))
        msg = `Customer ID "${req.body.customer_id}" is already registered.`;
      return res.status(409).json({ error: msg, constraint });
    }
    res.status(500).json({ error: err.message });
  }
}

// ── PUT /api/records/:id ──────────────────────────────────────────────────
async function update(req, res) {
  try {
    // BUG FIX: validate id is a positive integer before hitting DB
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1)
      return res.status(400).json({ error: "Invalid record id" });
    const {
      date,
      name,
      customer_id,
      customer_type,
      aadhar,
      mobile,
      account_no,
      section,
      tx_types,
      data,
      remarks,
      sonar_parent_no,
      sonar_sub_no,
      sonar_group_no, // Fix #8: include sonar fields
    } = req.body;

    // ── Merge top-level data-entry form fields into data blob ─────────────
    const mergedData =
      typeof data === "object" ? { ...data } : data ? JSON.parse(data) : {};
    for (const field of FORM_FIELDS) {
      if (
        req.body[field] !== undefined &&
        req.body[field] !== null &&
        req.body[field] !== ""
      ) {
        mergedData[field] = req.body[field];
      }
    }
    sanitizePan(mergedData, false); // manual entry (form) — don't silently drop what the user typed

    const txStr = Array.isArray(tx_types)
      ? JSON.stringify(tx_types)
      : tx_types || "[]";

    // Fix #4: AND is_deleted=FALSE so soft-deleted records can't be silently updated
    const result = await pool.query(
      `UPDATE records SET
         date=$1, name=$2, customer_id=$3, customer_type=$4, aadhar=$5, mobile=$6,
         account_no=$7, section=$8, tx_types=$9, data=$10, remarks=$11,
         sonar_parent_no=$12, sonar_sub_no=$13, sonar_group_no=$14,
         updated_at=NOW()
       WHERE id=$15 AND is_deleted=FALSE`,
      [
        date,
        name,
        customer_id || null,
        customer_type || "regular",
        aadhar || "",
        mobile || "",
        // BUG FIX (schema drift): same NOT NULL constraint as create() above.
        account_no || "",
        section,
        txStr,
        typeof mergedData === "object"
          ? JSON.stringify(mergedData)
          : mergedData || "{}",
        remarks || "",
        sonar_parent_no || null,
        sonar_sub_no || null,
        sonar_group_no || null,
        id,
      ],
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "Record not found or already deleted" });
    }

    // BUG FIX ("editing a transaction's date doesn't move the Transaction
    // Ledger row"): this endpoint updated records.date above but never
    // touched cashbook_entries — the table the ledger (cashbook.controller.js
    // list()) actually reads and filters by date. So changing a record's
    // date here left every cashbook_entries row generated from it (via
    // record_id) stuck on the OLD date: it kept showing on the old date's
    // ledger and never appeared on the new one. softDelete()/restore() above
    // already cascade WHERE record_id=$1 to cashbook_entries for is_deleted —
    // this is the same pattern applied to date.
    if (date) {
      await pool
        .query(`UPDATE cashbook_entries SET date=$1, updated_at=NOW() WHERE record_id=$2`, [
          date,
          id,
        ])
        .catch(() => {});
    }

    if (name)
      await upsertCustomer({
        customer_id,
        name,
        aadhar,
        mobile,
        data: mergedData || {},
      });

    // Sync name/aadhar/mobile into derived tables so they never show stale data
    if (name || aadhar || mobile) {
      const fields = [];
      const dvals = [];
      let dpi = 1;
      if (name) {
        fields.push(`customer_name=$${dpi++}`);
        dvals.push(name);
      }
      if (aadhar) {
        fields.push(`aadhar=$${dpi++}`);
        dvals.push(aadhar);
      }
      if (mobile) {
        fields.push(`mobile=$${dpi++}`);
        dvals.push(mobile);
      }
      dvals.push(id);
      const setClause = fields.join(", ");
      await Promise.all([
        pool.query(
          `UPDATE gold_loans    SET ${setClause} WHERE record_id=$${dpi}`,
          dvals,
        ),
        pool.query(
          `UPDATE saving_accounts SET ${setClause} WHERE record_id=$${dpi}`,
          dvals,
        ),
        pool.query(
          `UPDATE fd_accounts   SET ${setClause} WHERE record_id=$${dpi}`,
          dvals,
        ),
        pool.query(
          `UPDATE od_loans      SET ${setClause} WHERE record_id=$${dpi}`,
          dvals,
        ),
        pool.query(
          `UPDATE memberships   SET ${setClause} WHERE record_id=$${dpi}`,
          dvals,
        ),
      ]).catch(() => {}); // non-fatal — main record is already saved
    }

    // FIX 2 (CRITICAL): Sync loan_amount / fd_amount into derived tables on update.
    // Previously only name/aadhar/mobile were synced — amounts stayed stale.
    if (
      mergedData.loan_amount !== undefined ||
      mergedData.fd_amount !== undefined
    ) {
      try {
        const amountFields = [];
        const avals = [];
        let api = 1;
        if (mergedData.loan_amount !== undefined) {
          amountFields.push(`loan_amount=$${api++}`);
          avals.push(validateAmount(mergedData.loan_amount, "loan_amount"));
        }
        if (mergedData.fd_amount !== undefined) {
          amountFields.push(`fd_amount=$${api++}`);
          avals.push(validateAmount(mergedData.fd_amount, "fd_amount"));
        }
        avals.push(id);
        const amtClause = amountFields.join(", ");
        await Promise.all([
          pool.query(
            `UPDATE gold_loans  SET ${amtClause} WHERE record_id=$${api}`,
            avals,
          ),
          pool.query(
            `UPDATE od_loans    SET ${amtClause} WHERE record_id=$${api}`,
            avals,
          ),
          pool.query(
            `UPDATE fd_accounts SET ${amtClause} WHERE record_id=$${api}`,
            avals,
          ),
        ]).catch(() => {});
      } catch (amtErr) {
        // validateAmount threw — return 400 so user knows the value is bad
        return res.status(400).json({ error: amtErr.message });
      }
    }

    // FIX 4 (HIGH): Sync loan_acc_no / account_no into derived tables on update.
    // Previously these could drift, causing lookups to use different values.
    if (account_no || mergedData.loan_acc_no) {
      const newAccNo = account_no || mergedData.loan_acc_no;
      await pool
        .query(
          `UPDATE gold_loans SET loan_acc_no=$1, acc_no=$1 WHERE record_id=$2`,
          [newAccNo, id],
        )
        .catch(() => {});
      await pool
        .query(`UPDATE od_loans SET loan_acc_no=$1 WHERE record_id=$2`, [
          newAccNo,
          id,
        ])
        .catch(() => {});
    }

    // FIX 7 (MEDIUM): Sync fd_acc_no into fd_accounts on update.
    if (mergedData.fd_acc_no) {
      if (!isValidFdAccNo(mergedData.fd_acc_no)) {
        return res
          .status(400)
          .json({
            error: `Invalid fd_acc_no format "${mergedData.fd_acc_no}" — must be exactly 14 numeric digits`,
          });
      }
      await pool
        .query(
          `UPDATE fd_accounts SET fd_acc_no=$1, acc_code=$1 WHERE record_id=$2`,
          [mergedData.fd_acc_no, id],
        )
        .catch(() => {});
    }

    // FIX 11: Sync mis_acc_no into fd_accounts on update — same drift bug as
    // FIX 7 above but for MIS FDs. Previously nothing kept fd_accounts.mis_acc_no
    // in sync after the initial insert, so editing it via this endpoint left
    // the fd_accounts row stale (same class of bug as the OD acc_no drift).
    if (mergedData.mis_acc_no) {
      if (!isValidFdAccNo(mergedData.mis_acc_no)) {
        return res
          .status(400)
          .json({
            error: `Invalid mis_acc_no format "${mergedData.mis_acc_no}" — must be exactly 14 numeric digits`,
          });
      }
      await pool
        .query(`UPDATE fd_accounts SET mis_acc_no=$1 WHERE record_id=$2`, [
          mergedData.mis_acc_no,
          id,
        ])
        .catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── DELETE /api/records/:id (soft delete) ────────────────────────────────
async function softDelete(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1)
    return res.status(400).json({ error: "Invalid record id" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const recResult = await client.query(
      `UPDATE records SET is_deleted=TRUE, deleted_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND is_deleted=FALSE`,
      [id],
    );
    if (recResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "Record not found or already deleted" });
    }
    // Also soft-delete all cashbook ledger rows for this record
    const cbResult = await client.query(
      `UPDATE cashbook_entries
       SET is_deleted=TRUE, deleted_at=NOW(), updated_at=NOW()
       WHERE record_id=$1 AND is_deleted=FALSE`,
      [id],
    );
    await client.query("COMMIT");
    res.json({ ok: true, cashbookRowsDeleted: cbResult.rowCount });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// ── PATCH /api/records/:id/soft-delete ───────────────────────────────────
async function softDeletePatch(req, res) {
  return softDelete(req, res);
}

// ── PATCH /api/records/:id/restore ────────────────────────────────────────
async function restore(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1)
    return res.status(400).json({ error: "Invalid record id" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const recResult = await client.query(
      `UPDATE records SET is_deleted=FALSE, deleted_at=NULL, updated_at=NOW()
       WHERE id=$1 AND is_deleted=TRUE`,
      [id],
    );
    if (recResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Record not found or not deleted" });
    }
    // Also restore all cashbook ledger rows for this record
    const cbResult = await client.query(
      `UPDATE cashbook_entries
       SET is_deleted=FALSE, deleted_at=NULL, updated_at=NOW()
       WHERE record_id=$1 AND is_deleted=TRUE`,
      [id],
    );
    await client.query("COMMIT");
    res.json({ ok: true, cashbookRowsRestored: cbResult.rowCount });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// ── DELETE /api/records/:id/permanent ────────────────────────────────────
async function permanentDelete(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1)
    return res.status(400).json({ error: "Invalid record id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Check existence and soft-delete status INSIDE the transaction (no race window)
    const checkRow = await client.query(
      `SELECT id, is_deleted FROM records WHERE id=$1 LIMIT 1 FOR UPDATE`,
      [id],
    );
    if (!checkRow.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Record not found" });
    }
    if (!checkRow.rows[0].is_deleted) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({
          error: "Record must be soft-deleted first before permanent deletion",
        });
    }
    // Delete cashbook entries first (FK safety)
    const cbResult = await client.query(
      `DELETE FROM cashbook_entries WHERE record_id=$1`,
      [id],
    );
    // Delete the record
    await client.query(`DELETE FROM records WHERE id=$1`, [id]);
    await client.query("COMMIT");
    res.json({ ok: true, cashbookRowsDeleted: cbResult.rowCount });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// ── PATCH /api/records/:id/close ─────────────────────────────────────────
// Mirror tables (gold_loans, fd_accounts, od_loans, saving_accounts,
// memberships, share_accounts) hold a denormalized, read-optimized copy of
// a record's open/closed status. records.status is the single source of
// truth; these are not. Sync them here as a best-effort step: any one
// table's failure (a schema mismatch, a missing column — this is exactly
// how the share_accounts/record_id bug behaved) is logged and reported
// back to the caller, but must never block or roll back the caller's
// source-of-truth write. See the long comment on close()/reopen() below for
// why this used to be wrapped in one all-or-nothing transaction with the
// core update, and why that was the wrong tradeoff.
async function syncMirrorTablesOnStatusChange(id, accountNo, { status, closedDate }) {
  const errors = [];
  const tryUpdate = async (table, sql, params) => {
    try {
      await pool.query(sql, params);
    } catch (err) {
      console.error(`[mirror-sync] ${table} failed for record ${id}:`, err.message);
      errors.push({ table, error: err.message });
    }
  };
  if (status === "closed") {
    await tryUpdate("gold_loans", `UPDATE gold_loans SET status='closed', closed_date=$1 WHERE record_id=$2`, [closedDate, id]);
    await tryUpdate("fd_accounts", `UPDATE fd_accounts SET status='closed', closed_date=$1 WHERE record_id=$2`, [closedDate, id]);
    await tryUpdate("od_loans", `UPDATE od_loans SET status='closed', closed_date=$1 WHERE record_id=$2`, [closedDate, id]);
    await tryUpdate("saving_accounts", `UPDATE saving_accounts SET status='closed', closed_date=$1 WHERE record_id=$2`, [closedDate, id]);
    await tryUpdate("memberships", `UPDATE memberships SET status='closed', close_date=$1 WHERE record_id=$2`, [closedDate, id]);
    // share_accounts has no record_id column — it links via acc_no/acc_code —
    // so only touch it when this record actually has an account_no to match on.
    if (accountNo) {
      await tryUpdate("share_accounts", `UPDATE share_accounts SET status='closed', close_date=$1 WHERE acc_no=$2`, [closedDate, accountNo]);
    }
  } else {
    await tryUpdate("gold_loans", `UPDATE gold_loans SET status='active', closed_date=NULL WHERE record_id=$1`, [id]);
    await tryUpdate("fd_accounts", `UPDATE fd_accounts SET status='active', closed_date=NULL WHERE record_id=$1`, [id]);
    await tryUpdate("od_loans", `UPDATE od_loans SET status='active', closed_date=NULL WHERE record_id=$1`, [id]);
    await tryUpdate("saving_accounts", `UPDATE saving_accounts SET status='active', closed_date=NULL WHERE record_id=$1`, [id]);
    await tryUpdate("memberships", `UPDATE memberships SET status='active', close_date=NULL WHERE record_id=$1`, [id]);
    if (accountNo) {
      await tryUpdate("share_accounts", `UPDATE share_accounts SET status='active', close_date=NULL WHERE acc_no=$1`, [accountNo]);
    }
  }
  return errors;
}

async function close(req, res) {
  // ARCHITECTURE NOTE (Sept 2026): this used to run the core records.status
  // update together with 6 mirror-table updates inside one BEGIN/COMMIT —
  // meaning a bug or schema drift in ANY single mirror table (this exact
  // thing happened with share_accounts' missing record_id column) silently
  // rolled back the ENTIRE close, including the core status change, for
  // every account type, with staff seeing nothing but a generic toast.
  // records.status is the single source of truth for whether a loan/account
  // is closed; the mirror tables are denormalized read-optimizations of it.
  // A failure updating a read-optimization must never block the
  // source-of-truth write, so the core update below now runs and succeeds
  // on its own, and mirror-table syncing happens afterward via
  // syncMirrorTablesOnStatusChange(), whose per-table failures are logged
  // and surfaced in the response but never roll back the close.
  try {
    // BUG FIX: validate id is a positive integer before hitting DB
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1)
      return res.status(400).json({ error: "Invalid record id" });

    // Accept both tx_types_to_close (frontend) and close_types (legacy) for compatibility
    const { closed_date, closed_remarks, tx_types_to_close, close_types } =
      req.body;
    const typesToClose = tx_types_to_close || close_types || null;

    const { rows: recRows } = await pool.query(
      `SELECT tx_types, closed_tx_types, account_no
       FROM records WHERE id=$1 AND is_deleted=FALSE LIMIT 1`,
      [id],
    );
    if (!recRows.length)
      return res.status(404).json({ error: "Record not found" });

    const rec = recRows[0];
    const allTxTypes = parseTxTypes(rec.tx_types);
    const prevClosed = parseTxTypes(rec.closed_tx_types);
    const closingNow = typesToClose
      ? Array.isArray(typesToClose)
        ? typesToClose
        : parseTxTypes(typesToClose)
      : allTxTypes;
    const nowClosedSet = new Set([...prevClosed, ...closingNow]);

    // BUG FIX: .every() on an empty array returns true (vacuous truth).
    // Guard with allTxTypes.length > 0 so a record with no tx_types is
    // never automatically marked closed.
    const allClosed =
      allTxTypes.length > 0 && allTxTypes.every((t) => nowClosedSet.has(t));

    // FIX: if closing tx_types include all primary loan types, force allClosed=true
    // even if record has extra tx_types that weren't tracked properly
    const GOLD_CLOSE_TYPES = new Set([
      "Gold Loan",
      "Slips - Loan",
      "Closing - Loan",
    ]);
    const OD_CLOSE_TYPES = new Set([
      "New FD-OD Loan",
      "OD Loan",
      "Closing - OD",
    ]);
    const FD_CLOSE_TYPES = new Set([
      "Fixed Deposit",
      "Fixed Deposit - MIS",
      "New FD",
      "New FD - Term",
      "New FD - MIS",
      "FD - Slips",
      "FD - Slips - MIS",
    ]);

    const closingNowSet = new Set(closingNow);
    const forceClose =
      [...GOLD_CLOSE_TYPES].every((t) => closingNowSet.has(t)) ||
      [...OD_CLOSE_TYPES].every((t) => closingNowSet.has(t)) ||
      [...FD_CLOSE_TYPES].every((t) => closingNowSet.has(t));

    const effectiveClosed = allClosed || forceClose;

    const mergedClosedTxStr = JSON.stringify([...nowClosedSet]);
    const effectiveClosedDate = closed_date || getTodayStr();
    // Warn if closed_date is in the future (likely a data entry error)
    if (effectiveClosedDate > getTodayStr()) {
      console.warn(
        `[close] record ${id}: closed_date ${effectiveClosedDate} is in the future`,
      );
    }

    const closeResult = await pool.query(
      `UPDATE records SET
         status=$1, closed_date=$2, closed_remarks=$3, closed_tx_types=$4, updated_at=NOW()
       WHERE id=$5 AND is_deleted=FALSE`,
      [
        effectiveClosed ? "closed" : "active",
        effectiveClosedDate,
        closed_remarks || "",
        mergedClosedTxStr,
        id,
      ],
    );
    if (closeResult.rowCount === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    let mirrorSyncErrors = [];
    if (effectiveClosed) {
      mirrorSyncErrors = await syncMirrorTablesOnStatusChange(id, rec.account_no, {
        status: "closed",
        closedDate: effectiveClosedDate,
      });
    }

    res.json({
      ok: true,
      allClosed: effectiveClosed,
      ...(mirrorSyncErrors.length && { mirrorSyncErrors }),
    });
  } catch (err) {
    console.error("[close]", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── PATCH /api/records/:id/reopen ─────────────────────────────────────────
async function reopen(req, res) {
  // ARCHITECTURE NOTE: same decoupling as close() above — the core
  // records.status reset commits on its own; mirror-table resets are a
  // best-effort follow-up via syncMirrorTablesOnStatusChange() so a failure
  // in one mirror table can never roll back the reopen itself.
  try {
    // BUG FIX: validate id is a positive integer
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1)
      return res.status(400).json({ error: "Invalid record id" });

    // BUG FIX: closed_tx_types was not cleared on reopen — if you closed then
    // reopened and closed again, the old closed_tx_types merged in via prevClosed,
    // making types appear already closed even on the fresh close.
    const reopenResult = await pool.query(
      `UPDATE records
       SET status='active', closed_date=NULL, closed_remarks=NULL,
           closed_tx_types=NULL, updated_at=NOW()
       WHERE id=$1 AND is_deleted=FALSE
       RETURNING account_no`,
      [id],
    );
    if (reopenResult.rowCount === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    const reopenedAccountNo = reopenResult.rows[0].account_no;

    const mirrorSyncErrors = await syncMirrorTablesOnStatusChange(id, reopenedAccountNo, {
      status: "active",
    });

    res.json({ ok: true, ...(mirrorSyncErrors.length && { mirrorSyncErrors }) });
  } catch (err) {
    console.error("[reopen]", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/records/import/bulk ────────────────────────────────────────
async function importBulk(req, res) {
  // BUG FIX: validate BEFORE acquiring a DB connection — the original code
  // called pool.connect() first, then returned early on bad input without
  // calling client.release(), leaking a connection on every bad request.
  const { records } = req.body;
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: "No records provided" });
  }

  // Fix #7: wrap in a transaction so a partial failure rolls back everything
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const rec of records) {
      try {
        const section = rec.section || "general";
        const txStr = Array.isArray(rec.tx_types)
          ? JSON.stringify(rec.tx_types)
          : rec.tx_types || "[]";
        const recData =
          typeof rec.data === "object"
            ? rec.data
            : JSON.parse(rec.data || "{}");

        // FIX (CRITICAL — duplicate/lost-data prevention): re-importing a ledger
        // for an account that already exists used to either (a) crash on the
        // idx_records_unique_*_acc partial unique index and roll back the whole
        // 50-record chunk it was in (including otherwise-valid new records), or
        // (b) if no such index applied, silently create a second row for the
        // same account. Now: look up the existing, non-deleted records row for
        // this section+account_no first (mirroring the exact WHERE clause of
        // the unique indexes — see migrations.js idx_records_unique_gold_acc
        // etc.) and UPDATE it in place when found, instead of inserting a new
        // one. This is what lets the downstream gold_loans/saving_accounts
        // "ON CONFLICT (record_id) DO UPDATE ... COALESCE(...)" preservation
        // logic (already written, but previously unreachable in this code
        // path since record_id was always freshly minted) actually engage.
        let importAccNo = rec.account_no || null;
        if (section === "gold") importAccNo = recData.loan_acc_no || importAccNo;
        else if (section === "saving") importAccNo = recData.saving_acc_no || importAccNo;
        else if (section === "fd") importAccNo = recData.fd_acc_no || importAccNo;

        let record_id = null;
        if (importAccNo) {
          const { rows: existingRows } = await client.query(
            `SELECT id FROM records
               WHERE section = $1 AND account_no = $2 AND is_deleted = FALSE
                 AND ($1 <> 'gold' OR sonar_sub_no IS NULL)
               LIMIT 1`,
            [section, importAccNo],
          );
          if (existingRows.length) record_id = existingRows[0].id;
        }
        const isUpdate = record_id !== null;
        sanitizePan(recData);
        const cleanData = stripBlank(recData);

        if (isUpdate) {
          // Update only the fields this import actually supplies (via
          // COALESCE/NULLIF); everything the import doesn't mention — nominee
          // details, photos, ornament info, or any other enriched field
          // already on file — is left completely untouched.
          await client.query(
            `UPDATE records SET
               date        = COALESCE($1, date),
               name        = COALESCE(NULLIF($2, ''), name),
               customer_id = COALESCE(NULLIF($3, ''), customer_id),
               aadhar      = COALESCE(NULLIF($4, ''), aadhar),
               mobile      = COALESCE(NULLIF($5, ''), mobile),
               tx_types    = COALESCE(NULLIF($6, '[]'), tx_types),
               data        = data || $7::jsonb,
               remarks     = COALESCE(NULLIF($8, ''), remarks)
             WHERE id = $9`,
            [
              rec.date || null,
              rec.name || "",
              rec.customer_id || "",
              rec.aadhar || "",
              rec.mobile || "",
              txStr,
              JSON.stringify(cleanData),
              rec.remarks || "",
              record_id,
            ],
          );
        } else {
          const { rows } = await client.query(
            `INSERT INTO records (date, name, customer_id, customer_type, aadhar, mobile, account_no, section, tx_types, data, remarks)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [
              rec.date || null,
              rec.name || null,
              rec.customer_id || null,
              rec.customer_type || "regular",
              rec.aadhar || "",
              rec.mobile || "",
              rec.account_no || null,
              section,
              txStr,
              JSON.stringify(recData),
              rec.remarks || "",
            ],
          );
          record_id = rows[0].id;
        }

        // BUG FIX: importBulk previously only inserted into records — it never
        // wrote to saving_accounts. So balance, pan_no, interest_rate, cust_code,
        // and start_date were all missing / zero for every bulk-imported saving
        // account. Now we upsert into saving_accounts for saving section records.
        if (section === "saving") {
          const savingAccNo = recData.saving_acc_no || rec.account_no || null;
          if (savingAccNo) {
            await client.query(
              `INSERT INTO saving_accounts
                 (record_id, acc_no, saving_acc_no, acc_code, customer_name,
                  aadhar, mobile, balance, pan_no, interest_rate, cust_code, start_date, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')
               ON CONFLICT (record_id) DO UPDATE SET
                 acc_no        = EXCLUDED.acc_no,
                 saving_acc_no = EXCLUDED.saving_acc_no,
                 acc_code      = EXCLUDED.acc_code,
                 customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), saving_accounts.customer_name),
                 aadhar        = COALESCE(EXCLUDED.aadhar, saving_accounts.aadhar),
                 mobile        = COALESCE(EXCLUDED.mobile, saving_accounts.mobile),
                 balance       = EXCLUDED.balance,
                 pan_no        = COALESCE(EXCLUDED.pan_no, saving_accounts.pan_no),
                 interest_rate = COALESCE(EXCLUDED.interest_rate, saving_accounts.interest_rate),
                 cust_code     = COALESCE(EXCLUDED.cust_code, saving_accounts.cust_code),
                 start_date    = COALESCE(EXCLUDED.start_date, saving_accounts.start_date),
                 updated_at    = NOW()`,
              [
                record_id,
                savingAccNo,
                savingAccNo,
                savingAccNo,
                rec.name || recData.customer_name || null,
                rec.aadhar || recData.aadhar || null,
                rec.mobile || recData.mobile || null,
                parseFloat(recData.saving_balance || recData.balance || 0),
                recData.pan || recData.pan_no || null,
                parseFloat(recData.interest_rate) || null,
                recData.cust_code || rec.customer_id || null,
                recData.start_date || rec.date || null,
              ],
            );
          }
        }

        // FIX 1 (CRITICAL): importBulk only inserted saving_accounts — gold loan records
        // were written to records but never to gold_loans, creating orphaned records.
        // Now upsert into gold_loans for every gold-section import.
        if (section === "gold") {
          const goldAccNo = recData.loan_acc_no || rec.account_no || null;
          if (goldAccNo) {
            // BUG FIX: this upsert never resolved/wrote customer_id (the integer
            // FK to customers.id), same systemic gap as processTransaction.
            // Resolve it here too. Note: for a customer appearing for the first
            // time in this same import batch, upsertCustomer() below hasn't run
            // yet, so this may still resolve to null on the first pass — the
            // COALESCE on conflict means a later re-sync (e.g. Full Reload) will
            // backfill it without disturbing anything else.
            const goldCustomerId = await resolveCustomerId({
              customer_id: rec.customer_id || null,
              aadhar: rec.aadhar || recData.aadhar || null,
              mobile: rec.mobile || recData.mobile || null,
            });
            // FIX (ledger-import alignment): interest_rate/loan_end_date/closed_date
            // are real gold_loans columns the old import path never wrote at all —
            // there was no IMP_FIELDS mapping slot for them, so an imported ledger's
            // Int. Rate / End Date / Close Date columns were silently dropped.
            // A non-blank closed_date means the ledger shows this loan as settled —
            // derive status from it, but only ever move active→closed here, never
            // closed→active, and never touch status when the import doesn't supply
            // a close date (COALESCE keeps whatever the app already has on file).
            const goldInterestRate = validateAmount(recData.interest_rate, "interest_rate");
            const goldEndDate = recData.loan_end_date || null;
            const goldClosedDate = recData.closed_date || null;
            await client.query(
              `INSERT INTO gold_loans
                (record_id, loan_acc_no, acc_no, customer_name, aadhar, mobile,
                 loan_amount, loan_date, status, customer_id,
                 interest_rate, loan_end_date, closed_date)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
               ON CONFLICT (record_id) DO UPDATE SET
                 loan_acc_no   = EXCLUDED.loan_acc_no,
                 acc_no        = EXCLUDED.acc_no,
                 customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), gold_loans.customer_name),
                 aadhar        = COALESCE(EXCLUDED.aadhar, gold_loans.aadhar),
                 mobile        = COALESCE(EXCLUDED.mobile, gold_loans.mobile),
                 loan_amount   = COALESCE(EXCLUDED.loan_amount, gold_loans.loan_amount),
                 loan_date     = COALESCE(EXCLUDED.loan_date, gold_loans.loan_date),
                 customer_id   = COALESCE(EXCLUDED.customer_id, gold_loans.customer_id),
                 interest_rate = COALESCE(EXCLUDED.interest_rate, gold_loans.interest_rate),
                 loan_end_date = COALESCE(EXCLUDED.loan_end_date, gold_loans.loan_end_date),
                 closed_date   = COALESCE(EXCLUDED.closed_date, gold_loans.closed_date),
                 status        = CASE WHEN EXCLUDED.closed_date IS NOT NULL THEN 'closed' ELSE gold_loans.status END,
                 updated_at    = NOW()`,
              [
                record_id,
                goldAccNo,
                goldAccNo,
                rec.name || recData.customer_name || null,
                rec.aadhar || recData.aadhar || null,
                rec.mobile || recData.mobile || null,
                validateAmount(recData.loan_amount, "loan_amount"),
                recData.loan_date || rec.date || null,
                goldClosedDate ? "closed" : "active",
                goldCustomerId,
                goldInterestRate,
                goldEndDate,
                goldClosedDate,
              ],
            );
          }
        }

        results.push({ ok: true, id: record_id, action: isUpdate ? "updated" : "inserted" });

        // FIX: importBulk never called upsertCustomer, so bulk-imported records
        // (PDF imports, historical data) were written to records but never reached
        // the customers table — causing the 625-person gap between the sidebar
        // count (from records) and the Customers page count (from customers table).
        // upsertCustomer uses pool (not client) intentionally so a customer upsert
        // warning never rolls back the entire bulk import.
        //
        // FIX 2: For PDF-imported records, rec.aadhar / rec.mobile are often ''
        // because the importer only copies top-level columns from the parsed row.
        // The real values live in recData (the JSONB blob). Fall back to recData
        // so customers table gets aadhar, mobile, PAN, DOB from PDF imports too.
        const importAadhar = rec.aadhar || recData.aadhar || null;
        const importMobile = rec.mobile || recData.mobile || null;
        if (rec.name && (rec.customer_id || importAadhar || importMobile)) {
          await upsertCustomer({
            customer_id: rec.customer_id || null,
            name: rec.name,
            aadhar: importAadhar,
            mobile: importMobile,
            data: recData, // recData already carries pan, dob, address, etc.
          }).catch((e) =>
            console.warn("[importBulk] upsertCustomer warn:", e.message),
          );
        }
      } catch (e) {
        // BUG FIX: ROLLBACK without .catch() — if the rollback itself fails
        // it throws an unhandled rejection and client.release() in finally is
        // never reached, leaking a pool connection permanently.
        await client.query("ROLLBACK").catch(() => {});
        return res.status(400).json({
          error: `Import failed on record ${results.length + 1}: ${e.message}`,
          failedAt: results.length,
          results,
        });
      }
    }
    await client.query("COMMIT");
    res.json({
      results,
      count: results.filter((r) => r.ok).length,
      inserted: results.filter((r) => r.action === "inserted").length,
      updated: results.filter((r) => r.action === "updated").length,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// ── POST /api/records/process-transaction ────────────────────────────────
// Updates derived tables: gold_loans, fd_accounts, saving_accounts, od_loans, memberships
//
// FIX #6 — FIELD NAMING RULE (saving balance):
//   records.data JSONB  →  key is "saving_balance"
//   saving_accounts     →  column is "balance"
//   API response        →  exposed as "balance" (via COALESCE in SELECT queries)
//
// Never read data.saving_balance on the frontend — always use the API response
// field "balance". Reading the JSONB key directly returns undefined whenever
// the saving_accounts row exists (the authoritative value lives in the table).
async function processTransaction(req, res) {
  // BUG FIX: record_id came straight from req.body with no validation.
  // A non-numeric or missing value silently became NaN/undefined and was
  // inserted as NULL into every derived-table upsert, creating orphaned rows.
  const rawRecordId = req.body.record_id;
  const record_id = rawRecordId != null ? parseInt(rawRecordId, 10) : null;
  if (rawRecordId != null && (!record_id || record_id < 1)) {
    return res
      .status(400)
      .json({
        ok: false,
        error: "Invalid record_id — must be a positive integer",
      });
  }
  const { tx_types, data = {}, customer_name } = req.body;
  const txArr = Array.isArray(tx_types) ? tx_types : [];
  const results = [];
  const errors = [];

  // BUG FIX (systemic): every derived-table upsert below previously omitted
  // customer_id entirely, so gold_loans/fd_accounts/od_loans/saving_accounts/
  // memberships rows were created with customer_id=NULL on every normal form
  // save — breaking customer-list aggregation, profile lookups, and anything
  // else that joins on this FK. Resolve it once here (same data/aadhar/mobile
  // for the whole request) and pass it into each upsert below.
  const resolvedCustomerId = await resolveCustomerId(data);

  const upsert = async (table, conflictCol, vals, cols) => {
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const updates = cols
      .filter((c) => c !== conflictCol)
      .map((c) =>
        // customer_id is resolved via lookup and may legitimately come back
        // null on a later edit (e.g. payload missing aadhar/mobile that time);
        // COALESCE so a miss never overwrites an already-correct FK.
        c === "customer_id"
          ? `customer_id=COALESCE(EXCLUDED.customer_id, ${table}.customer_id)`
          : `${c}=EXCLUDED.${c}`,
      )
      .join(", ");
    await pool.query(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})
       ON CONFLICT (${conflictCol}) DO UPDATE SET ${updates}, updated_at=NOW()`,
      vals,
    );
  };

  try {
    // Fix #10: each operation is individually guarded so one failure doesn't
    // skip all subsequent operations. All errors are collected in errors[].

    // Gold Loan open
    if (txArr.includes("Gold Loan") && !txArr.includes("New FD-OD Loan")) {
      if (record_id && data.loan_acc_no) {
       if (!isValidLoanAccNo(data.loan_acc_no)) {
        // BUG FIX: gold_loans.loan_acc_no was never format-validated before —
        // a truncated/malformed value could be saved unchecked. Accepts both
        // the 14-digit format and the legacy "NN-NNN" dash format (both are
        // genuinely valid for gold loans, unlike OD).
        errors.push(
          `gold_loans: invalid loan_acc_no format "${data.loan_acc_no}" — must be either 14 numeric digits (e.g. "00104003000012") or the legacy "NN-NNN" dash format (e.g. "03-001").`,
        );
       } else {
        try {
          // Fix (Bug 2): include acc_no in every upsert so it never drifts from
          // loan_acc_no. Both columns carry the same value; acc_no exists for
          // backwards compatibility with older DB schemas.
          const ornamentItems = (() => {
            try {
              const v =
                typeof data.ornament_items === "string"
                  ? JSON.parse(data.ornament_items)
                  : data.ornament_items;
              return JSON.stringify(Array.isArray(v) ? v : v ? [v] : []);
            } catch {
              return "[]";
            }
          })();
          await upsert(
            "gold_loans",
            "record_id",
            [
              record_id,
              data.loan_acc_no,
              data.loan_acc_no, // loan_acc_no AND acc_no kept in sync
              customer_name || data.customer_name,
              data.aadhar || null,
              data.mobile || null,
              validateAmount(data.loan_amount, "loan_amount"),
              data.date || null,
              data.metal_type || null,
              ornamentItems,
              "active",
              // ── data entry form fields ──────────────────────────────────
              data.ornament_weight || null,
              data.silver_ornaments || null,
              data.gold_ornaments || null,
              data.transaction_type || null,
              data.address || null,
              data.photo_customer || data.customer_photo_url || null,
              data.photo_ornament || null,
              data.photo_aadhar_front || null,
              data.photo_aadhar_back || null,
              data.photo_pan || null,
              validateAmount(data.interest_rate || data.loan_interest_rate, "interest_rate"),
              data.loan_end_date || null,
              // nominee
              data.nominee || null,
              data.nominee_name || null,
              data.nominee_relation || null,
              resolvedCustomerId,
            ],
            [
              "record_id",
              "loan_acc_no",
              "acc_no",
              "customer_name",
              "aadhar",
              "mobile",
              "loan_amount",
              "loan_date",
              "metal_type",
              "ornament_items",
              "status",
              "ornament_weight",
              "silver_ornaments",
              "gold_ornaments",
              "transaction_type",
              "address",
              "customer_photo_url",
              "photo_ornament",
              "photo_aadhar_front",
              "photo_aadhar_back",
              "photo_pan",
              "interest_rate",
              "loan_end_date",
              "nominee",
              "nominee_name",
              "nominee_relation",
              "customer_id",
            ],
          );
          results.push("gold_loans upserted");
        } catch (e) {
          errors.push(`gold_loans: ${e.message}`);
        }
       }
      }
    }

    // Gold Loan close: look up by record_id first, then fall back to loan_acc_no.
    // Closing forms are saved as NEW records so gold_loans.record_id points to
    // the ORIGINAL Gold Loan record, not the closing form's record_id.
    if (txArr.includes("Closing - Loan")) {
      try {
        let glRows = [];
        if (record_id) {
          const { rows } = await pool.query(
            `SELECT id FROM gold_loans WHERE record_id=$1 AND status='active'`,
            [record_id],
          );
          glRows = rows;
        }
        // Fallback: match by loan_acc_no (handles closing forms saved as new records)
        if (!glRows.length && data.loan_acc_no) {
          const { rows } = await pool.query(
            `SELECT id FROM gold_loans WHERE loan_acc_no=$1 AND status='active'`,
            [String(data.loan_acc_no).trim()],
          );
          glRows = rows;
        }
        if (!glRows.length) {
          errors.push(
            `Closing - Loan: no active gold_loans row found for record_id ${record_id} / loan_acc_no ${data.loan_acc_no || '--'}`,
          );
        } else {
          await pool.query(
            `UPDATE gold_loans SET status='closed', closed_date=$1 WHERE id=$2`,
            [data.date || getTodayStr(), glRows[0].id],
          );
          results.push("gold_loans closed");
        }
      } catch (e) {
        errors.push(`gold_loans close: ${e.message}`);
      }
    }

    // FD open
    if (
      (txArr.includes("New FD") ||
        txArr.includes("New FD - Term") ||
        txArr.includes("New FD - MIS") ||
        txArr.includes("Fixed Deposit") ||
        txArr.includes("Fixed Deposit - MIS")) &&
      record_id
    ) {
      try {
        // Validate fd_acc_no format — must be exactly 14 digits
        if (data.fd_acc_no && !isValidFdAccNo(data.fd_acc_no)) {
          errors.push(
            `fd_accounts: invalid fd_acc_no format "${data.fd_acc_no}" — must be exactly 14 numeric digits (e.g. "00103046000421"). Dash formats are not allowed.`,
          );
        } else if (data.mis_acc_no && !isValidFdAccNo(data.mis_acc_no)) {
          // BUG FIX: mis_acc_no was never validated here. For a pure MIS FD
          // submission data.fd_acc_no is empty, so the check above never ran
          // and a malformed mis_acc_no was written straight into fd_accounts.
          errors.push(
            `fd_accounts: invalid mis_acc_no format "${data.mis_acc_no}" — must be exactly 14 numeric digits (e.g. "00103290000002").`,
          );
        } else {
          // fd_type: 'mis' if fd_sub_type contains 'mis', tx type is New FD - MIS, or mis_acc_no present
          // BUG FIX: fd_sub_type is now fully authoritative when present —
          // previously this was just the first term in an OR chain, so a
          // stale/leftover data.mis_acc_no value (e.g. the hidden MIS acc-no
          // field not being cleared on the frontend) could flip a Term FD
          // submission to MIS even though fd_sub_type clearly said Term.
          const isMisFd = data.fd_sub_type
            ? data.fd_sub_type.toLowerCase().includes("mis")
            : txArr.includes("New FD - MIS") || !!data.mis_acc_no; // legacy fallbacks when no fd_sub_type sent
          const fdSection = isMisFd ? "mis" : "fd";
          const fdType = isMisFd ? "mis" : "term";

          // Auto-calculate maturity date if not provided but start date + period exist
          let fdMaturityDate = data.fd_maturity_date || null;
          if (!fdMaturityDate && data.date && data.fd_period) {
            const start = new Date(data.date);
            start.setMonth(start.getMonth() + parseInt(data.fd_period));
            fdMaturityDate = start.toISOString().split("T")[0]; // YYYY-MM-DD
          }

          await upsert(
            "fd_accounts",
            "record_id",
            [
              record_id,
              // BUG FIX: fd_acc_no/acc_code/mis_acc_no/acc_no are now routed
              // authoritatively off the already-computed isMisFd flag instead
              // of OR-precedence (data.fd_acc_no || data.mis_acc_no), which
              // always preferred a stale/leftover fd_acc_no even when the
              // record is actually MIS (e.g. the hidden Term acc-no field
              // wasn't cleared on the frontend when the user switched FD Type
              // to MIS Special) — this was showing MIS deposits with a Term
              // (046-series) account number in the Fixed Deposits list.
              isMisFd ? null : data.fd_acc_no || null,
              isMisFd ? data.mis_acc_no || null : data.fd_acc_no || null,
              isMisFd ? data.mis_acc_no || null : null,
              // BUG FIX: acc_no was never included in this upsert (only
              // fd_acc_no/acc_code/mis_acc_no) — matching gold_loans and
              // od_loans, which both explicitly keep acc_no in sync with
              // their acc-no column "for backwards compatibility with older
              // DB schemas". Without it here, /api/combined/fd-accounts
              // (which selects fd.acc_no) showed every FD created through
              // this form — MIS or regular term — with a blank account code.
              isMisFd ? data.mis_acc_no || null : data.fd_acc_no || null,
              data.fd_parvati_no || null,
              customer_name || data.customer_name,
              data.aadhar || null,
              data.mobile || null,
              validateAmount(data.fd_amount, "fd_amount"),
              validateFdPeriod(data.fd_period),
              parseFloat(data.fd_interest_rate) || null,
              fdMaturityDate,
              parseFloat(data.fd_maturity_amount) || null,
              data.date || null,
              "active",
              fdSection,
              fdType,
              data.fd_sub_type || null,
              // nominee
              data.nominee || null,
              data.nominee_name || null,
              data.nominee_relation || null,
              // photos
              data.photo_customer || data.customer_photo_url || null,
              data.photo_aadhar_front || null,
              data.photo_aadhar_back || null,
              data.photo_pan || null,
              resolvedCustomerId,
            ],
            [
              "record_id",
              "fd_acc_no",
              "acc_code",
              "mis_acc_no",
              "acc_no",
              "fd_parvati_no",
              "customer_name",
              "aadhar",
              "mobile",
              "fd_amount",
              "fd_period",
              "fd_interest_rate",
              "fd_maturity_date",
              "fd_maturity_amount",
              "loan_date",
              "status",
              "section",
              "fd_type",
              "fd_sub_type",
              "nominee",
              "nominee_name",
              "nominee_relation",
              "photo_customer",
              "photo_aadhar_front",
              "photo_aadhar_back",
              "photo_pan",
              "customer_id",
            ],
          );
          results.push("fd_accounts upserted");
        }
      } catch (e) {
        errors.push(`fd_accounts: ${e.message}`);
      }
    }

    // MIS Interest — record interest payment in fd_accounts (update mis_acc_no match)
    if (txArr.includes("MIS Interest") && record_id && data.mis_acc_no) {
      try {
        await upsert(
          "fd_accounts",
          "record_id",
          [
            record_id,
            // BUG FIX: this path only ever runs for MIS (guarded by
            // data.mis_acc_no above), so fd_acc_no/acc_code/acc_no must not
            // fall back to a stale data.fd_acc_no — that was the same
            // OR-precedence bug as the "New FD" upsert, just on the interest
            // path.
            null,
            data.mis_acc_no || null,
            data.mis_acc_no || null,
            // BUG FIX: same acc_no gap as the "New FD" upsert above — this
            // MIS Interest path never set acc_no either, so an MIS FD opened
            // or updated only through this path also showed a blank code on
            // the Fixed Deposits list.
            data.mis_acc_no || null,
            data.fd_parvati_no || null,
            customer_name || data.customer_name,
            data.aadhar || null,
            data.mobile || null,
            validateAmount(data.fd_amount, "fd_amount"),
            validateFdPeriod(data.fd_period),
            parseFloat(data.fd_interest_rate) || null,
            data.fd_maturity_date || null,
            parseFloat(data.fd_maturity_amount) || null,
            data.date || null,
            "active",
            "mis",
            "mis",
            resolvedCustomerId,
          ],
          [
            "record_id",
            "fd_acc_no",
            "acc_code",
            "mis_acc_no",
            "acc_no",
            "fd_parvati_no",
            "customer_name",
            "aadhar",
            "mobile",
            "fd_amount",
            "fd_period",
            "fd_interest_rate",
            "fd_maturity_date",
            "fd_maturity_amount",
            "loan_date",
            "status",
            "section",
            "fd_type",
            "customer_id",
          ],
        );
        results.push("fd_accounts (MIS) upserted");
      } catch (e) {
        errors.push(`fd_accounts MIS: ${e.message}`);
      }
    }

    // FD close — skip upsert for closing records entirely (no new fd_accounts row needed).
    // Instead, mark the ORIGINAL FD's fd_accounts row as closed by matching fd_acc_no or
    // mis_acc_no (for New FD - MIS records which use 290-xxx stored in mis_acc_no).
    if (txArr.includes("Closing - FD") && (data.fd_acc_no || data.mis_acc_no)) {
      const accToClose = data.fd_acc_no || data.mis_acc_no;
      try {
        // Validate format for term FDs (MIS acc nos use a different format, skip check)
        if (data.fd_acc_no && !isValidFdAccNo(data.fd_acc_no)) {
          errors.push(
            `Closing - FD: invalid fd_acc_no format "${data.fd_acc_no}" — must be exactly 14 numeric digits.`,
          );
        } else {
          // Verify the FD exists and is currently active before closing
          const { rows: fdCheck } = await pool.query(
            `SELECT id, status FROM fd_accounts
             WHERE (fd_acc_no=$1 OR acc_code=$1 OR mis_acc_no=$1) LIMIT 1`,
            [accToClose],
          );
          if (!fdCheck.length) {
            errors.push(
              `Closing - FD: no FD account found with acc_no "${accToClose}"`,
            );
          } else if (fdCheck[0].status === "closed") {
            errors.push(
              `Closing - FD: FD account "${accToClose}" is already closed`,
            );
          } else {
            await pool.query(
              `UPDATE fd_accounts SET status='closed', closed_date=$1
               WHERE (fd_acc_no=$2 OR acc_code=$2 OR mis_acc_no=$2) AND status='active'`,
              [data.date || getTodayStr(), accToClose],
            );
            results.push("fd_accounts closed by acc_no");
          }
        }
      } catch (e) {
        errors.push(`fd_accounts close: ${e.message}`);
      }
    }
    // Never upsert a new fd_accounts row for a closing record
    if (
      txArr.includes("Closing - FD") &&
      !txArr.includes("New FD") &&
      !txArr.includes("Fixed Deposit")
    ) {
      // Skip — already handled above
    }

    // OD Loan open
    if (
      (txArr.includes("New FD-OD Loan") || txArr.includes("OD Loan")) &&
      record_id
    ) {
      // Validate loan_acc_no format — must be exactly 14 digits, same rule
      // as fd_acc_no. Without this, a malformed value (wrong digit count,
      // stray suffix) gets written to od_loans and then propagates into
      // every cashbook_entries row generated from this record.
      // Validate every linked FD account number — data.fd_acc_no may be a
      // comma-separated list when this OD loan is secured against 2+ FDs.
      const _odFdCodes = parseFdAccNoList(data.fd_acc_no);
      const _odInvalidFdCodes = _odFdCodes.filter((c) => !isValidFdAccNo(c));
      if (data.loan_acc_no && !isValidOdAccNo(data.loan_acc_no)) {
        errors.push(
          `od_loans: invalid loan_acc_no format "${data.loan_acc_no}" — must be exactly 14 numeric digits (e.g. "00104017000106").`,
        );
      } else if (_odInvalidFdCodes.length) {
        errors.push(
          `od_loans: invalid fd_acc_no format "${_odInvalidFdCodes.join(", ")}" — each linked FD account must be exactly 14 numeric digits.`,
        );
      } else {
        try {
          // BUG FIX: od_loans on the live DB has acc_code AND acc_no columns
          // that were manually added with NOT NULL on some deployments (same
          // drift already fixed for gold_loans.acc_no / fd_accounts.acc_no —
          // see migrations.js v9_od_loans_acc_code_nullable and
          // v10_od_loans_acc_no_nullable). This upsert never included either,
          // so every OD loan save has been throwing "null value in column
          // acc_code/acc_no violates not-null constraint" here — caught below
          // and pushed into the soft errors[] array, silently leaving od_loans
          // never created/updated for any OD loan saved through this form.
          // The migrations drop both NOT NULLs so this can't be blocked
          // again; write both = loan_acc_no going forward, same alias pattern
          // fd_accounts already keeps in sync.
          await upsert(
            "od_loans",
            "record_id",
            [
              record_id,
              data.loan_acc_no || null,
              data.loan_acc_no || null,
              data.loan_acc_no || null,
              data.fd_acc_no || data.mis_acc_no || null,
              customer_name || data.customer_name,
              data.aadhar || null,
              data.mobile || null,
              validateAmount(data.loan_amount, "loan_amount"),
              validateAmount(data.fd_amount, "fd_amount"),
              data.fd_maturity_date || null,
              "active",
              resolvedCustomerId,
            ],
            [
              "record_id",
              "loan_acc_no",
              "acc_code",
              "acc_no",
              "fd_acc_no",
              "customer_name",
              "aadhar",
              "mobile",
              "loan_amount",
              "fd_amount",
              "fd_maturity_date",
              "status",
              "customer_id",
            ],
          );
          results.push("od_loans upserted");
        } catch (e) {
          errors.push(`od_loans: ${e.message}`);
        }
      }
    }

    // OD close — FIX 5 (MEDIUM): verify row exists before closing
    if (txArr.includes("Closing - OD") && record_id) {
      try {
        const { rows: odCheck } = await pool.query(
          `SELECT id FROM od_loans WHERE record_id=$1`,
          [record_id],
        );
        if (!odCheck.length) {
          errors.push(
            `Closing - OD: no od_loans row found for record_id ${record_id}`,
          );
        } else {
          await pool.query(
            `UPDATE od_loans SET status='closed', closed_date=$1 WHERE record_id=$2`,
            [data.date || getTodayStr(), record_id],
          );
          results.push("od_loans closed");
        }
      } catch (e) {
        errors.push(`od_loans close: ${e.message}`);
      }

      // FIX 2: Also close the linked fd_accounts row(s) by fd_acc_no / mis_acc_no.
      // data.fd_acc_no may be a comma-separated list of 2+ FD account numbers
      // when this OD loan was secured against multiple FDs — closing the OD
      // loan closes every linked FD together (matches the single-FD behavior
      // this used to have, just generalized to N accounts instead of LIMIT 1).
      const _closingFdAccCodes = parseFdAccNoList(data.fd_acc_no);
      const _closingMisAcc = (data.mis_acc_no || "").trim();
      if (_closingFdAccCodes.length || _closingMisAcc) {
        try {
          const { rows: fdRows } = await pool.query(
            `SELECT id, status FROM fd_accounts
              WHERE status = 'active'
                AND (
                  (cardinality($1::text[]) > 0 AND (fd_acc_no = ANY($1::text[]) OR acc_code = ANY($1::text[])))
                  OR ($2 <> '' AND mis_acc_no = $2)
                )`,
            [_closingFdAccCodes, _closingMisAcc],
          );
          if (fdRows.length) {
            await pool.query(
              `UPDATE fd_accounts SET status='closed', closed_date=$1 WHERE id = ANY($2::int[])`,
              [data.date || getTodayStr(), fdRows.map((r) => r.id)],
            );
            results.push(
              `fd_accounts closed (OD closing) — ${fdRows.length} account(s)`,
            );
          }
        } catch (e) {
          errors.push(`fd_accounts close (OD closing): ${e.message}`);
        }
      }
    }

    // Saving Account open
    if (
      (txArr.includes("Saving Account") ||
        txArr.includes("New Sadasya") ||
        txArr.includes("New Naammatr Sabhasad") ||
        txArr.includes("Saving Deposit")) &&
      record_id
    ) {
      try {
        if (isValidSavingAccNo(data.saving_acc_no)) {
          const isDepositOnly =
            txArr.includes("Saving Deposit") &&
            !txArr.includes("Saving Account") &&
            !txArr.includes("New Sadasya") &&
            !txArr.includes("New Naammatr Sabhasad");
          if (isDepositOnly) {
            // For deposit/withdrawal: do NOT insert a new row with balance=0.
            // The existing saving_accounts row holds the authoritative balance.
            // We only link this record_id to the existing account — never overwrite balance here.
            // The balance delta is handled by the block below at line ~1510.
            await pool.query(
              `INSERT INTO saving_accounts (record_id, acc_no, saving_acc_no, acc_code, customer_name, aadhar, mobile, balance, customer_id)
               SELECT $1, sa.saving_acc_no, sa.saving_acc_no, sa.saving_acc_no, sa.customer_name, sa.aadhar, sa.mobile, sa.balance, sa.customer_id
               FROM saving_accounts sa WHERE sa.saving_acc_no=$2 ORDER BY sa.id DESC LIMIT 1
               ON CONFLICT (record_id) DO NOTHING`,
              [record_id, data.saving_acc_no],
            );
          } else {
            await pool.query(
              `INSERT INTO saving_accounts
                 (record_id, acc_no, saving_acc_no, acc_code, customer_name, aadhar, mobile, balance,
                  nominee, nominee_name, nominee_relation,
                  photo_customer, photo_aadhar_front, photo_aadhar_back, photo_pan, customer_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
               ON CONFLICT (record_id) DO UPDATE SET
                 acc_no=EXCLUDED.acc_no,
                 saving_acc_no=EXCLUDED.saving_acc_no,
                 acc_code=EXCLUDED.acc_code,
                 customer_name=EXCLUDED.customer_name,
                 aadhar=COALESCE(EXCLUDED.aadhar, saving_accounts.aadhar),
                 mobile=COALESCE(EXCLUDED.mobile, saving_accounts.mobile),
                 balance=EXCLUDED.balance,
                 nominee=COALESCE(EXCLUDED.nominee, saving_accounts.nominee),
                 nominee_name=COALESCE(EXCLUDED.nominee_name, saving_accounts.nominee_name),
                 nominee_relation=COALESCE(EXCLUDED.nominee_relation, saving_accounts.nominee_relation),
                 photo_customer=COALESCE(EXCLUDED.photo_customer, saving_accounts.photo_customer),
                 photo_aadhar_front=COALESCE(EXCLUDED.photo_aadhar_front, saving_accounts.photo_aadhar_front),
                 photo_aadhar_back=COALESCE(EXCLUDED.photo_aadhar_back, saving_accounts.photo_aadhar_back),
                 photo_pan=COALESCE(EXCLUDED.photo_pan, saving_accounts.photo_pan),
                 customer_id=COALESCE(EXCLUDED.customer_id, saving_accounts.customer_id),
                 updated_at=NOW()`,
              [
                record_id,
                data.saving_acc_no,
                data.saving_acc_no,
                data.saving_acc_no,
                customer_name || data.customer_name,
                data.aadhar || null,
                data.mobile || null,
                data.saving_balance !== undefined && data.saving_balance !== ""
                  ? parseFloat(data.saving_balance)
                  : 0,
                data.nominee || null,
                data.nominee_name || null,
                data.nominee_relation || null,
                data.photo_customer || data.customer_photo_url || null,
                data.photo_aadhar_front || null,
                data.photo_aadhar_back || null,
                data.photo_pan || null,
                resolvedCustomerId,
              ],
            );
          }
          results.push("saving_accounts upserted");
        }
      } catch (e) {
        errors.push(`saving_accounts: ${e.message}`);
      }
    }

    // Payment Received - Online → credit saving account balance
    // Payment Transfer - Online → debit saving account balance
    // The cashbook already records the correct TRF rows for both.
    // These blocks ensure the saving_accounts balance is also updated in the DB.
    if (
      txArr.includes("Payment Transfer - Online") &&
      isValidSavingAccNo(data.saving_acc_no)
    ) {
      try {
        const amt = parseFloat(data.expense_amount) || 0;
        if (amt > 0) {
          await pool.query(
            `UPDATE saving_accounts SET balance = GREATEST(0, balance - $1), updated_at=NOW() WHERE saving_acc_no=$2`,
            [amt, data.saving_acc_no],
          );
          results.push(
            `saving balance debited by ${amt} via Payment Transfer - Online`,
          );
          if (record_id) {
            const { rows: balRows } = await pool.query(
              "SELECT balance FROM saving_accounts WHERE saving_acc_no=$1 LIMIT 1",
              [data.saving_acc_no],
            );
            if (balRows.length) {
              const newBal = balRows[0].balance;
              await pool.query(
                `UPDATE records SET data = data || jsonb_build_object('saving_balance', $1::numeric),
                 updated_at = NOW()
                 WHERE id = $2 AND is_deleted = FALSE`,
                [newBal, record_id],
              );
              results.push("saving balance synced to records.data: " + newBal);
            }
          }
        }
      } catch (e) {
        errors.push("Payment Transfer - Online saving balance: " + e.message);
      }
    }

    if (
      txArr.includes("Payment Received - Online") &&
      isValidSavingAccNo(data.saving_acc_no)
    ) {
      try {
        const amt = parseFloat(data.expense_amount) || 0;
        if (amt > 0) {
          await pool.query(
            `UPDATE saving_accounts SET balance = balance + $1, updated_at=NOW() WHERE saving_acc_no=$2`,
            [amt, data.saving_acc_no],
          );
          results.push(
            `saving balance credited by ${amt} via Payment Received - Online`,
          );
          // Sync balance back into records.data
          if (record_id) {
            const { rows: balRows } = await pool.query(
              "SELECT balance FROM saving_accounts WHERE saving_acc_no=$1 LIMIT 1",
              [data.saving_acc_no],
            );
            if (balRows.length) {
              const newBal = balRows[0].balance;
              await pool.query(
                `UPDATE records SET data = data || jsonb_build_object('saving_balance', $1::numeric),
                 updated_at = NOW()
                 WHERE id = $2 AND is_deleted = FALSE`,
                [newBal, record_id],
              );
              results.push("saving balance synced to records.data: " + newBal);
            }
          }
        }
      } catch (e) {
        errors.push("Payment Received - Online saving balance: " + e.message);
      }
    }

    // Saving balance update
    if (
      (txArr.includes("Saving Deposit") ||
        txArr.includes("Saving Withdrawal")) &&
      isValidSavingAccNo(data.saving_acc_no)
    ) {
      try {
        const amt = parseFloat(data.deposit_amount) || 0;
        const delta = txArr.includes("Saving Withdrawal") ? -amt : amt;
        // Atomic balance update — withdrawal guard and update in one query to prevent race conditions
        if (delta < 0) {
          const { rows: updRows } = await pool.query(
            `UPDATE saving_accounts SET balance = balance + $1, updated_at=NOW()
             WHERE saving_acc_no=$2 AND balance + $1 >= 0
             RETURNING balance`,
            [delta, data.saving_acc_no],
          );
          if (!updRows.length) {
            const { rows: balChk } = await pool.query(
              `SELECT balance FROM saving_accounts WHERE saving_acc_no=$1 LIMIT 1`,
              [data.saving_acc_no],
            );
            const curBal = balChk.length ? balChk[0].balance : 0;
            errors.push(
              `Saving withdrawal of ${Math.abs(delta)} exceeds current balance of ${curBal} for acc ${data.saving_acc_no}`,
            );
          }
        } else {
          await pool.query(
            `UPDATE saving_accounts SET balance = balance + $1, updated_at=NOW() WHERE saving_acc_no=$2`,
            [delta, data.saving_acc_no],
          );
        }
        results.push(`saving balance updated by ${delta}`);

        // BUG FIX: sync the authoritative balance from saving_accounts back into
        // records.data so the two sources of truth never diverge. We read the
        // real DB value (not the user-typed form value) and write it back.
        if (record_id) {
          const { rows: balRows } = await pool.query(
            "SELECT balance FROM saving_accounts WHERE saving_acc_no=$1 LIMIT 1",
            [data.saving_acc_no],
          );
          if (balRows.length) {
            const newBal = balRows[0].balance;
            await pool.query(
              `UPDATE records SET data = data || jsonb_build_object('saving_balance', $1::numeric),
               updated_at = NOW()
               WHERE id = $2 AND is_deleted = FALSE`,
              [newBal, record_id],
            );
            // FIX: also sync customers.saving_balance so customer search/list
            // shows the live balance, not the stale value from the last save.
            await pool
              .query(
                `UPDATE customers SET saving_balance = $1, updated_at = NOW()
               WHERE saving_acc_no = $2 OR customer_id = (
                 SELECT customer_id FROM records WHERE id = $3 LIMIT 1
               )`,
                [newBal, data.saving_acc_no, record_id],
              )
              .catch(() => {});
            results.push("saving balance synced to records.data: " + newBal);
          }
        }
      } catch (e) {
        errors.push("saving balance: " + e.message);
      }
    }

    // Saving Acc Transfer — debits one member's saving account and credits a
    // DIFFERENT member's saving account, atomically (BEGIN/COMMIT/ROLLBACK —
    // unlike the single-account Saving Deposit/Withdrawal block above, this
    // touches two different saving_accounts rows and must not leave one leg
    // applied without the other). Modeled on softDelete()'s client-transaction
    // pattern elsewhere in this file; kept inside its own try/catch (rather
    // than aborting the whole processTransaction request) so a failure here
    // still lets the rest of this record's side effects run and be reported
    // via errors[].
    if (
      txArr.includes("Saving Acc Transfer") &&
      isValidSavingAccNo(data.from_saving_acc_no) &&
      isValidSavingAccNo(data.to_saving_acc_no) &&
      data.from_saving_acc_no.trim() !== data.to_saving_acc_no.trim()
    ) {
      const trAmt = parseFloat(data.transfer_amount) || 0;
      if (trAmt > 0) {
        const trClient = await pool.connect();
        try {
          await trClient.query("BEGIN");
          // Guarded debit — same overdraft-race-condition protection as the
          // single-account Saving Withdrawal path above.
          const { rows: debitRows } = await trClient.query(
            `UPDATE saving_accounts SET balance = balance - $1, updated_at=NOW()
             WHERE saving_acc_no=$2 AND balance - $1 >= 0
             RETURNING balance`,
            [trAmt, data.from_saving_acc_no],
          );
          if (!debitRows.length) {
            await trClient.query("ROLLBACK");
            const { rows: balChk } = await pool.query(
              `SELECT balance FROM saving_accounts WHERE saving_acc_no=$1 LIMIT 1`,
              [data.from_saving_acc_no],
            );
            const curBal = balChk.length ? balChk[0].balance : 0;
            errors.push(
              `Saving Acc Transfer of ${trAmt} exceeds current balance of ${curBal} for acc ${data.from_saving_acc_no}`,
            );
          } else {
            const { rows: creditRows } = await trClient.query(
              `UPDATE saving_accounts SET balance = balance + $1, updated_at=NOW()
               WHERE saving_acc_no=$2
               RETURNING balance`,
              [trAmt, data.to_saving_acc_no],
            );
            if (!creditRows.length) {
              // "To" account doesn't exist in saving_accounts — roll back the
              // debit too so we never leave money debited with nowhere credited.
              await trClient.query("ROLLBACK");
              errors.push(
                `Saving Acc Transfer: destination account ${data.to_saving_acc_no} not found in saving_accounts`,
              );
            } else {
              await trClient.query("COMMIT");
              const newFromBal = debitRows[0].balance;
              const newToBal = creditRows[0].balance;
              results.push(
                `saving acc transfer: ${data.from_saving_acc_no} -${trAmt} / ${data.to_saving_acc_no} +${trAmt}`,
              );

              // Sync both accounts' resulting balances back into records.data
              // (from_saving_balance/to_saving_balance) and customers.saving_balance,
              // same as the single-account Saving Deposit/Withdrawal sync above —
              // so reprints and the customer list never show a stale balance.
              // Looked up by saving_acc_no only (not OR customer_id like the
              // single-account block) since this record_id belongs to the
              // transfer itself, not to either leg's own customer record.
              if (record_id) {
                await pool
                  .query(
                    `UPDATE records SET data = data || jsonb_build_object(
                       'from_saving_balance', $1::numeric,
                       'to_saving_balance', $2::numeric
                     ), updated_at = NOW()
                     WHERE id = $3 AND is_deleted = FALSE`,
                    [newFromBal, newToBal, record_id],
                  )
                  .catch(() => {});
              }
              await pool
                .query(
                  `UPDATE customers SET saving_balance = $1, updated_at = NOW()
                   WHERE saving_acc_no = $2`,
                  [newFromBal, data.from_saving_acc_no],
                )
                .catch(() => {});
              await pool
                .query(
                  `UPDATE customers SET saving_balance = $1, updated_at = NOW()
                   WHERE saving_acc_no = $2`,
                  [newToBal, data.to_saving_acc_no],
                )
                .catch(() => {});
              results.push(
                "saving acc transfer balances synced to records.data and customers",
              );
            }
          }
        } catch (e) {
          await trClient.query("ROLLBACK").catch(() => {});
          errors.push("saving acc transfer: " + e.message);
        } finally {
          trClient.release();
        }
      } else {
        errors.push("Saving Acc Transfer: transfer_amount must be greater than 0");
      }
    }

    // Saving close
    if (txArr.includes("Closing - Saving Account")) {
      try {
        if (isValidSavingAccNo(data.saving_acc_no)) {
          await pool.query(
            `UPDATE saving_accounts SET status='closed', closed_date=$1 WHERE saving_acc_no=$2`,
            [data.date || getTodayStr(), data.saving_acc_no],
          );
          results.push("saving_accounts closed");
        }
      } catch (e) {
        errors.push(`saving_accounts close: ${e.message}`);
      }
    }

    // Membership
    if (
      (txArr.includes("New Sadasya") ||
        txArr.includes("New Naammatr Sabhasad")) &&
      record_id
    ) {
      try {
        const mType = txArr.includes("New Sadasya")
          ? "New Sadasya"
          : "New Naammatr Sabhasad";
        // acc_code is NOT NULL — use share_acc_no if available, fall back to saving_acc_no,
        // last resort use record_id string so the constraint is never violated.
        const memAccCode =
          data.share_acc_no || data.saving_acc_no || String(record_id);
        // FIX: memberships has TWO unique constraints — record_id AND acc_code.
        // The generic upsert() only handles ON CONFLICT (record_id), so when the same
        // acc_code exists on a different record_id it throws memberships_acc_code_key.
        // Try ON CONFLICT (record_id) first; if acc_code conflicts, update that row instead.
        // Explicitly resolve every value to null if falsy — prevents postgres
        // "could not determine data type of parameter $N" when value is undefined
        const memAadhar = data.aadhar || null;
        const memMobile = data.mobile || null;
        const memSavingAcc = isValidSavingAccNo(data.saving_acc_no)
          ? data.saving_acc_no
          : null;
        const memShareAcc = data.share_acc_no || null;
        const memDate = data.date || null;
        const memVals = [
          record_id, // $1  record_id
          customer_name || data.customer_name || null, // $2  customer_name
          memAadhar, // $3  aadhar
          memMobile, // $4  mobile
          memSavingAcc, // $5  saving_acc_no
          memShareAcc, // $6  share_acc_no
          memAccCode, // $7  acc_code
          memShareAcc, // $8  acc_no
          mType, // $9  membership_type
          memDate, // $10 start_date
          "active", // $11 status
          data.nominee || null,          // $12 nominee
          data.nominee_name || null,     // $13 nominee_name
          data.nominee_relation || null, // $14 nominee_relation
          data.photo_customer || data.customer_photo_url || null, // $15 photo_customer
          data.photo_aadhar_front || null, // $16 photo_aadhar_front
          data.photo_aadhar_back || null,  // $17 photo_aadhar_back
          data.photo_pan || null,          // $18 photo_pan
          resolvedCustomerId,               // $19 customer_id
        ];
        try {
          await pool.query(
            `INSERT INTO memberships
               (record_id,customer_name,aadhar,mobile,saving_acc_no,share_acc_no,acc_code,acc_no,
                membership_type,start_date,status,
                nominee,nominee_name,nominee_relation,
                photo_customer,photo_aadhar_front,photo_aadhar_back,photo_pan,customer_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
             ON CONFLICT (record_id) DO UPDATE SET
               customer_name=EXCLUDED.customer_name,
               aadhar=COALESCE(EXCLUDED.aadhar, memberships.aadhar),
               mobile=COALESCE(EXCLUDED.mobile, memberships.mobile),
               saving_acc_no=COALESCE(EXCLUDED.saving_acc_no, memberships.saving_acc_no),
               share_acc_no=COALESCE(EXCLUDED.share_acc_no, memberships.share_acc_no),
               acc_code=EXCLUDED.acc_code,
               acc_no=COALESCE(EXCLUDED.acc_no, memberships.acc_no),
               membership_type=EXCLUDED.membership_type,
               start_date=COALESCE(EXCLUDED.start_date, memberships.start_date),
               status=EXCLUDED.status,
               nominee=COALESCE(EXCLUDED.nominee, memberships.nominee),
               nominee_name=COALESCE(EXCLUDED.nominee_name, memberships.nominee_name),
               nominee_relation=COALESCE(EXCLUDED.nominee_relation, memberships.nominee_relation),
               photo_customer=COALESCE(EXCLUDED.photo_customer, memberships.photo_customer),
               photo_aadhar_front=COALESCE(EXCLUDED.photo_aadhar_front, memberships.photo_aadhar_front),
               photo_aadhar_back=COALESCE(EXCLUDED.photo_aadhar_back, memberships.photo_aadhar_back),
               photo_pan=COALESCE(EXCLUDED.photo_pan, memberships.photo_pan),
               customer_id=COALESCE(EXCLUDED.customer_id, memberships.customer_id),
               updated_at=NOW()`,
            memVals,
          );
        } catch (innerErr) {
          // acc_code unique constraint — same acc_code exists on a different record_id.
          // Update that existing row to point at the new record_id.
          if (
            innerErr.code === "23505" &&
            (innerErr.constraint || "").includes("acc_code")
          ) {
            await pool.query(
              `UPDATE memberships SET
                 record_id=$1, customer_name=$2,
                 aadhar=COALESCE($3, aadhar),
                 mobile=COALESCE($4, mobile),
                 saving_acc_no=COALESCE($5, saving_acc_no),
                 share_acc_no=COALESCE($6, share_acc_no),
                 acc_no=COALESCE($8, acc_no),
                 membership_type=$9, start_date=COALESCE($10, start_date),
                 status=$11,
                 nominee=COALESCE($12, nominee),
                 nominee_name=COALESCE($13, nominee_name),
                 nominee_relation=COALESCE($14, nominee_relation),
                 photo_customer=COALESCE($15, photo_customer),
                 photo_aadhar_front=COALESCE($16, photo_aadhar_front),
                 photo_aadhar_back=COALESCE($17, photo_aadhar_back),
                 photo_pan=COALESCE($18, photo_pan),
                 customer_id=COALESCE($19, customer_id),
                 updated_at=NOW()
               WHERE acc_code=$7`,
              memVals,
            );
          } else {
            throw innerErr;
          }
        }
        results.push("memberships upserted");
      } catch (e) {
        errors.push(`memberships: ${e.message}`);
      }
    }

    // Shares Account / Shares Transfer — upsert share_accounts mirror table
    if (
      (txArr.includes("Shares Account") ||
        txArr.includes("Shares - Transfer")) &&
      record_id
    ) {
      try {
        // Upsert customer with share_acc_no populated
        if (customer_name && (data.aadhar || data.mobile)) {
          await upsertCustomer({
            customer_id: data.customer_id || null,
            name: customer_name || data.customer_name,
            aadhar: data.aadhar || null,
            mobile: data.mobile || null,
            data,
          });
          results.push("shares: customer updated");
        }
      } catch (e) {
        errors.push(`shares: ${e.message}`);
      }

      // Upsert share_accounts mirror row so the Shares listing and
      // customer profile always reflect records created via normal form submit.
      //
      // BUG FIX: this previously INSERTed into record_id/share_amount/num_shares,
      // none of which exist on share_accounts (confirmed via \d share_accounts) —
      // every save here has been failing silently (caught below, pushed into
      // errors[], never surfaced). share_accounts has no record_id link to
      // records at all; acc_code is the real unique key. Real columns:
      // id, acc_code, acc_no, customer_id, cust_code, pan_no, start_date,
      // balance, status, close_date, remarks, is_deleted, deleted_at,
      // created_at, updated_at.
      if (data.share_acc_no || data.acc_no) {
        try {
          const shareAccNo = data.share_acc_no || data.acc_no;
          // BUG FIX: previously did `parseInt(data.customer_id, 10)` here, which
          // parses the human-readable zero-padded business code (e.g.
          // "0000002357" → 2357) — NOT customers.id, the actual integer FK
          // target. Use the shared resolver (already computed above) instead,
          // which looks up customers.id by the business code or aadhar/mobile.
          const custId = resolvedCustomerId;

          await pool.query(
            `INSERT INTO share_accounts
               (acc_code, acc_no, customer_id, cust_code, pan_no, start_date, balance, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'active')
             ON CONFLICT (acc_code) DO UPDATE SET
               acc_no       = COALESCE(EXCLUDED.acc_no, share_accounts.acc_no),
               customer_id  = COALESCE(EXCLUDED.customer_id, share_accounts.customer_id),
               cust_code    = COALESCE(EXCLUDED.cust_code, share_accounts.cust_code),
               pan_no       = COALESCE(EXCLUDED.pan_no, share_accounts.pan_no),
               start_date   = COALESCE(EXCLUDED.start_date, share_accounts.start_date),
               balance      = COALESCE(EXCLUDED.balance, share_accounts.balance),
               updated_at   = NOW()`,
            [
              shareAccNo,
              shareAccNo,
              custId,
              data.customer_id || null,
              data.pan_no || null,
              data.date || data.start_date || null,
              validateAmount(data.share_amount || data.balance, "balance"),
            ],
          );
          results.push("share_accounts upserted");
        } catch (e) {
          errors.push(`share_accounts: ${e.message}`);
        }
      }
    }

    // Current Account — record in customers, no dedicated derived table
    if (
      (txArr.includes("Current Account") ||
        txArr.includes("Current - Slips")) &&
      record_id
    ) {
      try {
        if (customer_name && (data.aadhar || data.mobile)) {
          await upsertCustomer({
            customer_id: data.customer_id || null,
            name: customer_name || data.customer_name,
            aadhar: data.aadhar || null,
            mobile: data.mobile || null,
            data,
          });
          results.push("current account: customer updated");
        }
      } catch (e) {
        errors.push(`current account: ${e.message}`);
      }
    }

    // ── SMS notifications (fire-and-forget, never block response) ────────
    const _mob = data.mobile || null;
    const _name = customer_name || data.customer_name || "Customer";
    const _acc = data.loan_acc_no || data.fd_acc_no || data.saving_acc_no || "";
    if (_sms && _mob) {
      if (txArr.includes("Gold Loan") && !txArr.includes("New FD-OD Loan")) {
        const amt = Number(data.loan_amount || 0).toLocaleString("en-IN");
        _trySMS(
          _mob,
          _sms.templates.loanOpened(_name, _acc, amt),
          "loan_opened",
          record_id,
        );
      }
      if (txArr.includes("Closing - Loan")) {
        _trySMS(
          _mob,
          _sms.templates.loanClosed(_name, _acc),
          "loan_closed",
          record_id,
        );
      }
      if (
        txArr.includes("New FD") ||
        txArr.includes("New FD - Term") ||
        txArr.includes("New FD - MIS") ||
        txArr.includes("Fixed Deposit")
      ) {
        const mat = data.fd_maturity_date || "";
        const amt = Number(data.fd_amount || 0).toLocaleString("en-IN");
        // Use mis_acc_no for MIS FDs (detected via fd_sub_type or tx type), fd_acc_no otherwise
        const isMisFdSms =
          (data.fd_sub_type &&
            data.fd_sub_type.toLowerCase().includes("mis")) ||
          txArr.includes("New FD - MIS");
        const fdAccForSms = isMisFdSms
          ? data.mis_acc_no || _acc
          : data.fd_acc_no || _acc;
        _trySMS(
          _mob,
          _sms.templates.fdOpened(_name, fdAccForSms, amt, mat),
          "fd_opened",
          record_id,
        );
      }
    }

    res.json({ ok: errors.length === 0, results, errors });
  } catch (err) {
    if (err.code === "23505") {
      const constraint = err.constraint || "";
      let msg = "A record with this account number already exists.";
      if (constraint.includes("fd_acc"))
        msg = "An FD account with this account number already exists.";
      if (constraint.includes("saving_acc"))
        msg = "A Saving account with this account number already exists.";
      if (constraint.includes("gold_acc"))
        msg = "A Gold Loan with this account number already exists.";
      if (constraint.includes("od_acc"))
        msg = "An OD Loan with this account number already exists.";
      errors.push(msg);
      return res.status(409).json({ ok: false, results, errors });
    }
    errors.push(err.message);
    res.json({ ok: false, results, errors });
  }
}

// ── internal helper: resolve customers.id (integer PK / FK target) ────────
// Every derived table (gold_loans, fd_accounts, od_loans, saving_accounts,
// share_accounts, memberships) has a `customer_id` column that is an
// INTEGER FK to customers.id — NOT the human-readable zero-padded business
// code (customers.customer_id, e.g. "0000002357"). Resolve by that business
// code first (exact match), falling back to aadhar/mobile, same priority
// upsertCustomer() uses. Returns null (never throws) if no match is found —
// callers should write NULL rather than fail the whole transaction, since a
// customer master row may not exist yet for legacy/edge-case data.
async function resolveCustomerId(data = {}) {
  try {
    const code = data.customer_id != null ? String(data.customer_id).trim() : "";
    if (code) {
      const { rows } = await pool.query(
        `SELECT id FROM customers WHERE customer_id = $1 LIMIT 1`,
        [code],
      );
      if (rows[0]) return rows[0].id;
    }
    const aadhar = data.aadhar || null;
    const mobile = data.mobile || null;
    if (aadhar || mobile) {
      const { rows } = await pool.query(
        `SELECT id FROM customers
         WHERE (aadhar=$1 AND $1 IS NOT NULL)
            OR (mobile=$2 AND $2 IS NOT NULL)
         LIMIT 1`,
        [aadhar, mobile],
      );
      if (rows[0]) return rows[0].id;
    }
    return null;
  } catch (e) {
    console.error("[resolveCustomerId]", e.message);
    return null;
  }
}

// ── Duplicate account-opening guard ────────────────────────────────────────
// An existing customer should not end up with two active "opening" records
// of the same product — e.g. a second Saving Account, a second Shares
// Account, or being made a "New Sadasya" member twice. This is the
// authoritative, server-side half of that check (records.controller.js's
// create(), below); app.js's selectCustomer() also warns the clerk earlier
// in the New Transaction form, but that is only a convenience — this is what
// actually stops the duplicate from ever being written.
//
// kind: 'saving' | 'shares' | 'New Sadasya' | 'New Naammatr Sabhasad'
// (the last two are literal memberships.membership_type values — see the
// "Membership" block in processTransaction() a few hundred lines down,
// which writes exactly those two strings).
async function customerHasActiveAccount(customerDbId, kind) {
  if (!customerDbId) return false;
  try {
    if (kind === "saving") {
      const { rows } = await pool.query(
        `SELECT 1 FROM saving_accounts WHERE customer_id=$1 AND COALESCE(status,'active') <> 'closed' LIMIT 1`,
        [customerDbId],
      );
      return rows.length > 0;
    }
    if (kind === "shares") {
      const { rows } = await pool.query(
        `SELECT 1 FROM share_accounts WHERE customer_id=$1 AND COALESCE(status,'active') <> 'closed' LIMIT 1`,
        [customerDbId],
      );
      return rows.length > 0;
    }
    // Membership (New Sadasya / New Naammatr Sabhasad) — same table, gated
    // by membership_type so the two products are checked independently.
    const { rows } = await pool.query(
      `SELECT 1 FROM memberships WHERE customer_id=$1 AND membership_type=$2 AND COALESCE(status,'active') <> 'closed' LIMIT 1`,
      [customerDbId, kind],
    );
    return rows.length > 0;
  } catch (e) {
    // Fail OPEN, never closed — a query error here (e.g. a column genuinely
    // missing on some deployment) must never block a legitimate save.
    console.error("[customerHasActiveAccount]", kind, e.message);
    return false;
  }
}

// tx_types string → { kind for customerHasActiveAccount, human label for the error }
const DUPLICATE_ACCOUNT_GUARD = {
  "Saving Account": { kind: "saving", label: "Saving Account" },
  "Shares Account": { kind: "shares", label: "Shares Account" },
  "New Sadasya": { kind: "New Sadasya", label: "New Sadasya membership" },
  "New Naammatr Sabhasad": { kind: "New Naammatr Sabhasad", label: "New Naammatr Sabhasad membership" },
};

// ── internal helper: upsert customer master ───────────────────────────────
async function upsertCustomer({
  customer_id,
  name,
  aadhar,
  mobile,
  data = {},
}) {
  try {
    if (!name) return;
    // Normalise empty strings to null — DB sometimes stores '' instead of NULL
    if (customer_id === "") customer_id = null;
    if (aadhar === "") aadhar = null;
    if (mobile === "") mobile = null;
    if (data.aadhar === "") data.aadhar = null;
    if (data.mobile === "") data.mobile = null;
    if (data.pan === "") data.pan = null;
    // Validate PAN format before storing — reject amounts, balances, or other junk
    // that may have been parsed from PDF columns (e.g. "40466.00 cr")
    if (data.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(data.pan.trim())) data.pan = null;

    const key = customer_id || aadhar || mobile;
    if (!key) return;

    // saving_balance from the form data blob is a *display* value shown to the
    // clerk — it is NOT the authoritative balance. The authoritative balance is
    // maintained exclusively by the Saving Deposit / Withdrawal sync path which
    // writes directly to saving_accounts and back-patches records.data.
    // Therefore we NEVER overwrite an existing customers.saving_balance with the
    // form value — we only set it when inserting a brand-new customer row.
    // saving_acc_no is updated with COALESCE so it is never erased once set.

    // Fix #6: ON CONFLICT (customer_id) never fires when customer_id is NULL because
    // NULL != NULL in unique constraints. Use a separate path for records without
    // a customer_id, falling back to aadhar or mobile as the natural key.
    if (customer_id) {
      const incomingAadhar = data.aadhar || aadhar || null;
      const incomingMobile = data.mobile || mobile || null;
      const incomingPan = data.pan || null;

      // ── Step 1: claim orphan rows ──────────────────────────────────────
      // If a row exists with no customer_id but matching aadhar/mobile/PAN,
      // it was created before the customer_id was known (e.g. gold loan saved
      // before PDF import). Stamp it now so ON CONFLICT below merges into ONE
      // row instead of inserting a second duplicate.
      if (incomingAadhar || incomingMobile || incomingPan) {
        const claimConds = [];
        const claimVals = [customer_id]; // $1
        let ci = 2;
        if (incomingAadhar) {
          claimConds.push(`aadhar=$${ci++}`);
          claimVals.push(incomingAadhar);
        }
        if (incomingMobile) {
          claimConds.push(`mobile=$${ci++}`);
          claimVals.push(incomingMobile);
        }
        if (incomingPan) {
          claimConds.push(`LOWER(pan)=LOWER($${ci++})`);
          claimVals.push(incomingPan);
        }
        await pool
          .query(
            `UPDATE customers SET customer_id=$1, updated_at=NOW()
           WHERE customer_id IS NULL AND (${claimConds.join(" OR ")})`,
            claimVals,
          )
          .catch(() => {}); // ignore unique violation if two orphans exist — Step C in migrations cleans those
      }

      // ── Step 2: upsert by customer_id — now guaranteed to hit one row ──
      await pool.query(
        `INSERT INTO customers (customer_id, name, aadhar, mobile, pan, dob, address, occupation,
           saving_acc_no, saving_balance, share_acc_no,
           gender, marital_status, caste, religion, qualification, passport_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (customer_id) DO UPDATE SET
           name=EXCLUDED.name,
           aadhar=COALESCE(EXCLUDED.aadhar, customers.aadhar),
           mobile=COALESCE(EXCLUDED.mobile, customers.mobile),
           pan=COALESCE(EXCLUDED.pan, customers.pan),
           dob=COALESCE(EXCLUDED.dob, customers.dob),
           address=COALESCE(EXCLUDED.address, customers.address),
           occupation=COALESCE(EXCLUDED.occupation, customers.occupation),
           saving_acc_no=COALESCE(EXCLUDED.saving_acc_no, customers.saving_acc_no),
           saving_balance=COALESCE(customers.saving_balance, EXCLUDED.saving_balance),
           share_acc_no=COALESCE(EXCLUDED.share_acc_no, customers.share_acc_no),
           gender=COALESCE(EXCLUDED.gender, customers.gender),
           marital_status=COALESCE(EXCLUDED.marital_status, customers.marital_status),
           caste=COALESCE(EXCLUDED.caste, customers.caste),
           religion=COALESCE(EXCLUDED.religion, customers.religion),
           qualification=COALESCE(EXCLUDED.qualification, customers.qualification),
           passport_no=COALESCE(EXCLUDED.passport_no, customers.passport_no),
           updated_at=NOW()`,
        [
          customer_id,
          name,
          incomingAadhar,
          incomingMobile,
          incomingPan,
          data.dob || null,
          data.address || null,
          data.occupation || null,
          isValidSavingAccNo(data.saving_acc_no) ? data.saving_acc_no : null,
          data.saving_balance !== undefined &&
          data.saving_balance !== null &&
          data.saving_balance !== ""
            ? parseFloat(data.saving_balance)
            : null,
          data.share_acc_no || null,
          data.gender || null,
          data.marital_status || null,
          data.caste || null,
          data.religion || null,
          data.qualification || null,
          data.passport_no || null,
        ],
      );
    } else {
      // No customer_id — match on aadhar, mobile, or name to avoid creating duplicates.
      // Priority: aadhar > mobile > name (name alone is last resort).
      const matchAadhar = aadhar || data.aadhar || null;
      const matchMobile = mobile || data.mobile || null;
      const matchName = name || null;

      let existing = { rows: [] };
      if (matchAadhar) {
        existing = await pool.query(
          `SELECT id FROM customers WHERE aadhar=$1 LIMIT 1`,
          [matchAadhar],
        );
      }
      if (!existing.rows.length && matchMobile) {
        existing = await pool.query(
          `SELECT id FROM customers WHERE mobile=$1 LIMIT 1`,
          [matchMobile],
        );
      }
      if (!existing.rows.length && matchName) {
        // Name match — only use if there's exactly one result to avoid false positives
        const nameMatch = await pool.query(
          `SELECT id FROM customers WHERE LOWER(TRIM(name))=LOWER(TRIM($1)) LIMIT 2`,
          [matchName],
        );
        if (nameMatch.rows.length === 1) existing = nameMatch;
      }

      const matchKey = matchAadhar || matchMobile;
      if (!matchKey && !matchName) return; // no usable key — skip silently
      if (existing.rows.length) {
        await pool.query(
          `UPDATE customers SET
             name=$1,
             aadhar=COALESCE($2, aadhar),
             mobile=COALESCE($3, mobile),
             pan=COALESCE($4, pan),
             dob=COALESCE($5, dob),
             address=COALESCE($6, address),
             occupation=COALESCE($7, occupation),
             saving_acc_no=COALESCE($8, saving_acc_no),
             saving_balance=COALESCE(saving_balance, $9),
             share_acc_no=COALESCE($10, share_acc_no),
             gender=COALESCE($12, gender),
             marital_status=COALESCE($13, marital_status),
             caste=COALESCE($14, caste),
             religion=COALESCE($15, religion),
             qualification=COALESCE($16, qualification),
             passport_no=COALESCE($17, passport_no),
             updated_at=NOW()
           WHERE id=$11`,
          [
            name,
            data.aadhar || aadhar || null,
            data.mobile || mobile || null,
            data.pan || null,
            data.dob || null,
            data.address || null,
            data.occupation || null,
            isValidSavingAccNo(data.saving_acc_no) ? data.saving_acc_no : null,
            data.saving_balance !== undefined &&
            data.saving_balance !== null &&
            data.saving_balance !== ""
              ? parseFloat(data.saving_balance)
              : null,
            data.share_acc_no || null,
            existing.rows[0].id,
            data.gender || null,
            data.marital_status || null,
            data.caste || null,
            data.religion || null,
            data.qualification || null,
            data.passport_no || null,
          ],
        );
      } else {
        await pool.query(
          `INSERT INTO customers (name, aadhar, mobile, pan, dob, address, occupation,
             saving_acc_no, saving_balance, share_acc_no,
             gender, marital_status, caste, religion, qualification, passport_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            name,
            data.aadhar || aadhar || null,
            data.mobile || mobile || null,
            data.pan || null,
            data.dob || null,
            data.address || null,
            data.occupation || null,
            isValidSavingAccNo(data.saving_acc_no) ? data.saving_acc_no : null,
            data.saving_balance !== undefined &&
            data.saving_balance !== null &&
            data.saving_balance !== ""
              ? parseFloat(data.saving_balance)
              : null,
            data.share_acc_no || null,
            data.gender || null,
            data.marital_status || null,
            data.caste || null,
            data.religion || null,
            data.qualification || null,
            data.passport_no || null,
          ],
        );
      }
    }
  } catch (err) {
    console.error("[upsertCustomer]", err.message);
  }
}

// ── GET /api/records/fd-accounts/by-customer ─────────────────────────────
// Returns all active FD accounts for a customer — used by FD-OD loan form.
// Joins the parent records.data JSONB so fd_amount / maturity fields are
// always populated even for older records where fd_accounts was backfilled
// without those columns.
async function fdAccountsByCustomer(req, res) {
  try {
    const { customer_id, name, aadhar, mobile } = req.query;
    if (!customer_id && !name && !aadhar && !mobile) {
      return res
        .status(400)
        .json({
          error: "Provide at least one of: customer_id, name, aadhar, mobile",
        });
    }

    // customer_id is the most reliable key — join through records to fd_accounts.
    // This avoids name-mismatch bugs (e.g. stale/corrupted customers.name) and
    // null aadhar/mobile in older fd_accounts rows.
    const SELECT = `
       SELECT
         fa.fd_acc_no,
         fa.mis_acc_no,
         fa.fd_parvati_no,
         fa.customer_name,
         fa.aadhar,
         fa.mobile,
         fa.fd_period,
         fa.fd_interest_rate,
         fa.loan_date,
         fa.status,
         COALESCE(
           NULLIF(fa.fd_amount::text, '0'),
           NULLIF(r.data->>'fd_amount', '')
         )::numeric                                          AS fd_amount,
         COALESCE(
           fa.fd_maturity_amount,
           NULLIF(r.data->>'fd_maturity_amount','')::numeric
         )                                                   AS fd_maturity_amount,
         COALESCE(
           fa.fd_maturity_date::text,
           NULLIF(r.data->>'fd_maturity_date','')
         )                                                   AS fd_maturity_date,
         COALESCE(
           NULLIF(fa.fd_parvati_no,''),
           NULLIF(r.data->>'fd_parvati_no','')
         )                                                   AS fd_parvati_no
       FROM fd_accounts fa
       JOIN records r ON r.id = fa.record_id AND r.is_deleted = FALSE`;

    let rows;

    if (customer_id) {
      // Primary path — exact match via records.customer_id (immune to name corruption)
      ({ rows } = await pool.query(
        `${SELECT}
         WHERE r.customer_id = $1
           AND fa.status = 'active'
         ORDER BY fa.loan_date DESC NULLS LAST, fa.id DESC`,
        [customer_id],
      ));
    } else {
      // Fallback for callers that don't have customer_id yet.
      // BUG FIX: this used to OR aadhar/mobile/name together — a customer
      // with no customer_id set (a known, pre-existing gap: customer_id is
      // NULL on many bulk-imported records) would match on WHICHEVER of
      // those fields happened to be present, and since name is only a loose
      // LIKE match, "OR"-ing it with the others could pull in a completely
      // different customer's active FDs into a picker used to close/back a
      // real transaction — showing (and letting staff select) someone
      // else's account. Use the single strongest identifier available
      // instead of unioning weak ones: aadhar and mobile are effectively
      // unique per customer, name is not and is used only as a last resort.
      let cond, param;
      if (aadhar) {
        cond = `fa.aadhar = $1`;
        param = aadhar;
      } else if (mobile) {
        cond = `fa.mobile = $1`;
        param = mobile;
      } else {
        cond = `LOWER(fa.customer_name) LIKE $1`;
        param = `%${name.toLowerCase()}%`;
      }
      ({ rows } = await pool.query(
        `${SELECT}
         WHERE ${cond}
           AND fa.status = 'active'
         ORDER BY fa.loan_date DESC NULLS LAST, fa.id DESC`,
        [param],
      ));
    }

    res.json(rows);
  } catch (err) {
    console.error("[fdAccountsByCustomer]", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/od-loans/by-customer ────────────────────────────────
// Returns all active FD-OD loans for a customer — used by Closing - OD form
// to show a loan picker (same pattern as gold loan closing picker).
// Joins od_loans with the parent records + fd_accounts so FD details are
// always available for auto-population when a loan is selected.
async function odLoansByCustomer(req, res) {
  try {
    // BUG FIX: was ignoring customer_id param — app.js sends it but the old
    // destructure only read { name, aadhar, mobile }. For customers with no
    // aadhar/mobile in the object the fallback was a fuzzy LIKE name match
    // which could match the wrong customer's OD loans. customer_id now used
    // as the primary fast path (exact JOIN on records.customer_id), consistent
    // with how fdAccountsByCustomer already works.
    const { customer_id, name, aadhar, mobile } = req.query;
    if (!customer_id && !name && !aadhar && !mobile) {
      return res
        .status(400)
        .json({
          error: "Provide at least one of: customer_id, name, aadhar, mobile",
        });
    }

    const SELECT = `SELECT
         ol.id,
         ol.record_id,
         ol.loan_acc_no,
         COALESCE(
           NULLIF(ol.fd_acc_no,''),
           NULLIF(r.data->>'fd_acc_no',''),
           NULLIF(r.data->>'mis_acc_no','')
         )                                                   AS fd_acc_no,
         NULLIF(r.data->>'mis_acc_no','')                   AS mis_acc_no,
         ol.customer_name,
         ol.aadhar,
         ol.mobile,
         ol.loan_amount,
         r.date                                                AS loan_date,
         ol.status,
         COALESCE(
           NULLIF(fa.fd_amount::text, '0'),
           NULLIF(r.data->>'fd_amount', '')
         )::numeric                                          AS fd_amount,
         COALESCE(
           fa.fd_maturity_amount::numeric,
           (NULLIF(r.data->>'fd_maturity_amount',''))::numeric
         )                                                   AS fd_maturity_amount,
         COALESCE(
           fa.fd_maturity_date::text,
           NULLIF(r.data->>'fd_maturity_date','')
         )                                                   AS fd_maturity_date,
         COALESCE(
           NULLIF(fa.fd_parvati_no,''),
           NULLIF(r.data->>'fd_parvati_no','')
         )                                                   AS fd_parvati_no,
         COALESCE(
           fa.fd_period::text,
           NULLIF(r.data->>'fd_period','')
         )                                                   AS fd_period,
         COALESCE(
           fa.fd_interest_rate::numeric,
           (NULLIF(r.data->>'fd_interest_rate',''))::numeric
         )                                                   AS fd_interest_rate,
         r.data                                              AS record_data
       FROM od_loans ol
       LEFT JOIN records r  ON r.id = ol.record_id AND r.is_deleted = FALSE
       LEFT JOIN fd_accounts fa
         ON fa.status = 'active'
        AND (
          (ol.fd_acc_no IS NOT NULL AND ol.fd_acc_no <> '' AND fa.fd_acc_no = ol.fd_acc_no)
          OR (ol.fd_acc_no IS NOT NULL AND ol.fd_acc_no <> '' AND fa.mis_acc_no = ol.fd_acc_no)
          OR (fa.fd_acc_no = r.data->>'fd_acc_no' AND r.data->>'fd_acc_no' <> '')
          OR (fa.mis_acc_no = r.data->>'mis_acc_no' AND r.data->>'mis_acc_no' <> '')
        )`;

    let rows;
    if (customer_id) {
      // Primary path — exact match via records.customer_id (immune to name corruption)
      ({ rows } = await pool.query(
        `${SELECT}
         WHERE r.customer_id = $1
           AND ol.status = 'active'
         ORDER BY r.date DESC NULLS LAST, ol.id DESC`,
        [customer_id],
      ));
    } else {
      // Fallback for callers that don't have customer_id.
      // BUG FIX: same issue as fdAccountsByCustomer above — OR-ing
      // aadhar/mobile/name together could match a different customer's OD
      // loans whenever only a loose field (name) was available. Use the
      // single strongest identifier instead of unioning weak ones.
      let cond, param;
      if (aadhar) {
        cond = `ol.aadhar = $1`;
        param = aadhar;
      } else if (mobile) {
        cond = `ol.mobile = $1`;
        param = mobile;
      } else {
        cond = `LOWER(ol.customer_name) LIKE $1`;
        param = `%${name.toLowerCase()}%`;
      }
      ({ rows } = await pool.query(
        `${SELECT}
         WHERE ${cond}
           AND ol.status = 'active'
         ORDER BY r.date DESC NULLS LAST, ol.id DESC`,
        [param],
      ));
    }

    res.json(rows);
  } catch (err) {
    console.error("[odLoansByCustomer]", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/od-loans/list ───────────────────────────────────────
// Returns all OD loans (active + closed) joined with fd_accounts so the
// FD ACC column in the OD Loans list page is always populated.
// Supports ?status=active|closed, ?q=search, ?limit=, ?offset=
async function odLoansList(req, res) {
  try {
    const { status, q, limit = 100, offset = 0 } = req.query;
    const where = [];
    const params = [];
    let pi = 1;

    if (status && status !== 'all') {
      where.push(`ol.status = $${pi++}`);
      params.push(status);
    }
    if (q) {
      where.push(
        `(LOWER(ol.customer_name) LIKE $${pi} OR ol.loan_acc_no LIKE $${pi} OR ol.fd_acc_no LIKE $${pi} OR ol.aadhar LIKE $${pi} OR ol.mobile LIKE $${pi})`,
      );
      params.push(`%${q.toLowerCase()}%`);
      pi++;
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM od_loans ol ${whereClause}`,
      params,
    );
    const total = parseInt(countRes.rows[0].total);

    const lim = Math.min(parseInt(limit) || 100, 500);
    const off = parseInt(offset) || 0;

    const { rows } = await pool.query(
      `SELECT
         ol.id,
         ol.record_id,
         ol.loan_acc_no,
         COALESCE(
           NULLIF(ol.fd_acc_no,''),
           NULLIF(r.data->>'fd_acc_no',''),
           NULLIF(r.data->>'mis_acc_no','')
         )                                             AS fd_acc_no,
         NULLIF(r.data->>'mis_acc_no','')             AS mis_acc_no,
         ol.customer_name,
         ol.aadhar,
         ol.mobile,
         ol.loan_amount,
         ol.fd_amount,
         ol.fd_maturity_date                          AS end_date,
         ol.status,
         ol.closed_date,
         r.date                                        AS start_date,
         -- balance: for active loans use loan_amount; for closed use 0
         CASE WHEN ol.status = 'active' THEN ol.loan_amount ELSE 0 END AS balance,
         -- interest rate from fd_accounts or records.data
         COALESCE(
           fa.fd_interest_rate,
           NULLIF(r.data->>'fd_interest_rate','')::numeric
         )                                             AS rate,
         -- FD acc details from fd_accounts (authoritative) with fallback to records.data
         COALESCE(
           NULLIF(fa.fd_acc_no,''),
           NULLIF(r.data->>'fd_acc_no',''),
           NULLIF(r.data->>'mis_acc_no','')
         )                                             AS linked_fd_acc_no,
         fa.fd_parvati_no,
         fa.status                                     AS fd_status
       FROM od_loans ol
       LEFT JOIN records r  ON r.id = ol.record_id AND r.is_deleted = FALSE
       LEFT JOIN fd_accounts fa
         ON (
           (ol.fd_acc_no IS NOT NULL AND ol.fd_acc_no <> '' AND fa.fd_acc_no = ol.fd_acc_no)
           OR (ol.fd_acc_no IS NOT NULL AND ol.fd_acc_no <> '' AND fa.mis_acc_no = ol.fd_acc_no)
           OR (fa.fd_acc_no = r.data->>'fd_acc_no' AND r.data->>'fd_acc_no' <> '')
           OR (fa.mis_acc_no = r.data->>'mis_acc_no' AND r.data->>'mis_acc_no' <> '')
         )
       ${whereClause}
       ORDER BY ol.id DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, lim, off],
    );

    res.json({ records: rows, total, limit: lim, offset: off });
  } catch (err) {
    console.error("[odLoansList]", err.message);
    res.status(500).json({ error: err.message });
  }
}


// ── GET /api/records/gold-loans/list  (also served as /api/combined/gold-loans) ──
// Returns gold loans joined with records so the Gold Loans list page is always
// populated. Supports ?status=active|closed|all, ?q=search, ?limit=, ?offset=
async function goldLoansList(req, res) {
  try {
    const { status, q, limit = 100, offset = 0 } = req.query;
    const where = [];
    const params = [];
    let pi = 1;

    if (status && status !== 'all') {
      where.push(`gl.status = $${pi++}`);
      params.push(status);
    }
    if (q) {
      where.push(
        `(LOWER(gl.customer_name) LIKE $${pi} OR gl.loan_acc_no LIKE $${pi} OR gl.aadhar LIKE $${pi} OR gl.mobile LIKE $${pi})`,
      );
      params.push(`%${q.toLowerCase()}%`);
      pi++;
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM gold_loans gl ${whereClause}`,
      params,
    );
    const total = parseInt(countRes.rows[0].total);

    const lim = Math.min(parseInt(limit) || 100, 500);
    const off = parseInt(offset) || 0;

    const { rows } = await pool.query(
      `SELECT
         gl.id,
         gl.record_id,
         gl.loan_acc_no,
         gl.acc_no,
         gl.customer_name,
         gl.aadhar,
         gl.mobile,
         gl.loan_amount,
         gl.loan_date                                   AS start_date,
         gl.status,
         gl.closed_date,
         COALESCE(
           NULLIF(r.data->>'loan_end_date', ''),
           NULLIF(r.data->>'end_date', '')
         )                                              AS end_date,
         COALESCE(
           NULLIF(r.data->>'interest_rate', '')::numeric,
           NULLIF(r.data->>'loan_interest_rate', '')::numeric
         )                                              AS rate,
         CASE WHEN gl.status = 'active' THEN gl.loan_amount ELSE 0 END AS balance
       FROM gold_loans gl
       LEFT JOIN records r ON r.id = gl.record_id AND r.is_deleted = FALSE
       ${whereClause}
       ORDER BY gl.id DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, lim, off],
    );

    res.json({ records: rows, total, limit: lim, offset: off });
  } catch (err) {
    console.error('[goldLoansList]', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/records/od-loans/backfill-fd-acc ───────────────────────────
// One-time / idempotent fix: for every od_loans row where fd_acc_no IS NULL,
// read fd_acc_no from the parent records.data JSONB and write it back.
// FIX 8 (MEDIUM): only backfill values that match the strict 14-digit format.
async function odLoansBackfillFdAcc(req, res) {
  try {
    // Pass 1: 14-digit term FD accounts
    const { rows: rows1 } = await pool.query(
      `UPDATE od_loans ol
       SET fd_acc_no = r.data->>'fd_acc_no',
           updated_at = NOW()
       FROM records r
       WHERE ol.record_id = r.id
         AND r.is_deleted = FALSE
         AND (ol.fd_acc_no IS NULL OR ol.fd_acc_no = '')
         AND (r.data->>'fd_acc_no' IS NOT NULL AND r.data->>'fd_acc_no' <> '')
         AND (r.data->>'fd_acc_no' ~ '^[0-9]{14}$')
       RETURNING ol.id, ol.loan_acc_no, ol.fd_acc_no`,
    );
    // Pass 2: MIS FD accounts (290-xxx format stored in mis_acc_no)
    const { rows: rows2 } = await pool.query(
      `UPDATE od_loans ol
       SET fd_acc_no = r.data->>'mis_acc_no',
           updated_at = NOW()
       FROM records r
       WHERE ol.record_id = r.id
         AND r.is_deleted = FALSE
         AND (ol.fd_acc_no IS NULL OR ol.fd_acc_no = '')
         AND (r.data->>'mis_acc_no' IS NOT NULL AND r.data->>'mis_acc_no' <> '')
         AND (r.data->>'fd_acc_no' IS NULL OR r.data->>'fd_acc_no' = '')
       RETURNING ol.id, ol.loan_acc_no, ol.fd_acc_no`,
    );
    const rows = [...rows1, ...rows2];
    res.json({ updated: rows.length, rows, pass1: rows1.length, pass2: rows2.length });
  } catch (err) {
    console.error("[odLoansBackfillFdAcc]", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/records/gold-loans/backfill ────────────────────────────────
// One-time / idempotent fix: for every gold_loans row where loan_amount IS NULL,
// read loan_amount from the parent records.data JSONB and write it back.
// FIX 3 (HIGH): only fill NULL (not = 0) — a 0 amount is a legitimate value.
// FIX 8 (MEDIUM): validate numeric format before casting to avoid DB errors.
async function goldLoansBackfill(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE gold_loans gl
       SET loan_amount = (r.data->>'loan_amount')::numeric,
           updated_at = NOW()
       FROM records r
       WHERE gl.record_id = r.id
         AND r.is_deleted = FALSE
         AND gl.loan_amount IS NULL
         AND (r.data->>'loan_amount' IS NOT NULL AND r.data->>'loan_amount' <> '')
         AND (r.data->>'loan_amount' ~ '^[0-9]+(\\.[0-9]+)?$')
       RETURNING gl.id, gl.loan_acc_no, gl.loan_amount`,
    );
    res.json({ updated: rows.length, rows });
  } catch (err) {
    console.error("[goldLoansBackfill]", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/next-saving-acc-no/:prefix ───────────────────────────
async function nextSavingAccNo(req, res) {
  try {
    const prefix = req.params.prefix;
    const prefixPadded = String(prefix).padStart(4, "0");
    const fullPrefix14 = `0011${prefixPadded}`;
    const likePattern14 = fullPrefix14 + "%";
    const likePatternShort = prefix + "-%";
    const escapedShort =
      "^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-";

    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(v), 0) AS max_num FROM (
         SELECT CASE
           WHEN data->>'saving_acc_no' ~ '^[0-9]{14}$'
            AND SUBSTRING(data->>'saving_acc_no', 1, 8) = $1
           THEN SUBSTRING(data->>'saving_acc_no', 9, 6)::integer
           ELSE NULL END AS v
         FROM records WHERE is_deleted=FALSE AND data->>'saving_acc_no' LIKE $2
         UNION ALL
         SELECT CASE
           WHEN REGEXP_REPLACE(data->>'saving_acc_no', $3, '') ~ '^[0-9]+$'
           THEN REGEXP_REPLACE(data->>'saving_acc_no', $3, '')::integer
           ELSE NULL END AS v
         FROM records WHERE is_deleted=FALSE AND data->>'saving_acc_no' LIKE $4
         UNION ALL
         SELECT CASE
           WHEN saving_acc_no ~ '^[0-9]{14}$'
            AND SUBSTRING(saving_acc_no, 1, 8) = $1
           THEN SUBSTRING(saving_acc_no, 9, 6)::integer
           ELSE NULL END AS v
         FROM saving_accounts WHERE saving_acc_no LIKE $2
         UNION ALL
         SELECT CASE
           WHEN REGEXP_REPLACE(saving_acc_no, $3, '') ~ '^[0-9]+$'
           THEN REGEXP_REPLACE(saving_acc_no, $3, '')::integer
           ELSE NULL END AS v
         FROM saving_accounts WHERE saving_acc_no LIKE $4
       ) combined`,
      [fullPrefix14, likePattern14, escapedShort, likePatternShort],
    );
    const next = (parseInt(rows[0].max_num) || 0) + 1;
    res.json({ next: `${fullPrefix14}${String(next).padStart(6, "0")}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/customer-full-data ──────────────────────────────────
// Returns merged data from ALL records for this customer so the form can
// auto-fill nominee, referral, account numbers, fd details etc.
async function customerFullData(req, res) {
  try {
    // BUG FIX: was destructuring only { name, aadhar, mobile } — customer_id was
    // silently discarded even though app.js now correctly sends ?customer_id=.
    // For customers with no aadhar/mobile the 400 guard fired immediately,
    // leaving every form field blank. customer_id is now the primary lookup key.
    const { customer_id, name, aadhar, mobile } = req.query;
    if (!customer_id && !name && !aadhar && !mobile)
      return res
        .status(400)
        .json({ error: "Provide customer_id, name, aadhar, or mobile" });

    const conds = [],
      params = [];
    let pi = 1;
    if (customer_id) {
      conds.push(`r.customer_id = $${pi++}`);
      params.push(customer_id);
    }
    if (aadhar) {
      conds.push(`r.aadhar = $${pi++}`);
      params.push(aadhar);
    }
    if (mobile) {
      conds.push(`r.mobile = $${pi++}`);
      params.push(mobile);
    }
    if (name) {
      conds.push(`LOWER(r.name) LIKE $${pi++}`);
      params.push(`%${name.toLowerCase()}%`);
    }

    // Newest first — merge all records, oldest first so newest wins
    const { rows } = await pool.query(
      `SELECT r.id, r.section, r.date, r.data, r.name, r.aadhar,
              r.mobile, r.customer_id, r.account_no
       FROM records r
       WHERE is_deleted = FALSE AND (${conds.join(" OR ")})
       ORDER BY r.id DESC LIMIT 50`,
      params,
    );

    if (!rows.length) return res.json({});

    // Merge: oldest → newest so newest values win
    const merged = {};
    [...rows].reverse().forEach((row) => {
      const d =
        typeof row.data === "string"
          ? (() => {
              try {
                return JSON.parse(row.data);
              } catch {
                return {};
              }
            })()
          : row.data || {};
      Object.entries(d).forEach(([k, v]) => {
        if (v != null && v !== "") merged[k] = v;
      });
    });

    // Top-level fields from most recent record always win
    const latest = rows[0];
    merged.customer_name = latest.name || merged.customer_name;
    merged.aadhar = latest.aadhar || merged.aadhar;
    merged.mobile = latest.mobile || merged.mobile;
    merged.customer_id = latest.customer_id || merged.customer_id;

    // Overlay customers table (pan/dob/address/occupation/saving_acc_no/saving_balance/share_acc_no
    // and the 6 PDF fields: gender/marital_status/caste/religion/qualification/passport_no)
    try {
      const custConds = [],
        custParams = [];
      let ci = 1;
      // FIX: prefer customer_id lookup (most precise) — old code skipped it entirely
      if (customer_id) {
        custConds.push(`customer_id = $${ci++}`);
        custParams.push(customer_id);
      }
      if (aadhar) {
        custConds.push(`aadhar = $${ci++}`);
        custParams.push(aadhar);
      }
      if (mobile) {
        custConds.push(`mobile = $${ci++}`);
        custParams.push(mobile);
      }
      if (!custConds.length && name) {
        custConds.push(`LOWER(name) LIKE $${ci++}`);
        custParams.push(`%${name.toLowerCase()}%`);
      }

      const { rows: custRows } = await pool.query(
        `SELECT pan, dob, address, occupation, saving_acc_no, saving_balance, share_acc_no,
                gender, marital_status, caste, religion, qualification, passport_no
         FROM customers WHERE ${custConds.join(" OR ")} LIMIT 1`,
        custParams,
      );
      if (custRows.length) {
        const c = custRows[0];
        if (c.pan) merged.pan = c.pan;
        if (c.dob) merged.dob = c.dob;
        if (c.address) merged.address = c.address;
        if (c.occupation) merged.occupation = c.occupation;
        if (c.saving_acc_no) merged.saving_acc_no = c.saving_acc_no;
        if (c.share_acc_no) merged.share_acc_no = c.share_acc_no;
        if (c.gender) merged.gender = c.gender;
        if (c.marital_status) merged.marital_status = c.marital_status;
        if (c.caste) merged.caste = c.caste;
        if (c.religion) merged.religion = c.religion;
        if (c.qualification) merged.qualification = c.qualification;
        if (c.passport_no) merged.passport_no = c.passport_no;
        // saving_balance: prefer the live value from saving_accounts over the
        // cached value in customers (which may be stale between deposit syncs)
        const accNo = c.saving_acc_no || merged.saving_acc_no;
        if (accNo) {
          try {
            const { rows: saRows } = await pool.query(
              `SELECT balance FROM saving_accounts WHERE saving_acc_no=$1 AND status<>'closed' LIMIT 1`,
              [accNo],
            );
            if (saRows.length) {
              merged.saving_balance = saRows[0].balance;
            } else if (c.saving_balance != null) {
              merged.saving_balance = c.saving_balance;
            }
          } catch (_) {
            if (c.saving_balance != null)
              merged.saving_balance = c.saving_balance;
          }
        } else if (c.saving_balance != null) {
          merged.saving_balance = c.saving_balance;
        }
      }
    } catch (_) {}

    res.json({
      ...merged,
      // Normalize saving_balance to a number — it may be stored as string in the
      // JSONB blob (written by the deposit sync as String(newBal)) but the
      // frontend expects a numeric value for display and arithmetic.
      saving_balance:
        merged.saving_balance != null
          ? isNaN(Number(merged.saving_balance))
            ? 0
            : Number(merged.saving_balance)
          : 0,
    });
  } catch (err) {
    console.error("[customerFullData]", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/check-saving-acc-no/:no ─────────────────────────────
async function checkSavingAccNo(req, res) {
  try {
    const no = req.params.no;

    // Check records table first (section='saving' with account_no)
    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.date, r.status
       FROM records r
       WHERE r.is_deleted=FALSE AND r.section='saving' AND r.account_no=$1
       ORDER BY r.id DESC LIMIT 1`,
      [no],
    );
    if (rows.length) {
      const r = rows[0];
      return res.json({
        exists: true,
        record: { id: r.id, name: r.name, date: r.date, status: r.status },
      });
    }

    // Also check saving_accounts table (created via membership/New Sadasya flow)
    const { rows: saRows } = await pool.query(
      `SELECT sa.id, sa.customer_name AS name, sa.status, r.date
       FROM saving_accounts sa
       LEFT JOIN records r ON r.id = sa.record_id AND r.is_deleted = FALSE
       WHERE sa.saving_acc_no=$1
       ORDER BY sa.id DESC LIMIT 1`,
      [no],
    );
    if (!saRows.length) return res.json({ exists: false });
    const s = saRows[0];
    res.json({
      exists: true,
      record: { id: s.id, name: s.name, date: s.date, status: s.status },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/next-customer-id ────────────────────────────────────
// Returns the next available 10-digit zero-padded customer ID
// Sources: records.customer_id AND customers.customer_id
async function nextCustomerId(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(v), 0) AS max_num FROM (
         SELECT CASE
           WHEN customer_id ~ '^[0-9]{10}$'
           THEN customer_id::bigint
           ELSE NULL END AS v
         FROM records WHERE is_deleted = FALSE AND customer_id IS NOT NULL

         UNION ALL

         SELECT CASE
           WHEN customer_id ~ '^[0-9]{10}$'
           THEN customer_id::bigint
           ELSE NULL END AS v
         FROM customers WHERE customer_id IS NOT NULL
       ) combined`,
    );
    const next = (parseInt(rows[0].max_num) || 0) + 1;
    res.json({ next: String(next).padStart(10, "0") });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/next-share-acc-no/:prefix ───────────────────────────
// prefix: "34" for Sadasya, "36" for Naammatr Sabhasad
// Returns next 14-digit share account number in format: 0011{prefix}XXXXXX
// Sources: records.data->>'share_acc_no' AND memberships.share_acc_no AND customers.share_acc_no
async function nextShareAccNo(req, res) {
  try {
    const prefix = req.params.prefix; // e.g. "34" or "36"
    // BUG FIX: '%34%' matched any acc number containing "34" anywhere
    // (e.g. 00110036000034 would falsely match a prefix-34 query).
    // Use the full 8-char fixed prefix so LIKE only matches the correct format.
    const prefixPadded = String(prefix).padStart(4, "0");
    const likePattern = `0011${prefixPadded}%`;
    // Extract the numeric suffix (last 6 digits) from 14-digit share acc nos
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(v), 0) AS max_num FROM (
         SELECT CASE
           WHEN data->>'share_acc_no' ~ '^[0-9]{14}$'
            AND SUBSTRING(data->>'share_acc_no', 7, 2) = $1
           THEN SUBSTRING(data->>'share_acc_no', 9, 6)::integer
           ELSE NULL END AS v
         FROM records WHERE is_deleted = FALSE AND data->>'share_acc_no' LIKE $2

         UNION ALL

         SELECT CASE
           WHEN share_acc_no ~ '^[0-9]{14}$'
            AND SUBSTRING(share_acc_no, 7, 2) = $1
           THEN SUBSTRING(share_acc_no, 9, 6)::integer
           ELSE NULL END AS v
         FROM memberships WHERE share_acc_no LIKE $2

         UNION ALL

         SELECT CASE
           WHEN share_acc_no ~ '^[0-9]{14}$'
            AND SUBSTRING(share_acc_no, 7, 2) = $1
           THEN SUBSTRING(share_acc_no, 9, 6)::integer
           ELSE NULL END AS v
         FROM customers WHERE share_acc_no LIKE $2
       ) combined`,
      [prefix, likePattern],
    );
    const next = (parseInt(rows[0].max_num) || 0) + 1;
    // Format: 0011 + prefix(2) + suffix(6) = 14 digits total
    // e.g. prefix=34 → "00110034" + "000001" = "00110034000001"
    const suffix = String(next).padStart(6, "0");
    res.json({ next: `0011${String(prefix).padStart(4, "0")}${suffix}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/check-share-acc-no/:no ──────────────────────────────
// Checks the same three sources nextShareAccNo draws from: records.data
// ->>'share_acc_no', memberships.share_acc_no, customers.share_acc_no.
async function checkShareAccNo(req, res) {
  try {
    const no = req.params.no;

    // Check records table first (data->>'share_acc_no', JSONB field)
    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.date, r.status
       FROM records r
       WHERE r.is_deleted=FALSE AND r.data->>'share_acc_no'=$1
       ORDER BY r.id DESC LIMIT 1`,
      [no],
    );
    if (rows.length) {
      const r = rows[0];
      return res.json({
        exists: true,
        record: { id: r.id, name: r.name, date: r.date, status: r.status },
      });
    }

    // Also check memberships table
    const { rows: memRows } = await pool.query(
      `SELECT m.id, m.customer_name AS name, m.status, r.date
       FROM memberships m
       LEFT JOIN records r ON r.id = m.record_id AND r.is_deleted = FALSE
       WHERE m.share_acc_no=$1
       ORDER BY m.id DESC LIMIT 1`,
      [no],
    );
    if (memRows.length) {
      const m = memRows[0];
      return res.json({
        exists: true,
        record: { id: m.id, name: m.name, date: m.date, status: m.status },
      });
    }

    // Also check customers table
    const { rows: custRows } = await pool.query(
      `SELECT c.id, c.name, c.share_acc_no
       FROM customers c
       WHERE c.share_acc_no=$1
       ORDER BY c.id DESC LIMIT 1`,
      [no],
    );
    if (!custRows.length) return res.json({ exists: false });
    const c = custRows[0];
    res.json({
      exists: true,
      record: { id: c.id, name: c.name, date: null, status: null },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/next-od-acc-no/:prefix ───────────────────────────────
// Returns next 14-digit loan_acc_no: prefix + 6-digit zero-padded sequence.
// Queries od_loans.loan_acc_no (authoritative) — mirrors nextFdAccNo below.
// BUG FIX: previously generated a "prefix-NNN" dash format (e.g. "17-001"),
// which doesn't match the real 14-digit account numbers shown on the OD
// Loans dashboard (e.g. "00104017000106"), and was one of the sources that
// let a malformed loan_acc_no reach od_loans / cashbook_entries unchecked.
async function nextOdAccNo(req, res) {
  try {
    let prefix = req.params.prefix;
    if (!/^\d{6,}$/.test(prefix)) {
      return res.status(400).json({
        error: `Invalid loan_acc_no prefix "${prefix}". Must be numeric digits only (e.g. "00104017"). Dash formats are not allowed.`,
      });
    }
    // BUG FIX: same class of bug as nextFdAccNo above — a full 14-digit
    // loan_acc_no passed as "prefix" (e.g. from the closing-form's "Use
    // next" button after typing an existing account number with no dash)
    // made the SUBSTRING below come back empty, crashing with a 500.
    if (prefix.length > 8) prefix = prefix.slice(0, 8);
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(v), 0) AS max_num FROM (
         SELECT CASE
           WHEN loan_acc_no ~ '^[0-9]{14}$'
            AND SUBSTRING(loan_acc_no, 1, $2) = $1
           THEN SUBSTRING(loan_acc_no, $2 + 1, 6)::integer
           ELSE NULL END AS v
         FROM od_loans WHERE loan_acc_no LIKE $3
         UNION ALL
         SELECT CASE
           WHEN data->>'loan_acc_no' ~ '^[0-9]{14}$'
            AND SUBSTRING(data->>'loan_acc_no', 1, $2) = $1
           THEN SUBSTRING(data->>'loan_acc_no', $2 + 1, 6)::integer
           ELSE NULL END AS v
         FROM records WHERE is_deleted=FALSE AND section='od' AND data->>'loan_acc_no' LIKE $3
       ) combined`,
      [prefix, prefix.length, prefix + "%"],
    );
    const next = (parseInt(rows[0].max_num) || 0) + 1;
    res.json({ next: `${prefix}${String(next).padStart(6, "0")}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/check-od-acc-no/:no ─────────────────────────────────
// BUG FIX: previously checked records.account_no ONLY. For "Closing - OD"
// records, records.account_no is deliberately suffixed ("<loan_acc_no>-C")
// to avoid the unique-index collision with the original loan row, so a
// lookup by the plain loan_acc_no never matched it here — the same class of
// drift bug checkLoanNo (gold) already guards against. Now also checks
// od_loans.loan_acc_no, mirroring checkLoanNo's two-source approach.
async function checkOdAccNo(req, res) {
  try {
    const no = req.params.no;
    if (!isValidOdAccNo(no)) {
      return res.status(400).json({
        error: `Invalid loan_acc_no "${no}". Must be exactly 14 numeric digits (e.g. "00104017000106").`,
      });
    }

    // 1. Check records.account_no (primary source)
    const { rows: recRows } = await pool.query(
      `SELECT id, name, date, status, closed_date, account_no
       FROM records WHERE is_deleted=FALSE AND section='od' AND account_no=$1
       ORDER BY id DESC LIMIT 1`,
      [no],
    );
    if (recRows.length) {
      const r = recRows[0];
      return res.json({
        exists: true,
        source: "records.account_no",
        record: {
          id: r.id,
          name: r.name,
          date: r.date,
          status: r.status,
          closed_date: r.closed_date,
          account_no: r.account_no,
        },
      });
    }

    // 2. Check od_loans.loan_acc_no (may differ from records if they drifted)
    const { rows: odRows } = await pool.query(
      `SELECT r.id, r.name, r.date, r.status, r.closed_date, ol.loan_acc_no AS account_no
       FROM od_loans ol
       JOIN records r ON r.id = ol.record_id AND r.is_deleted = FALSE
       WHERE ol.loan_acc_no = $1
       ORDER BY r.id DESC LIMIT 1`,
      [no],
    );
    if (odRows.length) {
      const r = odRows[0];
      return res.json({
        exists: true,
        source: "od_loans.loan_acc_no",
        record: {
          id: r.id,
          name: r.name,
          date: r.date,
          status: r.status,
          closed_date: r.closed_date,
          account_no: r.account_no,
        },
      });
    }

    res.json({ exists: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/check-customer-id/:id ────────────────────────────────
async function checkCustomerId(req, res) {
  try {
    const custId = req.params.id;
    const { rows } = await pool.query(
      `SELECT id, name, aadhar, mobile, customer_id
       FROM customers WHERE customer_id=$1 LIMIT 1`,
      [custId],
    );
    if (!rows.length) return res.json({ exists: false });
    const c = rows[0];
    res.json({
      exists: true,
      customer: { id: c.id, name: c.name, aadhar: c.aadhar, mobile: c.mobile },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/loan-holder/:groupNo ────────────────────────────────
// Returns the primary loan holder name for a given loan/group number.
// Looks up the original record with that account_no to get the customer name.
async function loanHolder(req, res) {
  try {
    const groupNo = req.params.groupNo;
    // First try: direct account_no match (the original loan)
    const { rows } = await pool.query(
      `SELECT name AS customerName, account_no
       FROM records
       WHERE is_deleted=FALSE
         AND account_no=$1
       ORDER BY id ASC LIMIT 1`,
      [groupNo],
    );
    if (rows.length)
      return res.json({
        customerName: rows[0].customerName,
        account_no: rows[0].account_no,
      });

    res.json({ customerName: "" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/saving-balance/:accNo ──────────────────────────────
// Returns the live balance for a saving account directly from saving_accounts table.
// Used by the frontend deposit/withdrawal form to show current balance instantly.
async function getSavingBalance(req, res) {
  try {
    const accNo = (req.params.accNo || "").trim();
    if (!accNo)
      return res.status(400).json({ error: "Account number required" });

    // 1. Exact match by saving_acc_no
    const { rows } = await pool.query(
      `SELECT sa.saving_acc_no, sa.balance, sa.status, sa.customer_name,
              r.name, r.date
       FROM saving_accounts sa
       LEFT JOIN records r ON r.id = sa.record_id AND r.is_deleted = FALSE
       WHERE sa.saving_acc_no = $1
       ORDER BY sa.id DESC LIMIT 1`,
      [accNo],
    );
    if (rows.length) {
      const row = rows[0];
      return res.json({
        found: true,
        balance: parseFloat(row.balance) || 0,
        status: row.status,
        customer_name: row.customer_name || row.name || "",
        date: row.date,
      });
    }

    // 2. Not found — try fuzzy name match using ?name= query param so staff can
    //    recover when they type the wrong account number.
    const namePart = (req.query.name || "").trim().toLowerCase();
    if (!namePart || namePart.length < 3) {
      return res.json({ found: false, balance: 0, suggestions: [] });
    }
    const { rows: sug } = await pool.query(
      `SELECT sa.saving_acc_no, sa.balance, sa.status,
              COALESCE(sa.customer_name, r.name) AS customer_name, r.date
       FROM saving_accounts sa
       LEFT JOIN records r ON r.id = sa.record_id AND r.is_deleted = FALSE
       WHERE LOWER(COALESCE(sa.customer_name, r.name, '')) LIKE $1
         AND sa.status = 'active'
       ORDER BY sa.balance DESC LIMIT 5`,
      ["%" + namePart + "%"],
    );
    return res.json({
      found: false,
      balance: 0,
      suggestions: sug.map((r) => ({
        saving_acc_no: r.saving_acc_no,
        balance: parseFloat(r.balance) || 0,
        status: r.status,
        customer_name: r.customer_name || "",
        date: r.date,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/reports/daily-summary?date=YYYY-MM-DD ──────────────────────────
// Mirrors the canonical implementation in dashboard_routes.js so that both
// /api/records/daily-summary and /api/reports/daily-summary return identical data.
async function dailySummary(req, res) {
  try {
    const date = req.query.date || getTodayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });

    const [cbRes, secRes] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN LOWER(tx_type)='credit' THEN amount ELSE 0 END), 0) AS total_in,
           COALESCE(SUM(CASE WHEN LOWER(tx_type)='debit'  THEN amount ELSE 0 END), 0) AS total_out,
           COUNT(*) AS entries
         FROM cashbook_entries
         WHERE date = $1 AND is_deleted = FALSE`,
        [date]
      ),
      pool.query(
        `SELECT
           section,
           COUNT(CASE WHEN date        = $1 THEN 1 END) AS opened,
           COUNT(CASE WHEN closed_date = $1 THEN 1 END) AS closed
         FROM records
         WHERE (date = $1 OR closed_date = $1)
           AND is_deleted = FALSE
           AND section IS NOT NULL
         GROUP BY section
         ORDER BY section`,
        [date]
      ),
    ]);

    const cb = cbRes.rows[0] || {};
    res.json({
      date,
      cashbook: {
        total_in:  parseFloat(cb.total_in)  || 0,
        total_out: parseFloat(cb.total_out) || 0,
        entries:   parseInt(cb.entries)     || 0,
      },
      sections: secRes.rows.map((r) => ({
        section: r.section,
        opened:  parseInt(r.opened) || 0,
        closed:  parseInt(r.closed) || 0,
      })),
    });
  } catch (err) {
    console.error("[daily-summary]", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/records/customers/:id/profile ────────────────────────────────
async function customerProfile(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid customer id' });

    const pool = require('../db/pool');

    // FIX (found while testing the new duplicate-account-opening guard,
    // 2026-09): this function's queries filtered on r.customer_id (records'
    // TEXT business code, e.g. "0000000012") compared against $1 (the
    // NUMERIC customers.id from the URL) — that comparison can never match a
    // real row, so gold/saving/fd/od/memberships were silently returning
    // EMPTY for every customer, and the shares query didn't even get that
    // far: share_accounts has no record_id column at all (see
    // pdf_sync.routes.js's shares case and migrations.js v11's comment), so
    // "JOIN records r ON r.id = sh.record_id" threw "column sh.record_id
    // does not exist" and 500'd the whole endpoint (Promise.all rejects as
    // soon as any one query fails). Also dropped the "AND x.is_deleted =
    // FALSE" filters — none of these mirror tables have an is_deleted
    // column (only records does); status='closed' is how a closed account
    // is represented here, not a soft-delete flag.
    // Fixed to join every mirror table directly on its OWN customer_id
    // column instead — this is the exact pattern already proven correct
    // (and load-bearing) in combined.routes.js and shares.memberships.routes.js.
    const [custR, goldR, savingR, fdR, odR, sharesR, memR] = await Promise.all([
      pool.query(`SELECT * FROM customers WHERE id=$1`, [id]),
      pool.query(
        `SELECT
           gl.loan_acc_no AS acc_no,
           gl.loan_amount,
           CASE WHEN gl.status = 'active' THEN gl.loan_amount ELSE 0 END AS balance,
           COALESCE(
             NULLIF(r.data->>'interest_rate', '')::numeric,
             NULLIF(r.data->>'loan_interest_rate', '')::numeric
           ) AS interest_rate,
           COALESCE(
             NULLIF(r.data->>'loan_end_date', ''),
             NULLIF(r.data->>'end_date', '')
           ) AS end_date,
           gl.status
         FROM gold_loans gl
         LEFT JOIN records r ON r.id = gl.record_id AND r.is_deleted = FALSE
         WHERE gl.customer_id = $1
         ORDER BY gl.status = 'active' DESC, gl.loan_acc_no`,
        [id],
      ),
      pool.query(
        `SELECT
           sa.saving_acc_no AS acc_no,
           sa.balance,
           sa.interest_rate,
           sa.status
         FROM saving_accounts sa
         WHERE sa.customer_id = $1
         ORDER BY sa.status = 'active' DESC, sa.saving_acc_no`,
        [id],
      ),
      pool.query(
        `SELECT
           fa.fd_acc_no AS acc_no,
           COALESCE(
             NULLIF(fa.fd_amount::text, '0'),
             NULLIF(r.data->>'fd_amount', '')
           )::numeric AS fd_amount,
           COALESCE(
             fa.fd_maturity_amount,
             NULLIF(r.data->>'fd_maturity_amount','')::numeric
           ) AS maturity_amount,
           fa.fd_interest_rate AS interest_rate,
           COALESCE(
             fa.fd_maturity_date::text,
             NULLIF(r.data->>'fd_maturity_date','')
           ) AS end_date,
           fa.status
         FROM fd_accounts fa
         LEFT JOIN records r ON r.id = fa.record_id AND r.is_deleted = FALSE
         WHERE fa.customer_id = $1
         ORDER BY fa.status = 'active' DESC, fa.fd_acc_no`,
        [id],
      ),
      pool.query(
        `SELECT
           ol.loan_acc_no AS acc_no,
           ol.loan_amount,
           COALESCE(
             NULLIF(ol.fd_acc_no, ''),
             NULLIF(r.data->>'fd_acc_no', ''),
             NULLIF(r.data->>'mis_acc_no', '')
           ) AS fd_acc_no,
           fa.fd_interest_rate AS interest_rate,
           ol.status
         FROM od_loans ol
         LEFT JOIN records r ON r.id = ol.record_id AND r.is_deleted = FALSE
         LEFT JOIN fd_accounts fa
           ON fa.status = 'active'
          AND (
            (ol.fd_acc_no IS NOT NULL AND ol.fd_acc_no <> '' AND fa.fd_acc_no = ol.fd_acc_no)
            OR (ol.fd_acc_no IS NOT NULL AND ol.fd_acc_no <> '' AND fa.mis_acc_no = ol.fd_acc_no)
            OR (fa.fd_acc_no = r.data->>'fd_acc_no' AND r.data->>'fd_acc_no' <> '')
            OR (fa.mis_acc_no = r.data->>'mis_acc_no' AND r.data->>'mis_acc_no' <> '')
          )
         WHERE ol.customer_id = $1
         ORDER BY ol.status = 'active' DESC, ol.loan_acc_no`,
        [id],
      ),
      pool.query(
        `SELECT sh.acc_no, sh.balance, sh.status
         FROM share_accounts sh
         WHERE sh.customer_id = $1
         ORDER BY sh.acc_no`,
        [id],
      ),
      pool.query(
        `SELECT m.acc_no, m.membership_type, m.status
         FROM memberships m
         WHERE m.customer_id = $1
         ORDER BY m.acc_no`,
        [id],
      ),
    ]);

    if (!custR.rows.length) return res.json({ customer: null });

    res.json({
      customer:        custR.rows[0],
      gold_loans:      goldR.rows,
      saving_accounts: savingR.rows,
      fd_accounts:     fdR.rows,
      od_loans:        odR.rows,
      shares:          sharesR.rows,
      memberships:     memR.rows,
    });
  } catch (err) {
    console.error('[customerProfile]', err.message);
    res.status(500).json({ error: err.message });
  }
}


// ── GET /api/records/statement/:id ─────────────────────────────────────────
// Feature: "Account Statement" (admin.html's Passbook page). The page and
// its printStatement() renderer were built and wired to call
// `${API}/statement/${id}` (API = "/api/records"), but this route was never
// added on the backend, so every click 404'd (fell through to the /:id
// generic-CRUD route not matching a 2-segment path, then the catch-all
// app.use("/api/*", ...) 404 handler) — the page has been dead since it was
// built. Reuses the exact query shapes already verified live and correct in
// dashboard.routes.js's GET /api/customers/:id/profile (acc_no read directly
// off each mirror table, joined on that table's own customer_id — the
// pattern established as correct in this file's own customerProfile()
// comment above), plus two additions printStatement() specifically needs
// that no existing endpoint returns: shares.balance aliased as share_amount
// (share_accounts has no separate share-count/share-amount split — balance
// IS the share value), and memberships joined to saving_accounts by acc_no
// to surface a live saving_balance (memberships only stores the linked
// saving_acc_no as text, not a balance of its own).
async function statement(req, res) {
  try {
    const rawId = req.params.id;

    const tryQuery = async (sql, params) => {
      try {
        const result = await pool.query(sql, params);
        return result.rows[0] || null;
      } catch (e) {
        console.error('[statement] lookup query failed:', e.message);
        return null;
      }
    };

    let customer = null;
    if (/^\d+$/.test(rawId)) {
      customer = await tryQuery('SELECT * FROM customers WHERE id = $1 LIMIT 1', [parseInt(rawId, 10)]);
    }
    if (!customer) {
      customer = await tryQuery(
        'SELECT * FROM customers WHERE customer_id = $1 OR cust_code = $1 LIMIT 1',
        [rawId],
      );
    }
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const custId = customer.id;

    const safeQuery = (sql, params) =>
      pool.query(sql, params).catch((e) => {
        console.error('[statement] sub-query failed:', e.message);
        return { rows: [] };
      });

    const [goldLoans, savingAccounts, fdAccounts, odLoans, shares, memberships] =
      await Promise.all([
        safeQuery(
          `SELECT gl.acc_no, gl.loan_amount,
                  COALESCE((r.data->>'balance')::numeric, gl.loan_amount) AS balance,
                  COALESCE((r.data->>'interest_rate')::numeric, 0)        AS interest_rate,
                  COALESCE(gl.loan_date::text, r.date::text)              AS start_date,
                  r.closed_date::text AS end_date,
                  gl.status
           FROM gold_loans gl
           LEFT JOIN records r ON r.id = gl.record_id AND r.is_deleted = FALSE
           WHERE gl.customer_id = $1
           ORDER BY gl.status = 'active' DESC, gl.acc_no`,
          [custId],
        ),
        safeQuery(
          `SELECT acc_no, start_date, interest_rate, balance, status
           FROM saving_accounts WHERE customer_id = $1
           ORDER BY status = 'active' DESC, acc_no`,
          [custId],
        ),
        safeQuery(
          `SELECT acc_no, start_date, end_date, interest_rate,
                  fd_amount, maturity_amount, status
           FROM fd_accounts WHERE customer_id = $1
           ORDER BY status = 'active' DESC, acc_no`,
          [custId],
        ),
        safeQuery(
          `SELECT acc_no, loan_amount, balance, interest_rate, status
           FROM od_loans WHERE customer_id = $1
           ORDER BY status = 'active' DESC, acc_no`,
          [custId],
        ),
        safeQuery(
          `SELECT acc_no, balance AS share_amount, NULL::text AS num_shares, status
           FROM share_accounts WHERE customer_id = $1
           ORDER BY status = 'active' DESC, acc_no`,
          [custId],
        ),
        safeQuery(
          `SELECT m.acc_no, m.membership_type, m.saving_acc_no,
                  sa.balance AS saving_balance, m.status
           FROM memberships m
           LEFT JOIN saving_accounts sa ON sa.acc_no = m.saving_acc_no
           WHERE m.customer_id = $1
           ORDER BY m.status = 'active' DESC, m.acc_no`,
          [custId],
        ),
      ]);

    res.json({
      customer: {
        name: customer.name,
        customer_id: customer.customer_id,
        mobile: customer.mobile,
        aadhar: customer.aadhar,
        pan: customer.pan || customer.pan_no || null,
        dob: customer.dob,
        address: customer.address,
      },
      gold_loans: goldLoans.rows,
      fd_accounts: fdAccounts.rows,
      saving_accounts: savingAccounts.rows,
      od_loans: odLoans.rows,
      shares: shares.rows,
      memberships: memberships.rows,
    });
  } catch (err) {
    console.error('[statement]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  list,
  stats,
  listDeleted,
  getOne,
  create,
  update,
  softDelete,
  softDeletePatch,
  restore,
  permanentDelete,
  close,
  reopen,
  importBulk,
  processTransaction,
  nextLoanNo,
  nextLoanNoAuto,
  checkLoanNo,
  nextFdAccNo,
  checkFdAccNo,
  fdLinkedOdLoans,
  nextMisAccNo,
  checkMisAccNo,
  customerSearch,
  fdAccountsByCustomer,
  odLoansByCustomer,
  odLoansList,
  odLoansBackfillFdAcc,
  goldLoansList,
  goldLoansBackfill,
  nextSavingAccNo,
  checkSavingAccNo,
  nextCustomerId,
  nextShareAccNo,
  checkShareAccNo,
  nextOdAccNo,
  checkOdAccNo,
  checkCustomerId,
  customerFullData,
  customerProfile,
  statement,
  loanHolder,
  getSavingBalance,
  dailySummary,
  upsertCustomer,
};
