'use strict';

// ── Export Routes ─────────────────────────────────────────────────────────────
// GET /api/export/:type?format=xlsx|pdf&status=all|active|closed
//
// Supported types:
//   gold_loans, saving_accounts, fd_accounts, od_loans,
//   memberships, customers, share_accounts

const router  = require('express').Router();
const pool    = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── Column definitions per account type ──────────────────────────────────────
const SCHEMAS = {
  gold_loans: {
    title:   'Gold Loans',
    table:   'gold_loans',
    columns: [
      { key: 'loan_acc_no',   label: 'Account No'     },
      { key: 'customer_name', label: 'Customer Name'  },
      { key: 'mobile',        label: 'Mobile'         },
      { key: 'aadhar',        label: 'Aadhar'         },
      { key: 'loan_amount',   label: 'Loan Amount (₹)', number: true },
      { key: 'loan_date',     label: 'Loan Date',       date: true   },
      { key: 'metal_type',    label: 'Metal Type'     },
      { key: 'status',        label: 'Status'         },
      { key: 'closed_date',   label: 'Closed Date',    date: true   },
      { key: 'closed_remarks',label: 'Closed Remarks' },
    ],
  },
  saving_accounts: {
    title:   'Saving Accounts',
    table:   'saving_accounts',
    columns: [
      { key: 'saving_acc_no', label: 'Account No'    },
      { key: 'customer_name', label: 'Customer Name' },
      { key: 'mobile',        label: 'Mobile'        },
      { key: 'aadhar',        label: 'Aadhar'        },
      { key: 'balance',       label: 'Balance (₹)',   number: true },
      { key: 'status',        label: 'Status'        },
      { key: 'closed_date',   label: 'Closed Date',  date: true   },
    ],
  },
  fd_accounts: {
    title:   'Fixed Deposits',
    table:   'fd_accounts',
    columns: [
      { key: 'fd_acc_no',          label: 'FD Account No'    },
      { key: 'mis_acc_no',         label: 'MIS Account No'   },
      { key: 'customer_name',      label: 'Customer Name'    },
      { key: 'mobile',             label: 'Mobile'           },
      { key: 'aadhar',             label: 'Aadhar'           },
      { key: 'fd_amount',          label: 'FD Amount (₹)',    number: true },
      { key: 'fd_period',          label: 'Period (months)',  number: true },
      { key: 'fd_interest_rate',   label: 'Interest Rate (%)',number: true },
      { key: 'loan_date',          label: 'Start Date',       date: true   },
      { key: 'fd_maturity_date',   label: 'Maturity Date',    date: true   },
      { key: 'fd_maturity_amount', label: 'Maturity Amount (₹)', number: true },
      { key: 'fd_type',            label: 'FD Type'          },
      { key: 'status',             label: 'Status'           },
      { key: 'closed_date',        label: 'Closed Date',      date: true   },
    ],
  },
  od_loans: {
    title:   'OD Loans',
    table:   'od_loans',
    columns: [
      { key: 'loan_acc_no',      label: 'OD Account No'   },
      { key: 'fd_acc_no',        label: 'FD Account No'   },
      { key: 'customer_name',    label: 'Customer Name'   },
      { key: 'mobile',           label: 'Mobile'          },
      { key: 'aadhar',           label: 'Aadhar'          },
      { key: 'loan_amount',      label: 'Loan Amount (₹)', number: true },
      { key: 'fd_amount',        label: 'FD Amount (₹)',   number: true },
      { key: 'loan_date',        label: 'Loan Date',       date: true   },
      { key: 'fd_maturity_date', label: 'FD Maturity',     date: true   },
      { key: 'status',           label: 'Status'          },
      { key: 'closed_date',      label: 'Closed Date',     date: true   },
    ],
  },
  memberships: {
    title:   'Memberships',
    table:   'memberships',
    columns: [
      { key: 'customer_name',   label: 'Customer Name'   },
      { key: 'mobile',          label: 'Mobile'          },
      { key: 'aadhar',          label: 'Aadhar'          },
      { key: 'membership_type', label: 'Membership Type' },
      { key: 'saving_acc_no',   label: 'Saving Account'  },
      { key: 'share_acc_no',    label: 'Share Account'   },
      { key: 'join_date',       label: 'Join Date',       date: true },
      { key: 'status',          label: 'Status'          },
    ],
  },
  customers: {
    title:   'Customers',
    table:   'customers',
    columns: [
      { key: 'customer_id',    label: 'Customer ID'    },
      { key: 'name',           label: 'Name'           },
      { key: 'mobile',         label: 'Mobile'         },
      { key: 'aadhar',         label: 'Aadhar'         },
      { key: 'pan',            label: 'PAN'            },
      { key: 'dob',            label: 'Date of Birth'  },
      { key: 'address',        label: 'Address'        },
      { key: 'occupation',     label: 'Occupation'     },
      { key: 'saving_acc_no',  label: 'Saving Account' },
      { key: 'saving_balance', label: 'Saving Balance (₹)', number: true },
      { key: 'share_acc_no',   label: 'Share Account'  },
    ],
  },
  share_accounts: {
    title:   'Share Accounts',
    table:   'customers',
    where:   `share_acc_no IS NOT NULL AND share_acc_no <> ''`,
    columns: [
      { key: 'customer_id',   label: 'Customer ID'    },
      { key: 'name',          label: 'Customer Name'  },
      { key: 'mobile',        label: 'Mobile'         },
      { key: 'aadhar',        label: 'Aadhar'         },
      { key: 'share_acc_no',  label: 'Share Account No'},
      { key: 'saving_acc_no', label: 'Saving Account' },
    ],
  },
};

