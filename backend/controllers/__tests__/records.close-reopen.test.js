'use strict';

// Regression tests for close()/reopen() in records.controller.js.
//
// Context: in Sept 2026, close()/reopen() wrapped the core `records`
// status update together with 6 mirror-table updates (gold_loans,
// fd_accounts, od_loans, saving_accounts, memberships, share_accounts) in
// one BEGIN/COMMIT/ROLLBACK transaction. share_accounts has no record_id
// column (it links via acc_no/acc_code instead), so its UPDATE threw
// "column record_id does not exist" on every single close/reopen, and
// because everything shared one transaction, that failure rolled back the
// core records.status change too — silently breaking close/reopen for
// EVERY account type, not just gold loans, with staff seeing nothing but a
// generic 500 toast.
//
// The fix decouples the two: the core `records` update now runs on its
// own via pool.query(), and mirror-table syncing is a separate,
// best-effort step (syncMirrorTablesOnStatusChange) whose per-table
// failures are logged and returned to the caller but never roll back the
// close/reopen. These tests pin that behavior down so a future change to
// this file can't silently reintroduce the all-or-nothing transaction.
//
// No real database is used — pool.query is mocked and dispatches based on
// the SQL text, which is enough to exercise the actual control flow in
// close()/reopen() without needing a live Postgres instance.

jest.mock('../../db/pool', () => ({ query: jest.fn() }));

const pool = require('../../db/pool');
const { close, reopen } = require('../records.controller');

function mockReqRes({ params = {}, body = {} } = {}) {
  const req = { params, body };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return { req, res };
}

// Builds a pool.query mock that:
//  - answers the initial `SELECT ... FROM records WHERE id=$1` read
//  - answers the core `UPDATE records SET status=...` write
//  - answers the RETURNING account_no reopen write
//  - for every mirror-table UPDATE, either succeeds or throws per
//    `failingTables` (keyed by table name, matched against the SQL text)
function buildPoolMock({ recordRow, failingTables = {} } = {}) {
  return jest.fn(async (sql, params) => {
    if (/SELECT tx_types, closed_tx_types, account_no/.test(sql)) {
      return { rows: recordRow ? [recordRow] : [] };
    }
    if (/UPDATE records SET\s+status=\$1/.test(sql)) {
      return { rowCount: recordRow ? 1 : 0 };
    }
    if (/UPDATE records\s+SET status='active'/.test(sql)) {
      return {
        rowCount: recordRow ? 1 : 0,
        rows: recordRow ? [{ account_no: recordRow.account_no }] : [],
      };
    }
    // Mirror-table updates: figure out which table this statement targets.
    const tableMatch = sql.match(/UPDATE\s+(\w+)\s+SET/);
    const table = tableMatch && tableMatch[1];
    if (table && failingTables[table]) {
      throw new Error(failingTables[table]);
    }
    return { rowCount: 1 };
  });
}

beforeEach(() => {
  pool.query.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
  console.warn.mockRestore();
});

