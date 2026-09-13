'use strict';
const pool = require('./pool');

// Every statement runs independently — no transaction, no cascade failures.
// Codes safe to ignore (already-exists / already-done):
//   42701 = duplicate_column, 42P07 = duplicate_table, 42710 = duplicate_object
//   42P16 = invalid_table_definition, 42703 = undefined_column
//   23505 = unique_violation (dedup cleanup), 22P02 = invalid_text_representation
//   22007 = invalid_datetime_format
// Structural errors (42804, 0A000, 42P01, 23502) are NOT ignored — they throw
// so migrate() skips markDone() and the broken migration retries on next start.
//
// DIAGNOSTIC MODE: set MIGRATIONS_DRY_RUN=1 to log every structural error
// instead of throwing on the first one, so a single boot against a DB copy
// surfaces the full list of remaining bugs instead of one per restart.
// Never leave this set against the real/production DB — statements after a
// broken one may depend on it having succeeded (e.g. a later UPDATE assuming
// an earlier ALTER's column exists), so dry-run output can include
// misleading downstream errors. Use it only to enumerate problems on a
// throwaway clone, then fix for real with dry-run off.
const DRY_RUN = process.env.MIGRATIONS_DRY_RUN === '1';
const dryRunErrors = [];

async function run(sql) {
  try {
    await pool.query(sql);
  } catch (err) {
    const ignore = [
      '42701', '42P07', '42710', '42P16',
      '42703', '23505', '22P02', '22007',
    ];
    if (ignore.includes(err.code)) return;
    console.error(`  ✗ [Migration error ${err.code}] ${err.message.split('\n')[0]}`);
    if (DRY_RUN) {
      dryRunErrors.push({ code: err.code, message: err.message.split('\n')[0], sql: sql.trim().slice(0, 200) });
      return; // swallow and continue so later statements still get a chance to run
    }
    throw err;
  }
}

// Null-out empty strings before a date cast
function cleanDate(table, col) {
  return `UPDATE ${table} SET ${col} = NULL WHERE ${col}::text = '' OR TRIM(${col}::text) = ''`;
}