// ── Helper: fetch rows ────────────────────────────────────────────────────────
async function fetchRows(schema, status) {
  const cols   = schema.columns.map(c => c.key).join(', ');
  const table  = schema.table;
  const conds  = [];

  if (schema.where) conds.push(schema.where);

  // status filter (only for tables that have a status column)
  const hasStatus = ['gold_loans','saving_accounts','fd_accounts','od_loans','memberships'].includes(schema.table);
  if (hasStatus && status && status !== 'all') {
    conds.push(`status = '${status === 'closed' ? 'closed' : 'active'}'`);
  }

  // is_deleted filter
  const hasSoftDelete = ['gold_loans','saving_accounts','fd_accounts','od_loans'].includes(table);
  // These tables don't have is_deleted, skip

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const sql   = `SELECT ${cols} FROM ${table} ${where} ORDER BY id DESC`;
  const { rows } = await pool.query(sql);
  return rows;
}

// ── Helper: format cell value ────────────────────────────────────────────────
function fmtVal(val, col) {
  if (val === null || val === undefined) return '';
  if (col.date) {
    const d = new Date(val);
    if (isNaN(d)) return String(val);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  if (col.number) return Number(val) || 0;
  return String(val);
}

// ── XLSX export ───────────────────────────────────────────────────────────────
async function sendXlsx(res, schema, rows) {
  let ExcelJS;
  try { ExcelJS = require('exceljs'); }
  catch(e) {
    return res.status(503).json({ error: 'exceljs not installed. Run: npm install exceljs' });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'JJU Bank';
  wb.created = new Date();

  const ws = wb.addWorksheet(schema.title, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  // Title row
  ws.mergeCells(1, 1, 1, schema.columns.length);
  const titleCell = ws.getCell('A1');
  titleCell.value = `${schema.title} — Jalgaon Jamod Urban Co-op Credit Society`;
  titleCell.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a3a5c' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  // Date row
  ws.mergeCells(2, 1, 2, schema.columns.length);
  const dateCell = ws.getCell('A2');
  dateCell.value = `Exported: ${new Date().toLocaleString('en-IN')}  |  Total: ${rows.length} records`;
  dateCell.font  = { italic: true, size: 10, color: { argb: 'FF555555' } };
  dateCell.alignment = { horizontal: 'center' };
  ws.getRow(2).height = 18;

  // Header row
  const headerRow = ws.addRow(schema.columns.map(c => c.label));
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2d6a4f' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
    };
  });
  ws.getRow(3).height = 22;

  // Data rows
  rows.forEach((row, i) => {
    const vals = schema.columns.map(c => fmtVal(row[c.key], c));
    const wsRow = ws.addRow(vals);
    const bg = i % 2 === 0 ? 'FFFAFAFA' : 'FFf0f4f8';
    wsRow.eachCell((cell, colIdx) => {
      const col = schema.columns[colIdx - 1];
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.font = { size: 9 };
      cell.alignment = { horizontal: col?.number ? 'right' : 'left', vertical: 'middle' };
      if (col?.number && typeof cell.value === 'number') {
        cell.numFmt = '#,##0.00';
      }
      // Highlight closed status in red
      if (col?.key === 'status' && cell.value === 'closed') {
        cell.font = { size: 9, bold: true, color: { argb: 'FFc0392b' } };
      }
    });
    wsRow.height = 18;
  });

  // Auto column widths
  schema.columns.forEach((col, i) => {
    const colNum = i + 1;
    const wsCol  = ws.getColumn(colNum);
    const maxLen = Math.max(
      col.label.length,
      ...rows.map(r => String(fmtVal(r[col.key], col) || '').length)
    );
    wsCol.width = Math.min(Math.max(maxLen + 2, 10), 40);
  });

  // Freeze header rows
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  // Summary sheet
  const summary = wb.addWorksheet('Summary');
  summary.addRow(['Report', schema.title]);
  summary.addRow(['Society', 'Jalgaon Jamod Urban Co-op Credit Society']);
  summary.addRow(['Exported At', new Date().toLocaleString('en-IN')]);
  summary.addRow(['Total Records', rows.length]);

  // Totals for numeric columns
  schema.columns.filter(c => c.number).forEach(col => {
    const total = rows.reduce((sum, r) => sum + (Number(r[col.key]) || 0), 0);
    summary.addRow([`Total ${col.label}`, total]);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="JJU_${schema.title.replace(/\s+/g,'_')}_${_today()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

// ── PDF export (HTML → print in new tab) ─────────────────────────────────────
function sendPdfHtml(res, schema, rows) {
  const headers = schema.columns.map(c =>
    `<th>${c.label}</th>`
  ).join('');

  const bodyRows = rows.map((row, i) => {
    const cells = schema.columns.map(c => {
      const val = fmtVal(row[c.key], c);
      const cls = c.number ? 'num' : '';
      const style = c.key === 'status' && val === 'closed' ? ' style="color:#c0392b;font-weight:bold"' : '';
      return `<td class="${cls}"${style}>${val}</td>`;
    }).join('');
    return `<tr class="${i%2===0?'even':'odd'}">${cells}</tr>`;
  }).join('');

  // Numeric totals footer
  const footerCells = schema.columns.map(c => {
    if (!c.number) return '<td></td>';
    const total = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    return `<td class="num total">₹${total.toLocaleString('en-IN', {minimumFractionDigits:2})}</td>`;
  }).join('');
  const footer = `<tr class="footer-row"><td colspan="1" style="font-weight:bold;text-align:right">Total →</td>${footerCells.split('</td>').slice(1).join('</td>')}</tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${schema.title} — JJU Bank</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #222; background: #fff; }
  .header { background: #1a3a5c; color: #fff; padding: 10px 16px; margin-bottom: 8px; }
  .header h1 { font-size: 14pt; }
  .header p  { font-size: 9pt; opacity: .8; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th {
    background: #2d6a4f; color: #fff; padding: 5px 6px;
    text-align: center; font-size: 8pt; white-space: nowrap;
    position: sticky; top: 0;
  }
  td { padding: 4px 6px; font-size: 8.5pt; border-bottom: 1px solid #eee; }
  tr.even td { background: #fafafa; }
  tr.odd  td { background: #f0f4f8; }
  td.num  { text-align: right; font-variant-numeric: tabular-nums; }
  tr.footer-row td { background: #e8f5e9; font-weight: bold; border-top: 2px solid #2d6a4f; }
  .meta { font-size: 8pt; color: #666; padding: 4px 16px 8px; }
  @media print {
    @page { size: A4 landscape; margin: 8mm; }
    .no-print { display: none; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
  .no-print {
    text-align: center; padding: 10px;
    background: #fff3cd; font-size: 10pt;
  }
  button {
    background: #1a3a5c; color: #fff; border: none;
    padding: 8px 24px; border-radius: 6px; cursor: pointer;
    font-size: 11pt; margin: 0 6px;
  }
</style>
</head>
<body>
<div class="no-print">
  <button onclick="window.print()">🖨️ Print / Save as PDF</button>
  <button onclick="window.close()">✕ Close</button>
</div>
<div class="header">
  <h1>${schema.title}</h1>
  <p>Jalgaon Jamod Urban Co-op Credit Society &nbsp;|&nbsp; Exported: ${new Date().toLocaleString('en-IN')} &nbsp;|&nbsp; Total: ${rows.length} records</p>
</div>
<table>
  <thead><tr>${headers}</tr></thead>
  <tbody>${bodyRows}${footer}</tbody>
</table>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

// ── Date helper ───────────────────────────────────────────────────────────────
function _today() {
  return new Date().toISOString().split('T')[0];
}

// ── Route: GET /api/export/:type ──────────────────────────────────────────────
router.get('/:type', async (req, res) => {
  const schema = SCHEMAS[req.params.type];
  if (!schema) {
    return res.status(404).json({
      error: `Unknown export type: ${req.params.type}`,
      valid: Object.keys(SCHEMAS),
    });
  }

  const format = (req.query.format || 'xlsx').toLowerCase();
  const status = req.query.status || 'all';

  try {
    const rows = await fetchRows(schema, status);
    if (format === 'pdf') {
      sendPdfHtml(res, schema, rows);
    } else {
      await sendXlsx(res, schema, rows);
    }
  } catch (err) {
    console.error(`[export] ${req.params.type} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Route: GET /api/export (list available types) ─────────────────────────────
router.get('/', (req, res) => {
  res.json({
    types: Object.entries(SCHEMAS).map(([key, s]) => ({
      key,
      title: s.title,
      xlsx: `/api/export/${key}?format=xlsx`,
      pdf:  `/api/export/${key}?format=pdf`,
    })),
  });
});

module.exports = router;