describe('close()', () => {
  const activeGoldLoanRecord = {
    tx_types: JSON.stringify(['Gold Loan', 'Slips - Loan', 'Closing - Loan']),
    closed_tx_types: null,
    account_no: '00104003005723',
  };

  test('closes the record and all mirror tables on the happy path', async () => {
    pool.query = buildPoolMock({ recordRow: activeGoldLoanRecord });
    const { req, res } = mockReqRes({
      params: { id: '85068' },
      body: { closed_date: '2026-09-07', tx_types_to_close: ['Gold Loan', 'Slips - Loan', 'Closing - Loan'] },
    });

    await close(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.allClosed).toBe(true);
    expect(res.body.mirrorSyncErrors).toBeUndefined();
  });

  test('REGRESSION: a share_accounts failure (e.g. missing record_id column) does not block the close', async () => {
    pool.query = buildPoolMock({
      recordRow: activeGoldLoanRecord,
      failingTables: { share_accounts: 'column "record_id" does not exist' },
    });
    const { req, res } = mockReqRes({
      params: { id: '85068' },
      body: { closed_date: '2026-09-07', tx_types_to_close: ['Gold Loan', 'Slips - Loan', 'Closing - Loan'] },
    });

    await close(req, res);

    // The bug this guards against: this used to come back as a 500 with
    // the record left 'active' because the whole transaction rolled back.
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.allClosed).toBe(true);
    expect(res.body.mirrorSyncErrors).toEqual([
      { table: 'share_accounts', error: 'column "record_id" does not exist' },
    ]);

    // The core records UPDATE must have actually been sent to the DB.
    const coreUpdateCall = pool.query.mock.calls.find(([sql]) =>
      /UPDATE records SET\s+status=\$1/.test(sql),
    );
    expect(coreUpdateCall).toBeDefined();
    expect(coreUpdateCall[1][0]).toBe('closed');
  });

  test('a gold_loans mirror failure does not block other mirror tables or the close', async () => {
    pool.query = buildPoolMock({
      recordRow: activeGoldLoanRecord,
      failingTables: { gold_loans: 'some transient error' },
    });
    const { req, res } = mockReqRes({
      params: { id: '85068' },
      body: { closed_date: '2026-09-07', tx_types_to_close: ['Gold Loan', 'Slips - Loan', 'Closing - Loan'] },
    });

    await close(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mirrorSyncErrors).toEqual([{ table: 'gold_loans', error: 'some transient error' }]);

    // fd_accounts (unrelated table) should still have been attempted.
    const fdCall = pool.query.mock.calls.find(([sql]) => /UPDATE fd_accounts/.test(sql));
    expect(fdCall).toBeDefined();
  });

  test('returns 404 when the record does not exist', async () => {
    pool.query = buildPoolMock({ recordRow: null });
    const { req, res } = mockReqRes({ params: { id: '999999' }, body: {} });

    await close(req, res);

    expect(res.statusCode).toBe(404);
  });

  test('returns 400 for a non-numeric id', async () => {
    pool.query = buildPoolMock({ recordRow: activeGoldLoanRecord });
    const { req, res } = mockReqRes({ params: { id: 'not-a-number' }, body: {} });

    await close(req, res);

    expect(res.statusCode).toBe(400);
  });
});

describe('reopen()', () => {
  test('reopens the record and all mirror tables on the happy path', async () => {
    pool.query = buildPoolMock({ recordRow: { account_no: '00104003005723' } });
    const { req, res } = mockReqRes({ params: { id: '85068' } });

    await reopen(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mirrorSyncErrors).toBeUndefined();
  });

  test('REGRESSION: a share_accounts failure does not block the reopen', async () => {
    pool.query = buildPoolMock({
      recordRow: { account_no: '00104003005723' },
      failingTables: { share_accounts: 'column "record_id" does not exist' },
    });
    const { req, res } = mockReqRes({ params: { id: '85068' } });

    await reopen(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mirrorSyncErrors).toEqual([
      { table: 'share_accounts', error: 'column "record_id" does not exist' },
    ]);

    const coreUpdateCall = pool.query.mock.calls.find(([sql]) =>
      /UPDATE records\s+SET status='active'/.test(sql),
    );
    expect(coreUpdateCall).toBeDefined();
  });

  test('returns 404 when the record does not exist', async () => {
    pool.query = buildPoolMock({ recordRow: null });
    const { req, res } = mockReqRes({ params: { id: '999999' } });

    await reopen(req, res);

    expect(res.statusCode).toBe(404);
  });

  test('returns 400 for a non-numeric id', async () => {
    pool.query = buildPoolMock({ recordRow: { account_no: '00104003005723' } });
    const { req, res } = mockReqRes({ params: { id: 'nope' } });

    await reopen(req, res);

    expect(res.statusCode).toBe(400);
  });
});
