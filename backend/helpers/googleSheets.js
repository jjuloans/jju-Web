'use strict';
const path = require('path');
const { google } = require('googleapis');

// ── Config ────────────────────────────────────────────────────────────────
const CREDENTIALS_PATH =
  process.env.GOOGLE_SERVICE_ACCOUNT_PATH ||
  path.join(__dirname, '../../credentials/google-service-account.json');

// NOTE: process.env.GOOGLE_SPREADSHEET_ID is intentionally NOT captured here at module load time.
// It is read lazily inside getAuthClient() so that dotenv has time to load
// the .env file before the value is consumed.

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

// Sheet tab names — change these if you want different names in your spreadsheet
const SHEET_NAMES = {
  records:   'Records',
  cashbook:  'Cashbook',
  customers: 'Customers',
  syncLog:   'Sync Log',
  goldLoan:  'Gold Loan',
};

// ── Auth ──────────────────────────────────────────────────────────────────
let _authClient = null;

async function getAuthClient() {
  if (_authClient) return _authClient;
  
  if (!process.env.GOOGLE_SPREADSHEET_ID) {
    throw new Error(
      'GOOGLE_SPREADSHEET_ID is not set in your .env file. ' +
      'See GOOGLE_SHEETS_SETUP.md for instructions.',
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes:  SCOPES,
  });
  _authClient = await auth.getClient();
  return _authClient;
}

async function getSheetsClient() {
  const auth = await getAuthClient();
  return google.sheets({ version: 'v4', auth });
}

async function getDriveClient() {
  const auth = await getAuthClient();
  return google.drive({ version: 'v3', auth });
}

// ── Ensure a tab exists, create it if not ────────────────────────────────
async function ensureSheet(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID });
  const exists = (meta.data.sheets || []).some(
    (s) => s.properties.title === title,
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
  }
}

// ── Clear a sheet and write rows ──────────────────────────────────────────
// rows: array of arrays, e.g. [['header1','header2'], ['val1','val2'], ...]
async function writeSheet(sheets, tabName, rows, valueInputOption = 'RAW') {
  await ensureSheet(sheets, tabName);
  // Clear existing content first
  await sheets.spreadsheets.values.clear({
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    range: tabName,
  });
  if (!rows.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    range:         `${tabName}!A1`,
    valueInputOption,
    requestBody: { values: rows },
  });
}

// ── Format a value safely for Sheets ─────────────────────────────────────
function fmt(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// Strips base64 image blobs (photo_*, *_photo keys, or any data:image/ values)
// out of a JSONB data object before it gets dumped into a sheet cell as text.
// These can run ~40-50KB each and serve no purpose as text in a spreadsheet —
// keeping them would eat the entire truncation budget and cut off the actually
// useful fields (loan_amount, address, etc.) that come after them in the JSON.
function stripPhotoFields(data) {
  if (!data || typeof data !== 'object') return data;
  const placeholder = new Set(['none', 'null', 'undefined', '']);
  const cleaned = {};
  for (const [key, value] of Object.entries(data)) {
    const isEmptyish = typeof value === 'string' && placeholder.has(value.trim().toLowerCase());
    const looksLikeBase64Image = typeof value === 'string' && value.startsWith('data:image');
    const looksLikePhotoKey = /photo/i.test(key) && typeof value === 'string' && !isEmptyish;
    cleaned[key] = (looksLikeBase64Image || looksLikePhotoKey) ? '[photo omitted]' : value;
  }
  return cleaned;
}

// Drive folder for every section OTHER than gold loan (gold has its own
// dedicated folder/tab — see GOLD_PHOTO_DRIVE_FOLDER / syncGoldLoan).
const RECORD_PHOTO_DRIVE_FOLDER = 'JJU Record Photos';

// Like stripPhotoFields, but instead of just discarding base64 photo_*
// fields, uploads each one to Drive and replaces it with the resulting
// URL (plain text — Sheets auto-linkifies it). Any field that fails to
// upload, or isn't actually a base64 image, falls back to the same
// '[photo omitted]' placeholder stripPhotoFields would have used.
// fileNamePrefix should be unique per record, e.g. `${section}_${id}`.
async function uploadRecordPhotos(drive, folderId, data, fileNamePrefix) {
  if (!data || typeof data !== 'object') return data;
  const cleaned = stripPhotoFields(data);
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string' || !value.startsWith('data:image')) continue;
    try {
      const url = await uploadPhotoToDrive(drive, folderId, value, `${fileNamePrefix}_${key}.jpg`);
      cleaned[key] = url || '[photo omitted]';
    } catch (e) {
      cleaned[key] = '[photo omitted]';
    }
  }
  return cleaned;
}

