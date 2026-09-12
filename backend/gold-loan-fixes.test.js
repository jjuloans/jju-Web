'use strict';
/**
 * Tests for Gold Loan account number bug fixes:
 *
 *   Bug 1 — nextLoanNo: was only scanning records.account_no, missing loans
 *            stored only in gold_loans.loan_acc_no
 *
 *   Bug 2 — acc_no drift: processTransaction upsert never wrote acc_no, so
 *            gold_loans.acc_no and gold_loans.loan_acc_no could diverge
 *
 *   Bug 3 — sonar sub-loans invisible: nextLoanNo and checkLoanNo never
 *            checked records.sonar_sub_no, so sub-loans like "03-1122-A"
 *            were invisible and the system could suggest a colliding number
 *
 *   Bug 4 (ROOT CAUSE) — wrong format: nextLoanNo was hardcoded to query
 *            "03-%" but existing PDF-imported loans use 14-digit format
 *            "00104003xxxxxx". The query always found zero matches and always
 *            returned "03-001" regardless of how many loans already existed.
 *
 * Run with:
 *   node --test tests/gold-loan-fixes.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ─────────────────────────────────────────────────────────────────────────────
// Minimal pool mock
// ─────────────────────────────────────────────────────────────────────────────
let _queryImpl = async () => ({ rows: [] });
const mockPool = { query: async (...args) => _queryImpl(...args) };
function setQuery(impl) { _queryImpl = impl; }

// ─────────────────────────────────────────────────────────────────────────────
// Constants (mirror records.controller.js)
// ─────────────────────────────────────────────────────────────────────────────
const LOAN_14_DIGIT_PREFIX  = '00104003';
const LOAN_14_DIGIT_SEQ_LEN = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Inline re-implementations mirroring the fixed controller logic
// ─────────────────────────────────────────────────────────────────────────────

async function _nextShortLoanNo(prefix) {
  const escapedPrefix = '^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-';
  const likePattern   = prefix + '-%';
  const { rows } = await mockPool.query(
    `SELECT COALESCE(MAX(v), 0) AS max_num FROM (
       SELECT CASE WHEN REGEXP_REPLACE(account_no,$1,'')~'^[0-9]+$'
         THEN REGEXP_REPLACE(account_no,$1,'')::integer ELSE NULL END AS v
       FROM records WHERE account_no LIKE $2 AND is_deleted=FALSE
       UNION ALL
       SELECT CASE WHEN REGEXP_REPLACE(loan_acc_no,$1,'')~'^[0-9]+$'
         THEN REGEXP_REPLACE(loan_acc_no,$1,'')::integer ELSE NULL END AS v
       FROM gold_loans WHERE loan_acc_no LIKE $2
       UNION ALL
       SELECT CASE
         WHEN REGEXP_REPLACE(REGEXP_REPLACE(sonar_sub_no,'-[A-Za-z]+$',''),$1,'')~'^[0-9]+$'
         THEN REGEXP_REPLACE(REGEXP_REPLACE(sonar_sub_no,'-[A-Za-z]+$',''),$1,'')::integer
         ELSE NULL END AS v
       FROM records WHERE sonar_sub_no LIKE $2||'%' AND is_deleted=FALSE
     ) combined`,
    [escapedPrefix, likePattern],
  );
  const next = (parseInt(rows[0].max_num) || 0) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

async function nextLoanNoAuto_fixed(section = 'gold') {
  const shortPrefix = section === 'od' ? '17' : '03';

  const { rows: r14 } = await mockPool.query(
    `SELECT COALESCE(MAX(CASE WHEN account_no~'^[0-9]{14,}$'
       THEN CAST(RIGHT(account_no,$1) AS BIGINT) ELSE NULL END),0) AS max_seq
     FROM records WHERE section=$2 AND account_no LIKE $3 AND is_deleted=FALSE`,
    [LOAN_14_DIGIT_SEQ_LEN, section, LOAN_14_DIGIT_PREFIX + '%'],
  );

  const max14 = parseInt(r14[0].max_seq) || 0;
  if (max14 > 0) {
    const nextSeq = String(max14 + 1).padStart(LOAN_14_DIGIT_SEQ_LEN, '0');
    return { next: `${LOAN_14_DIGIT_PREFIX}${nextSeq}`, format: '14digit' };
  }

  const next = await _nextShortLoanNo(shortPrefix);
  return { next, format: 'short' };
}

async function checkLoanNo_fixed(no) {
  const { rows: r1 } = await mockPool.query(
    `SELECT id,name,date,status,closed_date,account_no FROM records
     WHERE account_no=$1 AND is_deleted=FALSE ORDER BY id DESC LIMIT 1`, [no]);
  if (r1.length) {
    const r = r1[0];
    return { exists:true, source:'records.account_no',
             record:{id:r.id,name:r.name,date:r.date,status:r.status,
                     closed_date:r.closed_date,account_no:r.account_no} };
  }
  const { rows: r2 } = await mockPool.query(
    `SELECT r.id,r.name,r.date,r.status,r.closed_date,gl.loan_acc_no AS account_no
     FROM gold_loans gl JOIN records r ON r.id=gl.record_id AND r.is_deleted=FALSE
     WHERE gl.loan_acc_no=$1 ORDER BY r.id DESC LIMIT 1`, [no]);
  if (r2.length) {
    const r = r2[0];
    return { exists:true, source:'gold_loans.loan_acc_no',
             record:{id:r.id,name:r.name,date:r.date,status:r.status,
                     closed_date:r.closed_date,account_no:r.account_no} };
  }
  const { rows: r3 } = await mockPool.query(
    `SELECT id,name,date,status,closed_date,sonar_sub_no AS account_no
     FROM records WHERE sonar_sub_no=$1 AND is_deleted=FALSE ORDER BY id DESC LIMIT 1`, [no]);
  if (r3.length) {
    const r = r3[0];
    return { exists:true, source:'records.sonar_sub_no',
             record:{id:r.id,name:r.name,date:r.date,status:r.status,
                     closed_date:r.closed_date,account_no:r.account_no} };
  }
  return { exists: false };
}

function buildGoldLoansUpsertArgs(data, record_id, customer_name) {
  const ornamentItems = (() => {
    try {
      const v = typeof data.ornament_items === 'string'
        ? JSON.parse(data.ornament_items) : data.ornament_items;
      return JSON.stringify(Array.isArray(v) ? v : (v ? [v] : []));
    } catch { return '[]'; }
  })();
  const vals = [
    record_id, data.loan_acc_no, data.loan_acc_no,
    customer_name || data.customer_name,
    data.aadhar||null, data.mobile||null,
    parseFloat(data.loan_amount)||0, data.date||null,
    data.metal_type||null, ornamentItems,
    data.sonar_group_no||null, data.sonar_sub_no||null, 'active',
  ];
  const cols = ['record_id','loan_acc_no','acc_no','customer_name','aadhar','mobile',
                'loan_amount','loan_date','metal_type','ornament_items',
                'sonar_group_no','sonar_sub_no','status'];
  return { vals, cols };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 4 — ROOT CAUSE: auto-detect 14-digit format
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 4 (root cause) — nextLoanNoAuto detects 14-digit bank format', () => {

  test('returns 14-digit next number when PDF-imported loans exist', async () => {
    // 1,172 PDF-imported loans; highest sequence is 004773
    setQuery(async () => ({ rows: [{ max_seq: '4773' }] }));
    const result = await nextLoanNoAuto_fixed('gold');
    assert.equal(result.next, '00104003004774');
    assert.equal(result.format, '14digit');
  });

  test('pads sequence to 6 digits', async () => {
    setQuery(async () => ({ rows: [{ max_seq: '9' }] }));
    const result = await nextLoanNoAuto_fixed('gold');
    assert.equal(result.next, '00104003000010');
  });

  test('falls back to short format when no 14-digit loans exist (new DB)', async () => {
    let callCount = 0;
    setQuery(async () => {
      callCount++;
      if (callCount === 1) return { rows: [{ max_seq: '0' }] };  // no 14-digit
      return { rows: [{ max_num: '0' }] };                        // no short either
    });
    const result = await nextLoanNoAuto_fixed('gold');
    assert.equal(result.next, '03-001');
    assert.equal(result.format, 'short');
  });

  test('short format continues correctly from existing short loans', async () => {
    let callCount = 0;
    setQuery(async () => {
      callCount++;
      if (callCount === 1) return { rows: [{ max_seq: '0' }] };   // no 14-digit
      return { rows: [{ max_num: '42' }] };                        // short max = 42
    });
    const result = await nextLoanNoAuto_fixed('gold');
    assert.equal(result.next, '03-043');
    assert.equal(result.format, 'short');
  });

  test('OD loans use 17- prefix when falling back to short format', async () => {
    let callCount = 0;
    setQuery(async () => {
      callCount++;
      if (callCount === 1) return { rows: [{ max_seq: '0' }] };
      return { rows: [{ max_num: '5' }] };
    });
    const result = await nextLoanNoAuto_fixed('od');
    assert.equal(result.next, '17-006');
    assert.equal(result.format, 'short');
  });

  test('queries correct section in WHERE clause', async () => {
    let capturedParams;
    setQuery(async (sql, params) => {
      capturedParams = params;
      return { rows: [{ max_seq: '100' }] };
    });
    await nextLoanNoAuto_fixed('gold');
    assert.equal(capturedParams[1], 'gold', 'section param must be "gold"');
    assert.equal(capturedParams[2], '00104003%', 'LIKE pattern must use 14-digit prefix');
  });

  test('queries with correct sequence length (6)', async () => {
    let capturedParams;
    setQuery(async (sql, params) => {
      capturedParams = params;
      return { rows: [{ max_seq: '100' }] };
    });
    await nextLoanNoAuto_fixed('gold');
    assert.equal(capturedParams[0], 6, 'sequence length param must be 6');
  });

  test('handles null max_seq (empty table) without crashing', async () => {
    setQuery(async () => ({ rows: [{ max_seq: null }] }));
    // null → falls back to short format (second query also returns 0)
    let callCount = 0;
    setQuery(async () => {
      callCount++;
      return { rows: [{ max_seq: null, max_num: null }] };
    });
    const result = await nextLoanNoAuto_fixed('gold');
    assert.equal(result.next, '03-001');
    assert.equal(result.format, 'short');
  });

  test('14-digit next number has exactly 14 digits', async () => {
    setQuery(async () => ({ rows: [{ max_seq: '4773' }] }));
    const result = await nextLoanNoAuto_fixed('gold');
    assert.equal(result.next.length, 14, 'result must be exactly 14 digits');
    assert.match(result.next, /^\d{14}$/, 'result must be all digits');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 1 — nextLoanNo checks gold_loans.loan_acc_no
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 1 — _nextShortLoanNo checks gold_loans.loan_acc_no', () => {

  test('returns next number when only gold_loans has data', async () => {
    setQuery(async () => ({ rows: [{ max_num: '5' }] }));
    assert.equal(await _nextShortLoanNo('03'), '03-006');
  });

  test('returns 03-001 on empty database', async () => {
    setQuery(async () => ({ rows: [{ max_num: '0' }] }));
    assert.equal(await _nextShortLoanNo('03'), '03-001');
  });

  test('pads to 3 digits', async () => {
    setQuery(async () => ({ rows: [{ max_num: '9' }] }));
    assert.equal(await _nextShortLoanNo('03'), '03-010');
  });

  test('works with prefix 17', async () => {
    setQuery(async () => ({ rows: [{ max_num: '42' }] }));
    assert.equal(await _nextShortLoanNo('17'), '17-043');
  });

  test('handles null max_num gracefully', async () => {
    setQuery(async () => ({ rows: [{ max_num: null }] }));
    assert.equal(await _nextShortLoanNo('03'), '03-001');
  });

  test('SQL includes all three sources', async () => {
    let capturedSql = '';
    setQuery(async (sql) => { capturedSql = sql; return { rows: [{ max_num: '0' }] }; });
    await _nextShortLoanNo('03');
    assert.ok(capturedSql.includes('records'), 'must query records');
    assert.ok(capturedSql.includes('gold_loans'), 'must query gold_loans');
    assert.ok(capturedSql.includes('sonar_sub_no'), 'must query sonar_sub_no');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 3 — sonar sub-loans not skipped
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 3 — sonar sub-loans are counted in nextShortLoanNo', () => {

  test('does not suggest a number used by a sonar sub-loan', async () => {
    setQuery(async () => ({ rows: [{ max_num: '1122' }] }));
    assert.equal(await _nextShortLoanNo('03'), '03-1123');
  });

  test('SQL strips trailing letter suffix from sonar_sub_no', async () => {
    let capturedSql = '';
    setQuery(async (sql) => { capturedSql = sql; return { rows: [{ max_num: '0' }] }; });
    await _nextShortLoanNo('03');
    assert.ok(capturedSql.includes("'-[A-Za-z]+$'"), 'must strip suffix letters');
  });

  test('sonar sub-loan LIKE pattern catches all suffixes', async () => {
    let capturedSql = '';
    setQuery(async (sql) => { capturedSql = sql; return { rows: [{ max_num: '0' }] }; });
    await _nextShortLoanNo('03');
    assert.ok(capturedSql.includes("$2||'%'") || capturedSql.includes("$2 || '%'"),
      "sonar WHERE clause must use $2||'%'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 1+3 — checkLoanNo finds loans across all three sources
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 1+3 — checkLoanNo searches all three sources', () => {

  test('finds via records.account_no and stops (1 query)', async () => {
    let callCount = 0;
    setQuery(async (sql, params) => {
      callCount++;
      if (callCount === 1)
        return { rows: [{ id:10, name:'Ramesh', date:'2026-01-15',
                          status:'active', closed_date:null, account_no:params[0] }] };
      return { rows: [] };
    });
    const r = await checkLoanNo_fixed('03-042');
    assert.equal(r.exists, true);
    assert.equal(r.source, 'records.account_no');
    assert.equal(callCount, 1, 'must stop after first hit');
  });

  test('falls through to gold_loans.loan_acc_no', async () => {
    let callCount = 0;
    setQuery(async () => {
      callCount++;
      if (callCount === 1) return { rows: [] };
      if (callCount === 2) return { rows: [{ id:20, name:'Sunita', date:'2025-11-01',
          status:'active', closed_date:null, account_no:'03-099' }] };
      return { rows: [] };
    });
    const r = await checkLoanNo_fixed('03-099');
    assert.equal(r.exists, true);
    assert.equal(r.source, 'gold_loans.loan_acc_no');
    assert.equal(callCount, 2);
  });

  test('falls through to sonar_sub_no', async () => {
    let callCount = 0;
    setQuery(async () => {
      callCount++;
      if (callCount <= 2) return { rows: [] };
      return { rows: [{ id:30, name:'Vijay', date:'2025-09-10',
                        status:'active', closed_date:null, account_no:'03-1122-A' }] };
    });
    const r = await checkLoanNo_fixed('03-1122-A');
    assert.equal(r.exists, true);
    assert.equal(r.source, 'records.sonar_sub_no');
    assert.equal(callCount, 3);
  });

  test('returns exists:false when all three miss', async () => {
    setQuery(async () => ({ rows: [] }));
    const r = await checkLoanNo_fixed('03-999');
    assert.equal(r.exists, false);
  });

  test('works for 14-digit acc numbers too', async () => {
    setQuery(async (sql, params) => {
      if (params[0] === '00104003004774')
        return { rows: [{ id:5, name:'Priya', date:'2026-03-21',
                          status:'active', closed_date:null, account_no:'00104003004774' }] };
      return { rows: [] };
    });
    const r = await checkLoanNo_fixed('00104003004774');
    assert.equal(r.exists, true);
    assert.equal(r.record.account_no, '00104003004774');
  });

  test('closed loans are found correctly', async () => {
    setQuery(async () => ({ rows: [{ id:5, name:'Priya', date:'2024-03-01',
        status:'closed', closed_date:'2025-01-10', account_no:'03-007' }] }));
    const r = await checkLoanNo_fixed('03-007');
    assert.equal(r.exists, true);
    assert.equal(r.record.status, 'closed');
    assert.equal(r.record.closed_date, '2025-01-10');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 2 — acc_no kept in sync with loan_acc_no
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 2 — processTransaction upsert keeps acc_no in sync', () => {

  test('acc_no column is in upsert cols', () => {
    const { cols } = buildGoldLoansUpsertArgs(
      { loan_acc_no:'03-042', loan_amount:'50000' }, 101, 'Ramesh');
    assert.ok(cols.includes('acc_no'));
    assert.ok(cols.includes('loan_acc_no'));
  });

  test('acc_no equals loan_acc_no in upsert vals', () => {
    const { vals, cols } = buildGoldLoansUpsertArgs(
      { loan_acc_no:'03-042', loan_amount:'50000' }, 101, 'Ramesh');
    assert.equal(vals[cols.indexOf('acc_no')], vals[cols.indexOf('loan_acc_no')]);
    assert.equal(vals[cols.indexOf('acc_no')], '03-042');
  });

  test('works for 14-digit acc numbers too', () => {
    const { vals, cols } = buildGoldLoansUpsertArgs(
      { loan_acc_no:'00104003004774', loan_amount:'50000' }, 101, 'Ramesh');
    assert.equal(vals[cols.indexOf('acc_no')], '00104003004774');
    assert.equal(vals[cols.indexOf('loan_acc_no')], '00104003004774');
  });

  test('col count equals val count (no off-by-one)', () => {
    const { vals, cols } = buildGoldLoansUpsertArgs(
      { loan_acc_no:'03-042', loan_amount:'50000', date:'2026-03-21' }, 101, 'Ramesh');
    assert.equal(vals.length, cols.length);
  });

  test('ornament_items defaults to []', () => {
    const { vals, cols } = buildGoldLoansUpsertArgs(
      { loan_acc_no:'03-001', loan_amount:'10000' }, 1, 'Test');
    assert.equal(vals[cols.indexOf('ornament_items')], '[]');
  });

  test('ornament_items handles bad JSON gracefully', () => {
    const { vals, cols } = buildGoldLoansUpsertArgs(
      { loan_acc_no:'03-001', loan_amount:'10000', ornament_items:'NOT_JSON' }, 1, 'Test');
    assert.equal(vals[cols.indexOf('ornament_items')], '[]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration — auto-detect + checkLoanNo work together', () => {

  test('number from nextLoanNoAuto (14-digit) passes checkLoanNo as available', async () => {
    // nextLoanNoAuto says 004774 is next
    setQuery(async () => ({ rows: [{ max_seq: '4773' }] }));
    const { next } = await nextLoanNoAuto_fixed('gold');
    assert.equal(next, '00104003004774');

    // checkLoanNo finds nothing for that number
    setQuery(async () => ({ rows: [] }));
    const check = await checkLoanNo_fixed(next);
    assert.equal(check.exists, false, 'suggested number must be free');
  });

  test('checkLoanNo blocks a 14-digit number that already exists', async () => {
    setQuery(async (sql, params) => {
      if (params[0] === '00104003004773')
        return { rows: [{ id:99, name:'Existing Customer', date:'2025-01-01',
                          status:'active', closed_date:null, account_no:'00104003004773' }] };
      return { rows: [] };
    });
    const r = await checkLoanNo_fixed('00104003004773');
    assert.equal(r.exists, true);
    assert.equal(r.record.name, 'Existing Customer');
  });
});
