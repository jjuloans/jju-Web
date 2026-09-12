'use strict';
require('dotenv').config();
const { Pool } = require('pg');

// BUG FIX: was falling back to a hardcoded 'jju_pass123' password when
// DB_PASSWORD wasn't set — fail loudly instead (see backend/db/pool.js).
if (!process.env.DB_PASSWORD) { console.error('Missing DB_PASSWORD in .env'); process.exit(1); }

const pool = new Pool({
  user:     process.env.DB_USER     || 'jju_user',
  host:     process.env.DB_HOST     || 'localhost',
  database: process.env.DB_NAME     || 'jju_bank',
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
  const client = await pool.connect();
  try {
    // Show current gold_loans columns
    const { rows } = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'gold_loans' 
      ORDER BY ordinal_position
    `);
    console.log('Current gold_loans columns:');
    rows.forEach(r => console.log(' ', r.column_name, '-', r.data_type));

    // Add missing columns
    const fixes = [
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS record_id INTEGER`,
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS loan_acc_no TEXT`,
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS customer_name TEXT`,
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS loan_amount NUMERIC DEFAULT 0`,
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS loan_date DATE`,
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`,
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS closed_date DATE`,
    ];
    for (const sql of fixes) {
      await client.query(sql).catch(e => console.warn(' skipped:', e.message));
    }
    console.log('\n✅ Schema fixed');
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch(e => { console.error(e.message); process.exit(1); });