// ── Gold Loan helpers ──────────────────────────────────────────────────────
const GOLD_LOAN_INTEREST_RATE = 0.18; // 18% p.a. simple interest — change here if the rate changes
const GOLD_PHOTO_DRIVE_FOLDER = 'JJU Gold Loan Photos';

function safeStr(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (['none', 'null', 'nan', 'undefined'].includes(s.toLowerCase())) return '';
  return s;
}

function toNum(v) {
  const s = safeStr(v);
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toDateOnly(v) {
  const s = safeStr(v);
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const _driveFolderIdCache = {};
async function ensureDriveFolder(drive, folderName) {
  if (_driveFolderIdCache[folderName]) return _driveFolderIdCache[folderName];
  const q = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const list = await drive.files.list({ q, fields: 'files(id)' });
  if (list.data.files && list.data.files.length) {
    _driveFolderIdCache[folderName] = list.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    _driveFolderIdCache[folderName] = folder.data.id;
  }
  return _driveFolderIdCache[folderName];
}
async function ensureGoldPhotoFolder(drive) {
  return ensureDriveFolder(drive, GOLD_PHOTO_DRIVE_FOLDER);
}

// Uploads a base64 data-URL photo to Drive and returns a public view URL.
// Reuses the existing Drive file (matched by name) on repeat syncs instead
// of re-uploading, so the same photo doesn't pile up duplicates every run.
// Controls who can open the uploaded Drive photo links (Aadhar/PAN/customer
// photos, etc.). Configurable via .env since the right answer depends on
// whether this Google account is a personal Gmail or a Workspace domain:
//   GOOGLE_DRIVE_PHOTO_SHARING=private  (default) — no public permission is
//     granted on individual files. Share the parent folder ONCE, manually,
//     with only the specific people/emails who should see these photos
//     (Drive → right-click folder → Share). Safest option for sensitive
//     ID documents, but note: Sheets' =IMAGE() formula (used on the Gold
//     Loan tab) generally needs the image itself to be viewable by whoever
//     opens the sheet, so if a viewer can't see the thumbnail, check that
//     they also have folder access.
//   GOOGLE_DRIVE_PHOTO_SHARING=domain   — viewable by anyone signed in
//     within GOOGLE_WORKSPACE_DOMAIN (requires a Google Workspace domain,
//     not a plain @gmail.com service account). Good middle ground: works
//     for =IMAGE() for anyone in your org, without being public.
//   GOOGLE_DRIVE_PHOTO_SHARING=anyone   — the old behaviour: anyone with
//     the link can view, no sign-in required. Only use this if you're
//     confident the links won't leak, since these are Aadhar/PAN photos.
async function applyPhotoPermissions(drive, fileId) {
  const mode = (process.env.GOOGLE_DRIVE_PHOTO_SHARING || 'private').toLowerCase();
  if (mode === 'anyone') {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  } else if (mode === 'domain' && process.env.GOOGLE_WORKSPACE_DOMAIN) {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'domain', domain: process.env.GOOGLE_WORKSPACE_DOMAIN },
    });
  } else if (mode === 'domain') {
    console.warn(
      '[googleSheets] GOOGLE_DRIVE_PHOTO_SHARING=domain but GOOGLE_WORKSPACE_DOMAIN is not set — ' +
      'skipping public permission on this file. Set GOOGLE_WORKSPACE_DOMAIN in .env, or share the ' +
      'photo folders manually in Drive with the people who need access.',
    );
  }
  // mode === 'private' (default): grant nothing here — access is governed
  // entirely by whoever the parent Drive folder has been manually shared with.
}