// ── Migration tracking ────────────────────────────────────────────────────────
// Each named migration runs exactly once. On subsequent restarts it is skipped.
async function ensureTrackingTable() {
  try {
    // Self-heal: on some deployments a `_migrations` table already existed
    // under an older/incompatible shape (e.g. missing this "name" column),
    // which makes CREATE TABLE IF NOT EXISTS below a no-op — every
    // hasRun()/markDone() call then fails with "column \"name\" does not
    // exist" (42703), which is NOT in run()'s ignore list because these two
    // calls go straight to pool.query() rather than through run(). That
    // failure is fatal in server.js's start() (pool.end() + process.exit(1)),
    // so left unfixed this crash-loops forever on every restart.
    //
    // Fix: if a mismatched table is found, drop and recreate it rather than
    // patch it column-by-column — this table is pure internal bookkeeping
    // (which named migrations have run), never joined with real business
    // data anywhere in the app (confirmed: hasRun/markDone/ensureTrackingTable
    // are its only readers/writers), so it's safe to discard and rebuild.
    // A column-by-column ALTER-based heal was tried first and tested against
    // a simulated legacy table with an extra NOT NULL column from an older
    // schema — it fixed hasRun()'s SELECT but markDone()'s INSERT still
    // failed on that unrelated column, since we can't know every possible
    // legacy shape in advance. Drop+recreate sidesteps that entirely.
    // A table that's already correctly shaped (has "name") is left alone —
    // any existing migration history is preserved, not reset.
    const { rows } = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = '_migrations' AND column_name = 'name'
    `);
    if (rows.length === 0) {
      const { rowCount } = await pool.query(`
        SELECT 1 FROM information_schema.tables WHERE table_name = '_migrations'
      `);
      if (rowCount > 0) {
        console.log('  ⚠ [ensureTrackingTable] _migrations has an incompatible shape — recreating (bookkeeping-only table, no business data)');
        await pool.query(`DROP TABLE _migrations`);
      }
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) {
    // AggregateError (dual-stack connection failures) has an empty
    // top-level .message — the real reason is nested in err.errors[].
    if (err.name === 'AggregateError' && Array.isArray(err.errors)) {
      console.error('  ✗ [ensureTrackingTable] connection failed:',
        err.errors.map(e => e.message).join(' | '));
    } else {
      console.error('  ✗ [ensureTrackingTable] failed:', err.code || err.name, err.message);
    }
    throw err;
  }
}

async function hasRun(name) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM _migrations WHERE name = $1', [name]
  );
  return rowCount > 0;
}

async function markDone(name) {
  await pool.query(
    'INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]
  );
}

// Run a named migration only if it hasn't been applied yet.
// fn = async function containing all the run() / pool.query() calls for that migration.
async function migrate(name, fn) {
  if (await hasRun(name)) return;
  console.log(`  → applying migration: ${name}`);
  await fn();
  // In dry-run mode, run() swallows structural errors instead of throwing,
  // so fn() always "succeeds" — never markDone() here, or a migration with
  // real unresolved errors would get skipped on the next (real) run.
  if (!DRY_RUN) await markDone(name);
}

async function runMigrations() {
  console.log('Running migrations...');
  if (DRY_RUN) console.log('  ⚠ MIGRATIONS_DRY_RUN=1 — errors will be logged and collected, not thrown. Do NOT point this at production.');
  await ensureTrackingTable();

  await migrate('v1_initial_schema', async () => {

  await run(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$
  `);

  // ── 1. RECORDS ────────────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS records (
    id              SERIAL PRIMARY KEY,
    date            DATE,
    name            TEXT,
    customer_id     TEXT,
    customer_type   TEXT        DEFAULT 'regular',
    aadhar          TEXT,
    mobile          TEXT,
    account_no      TEXT,
    section         TEXT,
    tx_types        TEXT,
    data            JSONB       DEFAULT '{}',
    remarks         TEXT,
    sonar_parent_no TEXT,
    sonar_sub_no    TEXT,
    sonar_group_no  TEXT,
    status          TEXT        DEFAULT 'active',
    closed_date     DATE,
    closed_remarks  TEXT,
    closed_tx_types TEXT,
    is_deleted      BOOLEAN     DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )`);
  for (const s of [
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS customer_id     TEXT`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS customer_type   TEXT DEFAULT 'regular'`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS sonar_parent_no TEXT`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS sonar_sub_no    TEXT`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS sonar_group_no  TEXT`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS closed_date     DATE`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS closed_remarks  TEXT`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS closed_tx_types TEXT`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS is_deleted      BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS status          TEXT DEFAULT 'active'`,
    `ALTER TABLE records ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW()`,
  ]) await run(s);

  // Fix data column (TEXT → JSONB)
  // await run(`UPDATE records SET data = '{}' WHERE data IS NULL OR TRIM(data::text) = '' OR data::text !~ '^[\\[{]'`);
  // await run(`ALTER TABLE records ALTER COLUMN data DROP DEFAULT`);
  // await run(`ALTER TABLE records ALTER COLUMN data TYPE jsonb USING CASE WHEN data IS NULL OR data::text='' THEN '{}'::jsonb ELSE data::jsonb END`);
  // await run(`ALTER TABLE records ALTER COLUMN data SET DEFAULT '{}'`);

    // Fix data column (TEXT → JSONB) — skip the rewrite if already jsonb
  const { rows: __dataColType } = await pool.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name='records' AND column_name='data'
  `);
  if (__dataColType[0]?.data_type !== 'jsonb') {
    await run(`UPDATE records SET data = '{}' WHERE data IS NULL OR TRIM(data::text) = '' OR data::text !~ '^[\\[{]'`);
    await run(`ALTER TABLE records ALTER COLUMN data DROP DEFAULT`);
    await run(`ALTER TABLE records ALTER COLUMN data TYPE jsonb USING CASE WHEN data IS NULL OR data::text='' THEN '{}'::jsonb ELSE data::jsonb END`);
    await run(`ALTER TABLE records ALTER COLUMN data SET DEFAULT '{}'`);
  }

  // Fix date columns
  // await run(`ALTER TABLE records ALTER COLUMN date DROP NOT NULL`);
  // await run(cleanDate('records', 'date'));
  // await run(`ALTER TABLE records ALTER COLUMN date TYPE date USING CASE WHEN date IS NULL THEN NULL ELSE date::text::date END`);
  // await run(`ALTER TABLE records ALTER COLUMN closed_date DROP NOT NULL`);
  // await run(cleanDate('records', 'closed_date'));
  // await run(`ALTER TABLE records ALTER COLUMN closed_date TYPE date USING CASE WHEN closed_date IS NULL THEN NULL ELSE closed_date::text::date END`);

    // Fix date columns
  await run(`ALTER TABLE records ALTER COLUMN date DROP NOT NULL`);
  await run(`ALTER TABLE records ALTER COLUMN date DROP DEFAULT`);
  await run(cleanDate('records', 'date'));
  await run(`ALTER TABLE records ALTER COLUMN date TYPE date USING CASE WHEN date IS NULL THEN NULL ELSE date::text::date END`);
  
    await run(`ALTER TABLE records ALTER COLUMN closed_date DROP NOT NULL`);
  await run(`ALTER TABLE records ALTER COLUMN closed_date DROP DEFAULT`);
  await run(cleanDate('records', 'closed_date'));
  await run(`ALTER TABLE records ALTER COLUMN closed_date TYPE date USING CASE WHEN closed_date IS NULL THEN NULL ELSE closed_date::text::date END`);
  

  for (const s of [
    `CREATE INDEX IF NOT EXISTS idx_records_date       ON records(date)`,
    `CREATE INDEX IF NOT EXISTS idx_records_section    ON records(section)`,
    `CREATE INDEX IF NOT EXISTS idx_records_status     ON records(status)`,
    `CREATE INDEX IF NOT EXISTS idx_records_is_deleted ON records(is_deleted)`,
    `CREATE INDEX IF NOT EXISTS idx_records_aadhar     ON records(aadhar)`,
    `CREATE INDEX IF NOT EXISTS idx_records_mobile     ON records(mobile)`,
    `CREATE INDEX IF NOT EXISTS idx_records_account_no ON records(account_no)`,
    `CREATE INDEX IF NOT EXISTS idx_records_name       ON records(LOWER(name))`,
    `CREATE INDEX IF NOT EXISTS idx_records_sonar_group_no ON records(sonar_group_no) WHERE sonar_group_no IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_records_sonar_sub_no   ON records(sonar_sub_no)   WHERE sonar_sub_no   IS NOT NULL`,
    `DROP TRIGGER IF EXISTS trg_records_updated_at ON records`,
    `CREATE TRIGGER trg_records_updated_at BEFORE UPDATE ON records FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  ]) await run(s);


  // ── Heal any deposit records incorrectly saved as section='saving' ────────
  // Before the create() fix, deposit/withdrawal submissions with section='saving'
  // were rejected by the unique index on the FIRST attempt (since the opening
  // record already exists). Any that somehow got through (e.g. before the index
  // existed) will have section='saving' but tx_types containing only Deposit/
  // Withdrawal — find and reclassify them as section='general' to match the
  // new invariant enforced by the controller.
  await run(`UPDATE records
    SET section = 'general', updated_at = NOW()
    WHERE section = 'saving'
      AND is_deleted = FALSE
      AND tx_types::text NOT LIKE '%Saving Account%'
      AND tx_types::text NOT LIKE '%New Sadasya%'
      AND tx_types::text NOT LIKE '%New Naammatr Sabhasad%'
      AND (
        tx_types::text LIKE '%Saving Deposit%'
        OR tx_types::text LIKE '%Saving Withdrawal%'
        OR tx_types::text LIKE '%Closing - Saving Account%'
      )`);

  // ── 2. CASHBOOK ENTRIES ───────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS cashbook_entries (
    id          SERIAL PRIMARY KEY,
    date        DATE,
    entry_date  DATE,
    record_id   INTEGER REFERENCES records(id) ON DELETE SET NULL,
    name        TEXT,
    task        TEXT,
    acc_type    TEXT,
    tx_type     TEXT,
    acc_no      TEXT,
    amount      NUMERIC     DEFAULT 0,
    mode        TEXT,
    scroll_no   TEXT,
    loan_date   DATE,
    sort_order  INTEGER     DEFAULT 0,
    is_deleted  BOOLEAN     DEFAULT FALSE,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  )`);
  for (const s of [
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS record_id  INTEGER`,
    `DO $$ BEGIN ALTER TABLE cashbook_entries ADD CONSTRAINT fk_cashbook_record FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS entry_date DATE`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS name       TEXT`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS task       TEXT`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS acc_type   TEXT`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS tx_type    TEXT`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS acc_no     TEXT`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS mode       TEXT`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS scroll_no  TEXT`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS loan_date  DATE`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS parent_id  INTEGER`,
    `ALTER TABLE cashbook_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
  ]) await run(s);

  await run(`ALTER TABLE cashbook_entries ALTER COLUMN date DROP NOT NULL`);
  await run(`ALTER TABLE cashbook_entries ALTER COLUMN date DROP DEFAULT`);
  await run(cleanDate('cashbook_entries', 'date'));
  await run(`ALTER TABLE cashbook_entries ALTER COLUMN date TYPE date USING CASE WHEN date IS NULL THEN NULL ELSE date::text::date END`);
  await run(`ALTER TABLE cashbook_entries ALTER COLUMN entry_date DROP NOT NULL`);
  await run(`ALTER TABLE cashbook_entries ALTER COLUMN entry_date DROP DEFAULT`);
  await run(cleanDate('cashbook_entries', 'entry_date'));
  await run(`ALTER TABLE cashbook_entries ALTER COLUMN entry_date TYPE date USING CASE WHEN entry_date IS NULL THEN NULL ELSE entry_date::text::date END`);
  await run(`ALTER TABLE cashbook_entries ALTER COLUMN entry_date SET DEFAULT CURRENT_DATE`);
  await run(`ALTER TABLE cashbook_entries ALTER COLUMN loan_date DROP NOT NULL`);
  await run(`ALTER TABLE cashbook_entries ALTER COLUMN loan_date DROP DEFAULT`);
  await run(cleanDate('cashbook_entries', 'loan_date'));
  await run(`ALTER TABLE cashbook_entries ALTER COLUMN loan_date TYPE date USING CASE WHEN loan_date IS NULL THEN NULL ELSE loan_date::text::date END`);

  for (const s of [
    `CREATE INDEX IF NOT EXISTS idx_cashbook_date       ON cashbook_entries(date)`,
    `CREATE INDEX IF NOT EXISTS idx_cashbook_record_id  ON cashbook_entries(record_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cashbook_is_deleted ON cashbook_entries(is_deleted)`,
    `CREATE INDEX IF NOT EXISTS idx_cashbook_name       ON cashbook_entries(LOWER(name))`,
    `CREATE INDEX IF NOT EXISTS idx_cashbook_acc_no     ON cashbook_entries(acc_no)`,
    `DROP TRIGGER IF EXISTS trg_cashbook_updated_at ON cashbook_entries`,
    `CREATE TRIGGER trg_cashbook_updated_at BEFORE UPDATE ON cashbook_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  ]) await run(s);

  // ── 3. CUSTOMERS ──────────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS customers (
    id             SERIAL PRIMARY KEY,
    customer_id    TEXT UNIQUE,
    name           TEXT,
    aadhar         TEXT,
    mobile         TEXT,
    pan            TEXT,
    dob            TEXT,
    address        TEXT,
    occupation     TEXT,
    saving_acc_no  TEXT,
    saving_balance NUMERIC     DEFAULT 0,
    share_acc_no   TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  )`);
  for (const s of [
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_id    TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_customer_id ON customers(customer_id)`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS pan            TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS dob            TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS address        TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS occupation     TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS saving_acc_no  TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS saving_balance NUMERIC DEFAULT 0`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS share_acc_no   TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW()`,
    `CREATE INDEX IF NOT EXISTS idx_customers_aadhar ON customers(aadhar)`,
    `CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile)`,
    `CREATE INDEX IF NOT EXISTS idx_customers_name   ON customers(LOWER(name))`,
    `DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers`,
    `CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  ]) await run(s);

  // ── Extra customer fields from PDF Customer Analysis Report ───────────────
  // These 6 columns exist in the imported PDF but were missing from the DB schema.
  // Safe to run on existing DBs — IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards.
  for (const s of [
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender          TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS marital_status  TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS qualification   TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS passport_no     TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS religion        TEXT`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS caste           TEXT`,
  ]) await run(s);

  // ── 4. GOLD_LOANS ─────────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS gold_loans (
    id             SERIAL PRIMARY KEY,
    record_id      INTEGER REFERENCES records(id) ON DELETE CASCADE,
    loan_acc_no    TEXT,
    customer_name  TEXT,
    aadhar         TEXT,
    mobile         TEXT,
    loan_amount    NUMERIC     DEFAULT 0,
    loan_date      DATE,
    metal_type     TEXT,
    ornament_items JSONB       DEFAULT '[]',
    sonar_group_no TEXT,
    sonar_sub_no   TEXT,
    status         TEXT        DEFAULT 'active',
    closed_date    DATE,
    closed_remarks TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  )`);
  for (const s of [
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS record_id     INTEGER REFERENCES records(id) ON DELETE CASCADE`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS loan_acc_no    TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS customer_name  TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS aadhar         TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS mobile         TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS loan_amount    NUMERIC DEFAULT 0`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS loan_date      DATE`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS status         TEXT DEFAULT 'active'`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS metal_type     TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS ornament_items JSONB DEFAULT '[]'`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS sonar_group_no TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS sonar_sub_no   TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS closed_remarks TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS closed_date    DATE`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW()`,
  ]) await run(s);
  await run(`ALTER TABLE gold_loans ALTER COLUMN loan_date DROP NOT NULL`);
  await run(`ALTER TABLE gold_loans ALTER COLUMN loan_date DROP DEFAULT`);
  await run(cleanDate('gold_loans', 'loan_date'));
  await run(`ALTER TABLE gold_loans ALTER COLUMN loan_date TYPE date USING CASE WHEN loan_date IS NULL THEN NULL ELSE loan_date::text::date END`);
  await run(`ALTER TABLE gold_loans ALTER COLUMN closed_date DROP NOT NULL`);
  await run(`ALTER TABLE gold_loans ALTER COLUMN closed_date DROP DEFAULT`);
  await run(cleanDate('gold_loans', 'closed_date'));
  await run(`ALTER TABLE gold_loans ALTER COLUMN closed_date TYPE date USING CASE WHEN closed_date IS NULL THEN NULL ELSE closed_date::text::date END`);
  for (const s of [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_gold_loans_record_id   ON gold_loans(record_id)`,
    `CREATE INDEX        IF NOT EXISTS idx_gold_loans_loan_acc_no ON gold_loans(loan_acc_no)`,
    `CREATE INDEX        IF NOT EXISTS idx_gold_loans_status      ON gold_loans(status)`,
    `DROP TRIGGER IF EXISTS trg_gold_loans_updated_at ON gold_loans`,
    `CREATE TRIGGER trg_gold_loans_updated_at BEFORE UPDATE ON gold_loans FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  ]) await run(s);

  // ── gold_loans data entry form fields ────────────────────────────────
  // These columns store data from the gold loan data entry form.
  // Safe on all existing DBs — ADD COLUMN IF NOT EXISTS guards.
  for (const s of [
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS ornament_weight    TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS silver_ornaments   TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS gold_ornaments     TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS transaction_type   TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS address            TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS customer_photo_url TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS photo_ornament     TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS photo_aadhar_front TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS photo_aadhar_back  TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS photo_pan          TEXT`,
    // nominee fields
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS nominee            TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS nominee_name       TEXT`,
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS nominee_relation    TEXT`,
    // interest rate
    `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS interest_rate      NUMERIC`,
  ]) await run(s);

  // Backfill from records.data for any existing gold_loans rows that pre-date
  // the data entry form fields being stored in gold_loans directly.
  // BUG FIX (round 2): ornament_weight is declared TEXT above, but the live
  // DB has it as NUMERIC (confirmed via information_schema — same drift
  // class as gl.closed_date in v6). The straightforward ::text-cast COALESCE
  // fixed the *comparison* type error (42804 "COALESCE types numeric and
  // text cannot be matched"), but its result is still text, and Postgres
  // won't implicitly assign text into a numeric column — that surfaced a
  // second, later error: 'column "ornament_weight" is of type numeric but
  // expression is of type text'. Fixed the same way this file already
  // handles gl.interest_rate a bit further down: validate the JSONB string
  // looks like a number before casting, so a genuinely non-numeric value
  // (blank, "N/A", etc.) falls back to NULL instead of throwing 22P02.
  // silver_ornaments/gold_ornaments are confirmed TEXT on the live DB (no
  // drift), so they keep the simple ::text-cast COALESCE from round 1.
  await run(`UPDATE gold_loans gl
    SET ornament_weight    = COALESCE(
                                NULLIF(gl.ornament_weight::text, ''),
                                CASE WHEN (r.data->>'ornament_weight') ~ '^[0-9]+(\\.[0-9]+)?$'
                                THEN r.data->>'ornament_weight' ELSE NULL END
                              )::numeric,
        silver_ornaments   = COALESCE(gl.silver_ornaments::text,   r.data->>'silver_ornaments'),
        gold_ornaments     = COALESCE(gl.gold_ornaments::text,     r.data->>'gold_ornaments'),
        transaction_type   = COALESCE(gl.transaction_type,   r.data->>'transaction_type'),
        address            = COALESCE(gl.address,            r.data->>'address'),
        customer_photo_url = COALESCE(NULLIF(gl.customer_photo_url,''), r.data->>'photo_customer', r.data->>'customer_photo_url'),
        photo_ornament     = COALESCE(gl.photo_ornament,     r.data->>'photo_ornament'),
        photo_aadhar_front = COALESCE(gl.photo_aadhar_front, r.data->>'photo_aadhar_front'),
        photo_aadhar_back  = COALESCE(gl.photo_aadhar_back,  r.data->>'photo_aadhar_back'),
        photo_pan          = COALESCE(gl.photo_pan,          r.data->>'photo_pan')
    FROM records r
    WHERE r.id = gl.record_id
      AND r.is_deleted = FALSE`);


  // ── gold_loans live-DB compatibility ─────────────────────────────────
  // Some live DBs were created with an older schema that has an 'acc_no' TEXT NOT NULL
  // column instead of / in addition to 'loan_acc_no'. Handle both cases:
  // 1. If acc_no column exists and is NOT NULL, drop the constraint so NULLs are allowed
  // 2. If acc_no column doesn't exist, add it as nullable (harmless alias)
  await run(`ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS acc_no TEXT`);
  await run(`ALTER TABLE gold_loans ALTER COLUMN acc_no DROP NOT NULL`);
  await run(`ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS loan_end_date DATE`);
  // Keep acc_no in sync with loan_acc_no for any existing rows that are missing it
  await run(`UPDATE gold_loans SET acc_no = loan_acc_no WHERE acc_no IS NULL AND loan_acc_no IS NOT NULL`);

  // ── 5. FD_ACCOUNTS ────────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS fd_accounts (
    id                 SERIAL PRIMARY KEY,
    record_id          INTEGER REFERENCES records(id) ON DELETE CASCADE,
    fd_acc_no          TEXT,
    mis_acc_no         TEXT,
    fd_parvati_no      TEXT,
    customer_name      TEXT,
    aadhar             TEXT,
    mobile             TEXT,
    fd_amount          NUMERIC     DEFAULT 0,
    fd_period          INTEGER,
    fd_interest_rate   NUMERIC,
    fd_maturity_date   DATE,
    fd_maturity_amount NUMERIC,
    loan_date          DATE,
    status             TEXT        DEFAULT 'active',
    closed_date        DATE,
    section            TEXT        DEFAULT 'fd',
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
  )`);
  for (const s of [
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS record_id          INTEGER REFERENCES records(id) ON DELETE CASCADE`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_acc_no          TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS mis_acc_no         TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_parvati_no      TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS customer_name      TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS aadhar             TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS mobile             TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_amount          NUMERIC DEFAULT 0`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_period          INTEGER`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_interest_rate   NUMERIC`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_maturity_date   DATE`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_maturity_amount NUMERIC`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS loan_date          DATE`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS status             TEXT DEFAULT 'active'`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS section            TEXT DEFAULT 'fd'`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS closed_date        DATE`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW()`,
    // nominee fields
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS nominee            TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS nominee_name       TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS nominee_relation    TEXT`,
    // photo URLs
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS photo_customer     TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS photo_aadhar_front TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS photo_aadhar_back  TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS photo_pan          TEXT`,
    // fd_type and fd_sub_type (MIS vs Term)
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_type            TEXT`,
    `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_sub_type        TEXT`,
  ]) await run(s);
  await run(`ALTER TABLE fd_accounts ALTER COLUMN fd_maturity_date DROP NOT NULL`);
  await run(`ALTER TABLE fd_accounts ALTER COLUMN fd_maturity_date DROP DEFAULT`);
  await run(cleanDate('fd_accounts', 'fd_maturity_date'));
  await run(`ALTER TABLE fd_accounts ALTER COLUMN fd_maturity_date TYPE date USING CASE WHEN fd_maturity_date IS NULL THEN NULL ELSE fd_maturity_date::text::date END`);
  await run(`ALTER TABLE fd_accounts ALTER COLUMN loan_date DROP NOT NULL`);
  await run(`ALTER TABLE fd_accounts ALTER COLUMN loan_date DROP DEFAULT`);
  await run(cleanDate('fd_accounts', 'loan_date'));
  await run(`ALTER TABLE fd_accounts ALTER COLUMN loan_date TYPE date USING CASE WHEN loan_date IS NULL THEN NULL ELSE loan_date::text::date END`);
  await run(`ALTER TABLE fd_accounts ALTER COLUMN closed_date DROP NOT NULL`);
  await run(`ALTER TABLE fd_accounts ALTER COLUMN closed_date DROP DEFAULT`);
  await run(cleanDate('fd_accounts', 'closed_date'));
  await run(`ALTER TABLE fd_accounts ALTER COLUMN closed_date TYPE date USING CASE WHEN closed_date IS NULL THEN NULL ELSE closed_date::text::date END`);
  for (const s of [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_fd_accounts_record_id ON fd_accounts(record_id)`,
    `CREATE INDEX        IF NOT EXISTS idx_fd_accounts_fd_acc_no ON fd_accounts(fd_acc_no)`,
    `CREATE INDEX        IF NOT EXISTS idx_fd_accounts_status    ON fd_accounts(status)`,
    `DROP TRIGGER IF EXISTS trg_fd_accounts_updated_at ON fd_accounts`,
    `CREATE TRIGGER trg_fd_accounts_updated_at BEFORE UPDATE ON fd_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  ]) await run(s);

  // ── 6. SAVING_ACCOUNTS ────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS saving_accounts (
    id            SERIAL PRIMARY KEY,
    record_id     INTEGER REFERENCES records(id) ON DELETE CASCADE,
    saving_acc_no TEXT,
    customer_name TEXT,
    aadhar        TEXT,
    mobile        TEXT,
    balance       NUMERIC     DEFAULT 0,
    status        TEXT        DEFAULT 'active',
    closed_date   DATE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  )`);
  await run(`ALTER TABLE saving_accounts ALTER COLUMN closed_date DROP NOT NULL`);
  await run(`ALTER TABLE saving_accounts ALTER COLUMN closed_date DROP DEFAULT`);
  await run(cleanDate('saving_accounts', 'closed_date'));
  await run(`ALTER TABLE saving_accounts ALTER COLUMN closed_date TYPE date USING CASE WHEN closed_date IS NULL THEN NULL ELSE closed_date::text::date END`);
  for (const s of [
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS record_id     INTEGER REFERENCES records(id) ON DELETE CASCADE`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS saving_acc_no TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS acc_no        TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS acc_code      TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS customer_name TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS aadhar        TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS mobile        TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS balance       NUMERIC DEFAULT 0`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'active'`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS closed_date   DATE`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS pan_no        TEXT`,
    // BUG FIX: interest_rate, cust_code, and start_date were never in the
    // saving_accounts schema. The PDF report has all three. Without these columns
    // the data was silently dropped on import and never shown in the list view.
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS interest_rate NUMERIC`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS cust_code     TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS start_date    DATE`,
    // nominee fields
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS nominee            TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS nominee_name       TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS nominee_relation    TEXT`,
    // photo URLs
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS photo_customer     TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS photo_aadhar_front TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS photo_aadhar_back  TEXT`,
    `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS photo_pan          TEXT`,
  ]) await run(s);
  for (const s of [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_saving_accounts_record_id ON saving_accounts(record_id)`,
    `CREATE INDEX IF NOT EXISTS idx_saving_accounts_acc_no ON saving_accounts(saving_acc_no)`,
    `CREATE INDEX IF NOT EXISTS idx_saving_accounts_aadhar ON saving_accounts(aadhar)`,
    `DROP TRIGGER IF EXISTS trg_saving_accounts_updated_at ON saving_accounts`,
    `CREATE TRIGGER trg_saving_accounts_updated_at BEFORE UPDATE ON saving_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  ]) await run(s);

  // ── 7. OD_LOANS ───────────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS od_loans (
    id               SERIAL PRIMARY KEY,
    record_id        INTEGER REFERENCES records(id) ON DELETE CASCADE,
    loan_acc_no      TEXT,
    fd_acc_no        TEXT,
    customer_name    TEXT,
    aadhar           TEXT,
    mobile           TEXT,
    loan_amount      NUMERIC     DEFAULT 0,
    fd_amount        NUMERIC     DEFAULT 0,
    fd_maturity_date DATE,
    loan_date        DATE,
    status           TEXT        DEFAULT 'active',
    closed_date      DATE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  )`);
  await run(`ALTER TABLE od_loans ALTER COLUMN fd_maturity_date DROP NOT NULL`);
  await run(`ALTER TABLE od_loans ALTER COLUMN fd_maturity_date DROP DEFAULT`);
  await run(cleanDate('od_loans', 'fd_maturity_date'));
  await run(`ALTER TABLE od_loans ALTER COLUMN fd_maturity_date TYPE date USING CASE WHEN fd_maturity_date IS NULL THEN NULL ELSE fd_maturity_date::text::date END`);
  await run(`ALTER TABLE od_loans ALTER COLUMN loan_date DROP NOT NULL`);
  await run(`ALTER TABLE od_loans ALTER COLUMN loan_date DROP DEFAULT`);
  await run(cleanDate('od_loans', 'loan_date'));
  await run(`ALTER TABLE od_loans ALTER COLUMN loan_date TYPE date USING CASE WHEN loan_date IS NULL THEN NULL ELSE loan_date::text::date END`);
  await run(`ALTER TABLE od_loans ALTER COLUMN closed_date DROP NOT NULL`);
  await run(`ALTER TABLE od_loans ALTER COLUMN closed_date DROP DEFAULT`);
  await run(cleanDate('od_loans', 'closed_date'));
  await run(`ALTER TABLE od_loans ALTER COLUMN closed_date TYPE date USING CASE WHEN closed_date IS NULL THEN NULL ELSE closed_date::text::date END`);
  for (const s of [
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS record_id        INTEGER REFERENCES records(id) ON DELETE CASCADE`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS loan_acc_no      TEXT`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS fd_acc_no        TEXT`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS customer_name    TEXT`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS aadhar           TEXT`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS mobile           TEXT`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS loan_amount      NUMERIC DEFAULT 0`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS fd_amount        NUMERIC DEFAULT 0`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS loan_date        DATE`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS status           TEXT DEFAULT 'active'`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS closed_date      DATE`,
    `ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW()`,
  ]) await run(s);
  for (const s of [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_od_loans_record_id ON od_loans(record_id)`,
    `DROP TRIGGER IF EXISTS trg_od_loans_updated_at ON od_loans`,
    `CREATE TRIGGER trg_od_loans_updated_at BEFORE UPDATE ON od_loans FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  ]) await run(s);

  // ── 8. MEMBERSHIPS ────────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS memberships (
    id              SERIAL PRIMARY KEY,
    record_id       INTEGER REFERENCES records(id) ON DELETE CASCADE,
    customer_name   TEXT,
    aadhar          TEXT,
    mobile          TEXT,
    saving_acc_no   TEXT,
    share_acc_no    TEXT,
    membership_type TEXT,
    join_date       DATE,
    status          TEXT        DEFAULT 'active',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )`);
  await run(`ALTER TABLE memberships ALTER COLUMN join_date DROP NOT NULL`);
  await run(`ALTER TABLE memberships ALTER COLUMN join_date DROP DEFAULT`);
  await run(cleanDate('memberships', 'join_date'));
  await run(`ALTER TABLE memberships ALTER COLUMN join_date TYPE date USING CASE WHEN join_date IS NULL THEN NULL ELSE join_date::text::date END`);
  for (const s of [
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS record_id       INTEGER REFERENCES records(id) ON DELETE CASCADE`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS customer_name   TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS aadhar          TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS mobile          TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS saving_acc_no   TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS share_acc_no    TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS membership_type     TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'active'`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW()`,
    // nominee fields
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS nominee             TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS nominee_name        TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS nominee_relation     TEXT`,
    // photo URLs
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS photo_customer      TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS photo_aadhar_front  TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS photo_aadhar_back   TEXT`,
    `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS photo_pan           TEXT`,
  ]) await run(s);
  for (const s of [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_record_id ON memberships(record_id)`,
    `DROP TRIGGER IF EXISTS trg_memberships_updated_at ON memberships`,
    `CREATE TRIGGER trg_memberships_updated_at BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  ]) await run(s);

  // ── 9. SYNC_LOG ───────────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS sync_log (
    id          SERIAL PRIMARY KEY,
    started_at  TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status      TEXT        DEFAULT 'running',
    message     TEXT,
    rows_synced INTEGER     DEFAULT 0
  )`);

  // ── 10. USERS ─────────────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS users (
    id         SERIAL PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    full_name  TEXT,
    role       TEXT        DEFAULT 'admin',
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name  TEXT`);
  await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ`);
  await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT TRUE`);

  // ── 11. NOTIFICATIONS ─────────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS notifications (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    link       TEXT,
    is_read    BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_notif_user_read ON notifications(user_id, is_read)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_notif_created   ON notifications(created_at)`);

  // ── Drop any NOT NULL constraints that differ between live DB and schema ────
  // Live DB may have stricter constraints from older migrations.
  // records.customer_id must be nullable (many records have no customer_id).
  await run(`ALTER TABLE records ALTER COLUMN customer_id DROP NOT NULL`);
  await run(`ALTER TABLE records ALTER COLUMN aadhar DROP NOT NULL`);
  await run(`ALTER TABLE records ALTER COLUMN mobile DROP NOT NULL`);

  // ── Unique constraints on account numbers (prevent duplicate acc_nos) ──────
  // These prevent duplicate account numbers at the DB level as a hard stop.
  // Using partial unique indexes so NULL acc_nos don't conflict.
  // FIX: exclude sub-cases (sonar_sub_no IS NOT NULL) from the unique gold acc
  // index so sub-loan account_nos like "03-001-A" don't conflict with each other
  // or with the parent. Sub-cases use account_no = subCaseId which is unique by
  // construction but not something the partial index should enforce.
  await run(`DROP INDEX IF EXISTS idx_records_unique_gold_acc`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_records_unique_gold_acc
    ON records(account_no)
    WHERE is_deleted=FALSE AND section='gold' AND account_no IS NOT NULL AND sonar_sub_no IS NULL`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_records_unique_fd_acc
    ON records(account_no) WHERE is_deleted=FALSE AND section='fd' AND account_no IS NOT NULL`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_records_unique_saving_acc
    ON records(account_no) WHERE is_deleted=FALSE AND section='saving' AND account_no IS NOT NULL`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_records_unique_od_acc
    ON records(account_no) WHERE is_deleted=FALSE AND section='od' AND account_no IS NOT NULL`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_gold_loans_unique_acc
    ON gold_loans(loan_acc_no) WHERE loan_acc_no IS NOT NULL`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_fd_accounts_unique_acc
    ON fd_accounts(fd_acc_no) WHERE fd_acc_no IS NOT NULL`);
  // acc_code: alias for fd_acc_no — was manually added on some deployments with NOT NULL.
  // Ensure it exists as nullable everywhere so the controller upsert never fails.
  await run(`ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS acc_code TEXT`);
  await run(`ALTER TABLE fd_accounts ALTER COLUMN acc_code DROP NOT NULL`);
  await run(`UPDATE fd_accounts SET acc_code = fd_acc_no WHERE acc_code IS NULL AND fd_acc_no IS NOT NULL`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_saving_accounts_unique_acc
    ON saving_accounts(saving_acc_no) WHERE saving_acc_no IS NOT NULL`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_od_loans_unique_acc
    ON od_loans(loan_acc_no) WHERE loan_acc_no IS NOT NULL`);

  // ── Clean up bad customer_id values caused by PDF sync column misdetection ──
  // customer_id must always be a 10-digit numeric string (e.g. "0000003445")
  // If names got stored as customer_id, null them out
  await run(`UPDATE customers SET customer_id = NULL WHERE customer_id IS NOT NULL AND customer_id !~ '^[0-9]{10}$'`);
  // Remove ghost customer rows:
  // Case 1: no identifying info AND a real customer with same name exists
  await run(`DELETE FROM customers WHERE id IN (
    SELECT c.id FROM customers c
    WHERE c.customer_id IS NULL AND (c.aadhar IS NULL OR c.aadhar = '') AND (c.mobile IS NULL OR c.mobile = '')
      AND EXISTS (
        SELECT 1 FROM customers c2
        WHERE c2.id != c.id
          AND LOWER(TRIM(c2.name)) = LOWER(TRIM(c.name))
          AND c2.customer_id IS NOT NULL
      )
  )`);
  // Case 2: name contains a PAN number (e.g. "ROSHAN TEJRAV BHAGAT GBXPB5838R")
  // Strip the PAN from the name and try to find the real customer
  await run(`DELETE FROM customers WHERE id IN (
    SELECT c.id FROM customers c
    WHERE c.customer_id IS NULL AND (c.aadhar IS NULL OR c.aadhar = '') AND (c.mobile IS NULL OR c.mobile = '')
      AND c.name ~* '[A-Za-z]{5}[0-9]{4}[A-Za-z]'
      AND EXISTS (
        SELECT 1 FROM customers c2
        WHERE c2.id != c.id
          AND LOWER(TRIM(REGEXP_REPLACE(c.name, '\\s*[A-Za-z]{5}[0-9]{4}[A-Za-z][:\\s]*$', '', 'i')))
            = LOWER(TRIM(c2.name))
          AND c2.customer_id IS NOT NULL
      )
  )`);
  // Case 2b: strip trailing punctuation (colon, spaces) before name matching
  // Handles "RENDYA RELASING JAMRA :" matching "RENDYA RELASING JAMRA"
  await run(`DELETE FROM customers WHERE id IN (
    SELECT c.id FROM customers c
    WHERE c.customer_id IS NULL AND (c.aadhar IS NULL OR c.aadhar = '') AND (c.mobile IS NULL OR c.mobile = '')
      AND c.name ~ '[:\s]+$'
      AND EXISTS (
        SELECT 1 FROM customers c2
        WHERE c2.id != c.id
          AND LOWER(TRIM(REGEXP_REPLACE(c.name, '[:\s]+$', '', 'g')))
            = LOWER(TRIM(c2.name))
          AND c2.customer_id IS NOT NULL
      )
  )`);
  // Case 3: delete any ghost with no customer_id, aadhar, or mobile at all (completely unidentifiable)
  await run(`DELETE FROM customers
    WHERE customer_id IS NULL
      AND (aadhar IS NULL OR aadhar = '')
      AND (mobile IS NULL OR mobile = '')
      AND name ~ '[A-Z]{5}[0-9]{4}[A-Za-z]'`);

  // ── Normalise empty strings → NULL ──────────────────────────────────────────
  // Root cause of all customer search/duplicate bugs: records and customers rows
  // store '' (empty string) instead of NULL for customer_id, aadhar, mobile, pan.
  // This breaks every IS NOT NULL guard, JOIN, and COALESCE check.
  // Must run BEFORE the dedup steps below so they work correctly.
  for (const s of [
    `UPDATE records   SET customer_id = NULL WHERE TRIM(COALESCE(customer_id,'')) = '' AND customer_id IS NOT NULL`,
    `UPDATE records   SET aadhar      = NULL WHERE TRIM(COALESCE(aadhar,''))      = '' AND aadhar      IS NOT NULL`,
    `UPDATE records   SET mobile      = NULL WHERE TRIM(COALESCE(mobile,''))      = '' AND mobile      IS NOT NULL`,
    `UPDATE customers SET customer_id = NULL WHERE TRIM(COALESCE(customer_id,'')) = '' AND customer_id IS NOT NULL`,
    `UPDATE customers SET aadhar      = NULL WHERE TRIM(COALESCE(aadhar,''))      = '' AND aadhar      IS NOT NULL`,
    `UPDATE customers SET mobile      = NULL WHERE TRIM(COALESCE(mobile,''))      = '' AND mobile      IS NOT NULL`,
    `UPDATE customers SET pan         = NULL WHERE TRIM(COALESCE(pan,''))         = '' AND pan         IS NOT NULL`,
    `UPDATE gold_loans SET aadhar     = NULL WHERE TRIM(COALESCE(aadhar,''))      = '' AND aadhar      IS NOT NULL`,
    `UPDATE gold_loans SET mobile     = NULL WHERE TRIM(COALESCE(mobile,''))      = '' AND mobile      IS NOT NULL`,
  ]) await run(s);

  // ── customers dedup — merge orphan rows into their customer_id owner ────────
  // Root cause: upsertCustomer had two separate code paths:
  //   Path A (customer_id present) → ON CONFLICT (customer_id) INSERT/UPDATE
  //   Path B (no customer_id)      → match by aadhar/mobile then INSERT
  //
  // If Path B ran first (gold loan saved before PDF import), it created a row
  // with no customer_id. When Path A ran later with the same person it could not
  // match that row (NULL ≠ any value in unique index), so it inserted a SECOND
  // row. Result: the customer appeared twice in dropdowns; Customers page showed
  // "0 customers" because the ghost-row filter required at least one of
  // customer_id/aadhar/mobile — but the split meant neither row had all three.
  //
  // Step A — stamp orphan rows: find rows with no customer_id that share
  //          aadhar, mobile, or PAN with a row that HAS a customer_id.
  await run(`UPDATE customers orphan
    SET customer_id = owner.customer_id, updated_at = NOW()
    FROM customers owner
    WHERE orphan.customer_id IS NULL
      AND owner.customer_id  IS NOT NULL
      AND (
        (orphan.aadhar IS NOT NULL AND orphan.aadhar <> '' AND orphan.aadhar = owner.aadhar)
        OR (orphan.mobile IS NOT NULL AND orphan.mobile <> '' AND orphan.mobile = owner.mobile)
        OR (orphan.pan IS NOT NULL AND orphan.pan <> '' AND LOWER(orphan.pan) = LOWER(COALESCE(owner.pan,'')))
      )`);

  // Step B — for each customer_id now shared by 2+ rows, fold the extra data
  //          from duplicates into the keeper row (lowest id = oldest = most complete).
  await run(`WITH ranked AS (
    SELECT id, customer_id,
           ROW_NUMBER() OVER (
             PARTITION BY customer_id
             ORDER BY
               (CASE WHEN aadhar  IS NOT NULL AND aadhar  <> '' THEN 1 ELSE 0 END +
                CASE WHEN mobile  IS NOT NULL AND mobile  <> '' THEN 1 ELSE 0 END +
                CASE WHEN pan     IS NOT NULL AND pan     <> '' THEN 1 ELSE 0 END +
                CASE WHEN address IS NOT NULL AND address <> '' THEN 1 ELSE 0 END) DESC,
               id ASC
           ) AS rn
    FROM customers WHERE customer_id IS NOT NULL
  )
  UPDATE customers k
  SET
    aadhar        = COALESCE(k.aadhar,        d.aadhar),
    mobile        = COALESCE(k.mobile,        d.mobile),
    pan           = COALESCE(k.pan,           d.pan),
    dob           = COALESCE(k.dob,           d.dob),
    address       = COALESCE(k.address,       d.address),
    occupation    = COALESCE(k.occupation,    d.occupation),
    saving_acc_no = COALESCE(k.saving_acc_no, d.saving_acc_no),
    share_acc_no  = COALESCE(k.share_acc_no,  d.share_acc_no),
    updated_at    = NOW()
  FROM ranked rd
  JOIN customers d ON d.id = rd.id
  JOIN ranked rk ON rk.customer_id = rd.customer_id AND rk.rn = 1
  JOIN customers k2 ON k2.id = rk.id
  WHERE rd.rn > 1 AND k.id = rk.id`);

  // Step C — delete the now-merged duplicate rows (keep only rn=1 per customer_id)
  await run(`DELETE FROM customers
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY customer_id
                 ORDER BY
                   (CASE WHEN aadhar  IS NOT NULL AND aadhar  <> '' THEN 1 ELSE 0 END +
                    CASE WHEN mobile  IS NOT NULL AND mobile  <> '' THEN 1 ELSE 0 END +
                    CASE WHEN pan     IS NOT NULL AND pan     <> '' THEN 1 ELSE 0 END +
                    CASE WHEN address IS NOT NULL AND address <> '' THEN 1 ELSE 0 END) DESC,
                   id ASC
               ) AS rn
        FROM customers WHERE customer_id IS NOT NULL
      ) sub WHERE rn > 1
    )`);

  // ── gold_loans acc_no / loan_acc_no drift repair ──────────────────────
  // Bug fix: old processTransaction did not write acc_no on upsert so the two
  // columns could drift. This one-time backfill keeps them in sync for any
  // rows that were created before the fix was deployed. Safe to run repeatedly
  // (only updates rows that are actually out of sync).
  await run(`UPDATE gold_loans
    SET acc_no = loan_acc_no
    WHERE loan_acc_no IS NOT NULL
      AND (acc_no IS NULL OR acc_no <> loan_acc_no)`);

  // Also backfill the reverse: if acc_no was set but loan_acc_no is missing
  // (very old rows from original schema before loan_acc_no column existed)
  await run(`UPDATE gold_loans
    SET loan_acc_no = acc_no
    WHERE acc_no IS NOT NULL
      AND (loan_acc_no IS NULL OR loan_acc_no = '')`);

  // ── fd_accounts acc_no column — same issue as gold_loans ─────────────────
  // Some live DBs have an 'acc_no' TEXT NOT NULL column on fd_accounts that was
  // added manually before acc_code was introduced. The PDF-sync INSERTs now
  // include acc_no so new rows are fine; this migration ensures:
  //   1. The column exists (harmless if already present)
  //   2. The NOT NULL constraint is dropped so rows without it don't fail
  //   3. Any existing rows where acc_no is NULL get backfilled from fd_acc_no
  await run(`ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS acc_no TEXT`);
  await run(`ALTER TABLE fd_accounts ALTER COLUMN acc_no DROP NOT NULL`);
  await run(`UPDATE fd_accounts
    SET acc_no = fd_acc_no
    WHERE fd_acc_no IS NOT NULL
      AND (acc_no IS NULL OR acc_no <> fd_acc_no)`);
  // BUG FIX: the above only ever backfilled acc_no from fd_acc_no. MIS
  // Special deposits store their account number in mis_acc_no instead (a
  // separate 290-series), so every MIS row's acc_no stayed NULL — and the
  // records.controller.js upsert for "New FD"/"MIS Interest" never wrote
  // acc_no going forward either (fixed alongside this migration). Together
  // those two gaps meant any FD created through the app, MIS or regular
  // term, showed a blank account-code badge on the Fixed Deposits list
  // (/api/combined/fd-accounts selects fd.acc_no). Backfill the MIS side
  // here for existing rows; new rows are covered by the controller fix.
  await run(`UPDATE fd_accounts
    SET acc_no = mis_acc_no
    WHERE mis_acc_no IS NOT NULL
      AND (fd_acc_no IS NULL OR fd_acc_no = '')
      AND (acc_no IS NULL OR acc_no <> mis_acc_no)`);

  // BUG FIX: separately from the gap above, some MIS rows had BOTH a
  // populated mis_acc_no (correct, 290-series) AND a stale/leftover
  // fd_acc_no (a 046-series Term number) — caused by the frontend not
  // clearing the hidden Term acc-no field when the user switched FD Type to
  // MIS Special, combined with the old OR-precedence bug in the
  // records.controller.js upsert that always preferred fd_acc_no when
  // present. Together those meant a genuinely MIS deposit (fd_type='mis',
  // mis_acc_no correctly entered) displayed the wrong Term account number on
  // the Fixed Deposits list. Both bugs are fixed above; this backfill
  // corrects existing rows where mis_acc_no is populated and clearly
  // authoritative (only rows already tagged fd_type='mis' with a real
  // mis_acc_no are touched — an older row tagged MIS with no mis_acc_no on
  // file is left alone for manual review since its intended account number
  // can't be safely inferred here).
  await run(`UPDATE fd_accounts
    SET fd_acc_no = NULL,
        acc_code = mis_acc_no,
        acc_no = mis_acc_no
    WHERE fd_type = 'mis'
      AND mis_acc_no IS NOT NULL AND mis_acc_no <> ''
      AND fd_acc_no IS NOT NULL AND fd_acc_no <> ''
      AND fd_acc_no <> mis_acc_no`);

  // ── Clean customer names that have a trailing date from bad PDF import ────
  // When cols.startDate wasn't detected during PDF parsing, the start date
  // bled into the customer name (e.g. "CHANGAL NARSING GANGARAM 18/03/2026").
  // This strips any trailing dd/mm/yyyy from both records.name and
  // fd_accounts.customer_name so the display and search work correctly.
  await run(`UPDATE records
    SET name = TRIM(REGEXP_REPLACE(name, '\\s+\\d{2}/\\d{2}/\\d{4}\\s*$', '', 'g'))
    WHERE name ~ '\\d{2}/\\d{2}/\\d{4}\\s*$'`);
  await run(`UPDATE fd_accounts
    SET customer_name = TRIM(REGEXP_REPLACE(customer_name, '\\s+\\d{2}/\\d{2}/\\d{4}\\s*$', '', 'g'))
    WHERE customer_name ~ '\\d{2}/\\d{2}/\\d{4}\\s*$'`);
  await run(`UPDATE customers
    SET name = TRIM(REGEXP_REPLACE(name, '\\s+\\d{2}/\\d{2}/\\d{4}\\s*$', '', 'g'))
    WHERE name ~ '\\d{2}/\\d{2}/\\d{4}\\s*$'`);

  // ── Clean PAN fields that have a trailing date from bad PDF import ─────────
  // Same column-bleed issue as customer names: the start date bleeds into the
  // PAN field (e.g. "ezzpm0738m 04/05/2026"). Strip trailing dd/mm/yyyy from
  // pan in customers, saving_accounts, and the records.data JSONB blob.
  await run(`UPDATE customers
    SET pan = TRIM(REGEXP_REPLACE(pan, '\\s+\\d{2}/\\d{2}/\\d{4}\\s*$', '', 'g'))
    WHERE pan IS NOT NULL AND pan ~ '\\d{2}/\\d{2}/\\d{4}\\s*$'`);
  await run(`UPDATE saving_accounts
    SET pan_no = TRIM(REGEXP_REPLACE(pan_no, '\\s+\\d{2}/\\d{2}/\\d{4}\\s*$', '', 'g'))
    WHERE pan_no IS NOT NULL AND pan_no ~ '\\d{2}/\\d{2}/\\d{4}\\s*$'`);
  await run(`UPDATE records
    SET data = jsonb_set(data, '{pan}',
      to_jsonb(TRIM(REGEXP_REPLACE(data->>'pan', '\\s+\\d{2}/\\d{2}/\\d{4}\\s*$', '', 'g'))))
    WHERE data->>'pan' IS NOT NULL
      AND data->>'pan' ~ '\\d{2}/\\d{2}/\\d{4}\\s*$'
      AND is_deleted = FALSE`);

  // ── fd_type column — distinguishes Term FD (10%/13m) from MIS FD (9%/monthly) ──
  // 'term' = interest paid at maturity (acc prefix 046)
  // 'mis'  = monthly interest credited to saving acc (acc prefix 290)
  // Backfill: rows with mis_acc_no or section='mis' → 'mis', everything else → 'term'
  await run(`ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_type TEXT DEFAULT 'term'`);
  await run(`ALTER TABLE fd_accounts ALTER COLUMN fd_type DROP NOT NULL`);
  // BUG FIX: original condition was:
  //   WHERE fd_type IS NULL OR fd_type = 'term' AND (mis_acc_no IS NOT NULL OR section = 'mis')
  // AND binds tighter than OR, so it parsed as:
  //   WHERE fd_type IS NULL OR (fd_type = 'term' AND ...)
  // meaning any NULL row got set to 'mis' even if it's a term FD.
  // Fix: wrap each OR branch in explicit parentheses.
  await run(`UPDATE fd_accounts SET fd_type = 'mis'
    WHERE (fd_type IS NULL OR fd_type = 'term')
      AND (mis_acc_no IS NOT NULL OR section = 'mis')`);
  await run(`UPDATE fd_accounts SET fd_type = 'term'
    WHERE fd_type IS NULL`);

  // ── fd_sub_type column — stores the FD product label selected in the form ──────
  // e.g. "13 Months – 10%", "MIS FD – 9%", "1 Year FD – 8%"
  // Frontend sends data.fd_sub_type on every new FD save. Stored so it's queryable
  // for reports and so isMisFd detection in process-transaction is reliable.
  await run(`ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_sub_type TEXT`);
  // Backfill existing MIS rows (fd_type='mis') that have no fd_sub_type set
  await run(`UPDATE fd_accounts SET fd_sub_type = 'MIS FD – 9%'
    WHERE fd_sub_type IS NULL AND fd_type = 'mis'`);

  // ── FD Account Number Format Enforcement ─────────────────────────────────
  // Rule: fd_acc_no must always be exactly 14 digits (e.g. "00103046000421").
  // Any suffix like -CLOSE, -C, -XXXX was incorrectly encoded status info.
  // Strip it from fd_accounts and records, then mark those rows as closed.
  await run(`UPDATE fd_accounts
    SET fd_acc_no = REGEXP_REPLACE(fd_acc_no, '[-][A-Za-z0-9]+$', ''),
        acc_code  = REGEXP_REPLACE(COALESCE(acc_code,''), '[-][A-Za-z0-9]+$', ''),
        acc_no    = REGEXP_REPLACE(COALESCE(acc_no,''), '[-][A-Za-z0-9]+$', ''),
        status    = 'closed'
    WHERE fd_acc_no ~ '[-][A-Za-z]'`);
  await run(`UPDATE records
    SET account_no = REGEXP_REPLACE(account_no, '[-][A-Za-z0-9]+$', ''),
        status = 'closed'
    WHERE section='fd' AND account_no ~ '[-][A-Za-z]' AND is_deleted=FALSE`);
  // Also clean data->>'fd_acc_no' inside the JSONB blob
  await run(`UPDATE records
    SET data = jsonb_set(
      data,
      '{fd_acc_no}',
      to_jsonb(REGEXP_REPLACE(data->>'fd_acc_no', '[-][A-Za-z0-9]+$', ''))
    )
    WHERE data->>'fd_acc_no' ~ '[-][A-Za-z]' AND is_deleted=FALSE`);

  // ── Maturity Date Backfill ────────────────────────────────────────────────
  // For any FD where fd_maturity_date is NULL but loan_date + fd_period exist,
  // calculate and store the correct maturity date.
  await run(`UPDATE fd_accounts
    SET fd_maturity_date = (loan_date + (fd_period || ' months')::interval)::date
    WHERE fd_maturity_date IS NULL
      AND loan_date IS NOT NULL
      AND fd_period IS NOT NULL
      AND fd_period > 0`);
  // Also backfill the JSONB field in records.data for display consistency
  await run(`UPDATE records r
    SET data = jsonb_set(
      data,
      '{fd_maturity_date}',
      to_jsonb(fa.fd_maturity_date::text)
    )
    FROM fd_accounts fa
    WHERE fa.record_id = r.id
      AND r.is_deleted = FALSE
      AND r.section IN ('fd','mis')
      AND fa.fd_maturity_date IS NOT NULL
      AND (r.data->>'fd_maturity_date' IS NULL OR r.data->>'fd_maturity_date' = '')`);

  // ── saving_accounts acc_code / acc_no backfill ───────────────────────────
  // acc_code and acc_no were added later — backfill from saving_acc_no for any
  // existing rows that are NULL so the NOT NULL constraint never fires again.
  await run(`UPDATE saving_accounts
    SET acc_no = saving_acc_no
    WHERE saving_acc_no IS NOT NULL
      AND (acc_no IS NULL OR acc_no = '')`);
  await run(`UPDATE saving_accounts
    SET acc_code = saving_acc_no
    WHERE saving_acc_no IS NOT NULL
      AND (acc_code IS NULL OR acc_code = '')`);

  // ── saving_accounts interest_rate / cust_code / start_date backfill ──────
  // BUG FIX: these three columns were missing from the schema so bulk-imported
  // rows were saved without them. Backfill from records.data JSONB for any
  // existing saving_accounts rows that are still NULL.
  await run(`UPDATE saving_accounts sa
    SET interest_rate = (r.data->>'interest_rate')::numeric
    FROM records r
    WHERE r.id = sa.record_id
      AND sa.interest_rate IS NULL
      AND r.data->>'interest_rate' ~ '^[0-9]+(\\.[0-9]+)?$'`);
  await run(`UPDATE saving_accounts sa
    SET cust_code = COALESCE(r.data->>'cust_code', r.customer_id)
    FROM records r
    WHERE r.id = sa.record_id
      AND sa.cust_code IS NULL
      AND COALESCE(r.data->>'cust_code', r.customer_id) IS NOT NULL`);
  await run(`UPDATE saving_accounts sa
    SET start_date = r.date
    FROM records r
    WHERE r.id = sa.record_id
      AND sa.start_date IS NULL
      AND r.date IS NOT NULL`);
  // Also backfill pan_no from records.data if missing
  await run(`UPDATE saving_accounts sa
    SET pan_no = r.data->>'pan'
    FROM records r
    WHERE r.id = sa.record_id
      AND sa.pan_no IS NULL
      AND r.data->>'pan' IS NOT NULL AND r.data->>'pan' <> ''`);

  // Backfill balance from records.data->>'saving_balance' for rows still at 0
  // (rows imported before importBulk wrote to saving_accounts)
  await run(`UPDATE saving_accounts sa
    SET balance = (r.data->>'saving_balance')::numeric
    FROM records r
    WHERE r.id = sa.record_id
      AND sa.balance = 0
      AND r.data->>'saving_balance' ~ '^[0-9]+(\\.[0-9]+)?$'
      AND (r.data->>'saving_balance')::numeric > 0`);

  // ── customers.saving_balance backfill from saving_accounts ───────────────
  // FIX: customers.saving_balance is never updated by processTransaction —
  // it stays at the value set during account opening. Sync the live balance
  // from saving_accounts into customers so the customer list/search shows
  // the correct balance. Safe to run repeatedly (only updates where different).
  await run(`UPDATE customers c
    SET saving_balance = sa.balance, updated_at = NOW()
    FROM saving_accounts sa
    WHERE sa.saving_acc_no = c.saving_acc_no
      AND sa.status <> 'closed'
      AND sa.balance IS DISTINCT FROM c.saving_balance`);

  // Also index saving_acc_no on customers for fast balance syncs
  await run(`CREATE INDEX IF NOT EXISTS idx_customers_saving_acc_no ON customers(saving_acc_no) WHERE saving_acc_no IS NOT NULL`);

  // ── customers identity-field backfill from records ────────────────────────
  // For PDF-imported customers, aadhar/mobile were stored as '' in records
  // top-level columns so customers.aadhar/mobile remained blank after import.
  // This backfills from records.data JSONB (where the real values live) into
  // the customers table for any row that is still blank.
  // Safe to run repeatedly — COALESCE+NULLIF never overwrites a filled value.
  // BUG FIX (round 2): the round-1 ::text cast fixed the comparison-type
  // error (COALESCE types date and text cannot be matched), but the result
  // is still text, and c.dob is really DATE on the live DB — Postgres
  // won't implicitly assign text into a date column, so this would have
  // been the very next crash: 'column "dob" is of type date but expression
  // is of type text'. Cast the final COALESCE result to ::date, same
  // pattern already used for closed_date/loan_date etc. throughout this
  // file. NULLIF(...,'')::date guards against empty-string values; any
  // genuinely malformed date string will still throw 22007, but that code
  // is in run()'s ignore list, so it degrades to "skip this backfill" rather
  // than crashing the whole migration.
  await run(`UPDATE customers c
    SET
      aadhar     = COALESCE(NULLIF(c.aadhar,''),     NULLIF(r.aadhar,''),          NULLIF(r.data->>'aadhar','')),
      mobile     = COALESCE(NULLIF(c.mobile,''),     NULLIF(r.mobile,''),          NULLIF(r.data->>'mobile','')),
      pan        = COALESCE(NULLIF(c.pan,''),        NULLIF(r.data->>'pan',''),    NULLIF(r.data->>'pan_no','')),
      dob        = COALESCE(NULLIF(c.dob::text,''),  NULLIF(r.data->>'dob',''))::date,
      address    = COALESCE(NULLIF(c.address,''),    NULLIF(r.data->>'address','')),
      occupation = COALESCE(NULLIF(c.occupation,''), NULLIF(r.data->>'occupation','')),
      updated_at = NOW()
    FROM (
      SELECT DISTINCT ON (customer_id)
        customer_id, aadhar, mobile, data
      FROM records
      WHERE is_deleted = FALSE
        AND customer_id IS NOT NULL AND customer_id <> ''
      ORDER BY customer_id, id DESC
    ) r
    WHERE c.customer_id = r.customer_id
      AND (
        COALESCE(c.aadhar,'') = '' OR COALESCE(c.mobile,'') = ''
        OR COALESCE(c.pan,'') = '' OR COALESCE(c.dob::text,'') = ''
      )`);


  }); // end migrate('v1_initial_schema')

  // ── v2: PDF SYNC LOG ──────────────────────────────────────────────────
  // Tracks every PDF Sync upload (preview/apply/wipe/nuclear) for the
  // "Upload History" panel on the PDF Sync admin page.
  await migrate('v2_pdf_sync_log', async () => {
    await run(`CREATE TABLE IF NOT EXISTS pdf_sync_log (
      id           SERIAL PRIMARY KEY,
      section      TEXT NOT NULL,
      file_name    TEXT,
      record_count INTEGER     DEFAULT 0,
      mode         TEXT        NOT NULL,
      updated      INTEGER     DEFAULT 0,
      inserted     INTEGER     DEFAULT 0,
      closed       INTEGER     DEFAULT 0,
      deleted      INTEGER     DEFAULT 0,
      skipped      INTEGER     DEFAULT 0,
      applied      INTEGER     DEFAULT 0,
      status       TEXT        DEFAULT 'applied',
      errors       JSONB       DEFAULT '[]',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_pdf_sync_log_created_at ON pdf_sync_log(created_at)`);
  });

  // ── v3: SHARE_ACCOUNTS record_id unique index ──────────────────────────
  // pdf_sync_routes.js upsertMirror('shares') does
  // INSERT INTO share_accounts (...) ON CONFLICT (record_id) DO UPDATE ...
  // which requires a unique constraint/index on record_id (memberships
  // already has idx_memberships_record_id for the same reason).
  await migrate('v3_share_accounts_record_id_idx', async () => {
    await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_share_accounts_record_id ON share_accounts(record_id)`);
  });

  // ── v4: nominee + photo columns on all derived tables ─────────────────
  await migrate('v4_nominee_photo_columns', async () => {
    // gold_loans: add nominee + interest_rate
    for (const s of [
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS nominee          TEXT`,
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS nominee_name     TEXT`,
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS nominee_relation  TEXT`,
      `ALTER TABLE gold_loans ADD COLUMN IF NOT EXISTS interest_rate    NUMERIC`,
    ]) await run(s);

    // fd_accounts: add nominee + photos + fd_type/fd_sub_type
    for (const s of [
      `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS nominee             TEXT`,
      `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS nominee_name        TEXT`,
      `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS nominee_relation     TEXT`,
      `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS photo_customer       TEXT`,
      `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS photo_aadhar_front   TEXT`,
      `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS photo_aadhar_back    TEXT`,
      `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS photo_pan            TEXT`,
      `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_type              TEXT`,
      `ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS fd_sub_type          TEXT`,
    ]) await run(s);

    // saving_accounts: add nominee + photos
    for (const s of [
      `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS nominee             TEXT`,
      `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS nominee_name        TEXT`,
      `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS nominee_relation     TEXT`,
      `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS photo_customer       TEXT`,
      `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS photo_aadhar_front   TEXT`,
      `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS photo_aadhar_back    TEXT`,
      `ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS photo_pan            TEXT`,
    ]) await run(s);

    // memberships: add nominee + photos
    for (const s of [
      `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS nominee             TEXT`,
      `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS nominee_name        TEXT`,
      `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS nominee_relation     TEXT`,
      `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS photo_customer       TEXT`,
      `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS photo_aadhar_front   TEXT`,
      `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS photo_aadhar_back    TEXT`,
      `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS photo_pan            TEXT`,
    ]) await run(s);

    // Backfill nominee + photos into derived tables from records.data JSONB
    await run(`UPDATE gold_loans gl
      SET
        nominee          = COALESCE(gl.nominee,          r.data->>'nominee'),
        nominee_name     = COALESCE(gl.nominee_name,     r.data->>'nominee_name'),
        nominee_relation = COALESCE(gl.nominee_relation, r.data->>'nominee_relation'),
        interest_rate    = COALESCE(
                             NULLIF(gl.interest_rate::text, ''),
                             CASE WHEN (r.data->>'interest_rate') ~ '^[0-9]+(\\.[0-9]+)?$'
                             THEN r.data->>'interest_rate' ELSE NULL END
                            )::numeric
      FROM records r
      WHERE r.id = gl.record_id AND r.is_deleted = FALSE`);

    await run(`UPDATE fd_accounts fa
      SET
        nominee           = COALESCE(fa.nominee,           r.data->>'nominee'),
        nominee_name      = COALESCE(fa.nominee_name,      r.data->>'nominee_name'),
        nominee_relation  = COALESCE(fa.nominee_relation,  r.data->>'nominee_relation'),
        photo_customer    = COALESCE(fa.photo_customer,    r.data->>'photo_customer', r.data->>'customer_photo_url'),
        photo_aadhar_front= COALESCE(fa.photo_aadhar_front,r.data->>'photo_aadhar_front'),
        photo_aadhar_back = COALESCE(fa.photo_aadhar_back, r.data->>'photo_aadhar_back'),
        photo_pan         = COALESCE(fa.photo_pan,         r.data->>'photo_pan')
      FROM records r
      WHERE r.id = fa.record_id AND r.is_deleted = FALSE`);

    await run(`UPDATE saving_accounts sa
      SET
        nominee           = COALESCE(sa.nominee,           r.data->>'nominee'),
        nominee_name      = COALESCE(sa.nominee_name,      r.data->>'nominee_name'),
        nominee_relation  = COALESCE(sa.nominee_relation,  r.data->>'nominee_relation'),
        photo_customer    = COALESCE(sa.photo_customer,    r.data->>'photo_customer', r.data->>'customer_photo_url'),
        photo_aadhar_front= COALESCE(sa.photo_aadhar_front,r.data->>'photo_aadhar_front'),
        photo_aadhar_back = COALESCE(sa.photo_aadhar_back, r.data->>'photo_aadhar_back'),
        photo_pan         = COALESCE(sa.photo_pan,         r.data->>'photo_pan')
      FROM records r
      WHERE r.id = sa.record_id AND r.is_deleted = FALSE`);

    await run(`UPDATE memberships m
      SET
        nominee           = COALESCE(m.nominee,           r.data->>'nominee'),
        nominee_name      = COALESCE(m.nominee_name,      r.data->>'nominee_name'),
        nominee_relation  = COALESCE(m.nominee_relation,  r.data->>'nominee_relation'),
        photo_customer    = COALESCE(m.photo_customer,    r.data->>'photo_customer', r.data->>'customer_photo_url'),
        photo_aadhar_front= COALESCE(m.photo_aadhar_front,r.data->>'photo_aadhar_front'),
        photo_aadhar_back = COALESCE(m.photo_aadhar_back, r.data->>'photo_aadhar_back'),
        photo_pan         = COALESCE(m.photo_pan,         r.data->>'photo_pan')
      FROM records r
      WHERE r.id = m.record_id AND r.is_deleted = FALSE`);
  });

  // ── v5: cashbook_entries acc_no drift repair (OD / Gold Loan pairs) ────
  // Bug: "FD OD Loan" (Debit) and "FD OD Loan Closing" (Credit) — and the
  // equivalent Gold Loan pair — are generated from the same record_id and
  // must always share one acc_no. The frontend previously let each row's
  // Account No. be edited independently (see ldgSaveCell in app.js), so a
  // fix typed into one row silently left its sibling stale (e.g. a valid
  // 14-digit OD account "00104017000106" next to a stale, truncated
  // "001040170001" for the same loan). app.js now keeps siblings in sync
  // going forward; this is a one-time backfill for rows already drifted.
  // Where a group has one row matching the canonical 14-digit account-number
  // format (od/gold: NNNNNNNNNNNNNN) and another that doesn't, adopt the
  // 14-digit value across the whole record_id group. Safe to run repeatedly.
  await migrate('v5_cashbook_acc_no_drift_repair', async () => {
    await run(`UPDATE cashbook_entries ce
      SET acc_no = canon.acc_no
      FROM (
        SELECT DISTINCT record_id, acc_no
        FROM cashbook_entries
        WHERE is_deleted = FALSE
          AND acc_no ~ '^[0-9]{14}$'
          AND acc_type IN (
            'FD OD Loan', 'FD OD Loan Closing',
            'Gold Loan TRF', 'Interest Received On Gold Loan TRF'
          )
      ) canon
      WHERE ce.record_id = canon.record_id
        AND ce.is_deleted = FALSE
        AND ce.acc_type IN (
          'FD OD Loan', 'FD OD Loan Closing',
          'Gold Loan TRF', 'Interest Received On Gold Loan TRF'
        )
        AND ce.acc_no IS DISTINCT FROM canon.acc_no`);
  });

  // ── v6: derived-table status drift repair (gold_loans/fd_accounts/od_loans/
  // saving_accounts/memberships stuck 'active' after their record was closed) ──
  // The PATCH /api/records/:id/close endpoint cascades status='closed' to every
  // derived table whenever a record closes (see records.controller.js) — but
  // that cascade was added/fixed incrementally over time (see its own "BUG
  // FIX" comments: saving_accounts, share_accounts, and the sonar sub-loan
  // auto-close-parent path were each missing the cascade at different points
  // in the past). Records closed before each of those fixes landed are stuck
  // showing 'active' in their derived-table mirror forever. This is exactly
  // what the unified Account Search surfaced: a fully-closed gold loan
  // (records.closed_tx_types already covers every tx_type) still showed up
  // as an "active" search result, and clicking Close on it just said "All
  // transaction types already closed" — because gold_loans.status was never
  // updated even though records.status correctly says 'closed'.
  // One-time backfill: wherever records.status = 'closed' but the linked
  // derived row still isn't, adopt records' status/closed date. records.status
  // is only ever set to 'closed' once every required tx_type on it is closed
  // (see effectiveClosed in records.controller.js), so it's a safe, reliable
  // source of truth here — this mirrors exactly what the live cascade already
  // does on every new close, just applied retroactively. share_accounts has
  // no record_id link (confirmed elsewhere) so it can't drift this way.
  // BUG FIX: this migration originally did `COALESCE(gl.closed_date,
  // r.closed_date)` etc. directly — both columns are declared DATE in this
  // file's own CREATE/ALTER statements, but the live DB threw "COALESCE
  // types date and text cannot be matched" (42804), meaning at least one of
  // them has drifted to TEXT on the actual server (the same class of
  // migrations.js-vs-live-schema drift already seen elsewhere on this
  // project — e.g. customers.cust_code/pan_no, share_accounts). That's a
  // structural error (not in run()'s ignore list), so it aborted the
  // migration on every single boot and crashed the whole app in a restart
  // loop until PM2 gave up. Cast both sides through ::text — a no-op for a
  // column that's already text, and a safe ISO-format stringify for one
  // that's really date — then NULLIF/COALESCE as text and cast the single
  // winning value back to ::date once at the end. Works no matter which
  // side (if either) has actually drifted.
  await migrate('v6_derived_table_status_sync', async () => {
    await run(`UPDATE gold_loans gl SET
        status = 'closed',
        closed_date = COALESCE(NULLIF(gl.closed_date::text, ''), NULLIF(r.closed_date::text, ''))::date
      FROM records r
      WHERE r.id = gl.record_id
        AND r.status = 'closed'
        AND COALESCE(gl.status::text, '') <> 'closed'`);

    await run(`UPDATE fd_accounts fa SET
        status = 'closed',
        closed_date = COALESCE(NULLIF(fa.closed_date::text, ''), NULLIF(r.closed_date::text, ''))::date
      FROM records r
      WHERE r.id = fa.record_id
        AND r.status = 'closed'
        AND COALESCE(fa.status::text, '') <> 'closed'`);

    await run(`UPDATE od_loans od SET
        status = 'closed',
        closed_date = COALESCE(NULLIF(od.closed_date::text, ''), NULLIF(r.closed_date::text, ''))::date
      FROM records r
      WHERE r.id = od.record_id
        AND r.status = 'closed'
        AND COALESCE(od.status::text, '') <> 'closed'`);

    await run(`UPDATE saving_accounts sa SET
        status = 'closed',
        closed_date = COALESCE(NULLIF(sa.closed_date::text, ''), NULLIF(r.closed_date::text, ''))::date
      FROM records r
      WHERE r.id = sa.record_id
        AND r.status = 'closed'
        AND COALESCE(sa.status::text, '') <> 'closed'`);

    await run(`UPDATE memberships m SET
        status = 'closed',
        close_date = COALESCE(NULLIF(m.close_date::text, ''), NULLIF(r.closed_date::text, ''))::date
      FROM records r
      WHERE r.id = m.record_id
        AND r.status = 'closed'
        AND COALESCE(m.status::text, '') <> 'closed'`);
  });

  // ── Daily Cash Book opening balance ──────────────────────────────────────
  // Previously the "opening balance" typed into the Cash Book tab was only
  // ever saved to that browser's localStorage (cb-opening-<date>) — nothing
  // server-side. On a shared multi-cashier/multi-computer app that breaks
  // the day-to-day carry-forward the Sahakaar Vibhag रोखवही format depends
  // on: open the cash book from a different machine, or clear browser data,
  // and "previous day's closing" has nothing to find. One row per date,
  // upserted from the Cash Book tab, gives every device/user the same value.
  await migrate('v7_daily_cash_balance', async () => {
    await run(`CREATE TABLE IF NOT EXISTS daily_cash_balance (
      date            DATE PRIMARY KEY,
      opening_balance NUMERIC     DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )`);
    await run(`DROP TRIGGER IF EXISTS trg_daily_cash_balance_updated_at ON daily_cash_balance`);
    await run(`CREATE TRIGGER trg_daily_cash_balance_updated_at BEFORE UPDATE ON daily_cash_balance FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
  });

  // FIX (CRITICAL): processTransaction()'s shared upsert() helper has passed
  // "customer_id" in the column list for gold_loans, fd_accounts, and od_loans
  // since the "BUG FIX (systemic)" comment above resolvedCustomerId was added —
  // but the column itself was never actually created on any of the three
  // tables. Every normal single-record save for a Gold Loan, FD, MIS FD, or OD
  // Loan has therefore been throwing "column customer_id does not exist" on
  // its derived-table upsert — caught, pushed into a soft errors[] array, and
  // shown only as a dismissible "some steps failed" toast, while the main
  // "✅ Saved" toast still fires. Net effect: the records row saves fine, but
  // the gold_loans/fd_accounts/od_loans mirror row is never created or
  // updated — exactly why OD Loans (and gold/FD) can look "not updated" on
  // pages that read the derived tables. Purely additive, nullable FK column —
  // same safe pattern as every other ADD COLUMN IF NOT EXISTS in this file.
  await migrate('v8_derived_table_customer_id', async () => {
    await run(`ALTER TABLE gold_loans  ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`);
    await run(`ALTER TABLE fd_accounts ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`);
    await run(`ALTER TABLE od_loans    ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_gold_loans_customer_id  ON gold_loans(customer_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_fd_accounts_customer_id ON fd_accounts(customer_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_od_loans_customer_id    ON od_loans(customer_id)`);
  });

  // FIX (PAN corruption): upsertCustomer() already validates data.pan against
  // the real PAN format (5 letters + 4 digits + 1 letter) before writing to
  // customers.pan — but create()/update()/importBulk() write the raw,
  // unvalidated pan value straight into records.data (what the Database tab
  // actually displays), so junk like a stray "155599.00 cr" balance string
  // pasted into the PAN field could sit there indefinitely. Clean up any
  // already-corrupted values now (same idea as the earlier "trailing date"
  // PAN cleanup above); the code fix stops new junk going in from here on.
  await migrate('v8_clean_bad_pan_in_records_data', async () => {
    await run(`UPDATE records
      SET data = data - 'pan'
      WHERE data->>'pan' IS NOT NULL
        AND data->>'pan' <> ''
        AND data->>'pan' !~* '^[A-Z]{5}[0-9]{4}[A-Z]$'
        AND is_deleted = FALSE`);
  });

  // FIX (OD Loan PDF sync failing on every row): od_loans on the live DB has
  // an acc_code column with a NOT NULL constraint that isn't in this file's
  // v1_initial_schema CREATE TABLE at all — the same "manually added on some
  // deployments with NOT NULL" drift already fixed for fd_accounts.acc_code
  // above (see the v1_initial_schema block). Neither the normal OD-loan save
  // path (records.controller.js's upsert() call for od_loans) nor
  // pdf_sync.routes.js's OD upsertMirror ever populate acc_code, so every
  // single INSERT into od_loans has been throwing "null value in column
  // acc_code violates not-null constraint" — caught and pushed into a soft
  // errors[] array on the normal save path (same silent-failure shape as
  // v8_derived_table_customer_id above), and surfaced loudly (0/90 applied)
  // the first time a bulk PDF sync exercised this path. Drop the NOT NULL
  // and backfill from loan_acc_no, same remedy already applied to
  // fd_accounts.acc_code.
  await migrate('v9_od_loans_acc_code_nullable', async () => {
    await run(`ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS acc_code TEXT`);
    await run(`ALTER TABLE od_loans ALTER COLUMN acc_code DROP NOT NULL`);
    await run(`UPDATE od_loans SET acc_code = loan_acc_no WHERE acc_code IS NULL AND loan_acc_no IS NOT NULL`);
  });

  // FIX (same drift, second column): after v9 fixed acc_code, retrying the OD
  // PDF sync immediately hit an identical error one column over — "null value
  // in column acc_no violates not-null constraint". od_loans on the live DB
  // also has an acc_no TEXT NOT NULL column that isn't in this file's
  // v1_initial_schema CREATE TABLE at all — exactly the same "manually added
  // on some deployments with NOT NULL" drift already fixed for
  // gold_loans.acc_no and fd_accounts.acc_no above. Same remedy.
  await migrate('v10_od_loans_acc_no_nullable', async () => {
    await run(`ALTER TABLE od_loans ADD COLUMN IF NOT EXISTS acc_no TEXT`);
    await run(`ALTER TABLE od_loans ALTER COLUMN acc_no DROP NOT NULL`);
    await run(`UPDATE od_loans SET acc_no = loan_acc_no WHERE acc_no IS NULL AND loan_acc_no IS NOT NULL`);
  });

  // FIX (customer profile / Customers list showing 0 accounts for some
  // accounts even after pdf_sync.routes.js started populating customer_id
  // going forward — see that file's resolveCustomerDbId): this is the
  // historical half of the same gap. dashboard.routes.js's customer-detail
  // lookup and the Customers list counts both join on each mirror table's
  // OWN customer_id FK (gold_loans.customer_id, fd_accounts.customer_id,
  // etc.) — never on records.customer_id. Every mirror row written before
  // today (by an older PDF sync, or any other path that predates that FK
  // even existing) has customer_id NULL, so those accounts show up fine on
  // their own page (Gold Loans, etc.) but are invisible from the owning
  // customer's profile. Backfill in two passes, both exact-match only (never
  // fuzzy, so nothing gets attached to the wrong customer):
  //   Pass A: the record's own customer_id text business code, matched
  //     against customers.customer_id — unambiguous by construction.
  //   Pass B: PAN, matched against customers.pan_no, but ONLY when that PAN
  //     belongs to exactly one customer (guards against the rare case of a
  //     shared/mistyped PAN attaching an account to the wrong person).
  // share_accounts has no record_id at all (see pdf_sync.routes.js's shares
  // case) so it matches directly on its own cust_code/pan_no columns instead.
  await migrate('v11_backfill_mirror_customer_ids', async () => {
    const recordLinkedTables = [
      ['gold_loans', 'gl'],
      ['fd_accounts', 'fa'],
      ['saving_accounts', 'sa'],
      ['od_loans', 'ol'],
      ['memberships', 'm'],
    ];
    for (const [table, alias] of recordLinkedTables) {
      // Pass A — business-code match
      await run(`
        UPDATE ${table} ${alias} SET customer_id = c.id, updated_at = NOW()
        FROM records r JOIN customers c ON c.customer_id = r.customer_id
        WHERE ${alias}.record_id = r.id
          AND ${alias}.customer_id IS NULL
          AND r.is_deleted = FALSE`);
      // Pass B — unambiguous PAN match
      await run(`
        UPDATE ${table} ${alias} SET customer_id = c.id, updated_at = NOW()
        FROM records r, customers c
        WHERE ${alias}.record_id = r.id
          AND ${alias}.customer_id IS NULL
          AND r.is_deleted = FALSE
          AND r.data->>'pan' ~* '^[A-Za-z]{5}[0-9]{4}[A-Za-z]$'
          AND LOWER(c.pan_no) = LOWER(r.data->>'pan')
          AND (SELECT COUNT(*) FROM customers c2 WHERE LOWER(c2.pan_no) = LOWER(r.data->>'pan')) = 1`);
    }
    // share_accounts: match directly on its own cust_code/pan_no, no records join
    await run(`
      UPDATE share_accounts sh SET customer_id = c.id, updated_at = NOW()
      FROM customers c
      WHERE sh.customer_id IS NULL
        AND sh.cust_code IS NOT NULL
        AND sh.cust_code = c.customer_id`);
    await run(`
      UPDATE share_accounts sh SET customer_id = c.id, updated_at = NOW()
      FROM customers c
      WHERE sh.customer_id IS NULL
        AND sh.pan_no ~* '^[A-Za-z]{5}[0-9]{4}[A-Za-z]$'
        AND LOWER(c.pan_no) = LOWER(sh.pan_no)
        AND (SELECT COUNT(*) FROM customers c2 WHERE LOWER(c2.pan_no) = LOWER(sh.pan_no)) = 1`);
  });

  // FIX (same live-DB-drift class as v9/v10, one more table): the Nominal
  // Membership PDF-sync full reset failed every single row with "column
  // join_date of relation memberships does not exist". join_date IS part of
  // v1_initial_schema's `CREATE TABLE IF NOT EXISTS memberships` above — but
  // IF NOT EXISTS is a no-op on a table that already existed before this
  // schema file did, so a memberships table created by an older deployment
  // never picked up the column, and the very next line (`ALTER COLUMN
  // join_date DROP NOT NULL`) silently failed against it the same way. Add
  // it defensively so this specific installation catches up.
  await migrate('v12_memberships_join_date_column', async () => {
    await run(`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS join_date DATE`);
  });

  // FIX (same symptom as v11, new root cause found during the 2026-09-09
  // full-data-reset): every per-record PDF-sync loop called
  // maybeUpsertCustomer(rec) AFTER upsertMirror(client, section, id, rec) —
  // but upsertMirror() calls resolveCustomerDbId(), which looks the customer
  // up by customer_id right then, on the SAME transaction. For any customer
  // who first appears in THAT section's PDF (not already in the customers
  // table from an earlier section or the Customers PDF), the row didn't
  // exist yet at lookup time, so THIS record's own mirror row got
  // customer_id permanently NULL even though maybeUpsertCustomer() created
  // the customer literally a few lines later — reported live: SUNITA
  // SUPDAJI DANGE's saving account showed correctly on the Saving Accounts
  // page but "0 accounts" on her own profile. pdf_sync.routes.js now calls
  // maybeUpsertCustomer() first (see /wipe and /nuclear-wipe), so this can
  // only have happened to rows synced before that fix — re-run v11's exact
  // backfill (safe: it only ever fills NULL customer_id, so it's a no-op on
  // every row it already fixed) to catch every case from today's reset.
  await migrate('v13_backfill_mirror_customer_ids_round2', async () => {
    const recordLinkedTables = [
      ['gold_loans', 'gl'],
      ['fd_accounts', 'fa'],
      ['saving_accounts', 'sa'],
      ['od_loans', 'ol'],
      ['memberships', 'm'],
    ];
    for (const [table, alias] of recordLinkedTables) {
      await run(`
        UPDATE ${table} ${alias} SET customer_id = c.id, updated_at = NOW()
        FROM records r JOIN customers c ON c.customer_id = r.customer_id
        WHERE ${alias}.record_id = r.id
          AND ${alias}.customer_id IS NULL
          AND r.is_deleted = FALSE`);
      await run(`
        UPDATE ${table} ${alias} SET customer_id = c.id, updated_at = NOW()
        FROM records r, customers c
        WHERE ${alias}.record_id = r.id
          AND ${alias}.customer_id IS NULL
          AND r.is_deleted = FALSE
          AND r.data->>'pan' ~* '^[A-Za-z]{5}[0-9]{4}[A-Za-z]$'
          AND LOWER(c.pan_no) = LOWER(r.data->>'pan')
          AND (SELECT COUNT(*) FROM customers c2 WHERE LOWER(c2.pan_no) = LOWER(r.data->>'pan')) = 1`);
    }
    await run(`
      UPDATE share_accounts sh SET customer_id = c.id, updated_at = NOW()
      FROM customers c
      WHERE sh.customer_id IS NULL
        AND sh.cust_code IS NOT NULL
        AND sh.cust_code = c.customer_id`);
    await run(`
      UPDATE share_accounts sh SET customer_id = c.id, updated_at = NOW()
      FROM customers c
      WHERE sh.customer_id IS NULL
        AND sh.pan_no ~* '^[A-Za-z]{5}[0-9]{4}[A-Za-z]$'
        AND LOWER(c.pan_no) = LOWER(sh.pan_no)
        AND (SELECT COUNT(*) FROM customers c2 WHERE LOWER(c2.pan_no) = LOWER(sh.pan_no)) = 1`);
  });

  // Defensive column guarantee for the new duplicate-account-opening check
  // (records.controller.js create() + /customers/:id/profile): v11/v13 above
  // already UPDATE saving_accounts.customer_id / memberships.customer_id /
  // share_accounts.customer_id, and this session's own verification (0
  // unlinked across gold/fd/saving/od/shares) confirms those columns exist
  // and are populated correctly on the live DB — but per the same
  // live-DB-schema-drift class documented at v9/v10/v12, add them
  // defensively too rather than assume every deployment matches. No-op
  // where the column is already present.
  await migrate('v14_saving_share_membership_customer_id_columns', async () => {
    await run(`ALTER TABLE saving_accounts ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`);
    await run(`ALTER TABLE memberships    ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`);
    await run(`ALTER TABLE share_accounts ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`);
    await run(`CREATE INDEX IF NOT EXISTS idx_saving_accounts_customer_id ON saving_accounts(customer_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_memberships_customer_id    ON memberships(customer_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_share_accounts_customer_id ON share_accounts(customer_id)`);
  });

  // Schema drift fix: the live production database has records.account_no
  // as NOT NULL DEFAULT '' — this was never captured here, so create()/
  // update() inserting/updating NULL (their old behavior) crashed with a
  // not-null-constraint 500 on every record with no account number (most
  // transaction types: cash entries, deposits/withdrawals, bank
  // transactions, etc. — see records.controller.js create()/update() fix
  // alongside this migration). Backfill first so the NOT NULL doesn't fail
  // on any existing NULL rows, then match the live column definition.
  await migrate('v15_records_account_no_not_null', async () => {
    await run(`UPDATE records SET account_no = '' WHERE account_no IS NULL`);
    await run(`ALTER TABLE records ALTER COLUMN account_no SET DEFAULT ''`);
    await run(`ALTER TABLE records ALTER COLUMN account_no SET NOT NULL`);
  });

  // Moved from features/audit.middleware.js's standalone, un-retried
  // module-load-time call (see the BUG FIX comment left in that file) —
  // this now runs through the same waitForDB() gate and tracked-migration
  // system as every other table, so it can no longer silently fail to be
  // created on a rocky startup and leave the app with zero audit trail.
  await migrate('v16_audit_log_table', async () => {
    await run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER,
        username    TEXT,
        action      TEXT NOT NULL,
        resource    TEXT NOT NULL,
        resource_id TEXT,
        ip          TEXT,
        user_agent  TEXT,
        diff        JSONB,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_log(user_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_audit_resource   ON audit_log(resource)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at)`);
  });

  if (DRY_RUN) {
    if (dryRunErrors.length === 0) {
      console.log('✅ Dry run complete — no structural errors found');
    } else {
      console.log(`\n⚠ Dry run complete — ${dryRunErrors.length} structural error(s) found:\n`);
      dryRunErrors.forEach((e, i) => {
        console.log(`${i + 1}. [${e.code}] ${e.message}`);
        console.log(`   ${e.sql}...\n`);
      });
    }
    return;
  }

  console.log('✅ All migrations complete — tables ready');
}

module.exports = { runMigrations };
