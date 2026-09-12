'use strict';
require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const XLSX = require('xlsx');
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

const UPLOADS = path.join(__dirname, 'uploads');
console.log('📁 Looking for xlsx files in:', UPLOADS);

function loadSheet(filename) {
  const fp = path.join(UPLOADS, filename);
  if (!fs.existsSync(fp)) { console.warn(`  ⚠ File not found: ${filename}`); return []; }
  const wb = XLSX.readFile(fp);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, cellDates: true });
}

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  const s = String(val).trim();
  if (!s || s === 'None' || s === 'CR' || s === 'DR') return null;
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function toNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

// Parse duration like "12 M" → 12 (integer months)
function toPeriod(val) {
  if (!val) return null;
  const n = parseInt(String(val));
  return isNaN(n) ? null : n;
}

function str(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === '' || s === 'None' || s === 'CR' || s === 'DR' ? null : s;
}

// Derive short acc_no: 00104003000001 → 03-1
function accNo(ac) {
  if (!ac || ac.length < 14) return ac;
  const series = String(parseInt(ac.substring(6, 9), 10)).padStart(2, '0');
  const serial = parseInt(ac.slice(-6), 10);
  return `${series}-${serial}`;
}

async function run() {
  const client = await pool.connect();
  try {

    // ── WIPE ──────────────────────────────────────────────────────────
    console.log('\n🗑  Wiping existing data...');
    await client.query(`TRUNCATE TABLE
      memberships, od_loans, saving_accounts, fd_accounts,
      gold_loans, cashbook_entries, records, customers
      RESTART IDENTITY CASCADE`);
    console.log('   ✅ All tables cleared\n');

    // ── 1. CUSTOMERS ──────────────────────────────────────────────────
    console.log('👤 Importing customers...');
    let n = 0;
    for (const row of loadSheet('customers.xlsx')) {
      const custId = str(row['Unique CustID']);
      const name   = str(row['Name']);
      if (!custId || !name) continue;
      await client.query(
        `INSERT INTO customers (customer_id,name,address,aadhar,pan,dob,mobile)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (customer_id) DO NOTHING`,
        [custId, name, str(row['Address']), str(row['Adhar ID']),
         str(row['Pan No']), toDate(row['Birth date']), str(row['Mob No.'])]
      );
      n++;
    }
    console.log(`   ✅ ${n} customers imported`);

    // ── 2. GOLD LOANS ─────────────────────────────────────────────────
    console.log('\n🪙 Importing gold loans...');
    n = 0;
    for (const row of loadSheet('Gold Loan Acc.xlsx')) {
      const ac=str(row['A/c Code']), cust=str(row['Cust ID']), name=str(row['A/c Name']);
      const sd=toDate(row['Start Date']), ed=toDate(row['End Date']), cd=toDate(row['Close Date']);
      const amt=toNum(row['Loan Amt']), bal=toNum(row['Balance']), rate=toNum(row['Int. Rate']);
      const pan=str(row['PAN No']), st=cd?'closed':'active', an=accNo(ac);

      await client.query(
        `INSERT INTO records (date,name,customer_id,account_no,section,tx_types,data,status,closed_date)
         VALUES ($1,$2,$3,$4,'gold','["Gold Loan"]',$5,$6,$7)`,
        [sd,name,cust,ac,{loan_acc_no:ac,loan_amount:amt,balance:bal,interest_rate:rate,pan,start_date:sd,end_date:ed},st,cd]
      );
      await client.query(
        `INSERT INTO gold_loans (acc_code,acc_no,cust_code,pan_no,start_date,end_date,interest_rate,loan_amount,balance,status,close_date,closed_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [ac,an,cust,pan,sd,ed,rate,amt,bal,st,cd]
      );
      n++;
    }
    console.log(`   ✅ ${n} gold loans imported`);

    // ── 3. FD ACCOUNTS ────────────────────────────────────────────────
    // fd_accounts columns used:
    //   acc_code, acc_no, cust_code, pan_no, start_date, end_date,
    //   interest_rate(numeric), duration(text), fd_amount(numeric),
    //   maturity_amount(numeric), balance(numeric), status(text),
    //   close_date(date), closed_date(date), section(text),
    //   fd_period(integer — numeric months only), fd_interest_rate(numeric),
    //   fd_maturity_amount(numeric)
    console.log('\n🏦 Importing FD accounts...');
    n = 0;
    async function importFD(filename, section) {
      for (const row of loadSheet(filename)) {
        const ac=str(row['A/c Code']), cust=str(row['Cust ID']), name=str(row['A/c Name']);
        const sd=toDate(row['Start Date']), ed=toDate(row['End Date']), cd=toDate(row['Close Date']);
        const amt=toNum(row['Deposit Amt']), mat=toNum(row['Maturity Amt']), bal=toNum(row['BAL']);
        const rate=toNum(row['Int. Rate']);
        const durText=str(row['Dur']);          // e.g. "12 M" → keep as text for duration col
        const durInt=toPeriod(row['Dur']);      // e.g. "12 M" → 12 for fd_period col
        const pan=str(row['PAN_NO']), st=cd?'closed':'active', an=accNo(ac);

        await client.query(
          `INSERT INTO records (date,name,customer_id,account_no,section,tx_types,data,status,closed_date)
           VALUES ($1,$2,$3,$4,$5,'["New FD"]',$6,$7,$8)`,
          [sd,name,cust,ac,section,
           {fd_acc_no:ac,fd_amount:amt,fd_maturity_date:ed,fd_maturity_amount:mat,
            fd_interest_rate:rate,fd_period:durText,balance:bal,pan},
           st,cd]
        );
        await client.query(
          `INSERT INTO fd_accounts
             (acc_code,acc_no,cust_code,pan_no,start_date,end_date,
              interest_rate,duration,fd_amount,maturity_amount,balance,
              status,close_date,closed_date,section,
              fd_period,fd_interest_rate,fd_maturity_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,$17)`,
          [ac,an,cust,pan,sd,ed,
           rate,durText,amt,mat,bal,
           st,cd,section,
           durInt,rate,mat]
        );
        n++;
      }
    }
    await importFD('FD Acc.xlsx', 'fd');
    await importFD('fd - MIS Acc.xlsx', 'mis');
    console.log(`   ✅ ${n} FD/MIS accounts imported`);

    // ── 4. OD LOANS ───────────────────────────────────────────────────
    // od_loans columns: acc_code,acc_no,cust_code,pan_no,start_date,end_date,
    //                   interest_rate,loan_amount,balance,status,close_date
    console.log('\n📋 Importing OD loans...');
    n = 0;
    for (const row of loadSheet('FD OD Loan.xlsx')) {
      const ac=str(row['A/c Code']), cust=str(row['Cust ID']), name=str(row['A/c Name']);
      const sd=toDate(row['Start Date']), ed=toDate(row['End Date']), cd=toDate(row['Close Date']);
      const amt=toNum(row['Loan Amt']), bal=toNum(row['Balance']), rate=toNum(row['Int. Rate']);
      const pan=str(row['PAN No']), st=cd?'closed':'active', an=accNo(ac);

      await client.query(
        `INSERT INTO records (date,name,customer_id,account_no,section,tx_types,data,status,closed_date)
         VALUES ($1,$2,$3,$4,'od','["New FD-OD Loan"]',$5,$6,$7)`,
        [sd,name,cust,ac,{loan_acc_no:ac,loan_amount:amt,balance:bal,interest_rate:rate},st,cd]
      );
      await client.query(
        `INSERT INTO od_loans (acc_code,acc_no,cust_code,pan_no,start_date,end_date,interest_rate,loan_amount,balance,status,close_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [ac,an,cust,pan,sd,ed,rate,amt,bal,st,cd]
      );
      n++;
    }
    console.log(`   ✅ ${n} OD loans imported`);

    // ── 5. SAVING ACCOUNTS ────────────────────────────────────────────
    // saving_accounts columns: acc_code,acc_no,cust_code,pan_no,start_date,
    //                          interest_rate,balance,status,close_date
    console.log('\n💰 Importing saving accounts...');
    n = 0;
    for (const row of loadSheet('Saving Acc.xlsx')) {
      const ac=str(row['A/c Code']), cust=str(row['Cust ID']), name=str(row['A/c Name']);
      const sd=toDate(row['Start Date']), cd=toDate(row['Close Date']);
      const bal=toNum(row['Balance']), rate=toNum(row['Int. Rate']), pan=str(row['PAN_NO']);
      const st=cd?'closed':'active', an=accNo(ac);

      await client.query(
        `INSERT INTO records (date,name,customer_id,account_no,section,tx_types,data,status,closed_date)
         VALUES ($1,$2,$3,$4,'saving','["Saving Account"]',$5,$6,$7)`,
        [sd,name,cust,ac,{saving_acc_no:ac,saving_balance:bal,pan},st,cd]
      );
      await client.query(
        `INSERT INTO saving_accounts (acc_code,acc_no,cust_code,pan_no,start_date,interest_rate,balance,status,close_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ac,an,cust,pan,sd,rate,bal,st,cd]
      );
      n++;
    }
    console.log(`   ✅ ${n} saving accounts imported`);

    // ── 6. SHARES ─────────────────────────────────────────────────────
    console.log('\n📈 Importing share accounts...');
    n = 0;
    for (const row of loadSheet('Shares Acc.xlsx')) {
      const ac=str(row['A/c Code']), cust=str(row['Cust ID']), name=str(row['A/c Name']);
      const sd=toDate(row['Start Date']), bal=toNum(row['Balance']), pan=str(row['PAN_NO']);
      // Close Date col contains 'CR' (credit marker) not an actual close date — treat as active
      await client.query(
        `INSERT INTO records (date,name,customer_id,account_no,section,tx_types,data,status)
         VALUES ($1,$2,$3,$4,'shares','["Shares"]',$5,'active')`,
        [sd,name,cust,ac,{share_acc_no:ac,share_balance:bal,pan}]
      );
      n++;
    }
    console.log(`   ✅ ${n} share accounts imported`);

    // ── 7. NAMMATRA ───────────────────────────────────────────────────
    // memberships columns: acc_code,acc_no,membership_type,status
    console.log('\n🏷  Importing Nammatra accounts...');
    n = 0;
    for (const row of loadSheet('Nammatra Acc.xlsx')) {
      const ac=str(row['A/c Code']), name=str(row['A/c Name']), bal=toNum(row['Balance']);
      if (!name) continue;
      await client.query(
        `INSERT INTO records (name,account_no,section,tx_types,data,status)
         VALUES ($1,$2,'nammatra','["New Naammatr Sabhasad"]',$3,'active')`,
        [name,ac,{nammatra_acc_no:ac,balance:bal}]
      );
      await client.query(
        `INSERT INTO memberships (acc_code,acc_no,membership_type,status)
         VALUES ($1,$2,'naammatr','active') ON CONFLICT DO NOTHING`,
        [ac,ac]
      );
      n++;
    }
    console.log(`   ✅ ${n} Nammatra accounts imported`);

    // ── 8. CURRENT ACCOUNTS ───────────────────────────────────────────
    console.log('\n🏢 Importing current accounts...');
    n = 0;
    for (const row of loadSheet('current Acc.xlsx')) {
      const ac=str(row['A/c Code']), cust=str(row['Cust ID']), name=str(row['A/c Name']);
      const sd=toDate(row['Start Date']), bal=toNum(row['Balance']), pan=str(row['PAN_NO']);
      // Close Date col contains 'CR' — not an actual close date
      await client.query(
        `INSERT INTO records (date,name,customer_id,account_no,section,tx_types,data,status)
         VALUES ($1,$2,$3,$4,'current','["Current Account"]',$5,'active')`,
        [sd,name,cust,ac,{current_acc_no:ac,balance:bal,pan}]
      );
      n++;
    }
    console.log(`   ✅ ${n} current accounts imported`);

    // ── 9. CASH BALANCES ──────────────────────────────────────────────
    // cashbook_entries columns used: date, entry_date, task, tx_type, amount
    console.log('\n💵 Importing cash balances...');
    n = 0;
    for (const row of loadSheet('cash balances.xlsx')) {
      // XLSX returns Date objects — convert directly
      const rawDate = row['Date'];
      let date = null;
      if (rawDate instanceof Date) {
        date = rawDate.toISOString().split('T')[0];
      } else if (rawDate) {
        date = toDate(rawDate);
      }
      if (!date) continue;
      const opening = toNum(row['Opening balance']);
      const receipt = toNum(row['Receipt']);
      const payment = toNum(row['Payment']);
      if (opening) await client.query(
        `INSERT INTO cashbook_entries (date,entry_date,task,tx_type,amount) VALUES ($1,$1,'Opening Balance','opening',$2)`,
        [date, opening]);
      if (receipt) await client.query(
        `INSERT INTO cashbook_entries (date,entry_date,task,tx_type,amount) VALUES ($1,$1,'Receipt','receipt',$2)`,
        [date, receipt]);
      if (payment) await client.query(
        `INSERT INTO cashbook_entries (date,entry_date,task,tx_type,amount) VALUES ($1,$1,'Payment','payment',$2)`,
        [date, payment]);
      n++;
    }
    console.log(`   ✅ ${n} cash balance days imported`);

    // ── SUMMARY ───────────────────────────────────────────────────────
    console.log('\n✅ ALL DATA IMPORTED SUCCESSFULLY!\n');
    console.log('📊 Final row counts:');
    for (const t of ['customers','records','gold_loans','fd_accounts','saving_accounts','od_loans','memberships','cashbook_entries']) {
      const { rows } = await client.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`   ${t}: ${rows[0].count}`);
    }

  } catch (err) {
    console.error('\n❌ Import failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