// Uploads a base64 data-URL photo to Drive and returns a URL for it.
// Reuses the existing Drive file (matched by name) on repeat syncs instead
// of re-uploading, so the same photo doesn't pile up duplicates every run.
// Generic — used for gold loan ornament/customer photos AND, below, for
// every other section's photo_* fields.
async function uploadPhotoToDrive(drive, folderId, base64DataUrl, fileName) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(base64DataUrl || '');
  if (!match) return null;

  const existing = await drive.files.list({
    q: `name = '${fileName}' and '${folderId}' in parents and trashed = false`,
    fields: 'files(id)',
  });
  if (existing.data.files && existing.data.files.length) {
    return `https://drive.google.com/uc?export=view&id=${existing.data.files[0].id}`;
  }

  const { Readable } = require('stream');
  const buffer = Buffer.from(match[2], 'base64');
  const file = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: match[1], body: Readable.from(buffer) },
    fields: 'id',
  });
  await applyPhotoPermissions(drive, file.data.id);
  return `https://drive.google.com/uc?export=view&id=${file.data.id}`;
}

// ── Sync gold loan ledger tab ────────────────────────────────────────────
// Columns: Loan Acc No, Name, Address, Loan Date, Loan Amount,
// Ornament Weight (Gm), Silver Ornaments, Gold Ornaments,
// Customer Photo with Ornament, Transaction Type, Mobile No, Aadhar, PAN,
// (spacer), Date of Loan Closing, Closing Amount (Rs.), Current Status,
// No Of Days, Int Per Day, Int Till Today, Amount To Collect
async function syncGoldLoan(sheets, pool, drive) {
  const { rows } = await pool.query(
    `SELECT id, date, name, mobile, aadhar, account_no, tx_types, data, status
     FROM records
     WHERE is_deleted = FALSE AND section = 'gold'
     ORDER BY id`,
  );

  const folderId = await ensureGoldPhotoFolder(drive);

  const header = [
    'Loan Acc No', 'Name', 'Address', 'Loan Date', 'Loan Amount',
    'Ornament Weight (Gm)', 'Silver Ornaments', 'Gold Ornaments',
    'Ornament Photo', 'Transaction Type', 'Mobile No',
    'Aadhar', 'PAN', '', 'Date of Loan Closing', 'Closing Amount (Rs.)',
    'Current Status', 'No Of Days', 'Int Per Day', 'Int Till Today',
    'Amount To Collect', 'Customer Photo',
  ];

  const dataRows = [];
  for (const r of rows) {
    let d = {};
    try {
      d = typeof r.data === 'object' && r.data ? r.data : JSON.parse(r.data || '{}');
    } catch (e) { d = {}; }

    const loanAccNo = safeStr(r.account_no) || safeStr(d.loan_acc_no);
    const name = safeStr(r.name) || safeStr(d.customer_name);
    const loanDate = toDateOnly(d.loan_date) || toDateOnly(r.date);
    const loanAmount = toNum(d.loan_amount);

    let photoCell = '';
    if (d.photo_ornament && String(d.photo_ornament).startsWith('data:image')) {
      try {
        const url = await uploadPhotoToDrive(drive, folderId, d.photo_ornament, `gold_ornament_${loanAccNo || r.id}.jpg`);
        if (url) photoCell = `=IMAGE("${url}", 1)`;
      } catch (e) { photoCell = ''; }
    }

    // Customer's own photo — separate from the ornament photo. Previously
    // this was only ever stripped to '[photo omitted]' in the Records tab
    // and never backed up anywhere; now it gets the same Drive-upload
    // treatment as the ornament photo.
    let customerPhotoCell = '';
    if (d.photo_customer && String(d.photo_customer).startsWith('data:image')) {
      try {
        const url = await uploadPhotoToDrive(drive, folderId, d.photo_customer, `gold_customer_${loanAccNo || r.id}.jpg`);
        if (url) customerPhotoCell = `=IMAGE("${url}", 1)`;
      } catch (e) { customerPhotoCell = ''; }
    }

    let txType = '';
    try { txType = (JSON.parse(r.tx_types || '[]') || []).join(', '); }
    catch (e) { txType = safeStr(r.tx_types); }

    const isActive = r.status === 'active';
    const rowNum = dataRows.length + 2; // sheet row: +1 for header, +1 for 1-index

    // Live interest calc only makes sense for open loans with known date/amount —
    // for closed loans we don't have a recorded closing date, so leave blank
    // rather than guess.
    let noOfDays = '', intPerDay = '', intTillToday = '', amtToCollect = '';
    if (isActive && loanDate && loanAmount !== null) {
      noOfDays      = `=TODAY()-D${rowNum}`;
      intPerDay     = `=E${rowNum}*${GOLD_LOAN_INTEREST_RATE}/365`;
      intTillToday  = `=R${rowNum}*S${rowNum}`;
      amtToCollect  = `=E${rowNum}+T${rowNum}`;
    }

    dataRows.push([
      loanAccNo, name, safeStr(d.address), loanDate, loanAmount,
      toNum(d.ornament_weight), safeStr(d.silver_ornaments), safeStr(d.gold_ornaments),
      photoCell, txType, safeStr(r.mobile) || safeStr(d.mobile),
      safeStr(r.aadhar) || safeStr(d.aadhar), safeStr(d.pan), '', '', '',
      isActive ? 'Active' : 'Closed', noOfDays, intPerDay, intTillToday, amtToCollect,
      customerPhotoCell,
    ]);
  }

  await writeSheet(sheets, SHEET_NAMES.goldLoan, [header, ...dataRows], 'USER_ENTERED');
  return rows.length;
}

