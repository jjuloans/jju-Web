'use strict';
// One-off maintenance script: clears all OLD/CORRUPT DATA from the live
// database while leaving the schema, the `users` table (login), the
// `_migrations` tracking table, and any Postgres extensions completely
// untouched. Safe to re-run.
//
// Usage (from the backend/ folder):
//   node scripts/reset-db.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

if (!process.env.DB_PASSWORD) {
  console.error('Missing DB_PASSWORD in .env — aborting, nothing was touched.');
  process.exit(1);
}

const pool = new Pool({
  user: process.env.DB_USER || 'jju_user',
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_NAME || 'jju_bank',
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

// Never touch these, no matter what else is in the database.
const KEEP_TABLES = new Set(['users', '_migrations']);

(async () => {
  const client = await pool.connect();
  try {
    console.log('Connected to database:', process.env.DB_NAME || 'jju_bank');

    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const allTables = rows.map((r) => r.tablename);
    console.log('\nAll tables found (' + allTables.length + '):', allTables.join(', '));

    const kept = allTables.filter((t) => KEEP_TABLES.has(t));
    const toTruncate = allTables.filter((t) => !KEEP_TABLES.has(t));

    console.log('Preserving (untouched):', kept.join(', ') || '(none found)');
    console.log('Truncating (all data removed):', toTruncate.join(', ') || '(none)');

    if (toTruncate.length === 0) {
      console.log('\nNothing to truncate — done.');
      return;
    }

    // Row counts BEFORE, for the record.
    console.log('\n--- Row counts BEFORE ---');
    for (const t of allTables) {
      const { rows: c } = await client.query(`SELECT COUNT(*) FROM "${t}"`);
      console.log(`  ${t}: ${c[0].count}`);
    }

    const quoted = toTruncate.map((t) => `"${t}"`).join(', ');
    console.log('\nRunning TRUNCATE ... RESTART IDENTITY CASCADE ...');
    await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    console.log('TRUNCATE complete.');

    console.log('\n--- Row counts AFTER ---');
    for (const t of allTables) {
      const { rows: c } = await client.query(`SELECT COUNT(*) FROM "${t}"`);
      console.log(`  ${t}: ${c[0].count}`);
    }

    console.log('\nDONE — old data cleared, users/_migrations preserved.');
  } catch (e) {
    console.error('\nRESET FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
