'use strict';
// See the same comment in backend/server.js — ENV_FILE lets a staging copy
// of the app point at a separate database; unset (the default) behaves
// exactly as before.
require('dotenv').config({ path: process.env.ENV_FILE || undefined });
const { Pool } = require('pg');

// BUG FIX: this used to fall back to a hardcoded password ('jju_pass123')
// when DB_PASSWORD wasn't set. server.js's own startup check requires
// DB_PASSWORD before it ever requires this module, so that path was
// unreachable through the app — but the standalone scripts in the repo root
// (check-db.js, fix-schema.js, import-data.js, check-schemas.js) each
// duplicated the same hardcoded fallback and DO run standalone. Failing
// loudly here instead means a missing/misnamed .env shows up as a clear
// error instead of silently trying a guessable default credential.
if (!process.env.DB_PASSWORD) {
  console.error('\n  Missing required environment variable: DB_PASSWORD');
  console.error('  Create/check a .env file with DB_PASSWORD set before running this.\n');
  throw new Error('DB_PASSWORD is not set');
}

const pool = new Pool({
  user:     process.env.DB_USER     || 'jju_user',
  // Use 127.0.0.1 instead of 'localhost' to avoid Node's dual-stack
  // (IPv6 + IPv4) "Happy Eyeballs" resolution, which throws an
  // AggregateError with an EMPTY .message when both address families
  // fail — masking the real connection error in logs.
  host:     process.env.DB_HOST     || '127.0.0.1',
  database: process.env.DB_NAME     || 'jju_bank',
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || '5432'),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

module.exports = pool;