// ── Sync records tab ──────────────────────────────────────────────────────
async function syncRecords(sheets, pool, drive) {
  const { rows } = await pool.query(
    `SELECT id, date, name, customer_id, customer_type, aadhar, mobile,
            account_no, section, tx_types, data,
            status, closed_tx_types, remarks, created_at, updated_at
     FROM records
     WHERE is_deleted = FALSE
     ORDER BY id`,
  );

  const header = [
    'ID', 'Date', 'Name', 'Customer ID', 'Customer Type', 'Aadhar', 'Mobile',
    'Account No', 'Section', 'Tx Types', 'Data',
    'Status', 'Closed Tx Types', 'Remarks', 'Created At', 'Updated At',
  ];

  const recordPhotoFolderId = await ensureDriveFolder(drive, RECORD_PHOTO_DRIVE_FOLDER);

  const dataRows = [];
  for (const r of rows) {
    let dataOut;
    if (typeof r.data === 'object' && r.data) {
      if (r.section === 'gold') {
        // Gold loan photos are already uploaded to Drive and linked from
        // the dedicated Gold Loan tab (see syncGoldLoan) — don't upload
        // the same images again here, just strip them from this tab.
        dataOut = JSON.stringify(stripPhotoFields(r.data));
      } else {
        const withPhotoLinks = await uploadRecordPhotos(
          drive, recordPhotoFolderId, r.data, `${r.section || 'record'}_${r.id}`,
        );
        dataOut = JSON.stringify(withPhotoLinks);
      }
    } else {
      dataOut = fmt(r.data);
    }
    dataOut = dataOut.slice(0, 49000);

    dataRows.push([
      fmt(r.id), fmt(r.date), fmt(r.name), fmt(r.customer_id),
      fmt(r.customer_type), fmt(r.aadhar), fmt(r.mobile),
      fmt(r.account_no), fmt(r.section), fmt(r.tx_types),
      dataOut,
      fmt(r.status), fmt(r.closed_tx_types), fmt(r.remarks),
      fmt(r.created_at), fmt(r.updated_at),
    ]);
  }

  await writeSheet(sheets, SHEET_NAMES.records, [header, ...dataRows]);
  return rows.length;
}

