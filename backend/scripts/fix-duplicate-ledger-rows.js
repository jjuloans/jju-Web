// One-time cleanup: removes the 49 duplicate/mis-dated cashbook rows created
// for Gajanan eshwar more's transaction (record_id 12068) while diagnosing
// the ledger auto-generation bug, and corrects the date stamp on PAWAR SAPNA
// NITIN's transaction (record_id 12067). Safe to run once; soft-deletes only
// (reversible via is_deleted flag), no permanent deletion.
//
// Run from the backend folder:
//   node scripts/fix-duplicate-ledger-rows.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Connected to database:', process.env.DB_NAME);

    const before = await client.query(
      `SELECT record_id, COUNT(*) FILTER (WHERE is_deleted=FALSE) AS active_count
         FROM cashbook_entries
        WHERE record_id IN (12067, 12068)
        GROUP BY record_id
        ORDER BY record_id`
    );
    console.log('\n--- Before ---');
    console.table(before.rows);

    const del = await client.query(
      `UPDATE cashbook_entries
          SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW()
        WHERE record_id = 12068 AND is_deleted = FALSE`
    );
    console.log(`\nSoft-deleted ${del.rowCount} duplicate rows for record_id 12068 (Gajanan eshwar more).`);

    const dateFix = await client.query(
      `UPDATE cashbook_entries
          SET date = '2026-09-12', updated_at = NOW()
        WHERE record_id = 12067 AND is_deleted = FALSE AND date <> '2026-09-12'`
    );
    console.log(`Corrected date on ${dateFix.rowCount} rows for record_id 12067 (PAWAR SAPNA NITIN).`);

    const after = await client.query(
      `SELECT record_id, COUNT(*) FILTER (WHERE is_deleted=FALSE) AS active_count
         FROM cashbook_entries
        WHERE record_id IN (12067, 12068)
        GROUP BY record_id
        ORDER BY record_id`
    );
    console.log('\n--- After ---');
    console.table(after.rows);

    console.log('\nDONE — reload the Ledger tab now; Gajanan\'s transaction should auto-generate a fresh, correctly-dated set of 7 rows.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
