'use strict';
require('dotenv').config();
const { Pool } = require('pg');
// BUG FIX: was falling back to a hardcoded 'jju_pass123' password when
// DB_PASSWORD wasn't set — fail loudly instead (see backend/db/pool.js).
if (!process.env.DB_PASSWORD) { console.error('Missing DB_PASSWORD in .env'); process.exit(1); }
const pool = new Pool({
  user: process.env.DB_USER || 'jju_user', host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'jju_bank', password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});
async function run() {
  const client = await pool.connect();

  // 1. Check status distribution in records for gold section
  const r1 = await client.query(`SELECT status, COUNT(*) FROM records WHERE section='gold' AND is_deleted=FALSE GROUP BY status`);
  console.log('records gold status counts:', r1.rows);

  // 2. Check status distribution in gold_loans
  const r2 = await client.query(`SELECT status, COUNT(*) FROM gold_loans GROUP BY status`);
  console.log('gold_loans status counts:', r2.rows);

  // 3. Sample a closed record to see its actual values
  const r3 = await client.query(`SELECT id, account_no, status, closed_date, is_deleted FROM records WHERE section='gold' AND status='closed' LIMIT 3`);
  console.log('Sample closed gold records:', r3.rows);

  // 4. Check if JOIN works
  const r4 = await client.query(`SELECT r.id, r.status, g.acc_code, g.status as g_status FROM records r LEFT JOIN gold_loans g ON g.acc_code = r.account_no WHERE r.section='gold' AND r.status='closed' LIMIT 3`);
  console.log('Sample JOIN result:', r4.rows);

  // 5. FD status check
  const r5 = await client.query(`SELECT r.status, COUNT(*) FROM records r WHERE r.section='fd' AND r.is_deleted=FALSE GROUP BY r.status`);
  console.log('records fd status counts:', r5.rows);

  client.release();
  await pool.end();
}
run().catch(e => console.error(e.message));