// ── Sync cashbook tab ─────────────────────────────────────────────────────
async function syncCashbook(sheets, pool) {
  const { rows } = await pool.query(
    `SELECT id, date, entry_date, parent_id, record_id, name, task,
            acc_type, tx_type, acc_no, amount, mode, scroll_no,
            loan_date, sort_order, created_at, updated_at
     FROM cashbook_entries
     WHERE is_deleted = FALSE
     ORDER BY date DESC, sort_order ASC, id ASC`,
  );

  const header = [
    'ID', 'Date', 'Entry Date', 'Parent ID', 'Record ID', 'Name', 'Task',
    'Acc Type', 'Tx Type', 'Acc No', 'Amount', 'Mode', 'Scroll No',
    'Loan Date', 'Sort Order', 'Created At', 'Updated At',
  ];

  const dataRows = rows.map((r) => [
    fmt(r.id), fmt(r.date), fmt(r.entry_date), fmt(r.parent_id),
    fmt(r.record_id), fmt(r.name), fmt(r.task), fmt(r.acc_type),
    fmt(r.tx_type), fmt(r.acc_no), fmt(r.amount), fmt(r.mode),
    fmt(r.scroll_no), fmt(r.loan_date), fmt(r.sort_order),
    fmt(r.created_at), fmt(r.updated_at),
  ]);

  await writeSheet(sheets, SHEET_NAMES.cashbook, [header, ...dataRows]);
  return rows.length;
}

// ── Sync customers tab ────────────────────────────────────────────────────
async function syncCustomers(sheets, pool) {
  const { rows } = await pool.query(
    `SELECT id, customer_id, name, aadhar, mobile, address,
            dob, pan, occupation, section,
            saving_acc_no, saving_balance, share_acc_no,
            nominee, referral, created_at, updated_at
     FROM customers
     WHERE is_deleted = FALSE
     ORDER BY id`,
  ).catch(async () => {
    // Fallback: derive unique customers from records table if customers
    // table doesn't exist yet in this schema
    return pool.query(
      `SELECT DISTINCT ON (customer_id)
              id, customer_id, name, aadhar, mobile,
              section, created_at, updated_at
       FROM records
       WHERE is_deleted = FALSE
       ORDER BY customer_id, id`,
    );
  });

  const header = rows[0]
    ? Object.keys(rows[0]).map((k) =>
        k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      )
    : [];

  const dataRows = rows.map((r) => Object.values(r).map(fmt));
  await writeSheet(sheets, SHEET_NAMES.customers, [header, ...dataRows]);
  return rows.length;
}

// ── Sync log tab ──────────────────────────────────────────────────────────
async function syncSyncLog(sheets, pool) {
  const { rows } = await pool.query(
    `SELECT id, started_at, finished_at, status, message, rows_synced
     FROM sync_log
     ORDER BY id DESC
     LIMIT 200`,
  );

  const header = ['ID', 'Started At', 'Finished At', 'Status', 'Message', 'Rows Synced'];
  const dataRows = rows.map((r) => [
    fmt(r.id), fmt(r.started_at), fmt(r.finished_at),
    fmt(r.status), fmt(r.message), fmt(r.rows_synced),
  ]);

  await writeSheet(sheets, SHEET_NAMES.syncLog, [header, ...dataRows]);
  return rows.length;
}

// ── Main export: sync everything ──────────────────────────────────────────
async function syncAllToSheets(pool) {
  const sheets = await getSheetsClient();
  const drive  = await getDriveClient();

  const tasks = [
    { name: 'records',   fn: () => syncRecords(sheets, pool, drive) },
    { name: 'cashbook',  fn: () => syncCashbook(sheets, pool) },
    { name: 'customers', fn: () => syncCustomers(sheets, pool) },
    { name: 'goldLoan',  fn: () => syncGoldLoan(sheets, pool, drive) },
  ];

  const settled = await Promise.allSettled(tasks.map((t) => t.fn()));

  const counts = {};
  const errors = {};
  settled.forEach((result, i) => {
    const { name } = tasks[i];
    if (result.status === 'fulfilled') {
      counts[name] = result.value;
    } else {
      counts[name] = 0;
      errors[name] = result.reason && result.reason.message ? result.reason.message : String(result.reason);
      console.error(`[syncAllToSheets] ${name} sync failed:`, result.reason);
    }
  });

  // Sync log last so it reflects the just-completed counts, even if some
  // tabs above failed — we still want a record of what happened.
  await syncSyncLog(sheets, pool);

  const total = counts.records + counts.cashbook + counts.customers + counts.goldLoan;
  const result = { ...counts, total };
  if (Object.keys(errors).length) {
    result.errors = errors;
  }
  return result;
}

module.exports = { syncAllToSheets };
