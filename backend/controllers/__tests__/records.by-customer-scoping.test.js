'use strict';

// Regression tests for the "no customer_id" fallback in
// fdAccountsByCustomer() and odLoansByCustomer() in records.controller.js.
//
// Context: when a customer has no customer_id set (a known, pre-existing
// data gap — customer_id is NULL on many bulk-imported records), these two
// endpoints fell back to matching on whichever of aadhar/mobile/name was
// available, OR-ed together. Because the name match is a loose LIKE, OR-ing
// it together with the others meant a customer missing customer_id (and
// missing aadhar/mobile on the query) could match a COMPLETELY DIFFERENT
// customer's active FDs/OD loans — which then showed up, selectable, in the
// picker used to close an FD or back an OD loan for the wrong person. This
// is exactly what produced the "why is this FD list not scoped to my
// customer" bug report.
//
// The fix uses the single strongest identifier available (aadhar > mobile >
// name) instead of unioning weak ones. These tests pin that query shape
// down using a mocked pool — no live database needed.

jest.mock('../../db/pool', () => ({ query: jest.fn() }));

const pool = require('../../db/pool');
const { fdAccountsByCustomer, odLoansByCustomer } = require('../records.controller');

function mockReqRes(query) {
  const req = { query };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  pool.query = jest.fn(async () => ({ rows: [] }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
});

describe('fdAccountsByCustomer() fallback (no customer_id)', () => {
  test('uses aadhar alone when aadhar is provided, even if name is also present', async () => {
    const { req, res } = mockReqRes({ name: 'Common Name', aadhar: '111122223333' });
    await fdAccountsByCustomer(req, res);

    expect(res.statusCode).toBe(200);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/fa\.aadhar = \$1/);
    expect(sql).not.toMatch(/\bOR\b/i);
    expect(params).toEqual(['111122223333']);
  });

  test('uses mobile alone when aadhar is absent but mobile is present', async () => {
    const { req, res } = mockReqRes({ name: 'Common Name', mobile: '9999999999' });
    await fdAccountsByCustomer(req, res);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/fa\.mobile = \$1/);
    expect(sql).not.toMatch(/\bOR\b/i);
    expect(params).toEqual(['9999999999']);
  });

  test('falls back to name only when nothing stronger is available', async () => {
    const { req, res } = mockReqRes({ name: 'Only Name' });
    await fdAccountsByCustomer(req, res);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/LOWER\(fa\.customer_name\) LIKE \$1/);
    expect(params).toEqual(['%only name%']);
  });

  test('uses the fast customer_id path when customer_id is provided, ignoring the others', async () => {
    const { req, res } = mockReqRes({ customer_id: '42', name: 'Irrelevant', aadhar: '000', mobile: '111' });
    await fdAccountsByCustomer(req, res);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/r\.customer_id = \$1/);
    expect(params).toEqual(['42']);
  });
});

describe('odLoansByCustomer() fallback (no customer_id)', () => {
  test('uses aadhar alone when aadhar is provided, even if name is also present', async () => {
    const { req, res } = mockReqRes({ name: 'Common Name', aadhar: '111122223333' });
    await odLoansByCustomer(req, res);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ol\.aadhar = \$1/);
    // The WHERE clause itself must be a single condition — unlike the
    // LEFT JOIN above it (which legitimately uses OR to match an FD by
    // either fd_acc_no or mis_acc_no), the customer-identity filter must
    // not OR aadhar together with other, weaker identifiers.
    const whereClause = sql.match(/WHERE\s+([\s\S]*?)\s+AND ol\.status/)[1];
    expect(whereClause).not.toMatch(/\bOR\b/i);
    expect(params).toEqual(['111122223333']);
  });

  test('falls back to name only when nothing stronger is available', async () => {
    const { req, res } = mockReqRes({ name: 'Only Name' });
    await odLoansByCustomer(req, res);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/LOWER\(ol\.customer_name\) LIKE \$1/);
    expect(params).toEqual(['%only name%']);
  });
});
