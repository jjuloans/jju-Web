// JJU Bank — App Logic
// Requires: js/data/static-data.js loaded first

// ═══════════════════════════════════════
//  CONFIG — removed type_of_customer, account_no (Primary), sonar_group_no from visible form fields
// ═══════════════════════════════════════
// [static data moved to js/data/static-data.js]

// [static data moved to js/data/static-data.js]
// FM is built after DOMContentLoaded to guarantee static-data.js has run first.
const FM = {};
function _buildFM() {
  if (typeof SECTIONS === "undefined") {
    console.error(
      "app.js: SECTIONS is not defined — ensure static-data.js is loaded before app.js",
    );
    return;
  }
  SECTIONS.forEach((s) =>
    s.fields.forEach((f) => (FM[f.id] = { ...f, secLabel: s.sec })),
  );
}
// NOTE: the sonar sub-loan grouping feature was removed (Sept 2026); the
// sonar_* DB columns are preserved read-only for legacy sub-case records.

// ── PDF Bottom Sheet — mobile-style slide-up panel ────────────────────────
(function initPDFSheet() {
  function _inject() {
    if (document.getElementById('pdf-sheet')) return;
    const el = document.createElement('div');
    el.id = 'pdf-sheet';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);align-items:flex-end;';
    el.innerHTML = `
      <div style="background:#fff;width:100%;height:92dvh;border-radius:18px 18px 0 0;display:flex;flex-direction:column;overflow:hidden;">
        <div style="background:#1a3a5c;color:#fff;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <strong id="pdf-sheet-title" style="flex:1;font-size:11pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Document</strong>
          <button id="pdf-sheet-print" style="background:#fff;color:#1a3a5c;border:none;border-radius:6px;padding:6px 16px;font-weight:700;font-size:10pt;cursor:pointer;">🖨️ Print</button>
          <button id="pdf-sheet-close" style="background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:6px;padding:6px 13px;font-size:14pt;line-height:1;cursor:pointer;">✕</button>
        </div>
        <iframe id="pdf-sheet-frame" name="pdf-frame" style="flex:1;border:none;width:100%;background:#f4f4f4;"></iframe>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('pdf-sheet-close').addEventListener('click', window.closePDFSheet);
    document.getElementById('pdf-sheet-print').addEventListener('click', window.printPDFSheet);
    el.addEventListener('click', function(e) { if (e.target === el) window.closePDFSheet(); });
  }

  /** Open the bottom sheet.
   *  @param {'url'|'html'} type  'url' for blob/object URLs; 'html' for raw HTML strings
   *  @param {string} content     the URL or raw HTML
   *  @param {string} [title]     header label
   *  @param {boolean} [autoPrint=true]  false = just show the sheet as a preview
   *         (e.g. "View Cash Book") without popping the print dialog — the
   *         manual 🖨️ Print button in the sheet header still works either way.
   */
  window.openPDFSheet = function(type, content, title, autoPrint) {
    _inject();
    const frame = document.getElementById('pdf-sheet-frame');
    document.getElementById('pdf-sheet-title').textContent = title || 'Document';

    // Auto-print: triggered by parent on iframe load — no setTimeout delay needed.
    // Skipped entirely when autoPrint===false (view-only mode).
    if (autoPrint !== false) {
      frame.onload = function() {
        try { frame.contentWindow.print(); } catch(e) { /* cross-origin guard */ }
        frame.onload = null; // fire once only
      };
    } else {
      frame.onload = null;
    }

    if (type === 'url') {
      // CSP blocks blob: in frame-src. Read blob as text and use srcdoc instead.
      if (typeof content === 'string' && content.startsWith('blob:')) {
        fetch(content)
          .then(function(r) { return r.text(); })
          .then(function(html) {
            frame.removeAttribute('src');
            frame.srcdoc = html;
            URL.revokeObjectURL(content);
          })
          .catch(function() {
            frame.removeAttribute('srcdoc');
            frame.src = content;
          });
      } else {
        frame.removeAttribute('srcdoc');
        frame.src = content;
      }
    } else {
      frame.removeAttribute('src');
      frame.srcdoc = content;
    }
    const sheet = document.getElementById('pdf-sheet');
    sheet.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };

  window.closePDFSheet = function() {
    const sheet = document.getElementById('pdf-sheet');
    if (!sheet) return;
    sheet.style.display = 'none';
    document.body.style.overflow = '';
    const frame = document.getElementById('pdf-sheet-frame');
    frame.removeAttribute('srcdoc');
    frame.src = 'about:blank';
  };

  window.printPDFSheet = function() {
    const frame = document.getElementById('pdf-sheet-frame');
    if (!frame) return;
    try { frame.contentWindow.print(); } catch(e) { window.print(); }
  };
})();

// ── PDF History — tracks every generateTemplatePDF call for dashboard panel ──
(function() {
  var PDF_HISTORY_KEY = 'jju_pdf_history';
  var MAX_ENTRIES = 30;

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(PDF_HISTORY_KEY) || '[]'); } catch(e) { return []; }
  }
  function saveHistory(arr) {
    try { localStorage.setItem(PDF_HISTORY_KEY, JSON.stringify(arr.slice(0, MAX_ENTRIES))); } catch(e) {}
  }

  window.clearPdfHistory = function() {
    localStorage.removeItem(PDF_HISTORY_KEY);
    renderPdfPanel();
  };

  window.renderPdfPanel = function() {
    var panel = document.getElementById('dash-pdf-panel');
    var list  = document.getElementById('dash-pdf-list');
    if (!panel || !list) return;
    var history = getHistory();
    if (!history.length) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    list.innerHTML = history.map(function(entry, i) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;' +
        (i < history.length - 1 ? 'border-bottom:1px dashed #ccd;' : '') + '">' +
        '<div>' +
          '<div style="font-weight:700;color:#1a3a5c;">' + entry.label + '</div>' +
          '<div style="color:#888;font-size:8pt;">' + entry.name + ' &nbsp;·&nbsp; ' + entry.time + '</div>' +
        '</div>' +
        '<button onclick="window._reopenPdf(' + i + ')" ' +
          'style="background:#1a3a5c;color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:8.5pt;cursor:pointer;white-space:nowrap;">🖨️ Open</button>' +
        '</div>';
    }).join('');
  };

  window._reopenPdf = function(idx) {
    var history = getHistory();
    var entry = history[idx];
    if (!entry) return;
    if (entry.type === 'html') {
      window.openPDFSheet('html', entry.content, entry.label);
    } else if (entry.type === 'url') {
      window.openPDFSheet('url', entry.content, entry.label);
    }
  };

  // Patch generateTemplatePDF to intercept and log every call
  var _origGenerateTemplatePDF;
  var _patchInterval = setInterval(function() {
    if (typeof generateTemplatePDF !== 'function') return;
    clearInterval(_patchInterval);
    _origGenerateTemplatePDF = generateTemplatePDF;
    generateTemplatePDF = function(txArr, data) {
      // Call original first (opens new tab)
      _origGenerateTemplatePDF.apply(this, arguments);
      // Log to history — we rebuild the HTML to allow reopening
      try {
        var label = (txArr || []).join(' + ');
        var nm    = (data && (data.customer_name || data.name)) || '—';
        var now   = new Date();
        var time  = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) +
                    ', ' + now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        // Rebuild HTML via buildHTMLPage + wrapHTML if available, otherwise store marker
        var htmlContent = null;
        if (typeof buildHTMLPage === 'function' && typeof wrapHTML === 'function') {
          try {
            var pages = txArr.map(function(tx) { return buildHTMLPage(tx, data); }).join('');
            htmlContent = wrapHTML(pages, nm);
          } catch(e) {}
        }
        var entry = { label: label, name: nm, time: time, type: htmlContent ? 'html' : 'none', content: htmlContent };
        var history = getHistory();
        history.unshift(entry);
        saveHistory(history);
        renderPdfPanel();
      } catch(e) {}
    };
  }, 200);
})();

// TF — remove type_of_customer, account_no, sonar_group_no from all arrays
const TF = {
  "Gold Loan": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "saving_balance",
    "loan_acc_no",
    "loan_amount",
    "loan_amount_words",
    "metal_type",
    "ornament_items",
    "comments",
    "photo_customer",
    "photo_ornament",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "Slips - Loan": [
    "customer_name",
    "customer_id",
    "loan_acc_no",
    "mobile",
    "aadhar",
    "date",
    "loan_amount",
    "loan_amount_words",
    "comments",
  ],
  "Closing - Loan": [
    "customer_name",
    "customer_id",
    "aadhar",
    "mobile",
    "pan",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "loan_acc_no",
    "loan_amount",
    "loan_amount_words",
    "date",
    "nominee_name",
    "nominee_relation",
    "ornament_items",
    "comments",
    "photo_ornament",
  ],
  "New FD - Term": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "fd_acc_no",
    "mis_acc_no",
    "fd_parvati_no",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "saving_balance",
    "fd_sub_type",
    "fd_amount",
    "fd_amount_words",
    "fd_period",
    "fd_interest_rate",
    "fd_maturity_date",
    "fd_maturity_amount",
    "fd_maturity_words",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "New FD - MIS": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "mis_acc_no",
    "fd_parvati_no",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "saving_balance",
    "fd_amount",
    "fd_amount_words",
    "fd_period",
    "fd_interest_rate",
    "fd_maturity_date",
    "fd_maturity_amount",
    "fd_maturity_words",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "New FD": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "fd_acc_no",
    "mis_acc_no",
    "fd_parvati_no",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "saving_balance",
    "fd_sub_type",
    "fd_amount",
    "fd_amount_words",
    "fd_period",
    "fd_interest_rate",
    "fd_maturity_date",
    "fd_maturity_amount",
    "fd_maturity_words",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "Fixed Deposit": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "fd_acc_no",
    "fd_parvati_no",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "saving_balance",
    "fd_amount",
    "fd_amount_words",
    "fd_period",
    "fd_interest_rate",
    "fd_maturity_date",
    "fd_maturity_amount",
    "fd_maturity_words",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "FD - Slips": [
    "customer_name",
    "customer_id",
    "fd_acc_no",
    "fd_parvati_no",
    "saving_acc_no",
    "mobile",
    "aadhar",
    "date",
    "fd_amount",
    "fd_amount_words",
    "comments",
  ],
  "Closing - FD": [
    "customer_name",
    "customer_id",
    "aadhar",
    "mobile",
    "pan",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "fd_acc_no",
    "fd_parvati_no",
    "fd_amount",
    "fd_amount_words",
    "fd_period",
    "fd_maturity_date",
    "fd_maturity_amount",
    "fd_maturity_words",
    "date",
    "nominee_name",
    "nominee_relation",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "Closing - FD - Slips": [
    "customer_name",
    "customer_id",
    "fd_acc_no",
    "fd_parvati_no",
    "saving_acc_no",
    "mobile",
    "aadhar",
    "date",
    "fd_amount",
    "fd_amount_words",
    "fd_maturity_amount",
    "fd_maturity_words",
    "comments",
  ],
  "Saving Account": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "saving_balance",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "Saving Deposit": [
    "customer_name",
    "customer_id",
    "saving_acc_no",
    "saving_balance",
    "mobile",
    "pan",
    "aadhar",
    "date",
    "deposit_amount",
    "deposit_amount_words",
    "comments",
  ],
  "Saving Withdrawal": [
    "customer_name",
    "customer_id",
    "saving_acc_no",
    "saving_balance",
    "mobile",
    "pan",
    "aadhar",
    "date",
    "deposit_amount",
    "deposit_amount_words",
    "comments",
  ],
  // No single "customer_name"/"customer_id" here — a transfer involves two
  // different members, identified by their own account-number lookups
  // instead (see onSavingAccNoInput's from/to variant).
  "Saving Acc Transfer": [
    "date",
    "from_saving_acc_no",
    "from_saving_balance",
    "to_saving_acc_no",
    "to_saving_balance",
    "transfer_amount",
    "transfer_amount_words",
    "transfer_ref_no",
    "comments",
  ],
  "Saving - Deposit Slip": [
    "customer_name",
    "customer_id",
    "saving_acc_no",
    "saving_balance",
    "mobile",
    "pan",
    "aadhar",
    "date",
    "deposit_amount",
    "deposit_amount_words",
    "comments",
  ],
  "Saving - Withdrawal Slip": [
    "customer_name",
    "customer_id",
    "saving_acc_no",
    "saving_balance",
    "mobile",
    "pan",
    "aadhar",
    "date",
    "deposit_amount",
    "deposit_amount_words",
    "comments",
  ],
  Sadasya: [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "Sadasya - Slips": [
    "customer_name",
    "customer_id",
    "saving_acc_no",
    "share_acc_no",
    "mobile",
    "aadhar",
    "date",
    "saving_balance",
    "comments",
  ],
  // Merged: New Sadasya = Sadasya form + Sadasya Slips in one selection
  "New Sadasya": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "saving_balance",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "Closing - Saving Account": [
    "customer_name",
    "customer_id",
    "aadhar",
    "mobile",
    "pan",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "date",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "New FD-OD Loan": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "fd_acc_no",
    "fd_parvati_no",
    "loan_acc_no",
    "date",
    "nominee_name",
    "nominee_relation",
    "loan_amount",
    "loan_amount_words",
    "fd_amount",
    "fd_amount_words",
    "fd_maturity_date",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
    "photo_fd",
  ],
  "OD Loan": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "fd_acc_no",
    "fd_parvati_no",
    "loan_acc_no",
    "date",
    "nominee_name",
    "nominee_relation",
    "loan_amount",
    "loan_amount_words",
    "fd_amount",
    "fd_amount_words",
    "fd_maturity_date",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
    "photo_fd",
  ],
  "Slips - FD-OD": [
    "customer_name",
    "customer_id",
    "loan_acc_no",
    "mobile",
    "aadhar",
    "date",
    "loan_amount",
    "loan_amount_words",
    "comments",
  ],
  "Slips - OD": [
    "customer_name",
    "customer_id",
    "loan_acc_no",
    "mobile",
    "aadhar",
    "date",
    "loan_amount",
    "loan_amount_words",
    "comments",
  ],
  "Closing - OD": [
    "customer_name",
    "customer_id",
    "aadhar",
    "mobile",
    "pan",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "fd_acc_no",
    "fd_parvati_no",
    "loan_acc_no",
    "loan_amount",
    "loan_amount_words",
    "fd_amount",
    "fd_amount_words",
    "fd_maturity_date",
    "date",
    "nominee_name",
    "nominee_relation",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
    "photo_fd",
  ],
  "Current Account": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "Current - Slips": [
    "customer_name",
    "customer_id",
    "mobile",
    "aadhar",
    "date",
    "loan_amount",
    "loan_amount_words",
    "comments",
  ],
  "Shares Account": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "Shares - Transfer": [
    "customer_name",
    "customer_id",
    "aadhar",
    "mobile",
    "share_acc_no",
    "date",
    "comments",
  ],
  "Naammatr Sabhasad Account": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "saving_balance",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  "Naammatr Sabhasad - Slips": [
    "customer_name",
    "customer_id",
    "saving_acc_no",
    "share_acc_no",
    "mobile",
    "aadhar",
    "date",
    "comments",
  ],
  // Merged: New Naammatr Sabhasad = Account form + Slips in one selection
  "New Naammatr Sabhasad": [
    "customer_name",
    "customer_id",
    "dob",
    "occupation",
    "mobile",
    "pan",
    "aadhar",
    "address",
    "saving_acc_no",
    "share_acc_no",
    "saving_balance",
    "date",
    "referral",
    "nominee_name",
    "nominee_relation",
    "comments",
    "photo_customer",
    "photo_aadhar_front",
    "photo_aadhar_back",
    "photo_pan",
  ],
  // ── FD Section: MIS Interest ─────────────────────────────────────────────────
  "MIS Interest": [
    "customer_name",
    "saving_acc_no",
    "mis_acc_no",
    "fd_parvati_no",
    "fd_amount",
    "fd_amount_words",
    "fd_period",
    "fd_interest_rate",
    "fd_maturity_date",
    "fd_maturity_amount",
    "fd_maturity_words",
    "date",
    "mis_month_select",
    "interest_amount",
    "interest_amount_words",
    "comments",
  ],
  // ── Office Maintenance Section ────────────────────────────────────────────────
  "Office Rent": [
    "date",
    "expense_amount",
    "expense_amount_words",
    "saving_acc_no",
    "comments",
  ],
  "Tea & Water Expense": [
    "date",
    "expense_amount",
    "expense_amount_words",
    "comments",
  ],
  "Office Maintenance": [
    "date",
    "expense_amount",
    "expense_amount_words",
    "saving_acc_no",
    "comments",
  ],
  "Printing & Stationary": [
    "date",
    "expense_amount",
    "expense_amount_words",
    "comments",
  ],
  "Employee Salary": [
    "customer_name",
    "date",
    "salary_month_select",
    "expense_amount",
    "expense_amount_words",
    "saving_acc_no",
    "comments",
  ],
  // ── Bank Transactions Section ─────────────────────────────────────────────────
  "Payment Received - Online": [
    "date",
    "customer_name",
    "saving_acc_no",
    "bank_acc_name",
    "expense_acc_no",
    "expense_amount",
    "expense_amount_words",
    "upi_rrn",
    "cheque_no",
    "comments",
  ],
  "Payment Transfer - Online": [
    "date",
    "customer_name",
    "saving_acc_no",
    "bank_acc_name",
    "expense_acc_no",
    "expense_amount",
    "expense_amount_words",
    "upi_rrn",
    "cheque_no",
    "comments",
  ],
  RTGS: [
    "date",
    "rtgs_from_acc",
    "rtgs_to_acc",
    "expense_amount",
    "expense_amount_words",
    "rtgs_bank_charges",
    "upi_rrn",
    "cheque_no",
    "comments",
  ],
  "Bank Charges": [
    "date",
    "bank_acc_name",
    "expense_acc_no",
    "expense_amount",
    "expense_amount_words",
    "upi_rrn",
    "cheque_no",
    "comments",
  ],
  "Other Bank - Cash Withdrawal": [
    "date",
    "bank_acc_name",
    "expense_acc_no",
    "expense_amount",
    "expense_amount_words",
    "upi_rrn",
    "cheque_no",
    "comments",
  ],
  "Other Bank - Cash Deposit": [
    "date",
    "bank_acc_name",
    "expense_acc_no",
    "expense_amount",
    "expense_amount_words",
    "upi_rrn",
    "cheque_no",
    "comments",
  ],
  TDS: [
    "date",
    "bank_acc_name",
    "expense_acc_no",
    "expense_amount",
    "expense_amount_words",
    "upi_rrn",
    "cheque_no",
    "comments",
  ],
  "Interest Received on FD from Other Bank": [
    "date",
    "customer_name",
    "saving_acc_no",
    "bank_acc_name",
    "fd_acc_no",
    "expense_acc_no",
    "expense_amount",
    "expense_amount_words",
    "upi_rrn",
    "cheque_no",
    "comments",
  ],
};

// [static data moved to js/data/static-data.js]

// ─── FD Sub-type config: auto-fills period & rate when dropdown changes ───────
// BUG FIX: these three used to be the only options and none of the
// numbers matched real product terms — MIS was coded as 12 months when
// every historical MIS Special record is 15 months, and the "1 Year FD"
// option used 8% when the real 12-month Term rate has always been 7%.
// Corrected per the bank's actual rate history (see FdAll.pdf export).
const FD_TYPE_CONFIG = {
  "12 Months FD – 7%":            { months: 12, rate: 7.0,  isMis: false },
  "13 Months FD – 10%":           { months: 13, rate: 10.0, isMis: false },
  "MIS Special – 15 Months – 9%": { months: 15, rate: 9.0,  isMis: true  },
  // Legacy labels: old records may still have one of these exact strings
  // saved in fd_sub_type from before the fix above (static-data.js's
  // dropdown no longer offers them). Kept resolvable — with the CORRECTED
  // months/rate, not the old wrong ones — so reopening an old record still
  // classifies it correctly as MIS vs Term instead of silently failing the
  // FD_TYPE_CONFIG[...] lookup.
  "13 Months – 10%": { months: 13, rate: 10.0, isMis: false },
  "MIS FD – 9%":      { months: 15, rate: 9.0,  isMis: true  },
  "1 Year FD – 8%":   { months: 12, rate: 7.0,  isMis: false },
};

function onFdSubTypeChange(val) {
  const cfg = FD_TYPE_CONFIG[val];
  if (!cfg) return;
  const periodEl = document.getElementById("f-fd_period");
  const rateEl   = document.getElementById("f-fd_interest_rate");
  if (periodEl) { periodEl.value = cfg.months; autoFillWords("fd_period", cfg.months); }
  if (rateEl)   { rateEl.value   = cfg.rate;   autoFillWords("fd_interest_rate", cfg.rate); }
  // MIS FD: swap acc-no hint label visibility
  const fdAccEl  = document.getElementById("f-fd_acc_no");
  const misAccEl = document.getElementById("f-mis_acc_no");
  const fdAccWrap  = fdAccEl?.closest(".field");
  const misAccWrap = misAccEl?.closest(".field");
  if (fdAccWrap)  fdAccWrap.style.display  = cfg.isMis ? "none" : "";
  if (misAccWrap) misAccWrap.style.display = cfg.isMis ? "" : "none";
  // BUG FIX: clear the now-hidden field's value instead of just hiding it.
  // Previously switching FD Type only toggled CSS display, so a
  // previously-entered/prefilled value in the other field stayed in the DOM
  // and was still submitted with the form — e.g. selecting "MIS Special"
  // after the Term acc-no field had been prefilled would submit both
  // fd_acc_no and mis_acc_no, and the backend's old OR-precedence logic
  // picked the stale fd_acc_no, showing the MIS deposit under a Term
  // (046-series) account number in the Fixed Deposits list.
  if (cfg.isMis && fdAccEl)  fdAccEl.value  = "";
  if (!cfg.isMis && misAccEl) misAccEl.value = "";
  // Trigger next-acc-no prefill based on sub-type
  if (cfg.isMis) setTimeout(prefillNextMisAccNo, 300);
  else           setTimeout(prefillNextFdAccNo,  100);
}

/** Returns true if current New FD form is MIS sub-type */
function _fdSubIsMis() {
  const v = document.getElementById("f-fd_sub_type")?.value || "";
  if (v) return FD_TYPE_CONFIG[v]?.isMis === true;
  // Fallback for legacy records that still carry the old tx-type names
  const txArr = window.checked ? [...window.checked] : [];
  return txArr.includes("New FD - MIS");
}

// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════
let checked = new Set(),
  photos = {},
  ctype = "regular";
// Bumped every time the form is rebuilt/cleared. onPhoto() captures this at
// upload time and checks it again once compression finishes — if a new form
// has since been built (fast "New Transaction" clicks, submit-then-reopen,
// etc.), the stale callback is dropped instead of writing an old photo into
// the new form's identically-id'd photo box.
let _photoFormGen = 0;
let dbOff = 0,
  dbTot = 0,
  editId = null,
  searchTmr = null;
let dbTxFilter = "",
  dbTxTypeFilter = "",
  dbStatusFilter = "";
let impRows = [],
  impCols = [];
const API = "/api/records";
const API_BASE = "/api"; // base for non-records endpoints

// ── Standalone Auth ──────────────────────────────────────────────────
let _appToken = localStorage.getItem("jju_token") || null;
let _appRedirecting = false;
let _serverPollId = null;

// ── Idle auto-logout (15 min) ────────────────────────────────────────────────
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
let _idleTimer = null;
function _resetIdleTimer() {
  if (!_appToken) return;
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    if (_appToken) {
      showAppLogin();
      const msg = document.getElementById("app-login-msg");
      if (msg) msg.innerHTML = '<div style="color:#e67e22;font-size:13px;margin-bottom:10px;">⏱️ Signed out due to inactivity. Please sign in again.</div>';
    }
  }, IDLE_TIMEOUT_MS);
}
["click","keydown","touchstart","mousemove"].forEach((ev) =>
  document.addEventListener(ev, _resetIdleTimer, { passive: true })
);

const _origFetch = window.fetch;
window.fetch = function (url, opts = {}) {
  _appToken = localStorage.getItem("jju_token");
  if (_appToken && typeof url === "string" && url.includes("/api/")) {
    opts = {
      ...opts,
      headers: { ...(opts.headers || {}), "x-auth-token": _appToken },
    };
  }
  return _origFetch(url, opts).then((res) => {
    if ((res.status === 401 || res.status === 403) && !_appRedirecting) {
      _appRedirecting = true;
      localStorage.removeItem("jju_token");
      _appToken = null;
      requestAnimationFrame(() => showAppLogin());
    }
    return res;
  });
};

async function appDoLogin() {
  const username = document.getElementById("app-login-username").value.trim();
  const password = document.getElementById("app-login-password").value;
  const btn = document.getElementById("app-login-btn");
  const msg = document.getElementById("app-login-msg");
  if (!username || !password) {
    msg.innerHTML =
      '<div style="color:#c0392b;font-size:13px;margin-bottom:10px;">Please enter username and password</div>';
    return;
  }
  btn.textContent = "Signing in...";
  btn.disabled = true;
  try {
    const res = await _origFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.error) {
      const errDiv = document.createElement("div");
      errDiv.style.cssText = "color:#c0392b;font-size:13px;margin-bottom:10px;";
      errDiv.textContent = "❌ " + data.error;
      msg.innerHTML = "";
      msg.appendChild(errDiv);
      btn.textContent = "Sign In →";
      btn.disabled = false;
      return;
    }
    _appToken = data.token;
    localStorage.setItem("jju_token", _appToken);
    _appRedirecting = false;
    _resetIdleTimer();
    document.getElementById("app-login-screen").style.display = "none";
    document.getElementById("app-main-wrap").style.display = "block";
    btn.textContent = "Sign In →";
    btn.disabled = false;
    // Re-init app now that we're logged in
    document.getElementById("dash-date").textContent =
      new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    initGlobalDate(); // ← must run after token is stored, not before
    renderTxList();
    checkServer();
    loadDashboard(); // interval already started in DOMContentLoaded
  } catch (e) {
    msg.innerHTML = `<div style="color:#c0392b;font-size:13px;margin-bottom:10px;">❌ Cannot connect to server</div>`;
    btn.textContent = "Sign In →";
    btn.disabled = false;
  }
}

function showAppLogin() {
  localStorage.removeItem("jju_token");
  _appToken = null;
  _appRedirecting = false;
  clearTimeout(_idleTimer);
  _idleTimer = null;
  if (_serverPollId) { clearInterval(_serverPollId); _serverPollId = null; }
  // Remove offline banner so it doesn't linger on the login screen
  const banner = document.getElementById("offline-banner");
  if (banner) banner.remove();
  document.getElementById("app-login-screen").style.display = "flex";
  document.getElementById("app-main-wrap").style.display = "none";
  setTimeout(() => document.getElementById("app-login-username").focus(), 100);
}

async function appCheckAuth() {
  if (!_appToken) {
    showAppLogin();
    return false;
  }
  try {
    const res = await _origFetch("/api/auth/me", {
      headers: { "x-auth-token": _appToken },
    });
    if (!res.ok) {
      showAppLogin();
      return false;
    }
    document.getElementById("app-login-screen").style.display = "none";
    document.getElementById("app-main-wrap").style.display = "block";
    return true;
  } catch (_e) {
    showAppLogin();
    return false;
  }
}
// ── End Auth ─────────────────────────────────────────────────────────

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
addEventListener("DOMContentLoaded", async () => {
  _buildFM(); // Build FM after static-data.js is guaranteed to have run
  const ok = await appCheckAuth();
  if (!ok) return;
  document.getElementById("dash-date").textContent =
    new Date().toLocaleDateString("en-IN", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  initGlobalDate(); // ← only runs after token confirmed valid
  renderTxList();
  checkServer();
  loadDashboard();
  if (_serverPollId) clearInterval(_serverPollId);
  _serverPollId = setInterval(checkServer, 30000);
});

let _serverFailCount = 0;

async function checkServer() {
  // Don’t poll when not logged in — avoids cascading 401s every 30s
  if (!_appToken) return;
  const el = document.getElementById("conn");
  try {
    const r = await _origFetch("/api/health");
    if (r.ok) {
      _serverFailCount = 0;
      if (el) { el.textContent = "● Online"; el.className = "conn online"; }
      // If we just came back online, remove the banner and reload data
      const banner = document.getElementById("offline-banner");
      if (banner) {
        banner.remove();
        loadDashboard();
        loadDB();
      }
    } else {
      _serverFailCount++;
      if (el) { el.textContent = "● DB Error"; el.className = "conn offline"; }
      if (_serverFailCount >= 2) {
        let msg =
          "Server running but database is unavailable — check your .env and PostgreSQL";
        try {
          const j = await r.json();
          if (j.error) msg = j.error;
        } catch (_) {}
        showOfflineBanner(msg);
      }
    }
  } catch (_e) {
    _serverFailCount++;
    if (el) { el.textContent = "● Offline"; el.className = "conn offline"; }
    // Only show red banner after 2 consecutive failures — prevents a single
    // WiFi blip or sleep/wake hiccup from alarming staff unnecessarily
    if (_serverFailCount >= 2) {
      showOfflineBanner();
    }
  }
}

// ═══════════════════════════════════════
//  GOOGLE SHEETS SYNC
// ═══════════════════════════════════════
async function loadSheetsLastSync() {
  // Read the sync timestamp from Z1 in the sheet via a backend endpoint
  // Falls back gracefully if not available
  try {
    const r = await fetch(`${API_BASE}/sync-sheets/status`);
    if (!r.ok) return;
    const { syncInProgress, lastSync } = await r.json();
    const el = document.getElementById("sheets-last-sync");
    if (!el) return;
    if (syncInProgress) {
      el.textContent = "⏳ Sync running…";
      el.style.color = "#e67e22";
    } else if (lastSync) {
      const when = lastSync.finishedAt
        ? new Date(lastSync.finishedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
        : null;
      if (lastSync.status === "done") {
        el.textContent = when ? `✅ Last synced at ${when}` : "✅ Last sync complete";
        el.style.color = "#27ae60";
      } else if (lastSync.status === "error") {
        el.textContent = `❌ Last sync failed${when ? " at " + when : ""}: ${lastSync.message || "unknown error"}`;
        el.style.color = "#c0392b";
      }
    }
  } catch (_e) {}
}

async function triggerSheetsSync() {
  const btn = document.getElementById("sheets-sync-btn");
  const icon = document.getElementById("sheets-sync-icon");
  const status = document.getElementById("sheets-sync-status");
  if (!btn) return;

  // Disable button while syncing
  btn.disabled = true;
  btn.style.opacity = "0.6";
  icon.textContent = "⏳";
  status.style.display = "block";
  status.innerHTML =
    '<span style="color:#e67e22;font-weight:700">⏳ Sync started — running in background. This usually takes 10–30 seconds…</span>';

  try {
    const r = await fetch(`${API_BASE}/sync-sheets`, { method: "POST" });
    const data = await r.json();

    if (data.ok) {
      status.innerHTML =
        '<span style="color:#27ae60;font-weight:700">✅ Sync request accepted! Google Sheet will be updated shortly. Check PM2 logs for progress.</span>';
      icon.textContent = "✅";
      // Poll status for up to 60 seconds
      let polls = 0;
      const poll = setInterval(async () => {
        polls++;
        if (polls > 60) {
          clearInterval(poll);
          status.innerHTML = '<span style="color:#e67e22;font-weight:700">⚠️ Sync timed out. Check server logs.</span>';
          icon.textContent = "🔄";
          btn.disabled = false;
          btn.style.opacity = "1";
          return;
        }
        try {
          const sr = await fetch(`${API_BASE}/sync-sheets/status`);
          const sd = await sr.json();
          if (!sd.syncInProgress) {
            clearInterval(poll);
            status.innerHTML =
              '<span style="color:#27ae60;font-weight:700">✅ Sync complete! Google Sheet is now up to date.</span>';
            icon.textContent = "🔄";
            btn.disabled = false;
            btn.style.opacity = "1";
          }
        } catch (_e) {}
      }, 1000);
    } else {
      const safeMsg = document.createElement("span");
      safeMsg.style.cssText = "color:#e67e22;font-weight:700";
      safeMsg.textContent = "⚠️ " + (data.message || "Unknown error");
      status.innerHTML = "";
      status.appendChild(safeMsg);
      icon.textContent = "🔄";
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  } catch (e) {
    status.innerHTML =
      '<span style="color:#c0392b;font-weight:700">❌ Could not reach server. Make sure the app is running.</span>';
    icon.textContent = "🔄";
    btn.disabled = false;
    btn.style.opacity = "1";
  }
}

// ═══════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════
async function loadDashboard() {
  // Guard: don't fire stats or any API call when not logged in
  if (!_appToken) return;
  // Ensure _appRedirecting is cleared — if it was set from a pre-login 401
  // it would silently block all subsequent API calls including stats
  _appRedirecting = false;
  const fmtAmt = (n) => {
    if (!n || n === 0) return "—";
    if (n >= 10000000) return "₹ " + (n / 10000000).toFixed(2) + " Cr";
    if (n >= 100000) return "₹ " + (n / 100000).toFixed(2) + " L";
    return "₹ " + Number(n).toLocaleString("en-IN");
  };
  try {
    const _statsRes = await fetch(API + "/stats");
    if (!_statsRes.ok)
      throw new Error("Stats fetch failed: " + _statsRes.status);
    const s = await _statsRes.json();

    // KPI row
    document.getElementById("s-total").textContent = s.total;
    document.getElementById("s-today").textContent = s.today;
    document.getElementById("s-active-gold").textContent = s.activeGold ?? "—";
    document.getElementById("s-active-fd").textContent = s.activeFD ?? "—";
    document.getElementById("s-gold-amt").textContent = fmtAmt(
      s.totalGoldLoanAmt,
    );
    document.getElementById("s-fd-amt").textContent = fmtAmt(
      s.totalFDDepositAmt,
    );

    // Today activity
    document.getElementById("s-today-opened").textContent =
      s.todayOpenedGold ?? 0;
    document.getElementById("s-today-closed").textContent =
      s.todayClosedGold ?? 0;
    document.getElementById("s-active-gold2").textContent = s.activeGold ?? "—";
    document.getElementById("s-closed-gold").textContent = s.closedGold ?? "—";

    // Data errors
    const de = s.dataErrors || {};
    const totalErrors =
      (de.missingLoanAmt || 0) +
      (de.missingName || 0) +
      (de.missingDate || 0) +
      (de.dupLoanAcc || 0);
    const errEl = document.getElementById("data-errors-list");
    if (totalErrors === 0) {
      errEl.innerHTML =
        '<div style="color:#27ae60;font-weight:800;font-size:11pt;padding:6px 0">✅ No data errors found!</div><div style="font-size:8.5pt;color:#555">All records look clean.</div>';
    } else {
      const rows = [
        de.missingLoanAmt > 0
          ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #eee"><span>❌ Missing Loan Amount</span><span style="background:#fadbd8;color:#c0392b;font-weight:800;padding:1px 8px;border-radius:10px">${de.missingLoanAmt}</span></div>`
          : "",
        de.missingName > 0
          ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #eee"><span>❌ Missing Customer Name</span><span style="background:#fadbd8;color:#c0392b;font-weight:800;padding:1px 8px;border-radius:10px">${de.missingName}</span></div>`
          : "",
        de.missingDate > 0
          ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #eee"><span>⚠️ Missing Date</span><span style="background:#fef3cd;color:#856404;font-weight:800;padding:1px 8px;border-radius:10px">${de.missingDate}</span></div>`
          : "",
        de.dupLoanAcc > 0
          ? `<div style="display:flex;justify-content:space-between;padding:4px 0"><span>⚠️ Duplicate Loan Acc No.</span><span style="background:#fef3cd;color:#856404;font-weight:800;padding:1px 8px;border-radius:10px">${de.dupLoanAcc}</span></div>`
          : "",
      ]
        .filter(Boolean)
        .join("");
      errEl.innerHTML =
        `<div style="font-size:9pt;color:#555;margin-bottom:4px">Found <strong style="color:#c0392b">${totalErrors}</strong> issue(s):</div>` +
        rows;
      if (de.dupLoanAccList && de.dupLoanAccList.length) {
        errEl.innerHTML += `<div style="font-size:8pt;color:#856404;margin-top:4px">Dup acc: ${de.dupLoanAccList.map((r) => r.account_no).join(", ")}</div>`;
      }
    }

    // Recently closed loans
    const rcEl = document.getElementById("recent-closed-list");
    if (s.recentClosed && s.recentClosed.length) {
      rcEl.innerHTML = "";
      s.recentClosed.forEach((r) => {
        const outer = document.createElement("div");
        outer.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px dashed #eee;gap:6px";
        const left = document.createElement("div");
        left.style.minWidth = "0";
        const nameDiv = document.createElement("div");
        nameDiv.style.cssText = "font-weight:800;font-size:9pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        nameDiv.textContent = r.name || "—";
        const metaDiv = document.createElement("div");
        metaDiv.style.cssText = "font-size:8pt;color:#555";
        metaDiv.textContent = (r.account_no || "—") + " · " + (r.closed_date || "—");
        left.appendChild(nameDiv);
        left.appendChild(metaDiv);
        const amtDiv = document.createElement("div");
        amtDiv.style.cssText = "font-size:8.5pt;font-weight:800;color:#1a5276;white-space:nowrap";
        amtDiv.textContent = r.loan_amount ? "₹ " + Number(r.loan_amount).toLocaleString("en-IN") : "";
        outer.appendChild(left);
        outer.appendChild(amtDiv);
        rcEl.appendChild(outer);
      });
    } else {
      rcEl.innerHTML =
        '<div style="color:#aaa;font-size:9pt">No closed loans yet</div>';
    }

    // Section breakdown bars
    const bS = {};
    (s.bySection || []).forEach((r) => (bS[r.section] = r.count));
    const maxC = Math.max(1, ...Object.values(bS));
    document.getElementById("tx-breakdown").innerHTML = Object.entries(SL)
      .map(([k, l]) => {
        const c = bS[k] || 0,
          p = Math.round((c / maxC) * 100);
        return `<div class="bar-row"><div class="bar-lbl">${l}</div><div class="bar-wrap"><div class="bar-fill" style="width:${p}%;background:${SC[k]}"></div></div><div class="bar-cnt" style="color:${SC[k]}">${c}</div></div>`;
      })
      .join("");

    // Section summary card
    const secNames = {
      gold: "🥇 Gold Loan",
      fd: "📈 Fixed Deposit",
      saving: "💰 Saving",
      membership: "🪪 Membership",
      current: "🏦 Current",
      shares: "📊 Shares",
      office: "🏢 Office",
      bank: "🏧 Bank",
      od: "💳 OD Loan",
      general: "📄 General",
    };
    document.getElementById("section-summary").innerHTML =
      Object.entries(bS)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([k, c]) =>
            `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed #eee;font-size:9pt"><span style="font-weight:700">${secNames[k] || k}</span><span style="font-weight:800;color:#1a3a5c">${c}</span></div>`,
        )
        .join("") || '<div style="color:#aaa;font-size:9pt">No data</div>';

    // Recent records
    const rec = s.recent || [];
    document.getElementById("recent-list").innerHTML = rec.length
      ? rec
          .map((r) => {
            const bg = SB[r.section] || "#eee";
            const icon = SI[r.section] || "📄";
            // BUG FIX: the /stats endpoint sends tx_types already parsed into
            // an array (see stats() in records.controller.js), but this was
            // calling the string-only .substring() directly on it — Array
            // has no .substring, so this threw on every record and silently
            // aborted the rest of loadDashboard() (the outer catch then reset
            // the KPI cards, Today's Activity, and Records by Section back to
            // their loading placeholders even though they'd already rendered
            // correctly). Normalize to a string first so it renders either way.
            const txTypesStr = Array.isArray(r.tx_types)
              ? r.tx_types.join(", ")
              : String(r.tx_types || "");
            return (
              '<div class="rrow" onclick="showPage(\'database\')">' +
              '<div class="rav" style="background:' +
              bg +
              '">' +
              icon +
              "</div>" +
              '<div style="flex:1;min-width:0"><div class="rname">' +
              (r.name || "—") +
              "</div>" +
              '<div class="rtx">' +
              txTypesStr.substring(0, 34) +
              "</div></div>" +
              '<div class="rdate">' +
              (r.date || "—") +
              "</div>" +
              (r.id
                ? '<button class="rpdf" onclick="event.stopPropagation();pdfRec(' +
                  r.id +
                  ')">📄</button>'
                : "") +
              "</div>"
            );
          })
          .join("")
      : '<div class="empty-st"><div class="ei">📭</div><p>No records yet</p></div>';

    // Update date/time in banner
    const now = new Date();
    document.getElementById("dash-date").textContent = now.toLocaleDateString(
      "en-IN",
      {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      },
    );
  } catch (e) {
    document.getElementById("recent-list").innerHTML =
      `<div class="empty-st"><div class="ei">❌</div><p>Server offline — check connection</p></div>`;
    document.getElementById("tx-breakdown").innerHTML =
      `<div style="font-size:10px;color:var(--textl)">— offline —</div>`;
    [
      "s-total",
      "s-today",
      "s-active-gold",
      "s-active-fd",
      "s-gold-amt",
      "s-fd-amt",
      "s-today-opened",
      "s-today-closed",
      "s-active-gold2",
      "s-closed-gold",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "—";
    });
    _serverFailCount++;
    if (_serverFailCount >= 2) showOfflineBanner();
  }

  // Load Sheets sync status (non-blocking)
  loadSheetsLastSync().catch(() => {});
}

function showOfflineBanner(customMsg) {
  const existing = document.getElementById("offline-banner");
  if (existing) {
    const msgEl = document.getElementById("offline-banner-msg");
    if (msgEl && customMsg) msgEl.innerHTML = customMsg;
    return;
  }
  const defaultMsg = `Unable to connect to server. Please contact the administrator.`;
  const banner = document.createElement("div");
  banner.id = "offline-banner";
  banner.style.cssText =
    "position:fixed;top:60px;left:0;right:0;z-index:9999;background:#c0392b;color:#fff;padding:10px 16px;display:flex;align-items:center;gap:12px;font-family:Nunito,sans-serif;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.3)";
  banner.innerHTML = `
    <span style="font-size:16px">⚡</span>
    <span id="offline-banner-msg" style="flex:1">${customMsg || defaultMsg}</span>
    <button onclick="document.getElementById('offline-banner').remove();loadDashboard();loadDB();" style="background:#fff;color:#c0392b;border:none;border-radius:5px;padding:5px 14px;cursor:pointer;font-weight:800;font-size:11px;font-family:Nunito,sans-serif">🔄 Retry</button>
    <button onclick="document.getElementById('offline-banner').remove()" style="background:transparent;border:1.5px solid rgba(255,255,255,.5);color:#fff;border-radius:5px;padding:5px 10px;cursor:pointer;font-size:11px">✕</button>
  `;
  document.body.appendChild(banner);
}

// ═══════════════════════════════════════
//  TX LIST
// ═══════════════════════════════════════
function renderTxList() {
  document.getElementById("tx-list").innerHTML = GROUPS.map(
    (g) =>
      `<div class="tx-group-lbl">${g.label}</div>` +
      g.types
        .map(
          (
            tx,
          ) => `<div class="tx-row" id="row-${sid(tx)}" onclick="toggleTx('${tx}')">
<div class="tx-cb" id="cb-${sid(tx)}">✓</div>
<div class="tx-dot" style="background:${g.color}"></div>
<div class="tx-lbl">${tx}</div></div>`,
        )
        .join(""),
  ).join("");
}
function sid(t) {
  return t.replace(/[\s\-]+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
}
function toggleTx(tx) {
  if (checked.has(tx)) checked.delete(tx);
  else checked.add(tx);
  document
    .getElementById("row-" + sid(tx))
    .classList.toggle("on", checked.has(tx));
  document.getElementById("sel-count").textContent = checked.size;
  document.getElementById("go-btn").disabled = !checked.size;
  updateGoBtnLabel();
  window.checked = checked;
  updateCBPreview();
}
function selAll() {
  GROUPS.forEach((g) =>
    g.types.forEach((tx) => {
      checked.add(tx);
      document.getElementById("row-" + sid(tx)).classList.add("on");
    }),
  );
  document.getElementById("sel-count").textContent = checked.size;
  document.getElementById("go-btn").disabled = false;
  updateGoBtnLabel();
  window.checked = checked;
  updateCBPreview();
}
function selNone() {
  checked.clear();
  photos = {};
  _photoFormGen++;
  document.querySelectorAll(".tx-row").forEach((r) => r.classList.remove("on"));
  document.getElementById("sel-count").textContent = 0;
  document.getElementById("go-btn").disabled = true;
  document.getElementById("form-empty").style.display = "";
  document.getElementById("form-card").classList.remove("show");
  document.getElementById("action-bar").classList.remove("show");
  document.getElementById("cb-preview-panel").classList.remove("show");
  updateGoBtnLabel();
}

// ── Multi-check ornament dropdown helpers ─────────────────────────────────────
function mchkToggle(id) {
  const drop = document.getElementById("mchk-drop-" + id);
  const btn = document.getElementById("mchk-btn-" + id);
  if (!drop || !btn) return;
  const isOpen = drop.classList.contains("open");
  document
    .querySelectorAll(".mchk-dropdown.open")
    .forEach((d) => d.classList.remove("open"));
  document
    .querySelectorAll(".mchk-trigger.open")
    .forEach((b) => b.classList.remove("open"));
  if (!isOpen) {
    drop.classList.add("open");
    btn.classList.add("open");
  }
}
function mchkUpdate(id) {
  const drop = document.getElementById("mchk-drop-" + id);
  if (!drop) return;
  const sel = [...drop.querySelectorAll("input[type=checkbox]:checked")].map(
    (c) => c.value,
  );
  const custom = (
    document.getElementById("mchk-custom-" + id)?.value || ""
  ).trim();
  const all = [...sel, custom].filter(Boolean);
  const hiddenEl = document.getElementById("f-" + id);
  if (hiddenEl) hiddenEl.value = all.join(", ");
  const lbl = document.getElementById("mchk-lbl-" + id);
  if (lbl) {
    lbl.innerHTML = all.length
      ? all.map((o) => `<span class="mchk-tag">${o}</span>`).join("")
      : '<span style="color:var(--textl)">Select ornaments…</span>';
  }
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".mchk-wrap")) {
    document
      .querySelectorAll(".mchk-dropdown.open")
      .forEach((d) => d.classList.remove("open"));
    document
      .querySelectorAll(".mchk-trigger.open")
      .forEach((b) => b.classList.remove("open"));
  }
});

function updateCBPreview() {
  const panel = document.getElementById("cb-preview-panel");
  const rowsEl = document.getElementById("cb-preview-rows");
  if (!checked.size) {
    panel.classList.remove("show");
    return;
  }

  // Build deduplicated rows (same logic as addCashbookRows)
  const skipTypes = new Set();
  if (checked.has("Gold Loan") && checked.has("Slips - Loan"))
    skipTypes.add("Slips - Loan");
  if (checked.has("Fixed Deposit") && checked.has("FD - Slips"))
    skipTypes.add("FD - Slips");
  if (checked.has("Gold Loan") && checked.has("Saving Account"))
    skipTypes.add("Saving Account");
  // Skip Saving Account when New Sadasya selected — New Sadasya covers all 4 rows
  if (checked.has("New Sadasya") && checked.has("Saving Account"))
    skipTypes.add("Saving Account");
  // Expand: New Sadasya also emits New Saving Account rows
  const expandedChecked = new Set(checked);
  if (checked.has("New Sadasya") && !checked.has("New Saving Account"))
    expandedChecked.add("New Saving Account");
  const hasGoldLoan = checked.has("Gold Loan");

  const allRows = [];
  [...expandedChecked].forEach((tx) => {
    if (skipTypes.has(tx)) return;
    const rows = CB_TX_ROWS_MAP[tx];
    if (!rows) return;
    rows.forEach((r) => {
      if (r.skipWhenGoldLoan && hasGoldLoan) return;
      allRows.push({ ...r, txLabel: tx });
    });
  });
  if (!allRows.length) {
    panel.classList.remove("show");
    return;
  }
  const isCr = (r) => r.tx_type === "Credit";
  rowsEl.innerHTML = allRows
    .map((r) => {
      const cr = isCr(r);
      const amtLabel =
        typeof r.amountField === "number" && r.amountField > 0
          ? `<span style="font-size:9px;font-weight:700;color:var(--mint-a)">₹ ${r.amountField}</span>`
          : r.amountField
            ? `<span style="font-size:9px;opacity:.6">₹ from form</span>`
            : `<span style="font-size:9px;opacity:.6">₹ manual</span>`;
      return `<div class="cb-preview-row ${cr ? "cr" : "db"}">
<span class="cb-badge ${cr ? "cr" : "db"}">${cr ? "CR" : "DR"}</span>
<span class="cb-badge ${r.mode === "Transfer" ? "trf" : "cash"}">${r.mode}</span>
<span style="flex:1;font-weight:700">${r.task}</span>
<span style="opacity:.7;font-size:9px">${r.acc_no}</span>
${amtLabel}
    </div>`;
    })
    .join("");
  panel.classList.add("show");
}

function setCtype(t) {
  ctype = t;

  document.getElementById("btn-reg").style.cssText =
    t === "regular"
      ? "flex:1;padding:7px 10px;border-radius:8px;border:1.5px solid #c8e6c9;background:#eafaf1;color:#1e8449;font-size:11px;font-weight:700;cursor:pointer;text-align:center;user-select:none;"
      : "flex:1;padding:7px 10px;border-radius:8px;border:1.5px solid #ddd;background:#fafafa;color:#555;font-size:11px;font-weight:700;cursor:pointer;text-align:center;user-select:none;";

  updateGoBtnLabel();
  photos = {};
  _photoFormGen++;
  document.getElementById("form-card").innerHTML = "";
  document.getElementById("form-card").classList.remove("show");
  document.getElementById("form-empty").style.display = "";
  document.getElementById("action-bar").classList.remove("show");
  document.getElementById("tx-layout-wrap")?.classList.remove("mob-form-open");
}

function onGoBtn() {
  if (!checked.size) {
    toast("Select at least one transaction type first", "err");
    return;
  }
  buildForm();
  document.getElementById("tx-layout-wrap")?.classList.add("mob-form-open");
}
function updateGoBtnLabel() {
  const btn = document.getElementById("go-btn");
  btn.textContent = "Fill Form →";
}

// ── Ornament Items Dynamic Table ──
// ── Ornament Chip-Picker ──────────────────────────────────────────────────────
const ORN_PRESETS = {
  gold: [
    "गोल्ड अंगुठी","गोल्ड पोत/मंगळसूत्र","गोल्ड हार/नेकलेस",
    "गोल्ड बांगडी","गोल्ड कानातली रिंग","गोल्ड चेन",
    "गोल्ड कानातली चेन","गोल्ड पेंडेंट","गोल्ड कडे",
    "गोल्ड नथ","गोल्ड वाकी","गोल्ड टिका",
  ],
  silver: [
    "चांदी कडे","चांदी साखळी","चांदी पाटली",
    "चांदी तागडी","चांदी बाष्या","चांदी फुलतोडे",
    "चांदी अंगुठी","चांदी पैंजण","चांदी करदोडा",
    "चांदी कमरपट्टा","चांदी नथ","चांदी वाकी",
  ],
};

function ornGetMetalType() {
  const el = document.getElementById("f-metal_type");
  const v = (el ? el.value : "").toLowerCase();
  if (v.includes("silver") || v.includes("चांदी")) return "silver";
  if (v.includes("gold") || v.includes("गोल्ड") || v.includes("सोन")) return "gold";
  return "both";
}

function ornRenderChips() {
  const wrap = document.getElementById("orn-chip-grid");
  if (!wrap) return;
  const metal = ornGetMetalType();
  const lists = metal === "both"
    ? [...ORN_PRESETS.gold, ...ORN_PRESETS.silver]
    : (metal === "gold" ? ORN_PRESETS.gold : ORN_PRESETS.silver);
  const current = ornGetItems().map(r => r.name);
  wrap.innerHTML = lists.map(name => {
    const active = current.includes(name);
    const isGold = ORN_PRESETS.gold.includes(name);
    const col = isGold ? "#b7791f" : "#4a5568";
    const bg  = active ? (isGold ? "#fef3c7" : "#e2e8f0") : "#f9fafb";
    const brd = active ? (isGold ? "#f6c90e" : "#94a3b8") : "#e5e7eb";
    const wt  = active ? (ornGetItems().find(r=>r.name===name)?.weight||"") : "";
    return `<div data-chip="${name}" onclick="ornChipToggle(this)" style="cursor:pointer;border:1.5px solid ${brd};background:${bg};border-radius:8px;padding:6px 8px;font-size:11px;font-family:Nunito,sans-serif;user-select:none;transition:all 0.12s;position:relative;min-width:0;word-break:break-word;">
      <div style="font-weight:${active?'700':'500'};color:${active?col:'#555'};margin-bottom:${active?'4px':'0'};line-height:1.3;">${active?'✓ ':''}<span style="font-size:10px;margin-right:3px;">${isGold?'🥇':'🪙'}</span>${name}</div>
      ${active ? `<div style="display:flex;gap:4px;align-items:center;margin-top:2px;">
        <input type="number" min="1" value="${ornGetItems().find(r=>r.name===name)?.qty||1}" onclick="event.stopPropagation()" oninput="ornChipUpdate('${name}','qty',this.value)" style="width:44px;padding:2px 4px;border:1px solid #ccc;border-radius:4px;font-size:11px;text-align:center;" placeholder="Qty">
        <span style="font-size:10px;color:#888;">नग</span>
        <input type="number" min="0" step="0.01" value="${wt}" onclick="event.stopPropagation()" oninput="ornChipUpdate('${name}','weight',this.value)" style="width:54px;padding:2px 4px;border:1px solid #ccc;border-radius:4px;font-size:11px;text-align:center;" placeholder="gm">
        <span style="font-size:10px;color:#888;">gm</span>
      </div>` : ''}
    </div>`;
  }).join("");
}

function ornChipToggle(el) {
  const name = el.getAttribute("data-chip");
  let items = ornGetItemsRaw();
  const idx = items.findIndex(r => r.name === name);
  if (idx >= 0) {
    items.splice(idx, 1);
  } else {
    items.push({ name, qty: 1, weight: null });
  }
  ornSaveRaw(items);
  ornRenderChips();
  ornRenderTable();
  ornUpdateSummary();
}

function ornChipUpdate(name, field, val) {
  let items = ornGetItemsRaw();
  const item = items.find(r => r.name === name);
  if (!item) return;
  if (field === "qty") item.qty = parseFloat(val) || 1;
  if (field === "weight") item.weight = val !== "" ? parseFloat(val) : null;
  ornSaveRaw(items);
  ornRenderTable();
  ornUpdateSummary();
}

function ornGetItemsRaw() {
  const hid = document.getElementById("f-ornament_items");
  if (!hid || !hid.value) return [];
  try { return JSON.parse(hid.value); } catch(e) { return []; }
}

function ornSaveRaw(items) {
  const hid = document.getElementById("f-ornament_items");
  if (hid) hid.value = items.length ? JSON.stringify(items) : "";
}

function ornRenderTable() {
  const tbody = document.getElementById("orn-items-tbody");
  const tbl   = document.getElementById("orn-items-table");
  if (!tbody) return;
  const items = ornGetItemsRaw();
  tbody.innerHTML = items.map((item, i) => `
    <tr>
      <td style="border:1px solid #ddd;padding:4px 6px;font-size:12px;font-family:Nunito,sans-serif;">${item.name}</td>
      <td style="border:1px solid #ddd;padding:4px 6px;text-align:center;">
        <input type="number" min="1" value="${item.qty||1}" data-orn="qty" data-i="${i}" oninput="ornTableEdit(${i},'qty',this.value)"
          style="width:52px;padding:3px 4px;border:1px solid #ccc;border-radius:4px;font-size:12px;text-align:center;font-family:Nunito,sans-serif;">
      </td>
      <td style="border:1px solid #ddd;padding:4px 6px;text-align:center;">
        <input type="number" min="0" step="0.01" value="${item.weight??''}" data-orn="weight" data-i="${i}" oninput="ornTableEdit(${i},'weight',this.value)"
          style="width:64px;padding:3px 4px;border:1px solid #ccc;border-radius:4px;font-size:12px;text-align:center;font-family:Nunito,sans-serif;" placeholder="0.00">
      </td>
      <td style="border:1px solid #ddd;padding:4px 6px;text-align:center;">
        <button type="button" onclick="ornRemoveIdx(${i})"
          style="background:#c62828;color:#fff;border:none;border-radius:4px;width:26px;height:26px;cursor:pointer;font-size:13px;">✕</button>
      </td>
    </tr>`).join("");
  if (tbl) tbl.style.display = items.length ? "" : "none";
}

function ornTableEdit(i, field, val) {
  const items = ornGetItemsRaw();
  if (!items[i]) return;
  if (field === "qty") items[i].qty = parseFloat(val) || 1;
  if (field === "weight") items[i].weight = val !== "" ? parseFloat(val) : null;
  ornSaveRaw(items);
  ornRenderChips();
  ornUpdateSummary();
}

function ornRemoveIdx(i) {
  const items = ornGetItemsRaw();
  items.splice(i, 1);
  ornSaveRaw(items);
  ornRenderChips();
  ornRenderTable();
  ornUpdateSummary();
}

// Called from "Other / Custom" row add
function ornAddRow(prefill) {
  const items = ornGetItemsRaw();
  const name = prefill ? prefill.name : "";
  const qty  = prefill ? (prefill.qty || 1) : 1;
  const wt   = prefill ? (prefill.weight ?? null) : null;
  if (name) {
    // prefill from history — add if not already present
    if (!items.find(r => r.name === name)) items.push({ name, qty, weight: wt });
    ornSaveRaw(items);
    ornRenderChips();
    ornRenderTable();
    ornUpdateSummary();
    return;
  }
  // Manual custom add — focus on custom input
  const inp = document.getElementById("orn-custom-inp");
  if (inp) inp.focus();
}

function ornAddCustom() {
  const inp = document.getElementById("orn-custom-inp");
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) return;
  const items = ornGetItemsRaw();
  if (!items.find(r => r.name === name)) {
    items.push({ name, qty: 1, weight: null });
    ornSaveRaw(items);
    ornRenderChips();
    ornRenderTable();
    ornUpdateSummary();
  }
  inp.value = "";
}
function ornUpdateSummary() {
  const items = ornGetItems();
  const totalQty = items.reduce((s, r) => s + (parseInt(r.qty) || 0), 0);
  const totalWt = items.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);
  const el = document.getElementById("orn-items-summary");
  if (el) {
    if (items.length) {
      const wtStr = totalWt > 0 ? ` | ${totalWt.toFixed(2)} gm` : "";
      el.textContent = `एकूण: ${items.length} प्रकार | ${totalQty} नग${wtStr}`;
    } else {
      el.textContent = "";
    }
  }
  // hidden field already kept in sync by ornSaveRaw
}
function ornGetItems() {
  return ornGetItemsRaw().filter(r => r.name);
}

function buildForm() {
  if (!checked.size) return;
  // ── Preserve already-entered data across a form rebuild ─────────────────────
  // BUG FIX: staff would sometimes forget to check "Saving Account" / "Shares
  // Account" (or any other type) before filling the form, then have to check it
  // afterward — which used to rebuild the form from scratch and wipe every value
  // already typed in, forcing them to redo the whole entry. We snapshot the
  // current form's field values and any uploaded photos before rebuilding, then
  // restore them onto matching fields below (id="f-..." in the new HTML) once
  // the new form is in the DOM. This does NOT leak across separate customers/
  // transactions: clearForm() (called after every successful save, and by
  // "Select None") empties #form-card first, so there is nothing to restore.
  const _prevFieldValues = {};
  document.querySelectorAll('#form-card [id^="f-"]').forEach((el) => {
    if (el.type === "file") return; // photo inputs — handled via `photos` below
    if (el.value) _prevFieldValues[el.id] = el.value;
  });
  const _prevPhotos = Object.assign({}, photos);
  photos = {};   // ── Fix: clear photos so previous form photos don't carry over ──
  _photoFormGen++;
  const txArr = [...checked];
  const needed = new Set();
  txArr.forEach((tx) => (TF[tx] || []).forEach((f) => needed.add(f)));

  // Show photo_ornament ONLY for Gold Loan; hide when combined with non-Gold-Loan types
  // EXCEPT: keep it visible when combined with New Sadasya / New Naammatr Sabhasad / Saving Account
  // Also always show for Closing - Loan (staff must photo the returned ornament)
  const isGoldClosing = txArr.includes("Closing - Loan");
  const nonGoldTypes = txArr.filter(t =>
    t !== "Gold Loan" &&
    t !== "Closing - Loan" &&
    t !== "New Sadasya" &&
    t !== "New Naammatr Sabhasad" &&
    t !== "Saving Account" &&
    t !== "New Saving Account"
  );
  if (!isGoldClosing && (!txArr.includes("Gold Loan") || nonGoldTypes.length > 0)) {
    needed.delete("photo_ornament");
  }
  // Determine section so we can conditionally show loan number prefill
  let section = "general";
  for (const g of GROUPS) {
    if (txArr.some((t) => g.types.includes(t))) {
      section = g.section;
      break;
    }
  }
  let html =
    '<div class="form-card-title">📝 Customer Form</div>' +
    '<div class="form-card-sub">Forms: <strong>' +
    txArr.join(" · ") +
    "</strong></div>";
  // Determine if this is a deposit-only or withdrawal-only form for label override
  const isWithdrawalOnly =
    txArr.some((t) => t === "Saving Withdrawal") &&
    !txArr.some((t) => t === "Saving Deposit");
  const isDepositOnly =
    txArr.some((t) => t === "Saving Deposit") &&
    !txArr.some((t) => t === "Saving Withdrawal");

  SECTIONS.forEach((s) => {
    const vis = s.fields.filter((f) => needed.has(f.id));
    if (!vis.length) return;
    html += '<div class="sec-lbl">' + s.sec + '</div><div class="fgrid">';
    vis.forEach((f) => {
      // Override deposit_amount label based on transaction type
      if (f.id === "deposit_amount") {
        f = Object.assign({}, f, {
          label: isWithdrawalOnly
            ? "Withdrawal Amount (₹)"
            : isDepositOnly
              ? "Deposit Amount (₹)"
              : f.label,
        });
      }
      const cls = f.w === 2 ? "fw" : "",
        req = f.req ? '<span class="req"> *</span>' : "";
      const today = "";
      if (f.type === "photo") {
        html +=
          '<div class="field ' +
          cls +
          '"><label>' +
          f.label +
          "</label>" +
          '<div class="photo-box" id="pbox-' +
          f.id +
          '">' +
          '<div class="ph-hint"><div class="ph-icon">📷</div><div class="ph-lbl">Tap to add</div></div>' +
          '<input type="file" aria-label="Upload photo" accept="image/*" capture="environment" onchange="onPhoto(\'' +
          f.id +
          "',this)\">" +
          "</div></div>";
      } else if (f.type === "multicheck") {
        const opts = (f.opts || [])
          .map(
            (o) =>
              `<label class="mchk-item"><input type="checkbox" aria-label="${o}" value="${o}" onchange="mchkUpdate('${f.id}')"><span>${o}</span></label>`,
          )
          .join("");
        html +=
          '<div class="field ' +
          cls +
          '"><label>' +
          f.label +
          req +
          "</label>" +
          '<div class="mchk-wrap">' +
          '<button type="button" class="mchk-trigger" id="mchk-btn-' +
          f.id +
          '" onclick="mchkToggle(\'' +
          f.id +
          "')\">" +
          '<span id="mchk-lbl-' +
          f.id +
          '" style="font-size:12px;color:var(--textl)">Select ornaments…</span>' +
          '<span style="font-size:10px;color:var(--textl)">▼</span>' +
          "</button>" +
          '<div class="mchk-dropdown" id="mchk-drop-' +
          f.id +
          '">' +
          '<label class="mchk-item" style="background:var(--lem);font-weight:700"><input type="checkbox" id="mchk-other-' +
          f.id +
          '" style="display:none"><span style="color:var(--lem-a);font-size:11px">✏️ Type custom below</span></label>' +
          '<input type="text" id="mchk-custom-' +
          f.id +
          '" placeholder="Custom ornament name…" oninput="mchkUpdate(\'' +
          f.id +
          '\')" style="width:calc(100% - 24px);margin:0 12px 8px;padding:6px 9px;border-radius:6px;border:1px solid var(--border);font-size:12px;font-family:Nunito,sans-serif">' +
          opts +
          "</div>" +
          '<input type="hidden" id="f-' +
          f.id +
          '">' +
          "</div></div>";
      } else if (f.type === "ornament_items") {
        html +=
          '<div class="field fw" style="grid-column:1/-1"><label>' + f.label + "</label>" +
          '<div id="orn-items-wrap" style="background:#fafafa;border:1.5px solid #e5e7eb;border-radius:10px;padding:12px 14px;">' +
          '<div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:7px;">टॅप करून निवडा / Tap to select</div>' +
          '<div id="orn-chip-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(140px,42vw),1fr));gap:5px;margin-bottom:12px;"></div>' +
          '<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">' +
          '<input type="text" id="orn-custom-inp" placeholder="Custom / \u0907\u0924\u0930 \u0926\u093e\u0917\u093f\u0928\u093e\u2026" style="flex:1;padding:6px 9px;border:1px solid #ccc;border-radius:6px;font-size:12px;font-family:Nunito,sans-serif;" onkeydown="if(event.key===&quot;Enter&quot;){event.preventDefault();ornAddCustom();}">' +
          '<button type="button" onclick="ornAddCustom()" style="background:#1a3a5c;color:#fff;border:none;border-radius:6px;padding:6px 13px;font-size:12px;font-weight:700;font-family:Nunito,sans-serif;cursor:pointer;">+ जोडा</button>' +
          '</div>' +
          '<table style="width:100%;border-collapse:collapse;margin-bottom:4px;" id="orn-items-table">' +
          '<thead><tr>' +
          '<th style="background:#1a3a5c;color:#fff;padding:5px 8px;font-size:11px;border:1px solid #999;text-align:left;width:50%">दागिन्याचे नाव / Name</th>' +
          '<th style="background:#1a3a5c;color:#fff;padding:5px 8px;font-size:11px;border:1px solid #999;text-align:center;width:15%">नग / Qty</th>' +
          '<th style="background:#1a3a5c;color:#fff;padding:5px 8px;font-size:11px;border:1px solid #999;text-align:center;width:25%">वजन / Weight (gm)</th>' +
          '<th style="background:#1a3a5c;color:#fff;padding:5px 8px;font-size:11px;border:1px solid #999;width:10%"></th>' +
          '</tr></thead>' +
          '<tbody id="orn-items-tbody"></tbody>' +
          '</table>' +
          '<div id="orn-items-summary" style="font-size:11px;color:#2e7d52;font-weight:700;margin-top:4px"></div>' +
          '</div>' +
          '<input type="hidden" id="f-ornament_items">' +
          "</div></div>";
        setTimeout(function () {
          ornRenderChips();
          ornRenderTable();
        }, 100);
      } else if (f.type === "textarea") {
        html +=
          '<div class="field ' +
          cls +
          '"><label>' +
          f.label +
          req +
          "</label>" +
          '<textarea id="f-' +
          f.id +
          '"></textarea></div>';
      } else if (f.type === "mis_month_year") {
        const curYear = new Date().getFullYear();
        const monthOpts = [
          "",
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ]
          .map((m) => `<option>${m}</option>`)
          .join("");
        html +=
          '<div class="field ' +
          cls +
          '"><label>' +
          f.label +
          req +
          "</label>" +
          '<div style="display:flex;gap:6px;align-items:center">' +
          '<select id="f-' +
          f.id +
          '-month" style="flex:2" onchange="misCombineMonthYear(\'' +
          f.id +
          "')\">" +
          monthOpts +
          "</select>" +
          '<input type="number" id="f-' +
          f.id +
          '-year" placeholder="Year" value="' +
          curYear +
          '" min="2000" max="2099" style="flex:1;width:70px" onchange="misCombineMonthYear(\'' +
          f.id +
          "')\" oninput=\"misCombineMonthYear('" +
          f.id +
          "')\">" +
          '<input type="hidden" id="f-' +
          f.id +
          '">' +
          "</div></div>";
      } else if (f.type === "select") {
        const onchg = f.id === "metal_type"   ? ' onchange="ornRenderChips()"'
                    : f.id === "fd_sub_type"   ? ' onchange="onFdSubTypeChange(this.value)"'
                    : "";
        const defaultOpt = f.id === "fd_sub_type" ? '<option value="">-- Select FD Type --</option>' : "";
        html +=
          '<div class="field ' +
          cls +
          '"><label>' +
          f.label +
          req +
          "</label>" +
          '<select id="f-' +
          f.id +
          '"' + onchg + '>' +
          defaultOpt +
          (f.opts || []).map((o) => "<option>" + o + "</option>").join("") +
          "</select></div>";
      } else {
        // Don't prefill loan_acc_no or saving_acc_no — keep empty so customer history can fill them
        const prefillVal = (f.id === "loan_acc_no" || f.id === "saving_acc_no") ? "" : f.prefill || "";
        const todayVal =
          f.id === "date" ? new Date().toISOString().split("T")[0] : "";
        const valAttr = prefillVal
          ? `value="${prefillVal}"`
          : todayVal
            ? `value="${todayVal}"`
            : "";
        // Auto-words trigger for amount fields + FD maturity recalc fields
        const autoWordsAttr =
          f.id === "loan_amount" ||
          f.id === "fd_amount" ||
          f.id === "fd_maturity_amount" ||
          f.id === "deposit_amount" ||
          f.id === "expense_amount" ||
          f.id === "interest_amount"
            ? ` oninput="autoFillWords('${f.id}',this.value)"`
            : f.id === "fd_period" || f.id === "fd_interest_rate"
              ? ` oninput="autoFillWords('${f.id}',this.value)"`
              : "";
        // Loan / FD / MIS acc no live check
        const loanAccAttr =
          f.id === "loan_acc_no"
            ? ` oninput="onLoanAccNoInput(this.value)" autocomplete="off"`
            : f.id === "fd_acc_no"
              ? ` oninput="onFdAccNoInput(this.value)" autocomplete="off"`
              : f.id === "mis_acc_no"
                ? ` oninput="onMisAccNoInput(this.value)" autocomplete="off"`
                : f.id === "saving_acc_no"
                  ? ` oninput="onSavingAccNoInput(this.value)" autocomplete="off"`
                  : f.id === "share_acc_no"
                  ? ` oninput="onShareAccNoInput(this.value)" autocomplete="off"`
                  : f.id === "from_saving_acc_no"
                  ? ` oninput="onTransferAccNoInput(this.value,'from')" autocomplete="off"`
                  : f.id === "to_saving_acc_no"
                  ? ` oninput="onTransferAccNoInput(this.value,'to')" autocomplete="off"`
                  : "";
        html +=
          '<div class="field ' +
          cls +
          (f.id === "loan_acc_no" ? " loan-acc-wrap" : "") +
          '"><label>' +
          f.label +
          req +
          "</label>" +
          '<input type="' +
          f.type +
          '" id="f-' +
          f.id +
          '" ' +
          valAttr +
          (f.req ? " required" : "") +
          autoWordsAttr +
          loanAccAttr +
          "></div>" +
          (f.id === "loan_acc_no"
            ? '<div id="loan-acc-hint" style="grid-column:1/-1;margin:-10px 0 4px;padding:0 2px;font-size:10px"></div>'
            : "") +
          (f.id === "fd_acc_no"
            ? '<div id="fd-acc-hint"   class="fd-acc-hint-wrap" style="grid-column:2/-1;margin:-10px 0 4px;padding:0 2px;font-size:10px"></div>'
            : "") +
          (f.id === "mis_acc_no"
            ? '<div id="mis-acc-hint"  style="grid-column:1/-1;margin:-10px 0 4px;padding:0 2px;font-size:10px"></div>'
            : "") +
          (f.id === "saving_acc_no"
            ? '<div id="saving-acc-hint" style="grid-column:1/-1;margin:-10px 0 4px;padding:0 2px;font-size:10px"></div>'
            : "") +
          (f.id === "share_acc_no"
            ? '<div id="share-acc-hint" style="grid-column:1/-1;margin:-10px 0 4px;padding:0 2px;font-size:10px"></div>'
            : "") +
          (f.id === "from_saving_acc_no"
            ? '<div id="from-saving-acc-hint" style="grid-column:1/-1;margin:-10px 0 4px;padding:0 2px;font-size:10px"></div>'
            : "") +
          (f.id === "to_saving_acc_no"
            ? '<div id="to-saving-acc-hint" style="grid-column:1/-1;margin:-10px 0 4px;padding:0 2px;font-size:10px"></div>'
            : "");
      }
    });
    html += "</div>";
  });
  const card = document.getElementById("form-card");
  card.innerHTML = html;
  card.classList.add("show");
  document.getElementById("form-empty").style.display = "none";
  document.getElementById("action-bar").classList.add("show");
  card.scrollIntoView({ behavior: "smooth", block: "start" });

  // ── Restore values/photos snapshotted above (see comment at top of function) ──
  // Only fills fields that came back empty, so this never overwrites a fresh
  // default and never blocks the auto-suggest-next-account-number logic below
  // (those functions already skip when their field is non-empty).
  Object.keys(_prevFieldValues).forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = _prevFieldValues[id];
  });
  Object.keys(_prevPhotos).forEach((fid) => {
    const pbox = document.getElementById("pbox-" + fid);
    if (pbox) {
      photos[fid] = _prevPhotos[fid];
      pbox.innerHTML = _photoBoxFilledHtml(fid, _prevPhotos[fid]);
    }
  });
  // Ornament items table is stored as JSON in the hidden f-ornament_items field
  // restored above — re-render its visible table/chip UI to match.
  if (_prevFieldValues["f-ornament_items"] && document.getElementById("f-ornament_items")) {
    try { ornRenderTable(); ornRenderChips(); ornUpdateSummary(); } catch (e) {}
  }
  // Auto-focus customer name field for gold loan section
  if (section === "gold") {
    setTimeout(function () {
      document.getElementById("f-customer_name")?.focus();
    }, 300);
  }
  // Closing types always belong to existing customers — never auto-suggest next acc numbers for them.
  const _isClosingType = txArr.some((t) =>
    ["Closing - Loan", "Closing - FD", "Closing - OD", "Closing - Saving Account"].includes(t),
  );

  // Auto-prefill next loan number for gold/od when form opens (not for closing flows)
  const _isClosingLoan = txArr.some((t) => ["Closing - Loan", "Closing - OD"].includes(t));
  if (!_isClosingLoan && (section === "od" || section === "gold")) {
    setTimeout(prefillNextLoanNo, 250);
  }

  // For FD section — trigger acc-no prefill once sub-type is known
  if (section === "fd" && txArr.some((t) => ["New FD", "New FD - Term"].includes(t))) {
    setTimeout(() => {
      const subVal = document.getElementById("f-fd_sub_type")?.value;
      if (subVal) {
        onFdSubTypeChange(subVal);
      } else {
        const misWrap = document.getElementById("f-mis_acc_no")?.closest(".field");
        if (misWrap) misWrap.style.display = "none";
        setTimeout(prefillNextFdAccNo, 250);
      }
    }, 300);
  }

  // For MIS Interest standalone — auto-suggest next mis_acc_no
  if (txArr.includes("MIS Interest")) {
    setTimeout(prefillNextMisAccNo, 250);
  }

  // Auto-suggest next saving acc no — ONLY for transactions that open a brand-new
  // saving/shares/nammatr account: "Saving Account" (new saving), "Shares Account"
  // (new shares), and "New Naammatr Sabhasad" (new nominal-member account).
  // BUG FIX: this used to also fire for New FD, OD Loan, Fixed Deposit and
  // New Sadasya — all of which are normally done by a customer who ALREADY has a
  // saving account — so an existing customer opening e.g. a Fixed Deposit would
  // incorrectly get a "Next available: ..." suggestion for a new saving account
  // number instead of their real, existing one. New Sadasya (upgrading a nominal
  // member to a full member) is excluded for the same reason: that customer
  // already has an account from when they registered as Naammatr Sabhasad.
  // Gold Loan is excluded — its saving acc no should be entered/looked up manually.
  // Closing types are excluded — they pre-fill from DB and must not be overwritten.
  if (!_isClosingType) {
    const _newAccountTypes = ["Saving Account", "Shares Account", "New Naammatr Sabhasad"];
    if (txArr.some((t) => _newAccountTypes.includes(t))) {
      setTimeout(prefillNextSavingAccNo, 200);
    }
  }

  // For Saving Deposit / Withdrawal — auto-look up saving acc no + balance from customer history
  const _isSavingDepWd = txArr.some((t) =>
    ["Saving Deposit", "Saving Withdrawal", "Saving - Deposit Slip", "Saving - Withdrawal Slip"].includes(t),
  );
  if (_isSavingDepWd) {
    setTimeout(async () => {
      await prefillSavingAccFromHistory();
    }, 300);
  }

  // Auto-suggest next Customer ID for new member registration
  if (txArr.includes("New Sadasya") || txArr.includes("New Naammatr Sabhasad")) {
    setTimeout(prefillNextCustomerId, 200);
  }

  // Auto-suggest next Share Acc No — 34- series for Sadasya/regular members, 36- for Naammatr.
  // Gold Loan is excluded — its share acc no should be entered/looked up manually, not auto-suggested.
  // Closing types excluded. Delay 600ms for FD/OD to avoid race with DB pre-fill.
  if (!_isClosingType) {
    const _newShareTypes = ["New FD", "New FD - Term", "Fixed Deposit", "OD Loan", "New FD-OD Loan", "Shares Account", "Saving Account"];
    if (txArr.includes("New Sadasya") || txArr.some((t) => _newShareTypes.includes(t))) {
      const _shareDelay = txArr.includes("New Sadasya") || txArr.includes("Saving Account") ? 200 : 600;
      setTimeout(() => prefillNextShareAccNo("34"), _shareDelay);
    } else if (txArr.includes("New Naammatr Sabhasad")) {
      setTimeout(() => prefillNextShareAccNo("36"), 200);
    }
  }
}

function resetAll() {
  clearForm();
  document.getElementById("tx-layout-wrap")?.classList.remove("mob-form-open");
}

// ── Loan Acc No live check + next suggestion ──────────────────────────────
let _loanAccTimer = null;
async function onLoanAccNoInput(val) {
  clearTimeout(_loanAccTimer);
  const hint = document.getElementById("loan-acc-hint");
  if (!hint) return;
  hint.innerHTML = "";
  if (!val || val.trim().length < 4) return;
  const v = val.trim();
  const isClosingGoldLoan =
    window.checked && [...window.checked].includes("Closing - Loan");
  const isClosingOd =
    window.checked && [...window.checked].includes("Closing - OD");
  const isClosing = isClosingGoldLoan || isClosingOd;
  _loanAccTimer = setTimeout(async () => {
    try {
      const chk = await fetch(
        "/api/records/check-loan-no/" + encodeURIComponent(v),
      ).then((r) => r.json());
      if (chk.exists) {
        const rec = chk.record;
        const isClosed = rec.status === "closed";
        // FIX 3: when loan acc no matches a record, auto-fill saving/share account
        // data from DB so staff don't have to type them manually.
        // BUG FIX: check-loan-no only ever returns {id,name,date,status,
        // closed_date,account_no} — it never had customer_id/aadhar/mobile/data,
        // so the "rec.customer_id || rec.aadhar || rec.mobile" guard below was
        // always false and this whole auto-fill block was dead code. Fetch the
        // full record (same call openClosingOdForm/openClosingFdForm already
        // make) so it actually has something to fill from.
        if (isClosing && rec && rec.id) {
          const full = await fetch(API + "/" + rec.id).then((r) => r.json()).catch(() => null);
          const recData = full ? (full.data || {}) : {};
          // Fill saving_acc_no from the record's own data first (fastest, no extra fetch)
          const savAccEl = document.getElementById('f-saving_acc_no');
          const shrAccEl = document.getElementById('f-share_acc_no');
          if (savAccEl && !savAccEl.value && (recData.saving_acc_no || rec.account_no)) {
            const sav = recData.saving_acc_no || rec.account_no || '';
            if (sav && !/^\d+-$/.test(sav) && !sav.endsWith('-CLOSE')) {
              savAccEl.value = sav;
              savAccEl.style.background = '#fffbe6';
              if (typeof onSavingAccNoInput === 'function') onSavingAccNoInput(sav);
            }
          }
          if (shrAccEl && !shrAccEl.value && recData.share_acc_no) {
            shrAccEl.value = recData.share_acc_no;
            shrAccEl.style.background = '#fffbe6';
          }
          // FD-OD Loan closing: pull the FD Pavati No. and the rest of the
          // FD details forward from the loan record so staff never have to
          // re-type (or mistype) the pavati number at closing time — it was
          // already captured once when the FD-OD loan was created.
          if (isClosingOd) {
            const odFdFields = {
              'f-fd_acc_no': recData.fd_acc_no,
              'f-fd_parvati_no': recData.fd_parvati_no,
              'f-fd_amount': recData.fd_amount,
              'f-fd_amount_words': recData.fd_amount_words,
              'f-fd_maturity_date': recData.fd_maturity_date,
              'f-loan_amount': recData.loan_amount,
              'f-loan_amount_words': recData.loan_amount_words,
            };
            Object.keys(odFdFields).forEach((id) => {
              const el = document.getElementById(id);
              const v2 = odFdFields[id];
              if (el && !el.value && v2 != null && v2 !== '') {
                el.value = v2;
                el.style.background = '#fffbe6';
              }
            });
          }
          // Then trigger full enrichment to get live balance + any missing fields
          const cid2 = (full && full.customer_id) || recData.customer_id || '';
          const aadh2 = (full && full.aadhar) || recData.aadhar || '';
          const mob2 = (full && full.mobile) || recData.mobile || '';
          if (cid2 || aadh2 || mob2) {
            setTimeout(() => {
              if (typeof enrichCustomerFromHistory === 'function') {
                enrichCustomerFromHistory({
                  customer_id: cid2,
                  aadhar: aadh2,
                  mobile: mob2,
                  name: (full && full.name) || rec.name || '',
                });
              }
            }, 100);
          }
        }
        if (isClosing) {
          // For closing form: show whether loan is active or already closed
          if (isClosed) {
            const sp = document.createElement("span");
            sp.style.cssText = "color:#c0392b;font-weight:700;font-size:12px;";
            sp.textContent = "🔒 Already CLOSED — " + rec.name + " · Closed on: " + (rec.closed_date || "?");
            hint.innerHTML = "";
            hint.appendChild(sp);
          } else {
            const sp = document.createElement("span");
            sp.style.cssText = "color:#27ae60;font-weight:700;font-size:12px;";
            sp.textContent = "✅ Active Loan Found — " + rec.name + " · Date: " + rec.date;
            hint.innerHTML = "";
            hint.appendChild(sp);
          }
        } else {
          // For new loan form: warn duplicate
          const statusText = isClosed ? "🔒 CLOSED" : "🟢 Active";
          const sp = document.createElement("span");
          sp.style.cssText = "color:#c0392b;font-weight:700";
          sp.textContent = "⚠️ Loan No. already exists — " + rec.name + " · " + rec.date + " · " + statusText;
          hint.innerHTML = "";
          hint.appendChild(sp);
          const prefix = v.split("-")[0];
          if (prefix) {
            const nxt = await fetch(
              "/api/records/next-loan-no/" + encodeURIComponent(prefix),
            ).then((r) => r.json());
            hint.appendChild(document.createTextNode("\u00a0\u00a0"));
            const useBtn = document.createElement("button");
            useBtn.type = "button";
            useBtn.style.cssText = "font-size:10px;background:#1a5276;color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer";
            useBtn.textContent = "Use next: " + nxt.next;
            const nextVal = nxt.next;
            useBtn.addEventListener("click", () => {
              const el = document.getElementById("f-loan_acc_no");
              if (el) { el.value = nextVal; onLoanAccNoInput(nextVal); }
            });
            hint.appendChild(useBtn);
          }
        }
      } else {
        if (isClosing) {
          const sp = document.createElement("span");
          sp.style.cssText = "color:#e67e22;font-weight:700;font-size:12px;";
          sp.textContent = "⚠️ Loan not in system — manual entry allowed, record will still save";
          hint.innerHTML = "";
          hint.appendChild(sp);
        } else {
          const sp = document.createElement("span");
          sp.style.cssText = "color:#27ae60;font-weight:700";
          sp.textContent = "✅ Loan No. is available";
          hint.innerHTML = "";
          hint.appendChild(sp);
        }
      }
    } catch (e) {
      hint.innerHTML = "";
    }
  }, 500);
}

// Pre-fill next loan number when form first loads for gold/od section.
// Calls /api/records/next-loan-no-auto which detects whether existing loans
// use the 14-digit bank format (00104003xxxxxx) or the short format (03-xxx)
// and continues from whichever is already in the database.
async function prefillNextLoanNo() {
  const el = document.getElementById("f-loan_acc_no");
  if (!el) return;
  const cur = el.value.trim();
  // Don't overwrite if user has already typed something meaningful
  if (cur && cur !== "03-" && cur !== "17-" && cur !== "") return;
  const isGold = [...(window.checked || [])].some((t) =>
    ["Gold Loan", "Gold Receipt", "Slips - Loan"].includes(t),
  );
  const section = isGold ? "gold" : "od";
  try {
    const _res = await fetch(
      "/api/records/next-loan-no-auto?section=" + section,
    );
    if (!_res.ok) return; // server down or 503 — leave field empty, user can type
    const nxt = await _res.json();
    if (nxt.next) {
      el.value = nxt.next;
      onLoanAccNoInput(nxt.next);
      // Update the field label to reflect the actual format in use
      const labelEl = document.querySelector('label[for="f-loan_acc_no"]');
      if (labelEl && nxt.format === "14digit") {
        labelEl.textContent = "Loan Acc No. (bank format)";
      } else if (labelEl) {
        labelEl.textContent = "Loan Acc No.";
      }
    }
  } catch (e) {}
}

// ── FD Acc No live check + next suggestion ──────────────────────────────────
let _fdAccTimer;
async function onFdAccNoInput(val) {
  clearTimeout(_fdAccTimer);
  const hint = document.getElementById("fd-acc-hint");
  if (!hint) return;
  hint.innerHTML = "";
  if (!val || val.trim().length < 4) return;
  const v = val.trim();
  _fdAccTimer = setTimeout(async () => {
    try {
      const chk = await fetch(
        "/api/records/check-fd-acc-no/" + encodeURIComponent(v),
      ).then((r) => r.json());
      if (chk.exists) {
        const rec = chk.record;
        const statusText = rec.status === "closed" ? "🔒 CLOSED" : "🟢 Active";
        const sp = document.createElement("span");
        sp.style.cssText = "color:#c0392b;font-weight:700";
        sp.textContent = "⚠️ FD Acc No. already exists — " + rec.name + " · " + rec.date + " · " + statusText;
        hint.innerHTML = "";
        hint.appendChild(sp);
        // BUG FIX: a plain 14-digit fd_acc_no has no dash, so split("-")[0]
        // returned the whole 14-digit number as "prefix" -- the backend
        // then crashed with a 500 trying to compute the next sequence from
        // it. Normalise to the real 8-digit prefix first (mirrors
        // onMisAccNoInput's existing v.length >= 14 guard).
        const prefix = v.length >= 14 ? v.slice(0, 8) : v.split("-")[0];
        if (prefix) {
          const nxt = await fetch(
            "/api/records/next-fd-acc-no/" + encodeURIComponent(prefix),
          ).then((r) => r.json());
          hint.appendChild(document.createTextNode("\u00a0\u00a0"));
          const useBtn = document.createElement("button");
          useBtn.type = "button";
          useBtn.style.cssText = "font-size:10px;background:#1a5276;color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer";
          useBtn.textContent = "Use next: " + nxt.next;
          const nextVal = nxt.next;
          useBtn.addEventListener("click", () => {
            const el = document.getElementById("f-fd_acc_no");
            if (el) { el.value = nextVal; onFdAccNoInput(nextVal); }
          });
          hint.appendChild(useBtn);
        }
      } else {
        const sp = document.createElement("span");
        sp.style.cssText = "color:#27ae60;font-weight:700";
        sp.textContent = "✅ FD Acc No. is available";
        hint.innerHTML = "";
        hint.appendChild(sp);
      }
    } catch (e) {
      hint.innerHTML = "";
    }
  }, 500);
}

async function prefillNextFdAccNo() {
  const el = document.getElementById("f-fd_acc_no");
  if (!el) return;
  const cur = el.value.trim();
  // Trigger when field is blank, or still has only a bare numeric prefix (6–8 digits),
  // or contains any 14-digit number (static prefill / stale value — always refresh from DB)
  const isBlankPrefix = !cur || /^\d{6,8}$/.test(cur) || /^\d{14}$/.test(cur);
  if (!isBlankPrefix) return;
  // Use the current value as prefix if it looks like a numeric prefix (6–8 digits), else default to "00103046"
  const prefix = cur && /^\d{6,8}$/.test(cur) ? cur : "00103046";
  try {
    const nxt = await fetch(API + "/next-fd-acc-no/" + prefix).then((r) => r.json());
    if (nxt.next) {
      el.value = nxt.next;
      onFdAccNoInput(nxt.next);
    }
  } catch (e) {}
}

// ── MIS Acc No live check + next suggestion ───────────────────────────────────
let _misAccTimer;
async function onMisAccNoInput(val) {
  clearTimeout(_misAccTimer);
  const hint = document.getElementById("mis-acc-hint");
  if (!hint) return;
  hint.innerHTML = "";
  if (!val || val.trim().length < 4) return;
  const v = val.trim();
  _misAccTimer = setTimeout(async () => {
    try {
      const chk = await fetch(
        "/api/records/check-mis-acc-no/" + encodeURIComponent(v),
      ).then((r) => r.json());
      if (chk.exists) {
        const rec = chk.record;
        const statusText = rec.status === "closed" ? "🔒 CLOSED" : "🟢 Active";
        const sp = document.createElement("span");
        sp.style.cssText = "color:#c0392b;font-weight:700";
        sp.textContent = "⚠️ MIS Acc No. already exists — " + rec.name + " · " + rec.date + " · " + statusText;
        hint.innerHTML = "";
        hint.appendChild(sp);
        // For 14-digit format "00103290000001" use first 8 chars as prefix; legacy "290-xxx" splits on dash
        const prefix = v.length >= 14 ? v.slice(0, 8) : v.split("-")[0];
        if (prefix) {
          const nxt = await fetch(
            "/api/records/next-mis-acc-no/" + encodeURIComponent(prefix),
          ).then((r) => r.json());
          hint.appendChild(document.createTextNode("\u00a0\u00a0"));
          const useBtn = document.createElement("button");
          useBtn.type = "button";
          useBtn.style.cssText = "font-size:10px;background:#1a5276;color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer";
          useBtn.textContent = "Use next: " + nxt.next;
          const nextVal = nxt.next;
          useBtn.addEventListener("click", () => {
            const el = document.getElementById("f-mis_acc_no");
            if (el) { el.value = nextVal; onMisAccNoInput(nextVal); }
          });
          hint.appendChild(useBtn);
        }
      } else {
        const sp = document.createElement("span");
        sp.style.cssText = "color:#27ae60;font-weight:700";
        sp.textContent = "✅ MIS Acc No. is available";
        hint.innerHTML = "";
        hint.appendChild(sp);
      }
    } catch (e) {
      hint.innerHTML = "";
    }
  }, 500);
}

async function prefillNextMisAccNo() {
  const el = document.getElementById("f-mis_acc_no");
  if (!el) return;
  const cur = el.value.trim();
  // Only auto-fill if field is empty or still has a bare stub (old "290-"/"290" or new "00103290")
  if (cur && cur !== "290-" && cur !== "290" && cur !== "00103290") return;
  try {
    const nxt = await fetch(API + "/next-mis-acc-no/00103290").then((r) => r.json());
    if (nxt.next) {
      el.value = nxt.next;
      onMisAccNoInput(nxt.next);
    }
  } catch (e) {}
}

// ── Saving Acc No next-number suggestion ────────────────────────────────
async function prefillNextSavingAccNo() {
  const el = document.getElementById("f-saving_acc_no");
  if (!el || el.value) return; // don't overwrite if already filled (existing customer)
  // If customer name is filled, enrichCustomerFromHistory is likely still fetching
  // or has already filled the acc no — only suggest for truly new customers
  const nameEl = document.getElementById("f-customer_name");
  const custId = document.getElementById("f-customer_id");
  if (custId && custId.value) return; // existing customer — their acc no is coming via enrich
  // If enrich is still in-flight (flag set by enrichCustomerFromHistory), retry once
  if (window._enrichFetching) {
    setTimeout(prefillNextSavingAccNo, 400);
    return;
  }
  try {
    const nxt = await fetch(API + "/next-saving-acc-no/43").then((r) =>
      r.json(),
    );
    if (nxt.next) {
      el.value = nxt.next;
      el.style.background = "#fffbe6";
      el.title = "Auto-suggested — confirm before submitting";
      const hint = document.getElementById("saving-acc-hint");
      if (hint)
        { const sp=document.createElement('span'); sp.style.cssText='color:#8e44ad;font-weight:600'; sp.textContent='💡 Next available: '+nxt.next+' — confirm or change'; hint.innerHTML=''; hint.appendChild(sp); }
    }
  } catch (e) {}
}

// ── Auto-fill saving acc no + balance for Saving Deposit / Withdrawal ─────────
// Looks up the customer's latest saving account record and auto-populates both
// saving_acc_no and saving_balance so staff don't need to type them manually.
async function prefillSavingAccFromHistory() {
  const accEl = document.getElementById("f-saving_acc_no");
  if (!accEl) return;
  // Don't overwrite if already filled with a real value
  if (accEl.value && !/^\d+-$/.test(accEl.value) && accEl.value.length > 4) {
    // Already has a real acc no — just trigger balance lookup
    onSavingAccNoInput(accEl.value);
    return;
  }

  const nameEl = document.getElementById("f-customer_name");
  const mobEl  = document.getElementById("f-mobile");
  const aadEl  = document.getElementById("f-aadhar");

  const nm   = (nameEl?.value || "").trim();
  const mob  = (mobEl?.value  || "").trim();
  const aadh = (aadEl?.value  || "").trim();

  // Need at least one identifier
  if (!nm && !mob && !aadh) return;

  try {
    const hint = document.getElementById("saving-acc-hint");
    if (hint) hint.innerHTML = '<span style="color:#aaa;font-size:10px">🔍 Looking up saving account…</span>';

    const params = new URLSearchParams({ section: "saving", limit: 200 });
    if (nm) params.set("q", nm);
    const { records } = await fetch(API + "?" + params).then((r) => r.json());
    if (!records || !records.length) {
      if (hint) hint.innerHTML = '<span style="color:#888;font-size:10px">No saving account found — please enter account number manually</span>';
      return;
    }

    // Score records to find best match
    const scored = records.map((r) => {
      const d = typeof r.data === "string" ? (() => { try { return JSON.parse(r.data); } catch(e) { return {}; } })() : r.data || {};
      let score = 0;
      if (nm && (r.name || "").toLowerCase() === nm.toLowerCase()) score += 5;
      else if (nm && (r.name || "").toLowerCase().includes(nm.toLowerCase())) score += 3;
      if (mob && (d.mobile || r.mobile || "") === mob) score += 3;
      if (aadh && (d.aadhar || r.aadhar || "") === aadh) score += 3;
      const accNo = d.saving_acc_no || r.account_no || "";
      // Prefer 14-digit full account numbers
      if (accNo && accNo.length === 14) score += 2;
      if (accNo && !accNo.endsWith("-CLOSE") && !/^\d+-$/.test(accNo)) score += 1;
      return { r, d, score, accNo };
    })
    .filter((x) => x.score > 0 && x.accNo && !x.accNo.endsWith("-CLOSE") && !/^\d+-$/.test(x.accNo))
    .sort((a, b) => b.score - a.score || new Date(b.r.date) - new Date(a.r.date));

    if (!scored.length) {
      if (hint) hint.innerHTML = '<span style="color:#888;font-size:10px">No saving account found — enter manually</span>';
      return;
    }

    const best = scored[0];
    const accNo = best.accNo;
    const bal   = best.r.balance ?? best.d.balance ?? best.d.saving_balance;

    // Auto-fill the account number
    accEl.value = accNo;
    accEl.style.background = "#fffbe6";
    accEl.title = "Auto-filled from last saving record — confirm before submitting";

    // Auto-fill balance if available
    const balEl = document.getElementById("f-saving_balance");
    if (balEl && (bal != null && bal !== "")) {
      balEl.value = bal;
    }

    if (hint) {
      const balStr = (bal != null && bal !== "") ? ` · Balance: ₹${Number(bal).toLocaleString("en-IN")}` : "";
      { const sp=document.createElement('span'); sp.style.cssText='color:#27ae60;font-weight:700;font-size:11px'; sp.textContent='✅ Auto-filled from DB — '+(best.r.name||'')+' · '+(best.r.date||'')+balStr; hint.innerHTML=''; hint.appendChild(sp); }
    }

    // Trigger the full balance-lookup to confirm against saving_accounts table
    onSavingAccNoInput(accNo);
  } catch (e) {
    console.warn("prefillSavingAccFromHistory error:", e.message);
  }
}

// ── Auto-fill next Customer ID (New Sadasya / New Naammatr Sabhasad) ─────
async function prefillNextCustomerId() {
  const el = document.getElementById("f-customer_id");
  if (!el || el.value) return; // don't overwrite if already filled
  try {
    const nxt = await fetch(API + "/next-customer-id").then((r) => r.json());
    if (nxt.next) {
      el.value = nxt.next;
      el.style.background = "#fffbe6";
      el.title = "Auto-suggested — confirm before submitting";
      const hint = document.getElementById("customer-id-hint");
      if (hint)
        { const sp=document.createElement('span'); sp.style.cssText='color:#8e44ad;font-weight:600'; sp.textContent='💡 Next Customer ID: '+nxt.next+' — confirm or change'; hint.innerHTML=''; hint.appendChild(sp); }
    }
  } catch (e) {}
}

// ── Auto-fill next Share Acc No (prefix: "34" = Sadasya, "36" = Naammatr) ─
async function prefillNextShareAccNo(prefix) {
  const el = document.getElementById("f-share_acc_no");
  if (!el) return;
  // Only skip if the field has a real user-entered or DB-loaded value (not a static 14-digit prefill)
  // A static prefill looks like a 14-digit number whose series matches the prefix.
  // We always fetch the live next number so it reflects actual DB state.
  const cur = (el.value || "").trim();
  const isStaticPrefill = cur.length === 14 && /^\d{14}$/.test(cur);
  if (cur && !isStaticPrefill) return; // real value already set — don't overwrite
  try {
    const nxt = await fetch(
      API + "/next-share-acc-no/" + encodeURIComponent(prefix),
      { headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } }
    ).then((r) => r.json());
    if (nxt.next) {
      el.value = nxt.next;
      el.style.background = "#fffbe6";
      el.title = "Auto-suggested — confirm before submitting";
      const hint = document.getElementById("share-acc-hint");
      if (hint)
        { const sp=document.createElement('span'); sp.style.cssText='color:#8e44ad;font-weight:600'; sp.textContent='💡 Next Share Acc: '+nxt.next+' — confirm or change'; hint.innerHTML=''; hint.appendChild(sp); }
    }
  } catch (e) {}
}

// ── Share Acc No live check — duplicate detection ─────────────────────────
let _shareAccTimer = null;
async function onShareAccNoInput(val) {
  clearTimeout(_shareAccTimer);
  const hint = document.getElementById("share-acc-hint");
  if (!hint) return;
  hint.innerHTML = "";
  const v = (val || "").trim();
  if (!v || v.length < 4) return;
  _shareAccTimer = setTimeout(async () => {
    try {
      const chk = await fetch(
        API + "/check-share-acc-no/" + encodeURIComponent(v),
        { headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } }
      ).then((r) => r.json());
      if (chk.exists) {
        const rec = chk.record;
        const status = rec.status === "closed" ? "🔒 CLOSED" : "🟢 Active";
        const sp = document.createElement('span');
        sp.style.cssText = 'color:#c0392b;font-weight:700';
        sp.textContent = '⚠️ Share Acc already exists — ' + (rec.name || rec.customer_name || '') + ' · ' + (rec.date || '') + ' · ' + status;
        hint.appendChild(sp);
        const prefix = v.length === 14 ? String(parseInt(v.substring(4, 8))) : v.split("-")[0];
        if (prefix) {
          const nxt = await fetch(
            API + "/next-share-acc-no/" + encodeURIComponent(prefix),
            { headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } }
          ).then((r) => r.json()).catch(() => ({}));
          if (nxt.next) {
            hint.appendChild(document.createTextNode("  "));
            const sp2 = document.createElement('span');
            sp2.style.cssText = 'color:#1a7a3a;font-weight:700;cursor:pointer;text-decoration:underline';
            sp2.textContent = '→ Use next: ' + nxt.next;
            sp2.onclick = () => {
              const el = document.getElementById("f-share_acc_no");
              if (el) { el.value = nxt.next; el.style.background = "#fffbe6"; }
              hint.innerHTML = '';
              const sp3 = document.createElement('span');
              sp3.style.cssText = 'color:#8e44ad;font-weight:600';
              sp3.textContent = '💡 Share Acc: ' + nxt.next + ' — confirm before submitting';
              hint.appendChild(sp3);
            };
            hint.appendChild(sp2);
          }
        }
      }
    } catch (e) {}
  }, 500);
}

// ── Saving Acc No live check — auto-populate saving balance ────────────────
let _savingAccTimer = null;
async function onSavingAccNoInput(val) {
  clearTimeout(_savingAccTimer);
  const hint = document.getElementById("saving-acc-hint");
  if (!hint) return;
  hint.innerHTML = "";
  const v = (val || "").trim();
  // BUG FIX: was < 8 which silently skipped short-format acc nos like "43-001" (6 chars).
  // 5 is safe — still filters out bare prefixes like "43-" (3 chars) without blocking real accounts.
  if (!v || v.length < 5) return;

  // If this is a new Saving Account (not deposit/withdrawal), check for duplicate
  const isNewSavingAcc =
    window.checked && [...window.checked].includes("Saving Account");
  if (isNewSavingAcc) {
    try {
      const chk = await fetch(
        "/api/records/check-saving-acc-no/" + encodeURIComponent(v),
      ).then((r) => r.json());
      if (chk.exists) {
        const rec = chk.record;
        const status = rec.status === "closed" ? "🔒 CLOSED" : "🟢 Active";
        { const sp=document.createElement('span'); sp.style.cssText='color:#c0392b;font-weight:700'; sp.textContent='⚠️ Saving Acc No. already exists — '+(rec.name||'')+' · '+(rec.date||'')+' · '+status; hint.innerHTML=''; hint.appendChild(sp); }
        // Extract prefix: for 14-digit (00110043XXXXXX) use chars 5-8 stripped of leading zeros, else dash-split
        const prefix = v.length === 14 ? String(parseInt(v.substring(4, 8))) : v.split("-")[0];
        if (prefix) {
          const nxt = await fetch(
            "/api/records/next-saving-acc-no/" + encodeURIComponent(prefix),
          )
            .then((r) => r.json())
            .catch(() => ({}));
          if (nxt.next) {
            {
              hint.appendChild(document.createTextNode('  '));
              const useBtn = document.createElement('button');
              useBtn.type = 'button';
              useBtn.style.cssText = 'font-size:10px;background:#1a5276;color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer';
              useBtn.textContent = 'Use next: ' + nxt.next;
              const _nextSav = nxt.next;
              useBtn.addEventListener('click', () => {
                const el = document.getElementById('f-saving_acc_no');
                if (el) { el.value = _nextSav; onSavingAccNoInput(_nextSav); }
              });
              hint.appendChild(useBtn);
            }
          }
        }
        return; // don't do balance lookup for duplicate
      } else {
        hint.innerHTML =
          '<span style="color:#27ae60;font-weight:700">✅ Saving Acc No. is available</span>';
        return;
      }
    } catch (e) {
      /* fall through to balance lookup */
    }
  }

  _savingAccTimer = setTimeout(async () => {
    function applyBalance(accNo, bal, customerName, status) {
      const balEl = document.getElementById("f-saving_balance");
      const accEl = document.getElementById("f-saving_acc_no");
      if (balEl) balEl.value = bal;
      if (accEl && accNo) accEl.value = accNo;
      const isClosed = status === "closed";
      const sp = document.createElement('span');
      sp.style.cssText = isClosed
        ? 'color:#c0392b;font-weight:700;font-size:11px'
        : 'color:#27ae60;font-weight:700;font-size:11px';
      sp.textContent = (isClosed ? '⚠️ Account CLOSED — ' : '✅ Balance: ₹') +
        (isClosed ? customerName : Number(bal).toLocaleString('en-IN')) +
        (isClosed ? '' : ' — ' + (customerName || ''));
      hint.innerHTML = '';
      hint.appendChild(sp);
    }

    function showSuggestions(suggestions) {
      const balEl = document.getElementById("f-saving_balance");
      if (balEl && !balEl.value) balEl.value = "0";
      hint.innerHTML = '';
      const warn = document.createElement('span');
      warn.style.cssText = 'color:#e67e22;font-weight:700;font-size:11px';
      warn.textContent = '⚠️ Account number not found. Did you mean:';
      hint.appendChild(warn);
      suggestions.forEach(s => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:3px';
        const info = document.createElement('span');
        info.style.cssText = 'font-size:10px;color:#555';
        info.textContent = s.saving_acc_no + ' — ' + s.customer_name + ' — ₹' + Number(s.balance).toLocaleString('en-IN');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'font-size:10px;background:#1a5276;color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer';
        btn.textContent = 'Use this';
        btn.addEventListener('click', () => {
          applyBalance(s.saving_acc_no, s.balance, s.customer_name, s.status);
        });
        row.appendChild(info);
        row.appendChild(btn);
        hint.appendChild(row);
      });
    }

    function setBalZero() {
      const balEl = document.getElementById("f-saving_balance");
      if (balEl && !balEl.value) balEl.value = "0";
      hint.innerHTML =
        '<span style="color:#7f8c8d;font-size:11px">No matching account found — balance set to 0</span>';
    }

    try {
      // Look up by exact acc no. If not found, retry with customer name for suggestions.
      const customerName = (document.getElementById("f-customer_name")?.value || "").trim();
      const url = API + "/saving-balance/" + encodeURIComponent(v) +
        (customerName ? "?name=" + encodeURIComponent(customerName) : "");
      const result = await fetch(url).then((r) => r.json());
      const balEl = document.getElementById("f-saving_balance");
      if (result.found) {
        applyBalance(null, result.balance, result.customer_name, result.status);
      } else if (result.suggestions && result.suggestions.length) {
        showSuggestions(result.suggestions);
      } else {
        setBalZero();
      }
    } catch (e) {
      setBalZero();
    }
  }, 600);
}

// ── Saving Acc Transfer: from/to acc no live check — parameterized version
// of onSavingAccNoInput() above, for the two independent account fields on
// the transfer form. `side` is "from" or "to". Unlike onSavingAccNoInput,
// there's no "new account duplicate check" branch — both accounts in a
// transfer are assumed to already exist. Also, unlike the regular
// Deposit/Withdrawal form (which has one customer_name field to send along
// for fuzzy-match suggestions), a transfer form has no single customer, so
// the lookup here is by account number only.
let _transferAccTimer = { from: null, to: null };
async function onTransferAccNoInput(val, side) {
  if (side !== "from" && side !== "to") return;
  clearTimeout(_transferAccTimer[side]);
  const hint = document.getElementById(side + "-saving-acc-hint");
  if (!hint) return;
  hint.innerHTML = "";
  const v = (val || "").trim();
  if (!v || v.length < 5) return;

  _transferAccTimer[side] = setTimeout(async () => {
    function applyBalance(accNo, bal, customerName, status) {
      const balEl = document.getElementById("f-" + side + "_saving_balance");
      const accEl = document.getElementById("f-" + side + "_saving_acc_no");
      if (balEl) balEl.value = bal;
      if (accEl && accNo) accEl.value = accNo;
      const isClosed = status === "closed";
      const sp = document.createElement("span");
      sp.style.cssText = isClosed
        ? "color:#c0392b;font-weight:700;font-size:11px"
        : "color:#27ae60;font-weight:700;font-size:11px";
      sp.textContent =
        (isClosed ? "⚠️ Account CLOSED — " : "✅ Balance: ₹") +
        (isClosed ? customerName : Number(bal).toLocaleString("en-IN")) +
        (isClosed ? "" : " — " + (customerName || ""));
      hint.innerHTML = "";
      hint.appendChild(sp);
    }

    function showSuggestions(suggestions) {
      hint.innerHTML = "";
      const warn = document.createElement("span");
      warn.style.cssText = "color:#e67e22;font-weight:700;font-size:11px";
      warn.textContent = "⚠️ Account number not found. Did you mean:";
      hint.appendChild(warn);
      suggestions.forEach((s) => {
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:6px;margin-top:3px";
        const info = document.createElement("span");
        info.style.cssText = "font-size:10px;color:#555";
        info.textContent =
          s.saving_acc_no +
          " — " +
          s.customer_name +
          " — ₹" +
          Number(s.balance).toLocaleString("en-IN");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.style.cssText =
          "font-size:10px;background:#1a5276;color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer";
        btn.textContent = "Use this";
        btn.addEventListener("click", () => {
          applyBalance(s.saving_acc_no, s.balance, s.customer_name, s.status);
        });
        row.appendChild(info);
        row.appendChild(btn);
        hint.appendChild(row);
      });
    }

    function setNotFound() {
      hint.innerHTML =
        '<span style="color:#e67e22;font-weight:700;font-size:11px">⚠️ Account not found</span>';
    }

    try {
      const url = API + "/saving-balance/" + encodeURIComponent(v);
      const result = await fetch(url).then((r) => r.json());
      if (result.found) {
        applyBalance(null, result.balance, result.customer_name, result.status);
      } else if (result.suggestions && result.suggestions.length) {
        showSuggestions(result.suggestions);
      } else {
        setNotFound();
      }
    } catch (e) {
      setNotFound();
    }
  }, 600);
}

// Calculate FD maturity amount AND maturity date from principal, period (months), rate (%)
// Uses simple interest: maturity = P + P*R*T/100  where T = period/12 years
// Maturity date = transaction date + period months
// Only runs for New FD transactions — NOT for MIS Interest
function calcFdMaturity() {
  const isMisType = _fdSubIsMis();
  const principal =
    parseFloat(document.getElementById("f-fd_amount")?.value) || 0;
  const period = parseFloat(document.getElementById("f-fd_period")?.value) || 0;
  const rate =
    parseFloat(document.getElementById("f-fd_interest_rate")?.value) || 0;

  // Maturity date: transaction date + period months. FIX: this used to be
  // skipped for every MIS-type FD because the old `if (isMisType) return;`
  // guard sat above this whole function — but that guard was meant to stop
  // the maturity-AMOUNT recalc on a follow-up "MIS Interest" payment, not to
  // block the maturity-DATE calc on a brand-new MIS Special FD (which is a
  // completely normal "New FD" case, e.g. "MIS Special – 15 Months – 9%").
  // Maturity date is a property of the FD account itself, so it should be
  // set for every FD type, new or follow-up, Term or MIS.
  const dateEl = document.getElementById("f-date");
  const matDateEl = document.getElementById("f-fd_maturity_date");
  if (matDateEl && period > 0) {
    const txDateStr = dateEl ? dateEl.value : "";
    const txDate = txDateStr ? new Date(txDateStr) : new Date();
    if (!isNaN(txDate.getTime())) {
      const matDate = new Date(txDate);
      matDate.setMonth(matDate.getMonth() + Math.round(period));
      matDateEl.value = matDate.toISOString().split("T")[0];
    }
  }

  // Maturity amount — MIS FDs pay interest out monthly instead of compounding
  // into a lump sum at maturity, so this recalc (and the follow-up "MIS
  // Interest" transaction that used to trigger the same over-broad guard)
  // correctly stays skipped for MIS-type FDs. Only this section is gated.
  if (isMisType) return;
  if (!principal || !period || !rate) return;
  const interest = (((principal * rate) / 100) * period) / 12;
  const maturity = Math.round(principal + interest);
  const matEl = document.getElementById("f-fd_maturity_amount");
  const matWrdEl = document.getElementById("f-fd_maturity_words");
  if (matEl) {
    matEl.value = maturity;
    if (matWrdEl)
      matWrdEl.value = maturity > 0 ? convertNumberToWords(maturity) : "";
  }
}

function autoFillWords(srcFieldId, val) {
  const amt = parseFloat(val) || 0;
  const words = amt > 0 ? convertNumberToWords(amt) : "";
  const wordsMap = {
    loan_amount: "loan_amount_words",
    fd_amount: "fd_amount_words",
    fd_maturity_amount: "fd_maturity_words",
    deposit_amount: "deposit_amount_words",
    expense_amount: "expense_amount_words",
    interest_amount: "interest_amount_words",
  };
  // For MIS Interest: maturity amount = fd_amount (principal returned unchanged)
  if (srcFieldId === "fd_amount") {
    const isMisType = _fdSubIsMis();
    if (isMisType) {
      const matEl = document.getElementById("f-fd_maturity_amount");
      const matWrdEl = document.getElementById("f-fd_maturity_words");
      if (matEl) matEl.value = val;
      if (matWrdEl && amt > 0) matWrdEl.value = words;
    }
  }
  // For New FD: trigger maturity recalc when amount, period, or rate changes
  if (
    srcFieldId === "fd_amount" ||
    srcFieldId === "fd_period" ||
    srcFieldId === "fd_interest_rate"
  ) {
    calcFdMaturity();
  }
  const targetId = wordsMap[srcFieldId];
  if (targetId) {
    const el = document.getElementById("f-" + targetId);
    if (el) el.value = words;
  }
}

function misCombineMonthYear(fieldId) {
  const m = document.getElementById("f-" + fieldId + "-month")?.value || "";
  const y = document.getElementById("f-" + fieldId + "-year")?.value || "";
  const hidden = document.getElementById("f-" + fieldId);
  if (hidden) hidden.value = m && y ? m + "-" + y : m || y || "";
}

function onPhoto(fid, inp) {
  if (!inp.files[0]) return;
  const file = inp.files[0];
  // Snapshot which form generation this upload belongs to — if the form
  // gets cleared/rebuilt before compression finishes, the callback below
  // will detect the mismatch and bail out instead of writing into a new,
  // unrelated form that happens to reuse the same field id.
  const gen = _photoFormGen;

  // Create image to get dimensions
  const img = new Image();
  const r = new FileReader();
  r.onload = (e) => {
    img.onload = () => {
      if (gen !== _photoFormGen) return; // stale — a new form has since been opened
      // Compress image: max 1200px, quality 0.8 for print clarity
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      
      // Calculate new dimensions maintaining aspect ratio
      if (w > 1200) {
        h = Math.round(h * (1200 / w));
        w = 1200;
      }
      
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      
      // Convert to compressed JPEG (0.8 quality)
      const compressed = canvas.toDataURL('image/jpeg', 0.8);
      
      if (gen !== _photoFormGen) return; // re-check — compression itself can take a beat
      photos[fid] = compressed;
      const b = document.getElementById("pbox-" + fid);
      if (b) b.innerHTML = _photoBoxFilledHtml(fid, compressed);
    };
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
}

// Builds the "photo already attached" markup for a photo box: the preview
// image, an invisible full-overlay file input to replace it (unchanged
// behavior), and a small ✕ button to clear it outright. The ✕ stops the
// click from reaching the file input underneath it, so tapping it never
// opens the camera/file picker — it just removes the photo.
function _photoBoxFilledHtml(fid, src) {
  return (
    '<img src="' + src + '">' +
    '<input type="file" aria-label="Replace photo" accept="image/*" capture="environment" onchange="onPhoto(\'' + fid + '\',this)" style="position:absolute;inset:0;opacity:0;cursor:pointer;z-index:2">' +
    '<button type="button" aria-label="Clear photo" title="Clear photo" onclick="event.stopPropagation();clearPhoto(\'' + fid + '\')" style="position:absolute;top:4px;right:4px;z-index:3;width:22px;height:22px;line-height:20px;border-radius:50%;border:none;background:rgba(0,0,0,.65);color:#fff;font-size:14px;font-weight:700;cursor:pointer;padding:0">×</button>'
  );
}

// Clears a photo that was accidentally attached (freshly uploaded, or
// pre-filled from a saved record / customer history) and resets the box
// back to its normal empty "Tap to add" state so staff must attach a fresh,
// correct photo before saving.
function clearPhoto(fid) {
  delete photos[fid];
  const pbox = document.getElementById("pbox-" + fid);
  if (pbox) {
    pbox.style.border = "";
    pbox.style.background = "";
    pbox.innerHTML =
      '<div class="ph-hint"><div class="ph-icon">📷</div><div class="ph-lbl">Tap to add</div></div>' +
      '<input type="file" aria-label="Upload photo" accept="image/*" capture="environment" onchange="onPhoto(\'' + fid + '\',this)">';
  }
}

function collect() {
  const d = {};
  SECTIONS.forEach((s) =>
    s.fields.forEach((f) => {
      if (f.type === "photo") {
        d[f.id] = photos[f.id] || null;
        return;
      }
      if (f.type === "ornament_items") {
        const items = ornGetItems();
        d.ornament_items = items.length ? items : null;
        const _totalQty = items.reduce((s, r) => s + (parseInt(r.qty) || 0), 0);
        const _totalWt = items.reduce(
          (s, r) => s + (parseFloat(r.weight) || 0),
          0,
        );
        const hasAnyWeight = items.some(
          (r) => r.weight !== null && r.weight !== undefined,
        );
        d.ornament_qty = items.length ? _totalQty : null;
        d.ornament_weight = items.length && hasAnyWeight ? _totalWt : null;
        d.gold_ornaments =
          items
            .filter(
              (r) =>
                !r.name.toLowerCase().includes("silver") &&
                !r.name.includes("चांदी"),
            )
            .map((r) => r.name)
            .join(", ") || null;
        d.silver_ornaments =
          items
            .filter(
              (r) =>
                r.name.toLowerCase().includes("silver") ||
                r.name.includes("चांदी"),
            )
            .map((r) => r.name)
            .join(", ") || null;
        return;
      }
      const el = document.getElementById("f-" + f.id);
      if (el) d[f.id] = el.value;
    }),
  );
  return d;
}

// ═══════════════════════════════════════
//  SAVE + PDF
// ═══════════════════════════════════════

// FIX: _fetchWithTimeout was defined inside saveAndPDF() making it unavailable
// to module-level functions like addCashbookRows() — moved to module scope.
function _fetchWithTimeout(url, opts, ms) {
  ms = ms || 20000;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
    .finally(() => clearTimeout(tid));
}

async function saveAndPDF() {
  // Re-entrancy guard: if a save is already in flight (e.g. rapid double-click),
  // do nothing.  window._saveInProgress is cleared in every exit path below.
  if (window._saveInProgress) return;
  window._saveInProgress = true;
  const saveBtn = document.querySelector(".btn-main");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ Saving…";
  }
  // Safety net: if anything hangs, re-enable button after 30s so user is never stuck
  const _saveBtnTimeout = setTimeout(() => {
    if (saveBtn && saveBtn.disabled) {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 Save & PDF";
      toast("Save timed out — please check the record and try again", "err");
    }
    window._saveInProgress = false;
  }, 90000);
  // Helper: abort save and re-enable button (always clears the safety timeout)
  function _abortSave(msg) {
    if (msg) toast(msg, "err");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 Save & PDF";
    }
    clearTimeout(_saveBtnTimeout);
    window._saveInProgress = false;
  }

  if (!checked.size) {
    _abortSave("Select at least one type");
    return;
  }
  if (window._dupAccountViolation) {
    _abortSave(window._dupAccountViolation);
    return;
  }
  let formData = collect();
  const txArr = [...checked];

  const data = formData;
  // Determine section first to decide validation rules
  let section = "general";
  for (const g of GROUPS) {
    if (txArr.some((t) => g.types.includes(t))) {
      section = g.section;
      break;
    }
  }
  // Gold Loan always takes priority for section regardless of GROUPS order
  if (txArr.includes("Gold Loan") && section !== "gold") {
    section = "gold";
  }
  // New Sadasya / New Naammatr Sabhasad always store as section='membership'
  // (unless combined with a Gold/OD/FD loan that already owns the section)
  if (
    !["gold", "od", "fd"].includes(section) &&
    (txArr.includes("New Sadasya") || txArr.includes("New Naammatr Sabhasad"))
  ) {
    section = "membership";
  }
  // ── Field validations — warn staff but allow override via confirm() ──
  // Hard blocks (no bypass): selecting zero tx types.
  // Soft blocks (bypassable): missing field values — staff can confirm to proceed.
  function _warnOrAbort(msg, focusId) {
    toast(msg, "err");
    if (focusId) document.getElementById(focusId)?.focus();
    return !window.confirm("⚠️ " + msg + "\n\nClick OK to save anyway, or Cancel to go back and fix it.");
  }

  // BUG FIX (caught in testing): "Saving Acc Transfer" has no single
  // data.customer_name — it identifies two different members by their
  // from/to account numbers instead (see the from/to fields below). Without
  // this exemption every transfer save would trip the "Customer Name is
  // required" warning, since that field is never collected on this form.
  const noNameRequired =
    ["office", "bank"].includes(section) ||
    txArr.includes("Saving Acc Transfer");
  if (!data.customer_name && !noNameRequired) {
    if (_warnOrAbort("Customer Name is required")) { _abortSave(); return; }
  }
  if (section === "gold" || section === "od") {
    if (!data.loan_acc_no) {
      if (_warnOrAbort("Loan Acc No is required", "f-loan_acc_no")) { _abortSave(); return; }
    }
    if (!data.loan_amount) {
      if (_warnOrAbort("Loan Amount is required", "f-loan_amount")) { _abortSave(); return; }
    }
  }
  if (section === "od" && txArr.includes("New FD-OD Loan")) {
    if (!data.fd_acc_no) {
      if (_warnOrAbort("FD Account is required — check at least one FD to secure this OD loan", "f-fd_acc_no")) { _abortSave(); return; }
    }
    if (!data.fd_amount) {
      if (_warnOrAbort("FD Amount is required", "f-fd_amount")) { _abortSave(); return; }
    }
  }
  if (section === "fd") {
    const isNewFd = txArr.some((t) => ["New FD", "New FD - Term"].includes(t));
    const isMisType = _fdSubIsMis();
    const isTermType = !isMisType;
    const isClosingFd = txArr.includes("Closing - FD");
    if (isNewFd && !data.fd_sub_type) {
      if (_warnOrAbort("Please select an FD Type (e.g. 13 Months FD – 10%)", "f-fd_sub_type")) { _abortSave(); return; }
    }
    if (isClosingFd && !data.fd_acc_no && !data.mis_acc_no) {
      if (_warnOrAbort("FD or MIS Acc No is required to close")) { _abortSave(); return; }
    }
    // Warn (bypassable) if this FD is currently securing an active FD-OD
    // loan — closing it would leave that loan without its collateral.
    if (isClosingFd && data.fd_acc_no) {
      try {
        const _fdLinked = await fetch(
          API + "/fd-linked-od-loans/" + encodeURIComponent(data.fd_acc_no),
        ).then((r) => r.json());
        if (_fdLinked && _fdLinked.loans && _fdLinked.loans.length) {
          const _odNames = _fdLinked.loans
            .map((l) => l.loan_acc_no + (l.customer_name ? " (" + l.customer_name + ")" : ""))
            .join(", ");
          if (
            _warnOrAbort(
              "This FD (Acc " +
                data.fd_acc_no +
                ") is securing an active FD-OD Loan — " +
                _odNames +
                ". Closing this FD will leave that loan without collateral.",
              "f-fd_acc_no",
            )
          ) {
            _abortSave();
            return;
          }
        }
      } catch (e) {
        console.warn("[fd-od-link-check] lookup failed:", e.message);
      }
    }
    if (!isMisType && !isClosingFd && !data.fd_acc_no) {
      if (_warnOrAbort("FD Acc No is required", "f-fd_acc_no")) { _abortSave(); return; }
    }
    if (isMisType && !data.mis_acc_no) {
      if (_warnOrAbort("MIS Acc No is required", "f-mis_acc_no")) { _abortSave(); return; }
    }
    if (!isMisType && !isClosingFd && !data.fd_amount) {
      if (_warnOrAbort("FD Amount is required", "f-fd_amount")) { _abortSave(); return; }
    }
  }
  const _isSavingAccTransfer = txArr.includes("Saving Acc Transfer");
  const _needsSavingAcc =
    section === "saving" ||
    txArr.includes("Saving Account") ||
    txArr.includes("New Sadasya") ||
    txArr.includes("New Naammatr Sabhasad");
  if (_needsSavingAcc) {
    // Saving Acc Transfer uses its own from_saving_acc_no/to_saving_acc_no
    // fields instead of the single saving_acc_no field every other saving
    // tx type uses — skip this check for it (validated separately below).
    if (!data.saving_acc_no && !_isSavingAccTransfer) {
      if (_warnOrAbort("Saving Acc No is required", "f-saving_acc_no")) { _abortSave(); return; }
    }
    const isDepWd = txArr.some((t) =>
      [
        "Saving Deposit",
        "Saving Withdrawal",
        "Saving - Deposit Slip",
        "Saving - Withdrawal Slip",
      ].includes(t),
    );
    if (isDepWd && !data.deposit_amount) {
      if (_warnOrAbort("Deposit / Withdrawal Amount is required", "f-deposit_amount")) { _abortSave(); return; }
    }
    // Warn (bypassable) if a Saving Withdrawal amount exceeds the account's
    // known balance — staff can still confirm to proceed (e.g. balance not
    // yet loaded, or an authorized overdraft-style exception).
    const isWithdrawalTx = txArr.some((t) =>
      ["Saving Withdrawal", "Saving - Withdrawal Slip"].includes(t),
    );
    if (isWithdrawalTx && data.deposit_amount) {
      const _wdAmt = parseFloat(data.deposit_amount) || 0;
      const _wdBal =
        data.saving_balance != null && data.saving_balance !== ""
          ? parseFloat(data.saving_balance)
          : null;
      if (_wdBal != null && !isNaN(_wdBal) && _wdAmt > _wdBal) {
        if (
          _warnOrAbort(
            "Withdrawal amount ₹" +
              _wdAmt.toLocaleString("en-IN") +
              " exceeds available balance ₹" +
              _wdBal.toLocaleString("en-IN"),
            "f-deposit_amount",
          )
        ) {
          _abortSave();
          return;
        }
      }
    }
  }
  if (_isSavingAccTransfer) {
    if (!data.from_saving_acc_no) {
      if (_warnOrAbort("From Saving Acc No is required", "f-from_saving_acc_no")) { _abortSave(); return; }
    }
    if (!data.to_saving_acc_no) {
      if (_warnOrAbort("To Saving Acc No is required", "f-to_saving_acc_no")) { _abortSave(); return; }
    }
    if (
      data.from_saving_acc_no &&
      data.to_saving_acc_no &&
      data.from_saving_acc_no.trim() === data.to_saving_acc_no.trim()
    ) {
      if (_warnOrAbort("From and To Saving Acc No cannot be the same account", "f-to_saving_acc_no")) { _abortSave(); return; }
    }
    const _trAmt = parseFloat(data.transfer_amount) || 0;
    if (_trAmt <= 0) {
      if (_warnOrAbort("Transfer Amount is required", "f-transfer_amount")) { _abortSave(); return; }
    }
    // Warn (bypassable) if the transfer exceeds the from-account's known
    // balance — mirrors the Saving Withdrawal over-balance warning above.
    const _trFromBal =
      data.from_saving_balance != null && data.from_saving_balance !== ""
        ? parseFloat(data.from_saving_balance)
        : null;
    if (_trFromBal != null && !isNaN(_trFromBal) && _trAmt > _trFromBal) {
      if (
        _warnOrAbort(
          "Transfer amount ₹" +
            _trAmt.toLocaleString("en-IN") +
            " exceeds available balance ₹" +
            _trFromBal.toLocaleString("en-IN") +
            " on the From account",
          "f-transfer_amount",
        )
      ) {
        _abortSave();
        return;
      }
    }
  }
  // ── Pre-save duplicate account number checks ─────────────────────────────
  // Block saves (not closings) if the account number already exists as active.
  const isClosing = txArr.some((t) => t.startsWith("Closing"));
  const isNewAccount =
    !isClosing &&
    txArr.some((t) =>
      [
        "Gold Loan",
        "New FD",
        "New FD - Term",
        "New FD - MIS",
        "Fixed Deposit",
        "New FD-OD Loan",
        "Saving Account",
        "New Sadasya",
        "New Naammatr Sabhasad",
      ].includes(t),
    );

  if (isNewAccount) {
    try {
      // Gold / OD loan account number
      if ((section === "gold" || section === "od") && data.loan_acc_no) {
        // BUG FIX: this used to always call check-loan-no (gold_loans only),
        // so a duplicate OD account number was never actually detected —
        // check-loan-no never queries od_loans.loan_acc_no. Route by section
        // to the endpoint that actually knows about that table, and use the
        // 14-digit-aware next-loan-no-auto for the suggestion (the legacy
        // dash-format next-loan-no doesn't apply to OD's 14-digit numbers).
        const checkUrl =
          section === "od"
            ? "/api/records/check-od-acc-no/"
            : "/api/records/check-loan-no/";
        const chk = await fetch(
          checkUrl + encodeURIComponent(data.loan_acc_no),
        ).then((r) => r.json());
        if (chk.exists && chk.record.status === "active") {
          const r = chk.record;
          const next = await fetch(
            "/api/records/next-loan-no-auto?section=" + section,
          )
            .then((r) => r.json())
            .catch(() => ({}));
          const useNext = next.next ? `\n\nNext available: ${next.next}` : "";
          toast(
            `⚠️ Loan No. ${data.loan_acc_no} already exists — ${r.name} · ${r.date}${useNext}`,
            "err",
          );
          document.getElementById("f-loan_acc_no")?.focus();
          _abortSave();
          return;
        }
      }
      // FD account number
      if (
        section === "fd" &&
        data.fd_acc_no &&
        !txArr.includes("MIS Interest") &&
        !_fdSubIsMis() &&
        !txArr.includes("Closing - FD")
      ) {
        const chk = await fetch(
          "/api/records/check-fd-acc-no/" + encodeURIComponent(data.fd_acc_no),
        ).then((r) => r.json());
        if (chk.exists && chk.record.status === "active") {
          const r = chk.record;
          toast(
            `⚠️ FD Acc No. ${data.fd_acc_no} already exists — ${r.name} · ${r.date}`,
            "err",
          );
          document.getElementById("f-fd_acc_no")?.focus();
          _abortSave();
          return;
        }
      }
      // MIS account number
      if (
        section === "fd" &&
        data.mis_acc_no &&
        (txArr.includes("MIS Interest") || _fdSubIsMis())
      ) {
        const chk = await fetch(
          "/api/records/check-mis-acc-no/" +
            encodeURIComponent(data.mis_acc_no),
        )
          .then((r) => r.json())
          .catch(() => ({ exists: false }));
        if (chk.exists && chk.record.status === "active") {
          const r = chk.record;
          toast(
            `⚠️ MIS Acc No. ${data.mis_acc_no} already exists — ${r.name} · ${r.date}`,
            "err",
          );
          document.getElementById("f-mis_acc_no")?.focus();
          _abortSave();
          return;
        }
      }
      // Saving account number (new account only, not deposit/withdrawal)
      const _hasSavingOrSadasya =
        txArr.includes("Saving Account") ||
        txArr.includes("New Sadasya") ||
        txArr.includes("New Naammatr Sabhasad");
      // Skip saving acc duplicate check when Gold Loan is present — the saving acc
      // is being referenced for the loan, not necessarily being created fresh.
      // An existing customer opening a Gold Loan will always have an existing saving acc.
      const _skipSavingDupCheck = txArr.includes("Gold Loan");
      if (
        !_skipSavingDupCheck &&
        (section === "saving" || _hasSavingOrSadasya) &&
        data.saving_acc_no &&
        _hasSavingOrSadasya
      ) {
        const chk = await fetch(
          "/api/records/check-saving-acc-no/" +
            encodeURIComponent(data.saving_acc_no),
        )
          .then((r) => r.json())
          .catch(() => ({ exists: false }));
        if (chk.exists && chk.record.status === "active") {
          const r = chk.record;
          toast(
            `⚠️ Saving Acc No. ${data.saving_acc_no} already exists — ${r.name} · ${r.date}`,
            "err",
          );
          document.getElementById("f-saving_acc_no")?.focus();
          _abortSave();
          return;
        }
      }
      // Customer ID duplicate check (for new customers only)
      if (data.customer_id && /^\d{10}$/.test(data.customer_id.trim())) {
        const chk = await fetch(
          "/api/records/check-customer-id/" +
            encodeURIComponent(data.customer_id.trim()),
        )
          .then((r) => r.json())
          .catch(() => ({ exists: false }));
        if (chk.exists) {
          // Warn but don't block — same customer can have multiple transactions
          const c = chk.customer;
          const hint = document.getElementById("cust-id-hint");
          if (hint)
            { const sp=document.createElement('span'); sp.style.cssText='color:#e67e22;font-weight:700;font-size:11px'; sp.textContent='ℹ️ Customer '+(c.name||'')+' already registered — using existing record'; hint.innerHTML=''; hint.appendChild(sp); }
        }
      }
    } catch (e) {
      console.warn("Pre-save duplicate check failed:", e.message);
      // Don't block save on network error — just proceed
    }
  }

  // ── Pre-save duplicate check for Closing - Loan ───────────────────────────
  // The DB constraint idx_records_unique_gold_acc rejects a second closing row
  // for the same loan_acc_no.  The old check only blocked when status === "closed",
  // but the constraint fires even when the original record is still "active" if a
  // closing record row already exists (e.g. from a previous failed attempt).
  // Fix: block if ANY record exists for this loan_acc_no that already contains
  // "Closing - Loan" in its tx_types, OR if the loan status is already "closed".
  if (txArr.includes("Closing - Loan") && data.loan_acc_no) {
    try {
      const chk = await fetch(
        "/api/records/check-loan-no/" + encodeURIComponent(data.loan_acc_no),
      )
        .then((r) => r.json())
        .catch(() => ({}));
      if (chk.exists) {
        const rec = chk.record || {};
        const recTxTypes = rec.tx_types || [];
        const recClosedTx = rec.closed_tx_types || rec.closedTxTypes || "";
        const alreadyClosed = rec.status === "closed";
        const closingRecordExists =
          Array.isArray(recTxTypes)
            ? recTxTypes.includes("Closing - Loan")
            : String(recTxTypes).includes("Closing - Loan");
        // Also check closed_tx_types: if "Gold Loan" is already closed via the PATCH
        // (done before opening the form), a second POST will hit the unique constraint.
        // Exception: window._closingRecId means THIS is the intended submission from the
        // pre-filled form — the PATCH already ran, we still need to POST the closing record.
        const goldAlreadyClosed =
          String(recClosedTx).includes("Gold Loan") && !window._closingRecId;
        // FIX: do NOT block just because loan is 'closed' — staff may manually
        // enter a closing form for an already-closed loan. Only block if a
        // closing record already exists to prevent true duplicates.
        if (closingRecordExists || goldAlreadyClosed) {
          toast(
            `⚠️ Loan ${data.loan_acc_no} already has a closing record — duplicate submission blocked.`,
            "err",
          );
          _abortSave();
          // If the loan is already closed it means a previous submission succeeded.
          // Navigate home so the form doesn't stay stuck on screen.
          if (alreadyClosed || closingRecordExists) {
            setTimeout(() => { try { showPage("home"); clearForm(); loadDashboard(); loadDB(); } catch(e) {} }, 600);
          }
          return;
        }
      }
      // Secondary search: look for an existing Closing - Loan record by account_no.
      // Uses account_no filter (not q= text search) for exact match.
      // Skip if window._closingRecId is set — that means this IS the intended submission.
      if (!window._closingRecId) {
        const closingSearch = await fetch(
          API + "?section=gold&account_no=" + encodeURIComponent(data.loan_acc_no) + "&limit=50"
        ).then((r) => r.json()).catch(() => ({ records: [] }));
        const closingRecords = (closingSearch.records || closingSearch || []);
        const hasExistingClosing = closingRecords.some(function(r) {
          const rTypes = r.tx_types || [];
          const matchesAcc = r.account_no === data.loan_acc_no;
          const isClosingType = Array.isArray(rTypes)
            ? rTypes.includes("Closing - Loan")
            : String(rTypes).includes("Closing - Loan");
          return matchesAcc && isClosingType;
        });
        if (hasExistingClosing) {
          toast(
            `⚠️ Loan ${data.loan_acc_no} already has a closing record — duplicate submission blocked.`,
            "err",
          );
          _abortSave();
          // Navigate home — the closing already succeeded on a prior submit.
          setTimeout(() => { try { showPage("home"); clearForm(); loadDashboard(); loadDB(); } catch(e) {} }, 600);
          return;
        }
      }
    } catch (e) {
      console.warn("Closing duplicate check failed:", e.message);
      // Don't block on network error — proceed and let DB constraint handle it
    }
  }

  const dbData = { ...data };

  // ── Build pdfTxArr and generate PDF NOW (before any awaits) so popup isn't blocked ──
  let pdfTxArr = [...txArr];
  if (txArr.includes("Gold Loan") && !txArr.includes("Slips - Loan")) {
    pdfTxArr = pdfTxArr
      .map((t) =>
        t === "Gold Loan" ? ["Gold Loan", "Slips - Loan", "Gold Receipt", "Blank Page"] : [t],
      )
      .flat();
  }
  if (txArr.includes("New FD-OD Loan")) {
    pdfTxArr = pdfTxArr
      .map((t) =>
        t === "New FD-OD Loan" ? ["New FD-OD Loan", "Slips - FD-OD"] : [t],
      )
      .flat();
  }
  if (txArr.includes("New FD") || txArr.includes("New FD - Term")) {
    const isMis = _fdSubIsMis();
    pdfTxArr = pdfTxArr
      .map((t) =>
        (t === "New FD" || t === "New FD - Term")
          ? (isMis ? ["Fixed Deposit - MIS", "FD - Slips - MIS", "Form 60-61"] : ["Fixed Deposit", "FD - Slips", "Form 60-61"])
          : [t],
      )
      .flat();
  }
  if (txArr.includes("New FD - MIS")) {
    pdfTxArr = pdfTxArr
      .map((t) =>
        t === "New FD - MIS" ? ["Fixed Deposit - MIS", "FD - Slips - MIS", "Form 60-61"] : [t],
      )
      .flat();
  }
  if (txArr.includes("MIS Interest")) {
    pdfTxArr = pdfTxArr
      .map((t) => (t === "MIS Interest" ? ["MIS Interest - Slips"] : [t]))
      .flat();
  }
  if (
    txArr.includes("Closing - FD") &&
    !txArr.includes("Closing - FD - Slips")
  ) {
    pdfTxArr = pdfTxArr
      .map((t) =>
        t === "Closing - FD" ? ["Closing - FD", "Closing - FD - Slips"] : [t],
      )
      .flat();
  }
  if (txArr.includes("New Sadasya")) {
    pdfTxArr = pdfTxArr
      .map((t) => (t === "New Sadasya" ? ["Sadasya", "Sadasya - Slips"] : [t]))
      .flat();
    // Also include saving deposit slip if saving_balance is set
    if (data && data.saving_balance && Number(data.saving_balance) > 0) {
      pdfTxArr.push("Saving - Deposit Slip");
    }
  }
  if (txArr.includes("New Naammatr Sabhasad")) {
    pdfTxArr = pdfTxArr
      .map((t) =>
        t === "New Naammatr Sabhasad"
          ? ["Naammatr Sabhasad Account", "Naammatr Sabhasad - Slips"]
          : [t],
      )
      .flat();
  }
  if (
    txArr.includes("Saving Account") &&
    !txArr.includes("Saving - Deposit Slip")
  ) {
    const _isFdContext = txArr.some((t) => ["New FD", "New FD - Term", "New FD - MIS", "Fixed Deposit"].includes(t));
    pdfTxArr = pdfTxArr
      .map((t) =>
        t === "Saving Account"
          ? (_isFdContext ? ["Saving Account", "Saving - Deposit Slip", "Blank Page"] : ["Saving Account", "Saving - Deposit Slip"])
          : [t],
      )
      .flat();
  }
  // Saving Deposit → Saving - Deposit Slip (with bank copy + customer copy)
  if (
    txArr.includes("Saving Deposit") &&
    !txArr.includes("Saving - Deposit Slip")
  ) {
    pdfTxArr = pdfTxArr
      .map((t) =>
        t === "Saving Deposit" ? ["Saving - Deposit Slip"] : [t],
      )
      .flat();
  }
  // Saving Withdrawal → Saving - Withdrawal Slip (with bank copy + customer copy)
  if (
    txArr.includes("Saving Withdrawal") &&
    !txArr.includes("Saving - Withdrawal Slip")
  ) {
    pdfTxArr = pdfTxArr
      .map((t) =>
        t === "Saving Withdrawal" ? ["Saving - Withdrawal Slip"] : [t],
      )
      .flat();
  }
  // Closing - Loan embeds its own slip inside loanClosing_FormPage — strip any
  // standalone Slips - Loan to avoid a duplicate 4th page.
  if (txArr.includes("Closing - Loan")) {
    pdfTxArr = pdfTxArr.filter((t) => t !== "Slips - Loan");
  }
  // For saving deposit/withdrawal, defer PDF generation until after
  // processTransaction so we use the live DB balance, not the stale form value.
  const _isSavingTx = txArr.includes('Saving Deposit') || txArr.includes('Saving Withdrawal');
  // Saving Acc Transfer also needs to wait — its voucher shows both accounts'
  // post-transfer balances, which only exist once processTransaction has run.
  // (_isSavingAccTransfer itself is declared earlier, in the validation block above.)
  if (!_isSavingTx && !_isSavingAccTransfer) {
    try { generateTemplatePDF(pdfTxArr, data); } catch(e) { console.warn('PDF generation error:', e.message); }
  }

  // For gold/od loans, use loan_acc_no as the primary account_no.
  // For FD/MIS, fd_acc_no must come BEFORE saving_acc_no — otherwise a customer
  // that also has a saving account will store the wrong number in records.account_no
  // and all dashboard JOINs will break.
  // BUG FIX: Closing - Loan / Closing - OD records must NOT reuse loan_acc_no as
  // account_no — the original loan record already owns that value and the unique
  // index (idx_records_unique_gold_acc) blocks a second row with the same account_no.
  // account_no is NOT NULL so we can't use null — append "-C" to make it unique
  // while keeping it traceable to the original loan.
  const isClosingRecord =
    txArr.includes("Closing - Loan") || txArr.includes("Closing - OD");
  // BUG FIX: the "bank" section (RTGS, Bank Charges, TDS, Other Bank - Cash
  // Withdrawal/Deposit) has no saving_acc_no/account_no field on its form —
  // those types only collect expense_acc_no (a manually-typed ledger code)
  // and/or rtgs_to_acc/rtgs_from_acc. Without this branch primaryAccNo fell
  // through to the saving_acc_no fallback below, which is always empty for
  // these types, so account_no was sent as "" → the backend does
  // `account_no || null` → INSERT fails with a NOT NULL violation (records
  // table has no default), silently dropping the whole transaction. Fall
  // back through every field that could plausibly hold a real account
  // reference for these types, and — since account_no truly has no natural
  // value here — end with a synthetic-but-traceable placeholder so a save
  // can never hard-crash even if every one of those fields is left blank.
  // BUG FIX (caught in testing): "Saving Acc Transfer" has no data.saving_acc_no
  // (it uses from_saving_acc_no/to_saving_acc_no instead) — the fallback chain
  // below would have resolved to "" for every transfer record. An empty
  // account_no isn't a NOT-NULL violation by itself (the column defaults to
  // ''), but idx_records_unique_saving_acc is a UNIQUE index on account_no
  // for section='saving' rows — so the FIRST transfer would save fine and
  // EVERY transfer after it would collide on that same empty string and fail
  // outright. Use the debited (from) account as the primary reference instead,
  // matching how every other section already picks one real account number.
  const primaryAccNo = isClosingRecord
    ? (data.loan_acc_no ? data.loan_acc_no + "-C" : data.account_no || "")
    : section === "gold" || section === "od"
      ? data.loan_acc_no || data.account_no || ""
      : section === "fd"
        ? data.fd_acc_no || data.mis_acc_no || data.account_no || ""
        : section === "bank"
          ? data.expense_acc_no ||
            data.rtgs_to_acc ||
            data.rtgs_from_acc ||
            data.fd_acc_no ||
            data.saving_acc_no ||
            data.account_no ||
            ("BANK-" + (txArr[0] || "TX").replace(/[^A-Za-z0-9]+/g, "-") + "-" + Date.now())
          : txArr.includes("Saving Acc Transfer")
            ? data.from_saving_acc_no || data.to_saving_acc_no || data.account_no || ""
            : data.saving_acc_no || data.account_no || "";
  // BUG FIX (caught in testing): the backend's create() rejects any non-bank
  // record with an empty name ("Customer name is required", a hard 400 — see
  // records.controller.js). A transfer has no single data.customer_name, so
  // every transfer save would have failed at the API call, not just shown a
  // bypassable warning. Compute a real display name from both accounts, same
  // shape addCashbookRows() already uses for the ledger rows.
  const _transferDisplayName =
    txArr.includes("Saving Acc Transfer")
      ? ((data.from_saving_acc_no || "") + " → " + (data.to_saving_acc_no || "")).trim() || "Saving Acc Transfer"
      : null;
  const payload = {
    date:
      txArr.includes("Closing - Loan") && data.date
        ? data.date
        : data.date || new Date().toISOString().split("T")[0],
    name: data.customer_name || _transferDisplayName || (section === 'bank' ? '—' : data.customer_name),
    customer_id: data.customer_id || "",
    customer_type: ctype,
    aadhar: data.aadhar || "",
    mobile: data.mobile || "",
    account_no: primaryAccNo,
    section,
    tx_types: txArr,
    data: dbData,
    remarks: data.comments || "",
  };
  // When saving a Closing - Loan, inherit the original record's customer_type
  // and account_no so the closing record isn't stored under the wrong identity.
  if (window._closingMeta && txArr.includes("Closing - Loan")) {
    const m = window._closingMeta;
    payload.customer_type = m.customer_type;
    if (m.account_no) payload.account_no = m.account_no;
  }
  // ── Closing - FD: PATCH the original record closed, then save a new closing record. ──
  if (txArr.includes("Closing - FD") && (data.fd_acc_no || data.mis_acc_no)) {
    const closingDate = data.date || new Date().toISOString().split("T")[0];
    const closingAccNo = data.fd_acc_no || data.mis_acc_no;
    let origRecId = null; // declared outside try so it's accessible after

    // ── Fast path: coming from openClosingFdForm (record already closed by confirmClose) ──
    // _closingRecId is set by openClosingFdForm; skip the active-record search and re-PATCH
    // because confirmClose already patched the record to closed before opening the form.
    const _fdClosingViaForm = !!window._closingRecId;
    if (_fdClosingViaForm) {
      origRecId = window._closingRecId;
    } else {
      // Manual entry path: find the active FD record and close it now
      try {
        const qParams = new URLSearchParams({ section: "fd", status: "active" });
        if (data.customer_name) qParams.set("q", data.customer_name);
        const searchRes = await fetch(API + "?" + qParams);
        if (!searchRes.ok) throw new Error("Search failed: " + searchRes.status);
        const searchData = await searchRes.json();
        const records = searchData.records || searchData || [];
        const origRec = records.find(function(r) {
          const rData = r.data || {};
          return (data.fd_acc_no && (rData.fd_acc_no === data.fd_acc_no || r.account_no === data.fd_acc_no))
              || (data.mis_acc_no && (rData.mis_acc_no === data.mis_acc_no || r.account_no === data.mis_acc_no));
        });
        if (!origRec) {
          toast("⚠️ Original FD record not found for acc " + closingAccNo + " — cannot close.", "err");
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 Save & PDF"; clearTimeout(_saveBtnTimeout); }
          window._saveInProgress = false;
          return;
        }
        origRecId = origRec.id;
        const closeRes = await fetch(API + "/" + origRec.id + "/close", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
          body: JSON.stringify({
            closed_date: closingDate,
            closed_remarks: data.comments || "",
            tx_types_to_close: ["Fixed Deposit", "Fixed Deposit - MIS", "New FD", "New FD - Term", "New FD - MIS", "FD - Slips", "FD - Slips - MIS"],
          }),
        });
        if (!closeRes.ok) {
          const errJ = await closeRes.json().catch(() => ({}));
          throw new Error(errJ.error || closeRes.status);
        }
      } catch (e) {
        toast("FD close failed: " + e.message, "err");
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 Save & PDF"; clearTimeout(_saveBtnTimeout); }
        window._saveInProgress = false;
        return;
      }
    }
    // Save a new record for the closing transaction so it appears in Database tab
    // and Transaction Ledger under today's date.
    const closePayload = {
      date: closingDate,
      name: data.customer_name,
      customer_id: data.customer_id || "",
      customer_type: ctype,
      aadhar: data.aadhar || "",
      mobile: data.mobile || "",
      account_no: data.fd_acc_no || data.mis_acc_no || "",
      section: "fd",
      tx_types: txArr,
      data: dbData,
      remarks: data.comments || "",
    };
    let closingMainId = null;
    try {
      const saveRes = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
        body: JSON.stringify(closePayload),
      });
      const saveJ = await saveRes.json();
      if (!saveRes.ok) {
        // Duplicate key: a closing record for this FD acc already exists (e.g. from
        // a previous partial save). Fetch its ID so cashbook rows are linked correctly
        // instead of silently falling back to the original FD record.
        if (saveJ.error && saveJ.error.includes("idx_records_unique_fd_acc")) {
          console.warn("Closing - FD: closing record already exists — fetching existing ID");
          try {
            const dupParams = new URLSearchParams({ section: "fd", status: "closed" });
            if (data.customer_name) dupParams.set("q", data.customer_name);
            const dupRes = await fetch(API + "?" + dupParams);
            if (dupRes.ok) {
              const dupData = await dupRes.json();
              const dupRecs = dupData.records || dupData || [];
              const dupRec = dupRecs.find(function(r) {
                return (data.fd_acc_no && r.account_no === data.fd_acc_no)
                    || (data.mis_acc_no && r.account_no === data.mis_acc_no);
              });
              if (dupRec) {
                closingMainId = dupRec.id;
                console.log("Closing - FD: reusing existing closing record id", closingMainId);
              }
            }
          } catch (dupErr) {
            console.warn("Closing - FD: could not fetch existing closing record:", dupErr.message);
          }
        } else {
          throw new Error(saveJ.error);
        }
      } else {
        closingMainId = saveJ.id;
      }
    } catch (e) {
      console.warn("Closing - FD: new record save failed:", e.message);
      // Non-fatal — PATCH already succeeded; fall back to origRecId for cashbook
    }
    // Link cashbook/ledger rows to the NEW closing record (today's date) so the
    // Transaction Ledger tab shows the entry under the correct date.
    await addCashbookRows(closingMainId || origRecId, data, txArr);
    toast("✅ FD closed successfully", "ok");
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 Save & PDF"; clearTimeout(_saveBtnTimeout); }
    window._saveInProgress = false;
    window._closingRecId = null;
    window._closingOriginalDate = null;
    window._closingMeta = null;
    window._closingInterestData = null;
    // BUG FIX: reassigning `window.closePDFSheet` alone (the old code below, now
    // removed) never actually ran when the user tapped the ✕ on the PDF preview.
    // The ✕ button's click handler was bound ONCE, the very first time any PDF
    // sheet was shown in this page session, via addEventListener(window.closePDFSheet)
    // inside initPDFSheet()'s _inject() — addEventListener captures that function
    // reference permanently, so reassigning the `window.closePDFSheet` variable
    // afterward (as the old code did) has no effect on that already-registered
    // listener. In practice this meant: the FIRST FD closed in a session behaved
    // correctly by luck (a fresh sheet with a fresh listener), but every FD closed
    // after that showed "closed successfully", yet tapping ✕ just hid the PDF
    // preview and left the stale form sitting there — no navigate home, no
    // dashboard/DB refresh — exactly the "form doesn't reset" symptom. `_navigateHome`
    // and the correct fix already exist a little further down this same function for
    // every OTHER closing type (Closing - Loan, Closing - OD, regular saves) — they
    // override the button's `.onclick` property directly instead, which (being a
    // live single-slot handler, not a captured listener) always reflects the latest
    // assignment. This FD-specific fast path just never got that same fix. Mirror it here.
    const _pdfSheetFD = document.getElementById('pdf-sheet');
    if (_pdfSheetFD && _pdfSheetFD.style.display === 'flex') {
      const _closeBtnFD = document.getElementById('pdf-sheet-close');
      if (_closeBtnFD) {
        const _prevClickFD = _closeBtnFD.onclick;
        _closeBtnFD.onclick = function(e) {
          if (_prevClickFD) _prevClickFD.call(this, e);
          _closeBtnFD.onclick = _prevClickFD;
          _navigateHome();
        };
      } else {
        // No close button found (shouldn't happen) — fall back to the old
        // best-effort reassignment so closing still eventually resets the form.
        const _origCloseFD = window.closePDFSheet;
        window.closePDFSheet = function() {
          _origCloseFD();
          window.closePDFSheet = _origCloseFD;
          _navigateHome();
        };
      }
    } else {
      setTimeout(_navigateHome, 800);
    }
    return;
  }

  let mainId = null;
  try {
    const res = await _fetchWithTimeout(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify(payload),
    }, 20000);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error);
    mainId = j.id;
  } catch (e) {
    toast("Save failed: " + e.message, "err");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 Save & PDF";
      clearTimeout(_saveBtnTimeout);
    }
    window._saveInProgress = false;
    window._closingRecId = null;
    window._closingOriginalDate = null;
    window._closingMeta = null;
    window._closingInterestData = null;
    // For bank transactions, navigate home even on error so user isn't stuck
    if (section === 'bank') {
      setTimeout(() => { showPage("home"); clearForm(); loadDashboard(); loadDB(); }, 800); // bank error path — no PDF shown, navigate immediately
    }
    return;
  }
  if (window._enrichRecId) {
    try {
      var _eF=['photo_customer','photo_ornament','photo_aadhar_front','photo_aadhar_back','photo_pan','ornament_items','ornament_weight','ornament_qty','gold_ornaments','silver_ornaments','customer_photo_url'];
      var _eP={};
      _eF.forEach(function(k){if(data[k]!=null)_eP[k]=data[k];});
      if(Object.keys(_eP).length>0){
        var _eO=await fetch(API+'/'+window._enrichRecId).then(function(r){return r.json();}).catch(function(){return null;});
        if(_eO){
          var _eM=Object.assign({},_eO.data||{},_eP);
          var _eR=await fetch(API+'/'+window._enrichRecId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:_eO.name,customer_id:_eO.customer_id,customer_type:_eO.customer_type,aadhar:_eO.aadhar,mobile:_eO.mobile,account_no:_eO.account_no,date:_eO.date,section:_eO.section,tx_types:_eO.tx_types,data:_eM,remarks:_eO.remarks||'',sonar_parent_no:_eO.sonar_parent_no||null,sonar_sub_no:_eO.sonar_sub_no||null,sonar_group_no:_eO.sonar_group_no||null})});
          if(_eR.ok){toast('Photos & ornaments saved to imported record #'+window._enrichRecId,'ok');}else{toast('Photo update failed (HTTP '+_eR.status+')','warn');}
        }
      }
    }catch(_eErr){console.warn('[enrich] PUT failed:',_eErr.message);toast('Photo update failed: '+_eErr.message,'warn');}
    window._enrichRecId=null;
  }

  const msg = "✅ Saved — Record #" + mainId;
  toast(msg, "ok");
  // Process transaction side-effects FIRST (update gold_loans, saving_accounts, fd_accounts etc.)
  // Must be awaited so derived tables exist before cashbook entries reference them.
  try {
    const ptRes = await _fetchWithTimeout(API + "/process-transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify({
        tx_types: txArr,
        data,
        record_id: mainId,
        customer_name: data.customer_name,
      }),
    }, 25000);
    if (!ptRes.ok) {
      console.warn("process-transaction HTTP error:", ptRes.status);
    } else {
      const ptJ = await ptRes.json();
      if (ptJ.errors && ptJ.errors.length) {
        console.warn("process-transaction errors:", ptJ.errors);
        if (typeof toast === "function") toast("⚠️ Some steps failed: " + ptJ.errors[0], "warn");
      }
      if (ptJ.results && ptJ.results.length)
        console.log("process-transaction:", ptJ.results);
      // FIX: update saving_balance with the live DB value returned by processTransaction
      // so the deposit/withdrawal slip shows the correct before/after balance.
      if (_isSavingTx && ptJ.saving_acc_no && ptJ.balance != null) {
        data.saving_balance = ptJ.balance;
        console.log('[pdf] using live saving_balance from processTransaction:', ptJ.balance);
      }
      // For Saving Acc Transfer, build data._transferRows for the transfer
      // voucher PDF now that the backend has applied the debit/credit — fetch
      // each account's live post-transfer balance and customer name (the
      // ptJ.balance/ptJ.saving_acc_no fields above are single-account only
      // and don't cover a transfer's two separate accounts).
      if (_isSavingAccTransfer && data.from_saving_acc_no && data.to_saving_acc_no) {
        try {
          const [fromRes, toRes] = await Promise.all([
            fetch(API + "/saving-balance/" + encodeURIComponent(data.from_saving_acc_no)).then(r => r.json()).catch(() => null),
            fetch(API + "/saving-balance/" + encodeURIComponent(data.to_saving_acc_no)).then(r => r.json()).catch(() => null),
          ]);
          const trAmt = parseFloat(data.transfer_amount) || 0;
          data._transferRows = [
            {
              tx_type: "Debit",
              name: (fromRes && fromRes.customer_name) || "",
              acc_no: data.from_saving_acc_no,
              amount: trAmt,
              scroll_no: data.transfer_ref_no || "",
              balance_after: fromRes && fromRes.balance != null ? fromRes.balance : "",
            },
            {
              tx_type: "Credit",
              name: (toRes && toRes.customer_name) || "",
              acc_no: data.to_saving_acc_no,
              amount: trAmt,
              scroll_no: data.transfer_ref_no || "",
              balance_after: toRes && toRes.balance != null ? toRes.balance : "",
            },
          ];
        } catch (e) {
          console.warn("[pdf] failed to fetch post-transfer balances:", e.message);
          data._transferRows = [];
        }
      }
    }
  } catch (e) {
    const isTimeout = e.name === "AbortError";
    console.warn("process-transaction failed:", e.message);
    if (typeof toast === "function") {
      toast(isTimeout
        ? "⚠️ Server took too long updating account — record was saved. Refresh to verify."
        : "⚠️ Account update failed: " + e.message + " — record was saved.", "warn");
    }
  }
  // Generate the deferred PDF for saving deposit/withdrawal (and Saving Acc
  // Transfer) now that the live post-transaction balance(s) are available.
  if (_isSavingTx || _isSavingAccTransfer) {
    try { generateTemplatePDF(pdfTxArr, data); } catch(e) { console.warn('PDF generation error:', e.message); }
  }
  // Auto-add cashbook entries for this transaction, right here at submit
  // time — this is the PRIMARY path that creates a transaction's ledger
  // rows; loadLedger()'s lazy auto-generate (Ledger tab load) is only meant
  // to be the backup safety net for anything that slips through here.
  if (!window._autoGenAttempted) window._autoGenAttempted = new Set();
  const _cbGenResult = await addCashbookRows(mainId, data, txArr);
  // BUG FIX (this was the actual root cause of ledger rows sometimes never
  // appearing at all): this used to mark _autoGenAttempted BEFORE knowing
  // whether addCashbookRows above actually succeeded. If that save failed
  // right here — a transient network error, a slow server response — the
  // transaction's ledger rows would never be generated, not now AND not
  // later either: loadLedger()'s own fallback on the Ledger tab checks this
  // exact same _autoGenAttempted set and would see this record as "already
  // tried," skipping it too. The one safety net that exists specifically to
  // catch a failure here was being disabled by the very failure it was
  // meant to catch. Only mark it once we know rows were actually saved (or
  // that there was genuinely nothing to generate for these tx types) —
  // leave it unmarked on failure so the Ledger tab's auto-gen can still
  // pick it up and retry the next time anyone loads that tab.
  if (_cbGenResult && (_cbGenResult.status === "saved" || _cbGenResult.status === "empty")) {
    window._autoGenAttempted.add(String(mainId));
  } else {
    console.warn("Ledger row generation failed at submit time for record", mainId, "— will retry from the Ledger tab's auto-gen safety net.");
  }

  // If this is a Gold Loan closing via the pre-filled form, mark original record as closed.
  // FIX: if _closingRecId is null (page refreshed mid-flow), fall back to
  // looking up the original active gold loan by loan_acc_no and closing it.
  if (txArr.includes("Closing - Loan")) {
    const closingDate = data.date || new Date().toISOString().split("T")[0];
    let recIdToClose = window._closingRecId;

    if (!recIdToClose && data.loan_acc_no) {
      try {
        const lookup = await fetch(
          "/api/records/check-loan-no/" + encodeURIComponent(data.loan_acc_no)
        ).then(r => r.json()).catch(() => ({}));
        // Accept both active and closed — manual entry should always close the record
        if (lookup.exists && lookup.record) {
          recIdToClose = lookup.record.id;
        }
      } catch (e) {
        console.warn("[closing] fallback lookup failed:", e.message);
      }
    }

    if (recIdToClose) {
      try {
        const closeRes = await fetch(
          API + "/" + recIdToClose + "/close",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
            body: JSON.stringify({
              closed_date: closingDate,
              closed_remarks: data.comments || "",
              tx_types_to_close: ["Gold Loan", "Slips - Loan", "Closing - Loan"],
            }),
          },
        );
        if (!closeRes.ok) {
          const errJ = await closeRes.json().catch(() => ({}));
          toast(
            "⚠️ Closing record saved but original loan status update failed: " +
              (errJ.error || closeRes.status) +
              " — please close manually from the records list.",
            "err",
          );
        }
      } catch (e) {
        toast(
          "⚠️ Closing record saved but original loan status update failed: " +
            e.message +
            " — please close manually from the records list.",
          "err",
        );
      }
    } else {
      console.warn("[closing] Could not find original loan record to close for acc:", data.loan_acc_no);
    }
    window._closingRecId = null;
    window._closingOriginalDate = null;
    window._closingMeta = null;
    window._closingInterestData = null;
    invalidateSavingCache();
  }
  // If this is an FD-OD loan closing via the pre-filled picker, mark the original
  // OD loan record as closed — mirrors the gold loan closing block exactly.
  if (txArr.includes("Closing - OD")) {
    const closingDate = data.date || new Date().toISOString().split("T")[0];
    let recIdToClose = window._closingRecId;

    // Fallback: find original active OD loan by acc_no if _closingRecId not set
    if (!recIdToClose && data.loan_acc_no) {
      try {
        const lookup = await fetch(
          "/api/records/check-od-acc-no/" + encodeURIComponent(data.loan_acc_no)
        ).then(r => r.json()).catch(() => ({}));
        // Accept both active and closed — manual entry should always close the record
        if (lookup.exists && lookup.record) {
          recIdToClose = lookup.record.id;
        }
      } catch (e) {
        console.warn("[closing-od] fallback lookup failed:", e.message);
      }
    }

    if (recIdToClose) {
      try {
        const closeRes = await fetch(
          API + "/" + recIdToClose + "/close",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
            body: JSON.stringify({
              closed_date: closingDate,
              closed_remarks: data.comments || "",
              tx_types_to_close: ["New FD-OD Loan", "OD Loan", "Closing - OD"],
            }),
          },
        );
        if (!closeRes.ok) {
          const errJ = await closeRes.json().catch(() => ({}));
          toast(
            "⚠️ Closing record saved but original FD-OD loan status update failed: " +
              (errJ.error || closeRes.status) +
              " — please close manually from the records list.",
            "err",
          );
        }
      } catch (e) {
        toast(
          "⚠️ Closing record saved but original FD-OD loan status update failed: " +
            e.message +
            " — please close manually from the records list.",
          "err",
        );
      }
    } else {
      console.warn("[closing-od] Could not find original OD loan record to close for acc:", data.loan_acc_no);
    }
    window._closingRecId = null;
    window._closingOriginalDate = null;
    window._closingMeta = null;
    window._closingInterestData = null;
    invalidateSavingCache();
  }
  // Re-enable save button before navigating away so it's never left frozen
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 Save & PDF";
    clearTimeout(_saveBtnTimeout);
  }
  window._saveInProgress = false;

  // If the PDF sheet is open, wait for the user to close it before navigating away.
  // This prevents the page switch from hiding the PDF before the user can print it.
  function _navigateHome() {
    try { showPage("home"); } catch(e) {
      console.error("showPage failed:", e);
      // Hard fallback: hide all pages and show home directly
      try {
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
        const homePage = document.getElementById('page-home') || document.querySelector('[data-page="home"]');
        if (homePage) homePage.style.display = '';
      } catch(_) {}
    }
    try { clearForm(); } catch(e) { console.error("clearForm failed:", e); }
    try { loadDashboard(); } catch(e) { console.error("loadDashboard failed:", e); }
    try { invalidateSavingCache(); } catch(e) { console.warn("invalidateSavingCache failed:", e); }
    try { loadDB(); } catch(e) { console.error("loadDB failed:", e); }
  }
  const _pdfSheet = document.getElementById('pdf-sheet');
  if (_pdfSheet && _pdfSheet.style.display === 'flex') {
    const _origClose = window.closePDFSheet;
    window.closePDFSheet = function() {
      _origClose();
      window.closePDFSheet = _origClose;
      _navigateHome();
    };
    const _closeBtn = document.getElementById('pdf-sheet-close');
    if (_closeBtn) {
      const _prevClick = _closeBtn.onclick;
      _closeBtn.onclick = function(e) {
        if (_prevClick) _prevClick.call(this, e);
        window.closePDFSheet = _origClose;
        _navigateHome();
      };
    }
  } else {
    setTimeout(_navigateHome, 800);
  }
}

function clearForm() {
  selNone();
  ctype = "regular";
  window._closingRecId = null;
  window._closingOriginalDate = null;
  window._closingMeta = null;
  window._closingInterestData = null;
  window._enrichRecId = null;
  window._dupAccountViolation = null;
  // Reset button styles
  const btnReg = document.getElementById("btn-reg");
  if (btnReg)
    btnReg.style.cssText =
      "flex:1;padding:7px 10px;border-radius:8px;border:1.5px solid #c8e6c9;background:#eafaf1;color:#1e8449;font-size:11px;font-weight:700;cursor:pointer;text-align:center;user-select:none;";
  photos = {};
  _photoFormGen++;
  document.getElementById("form-card").innerHTML = "";
  document.getElementById("form-card").classList.remove("show");
  document.getElementById("form-empty").style.display = "";
  document.getElementById("action-bar").classList.remove("show");
  document.getElementById("tx-layout-wrap")?.classList.remove("mob-form-open");
}

// ═══════════════════════════════════════
//  PDF — delegated to /pdf-template.js
// ═══════════════════════════════════════
// generateTemplatePDF is defined in /pdf-template.js (HTML-based, supports Marathi/Devanagari)

// ═══════════════════════════════════════
//  PAGE NAV
// ═══════════════════════════════════════
function showPage(id) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  const target = document.getElementById("page-" + id);
  if (!target) {
    console.warn("showPage: no page with id 'page-" + id + "'");
    return;
  }
  target.classList.add("active");
  document
    .querySelectorAll(".nav-item,.bnav-btn")
    .forEach((n) => n.classList.toggle("active", n.dataset.page === id));
  if (id === "database") loadDB();
  if (id === "home") loadDashboard();
  if (id === "new") {
    // Confirm before clearing if the user has started filling a form.
    // Skip confirm if _forceNav flag is set (programmatic navigation, e.g. openClosingLoanForm).
    const hasData =
      !window._forceNav &&
      checked.size > 0 &&
      (document.getElementById("f-customer_name")?.value ||
        document.getElementById("f-loan_acc_no")?.value);
    if (hasData) {
      if (
        !confirm(
          "Switch to New Transaction? Your current form will be cleared.",
        )
      ) {
        // Revert nav highlight back to previous page
        return;
      }
    }
    window._forceNav = false;
    clearForm();
  }
  if (id === "cashbook") {
    const _cbDateEl = document.getElementById("cb-date");
    if (_cbDateEl && !_cbDateEl.value)
      _cbDateEl.value = new Date().toISOString().split("T")[0];
  }
  if (id === "ledger") {
    // Auto-set today's date and load ledger data
    const ldgDate = document.getElementById("ldg-date");
    if (ldgDate && !ldgDate.value)
      ldgDate.value = new Date().toISOString().split("T")[0];
    loadLedger();
  }
  window.scrollTo(0, 0);
}
function filterGo(s) {
  // Set the filter BEFORE navigating — showPage("database") already calls
  // loadDB() internally, so setting the value first means that single call
  // picks up the right filter instead of firing once with the stale value
  // and once more to correct it.
  document.getElementById("db-sect").value = s;
  showPage("database");
}
function filterCtype(t) {
  document.getElementById("db-ctype").value = t;
  showPage("database");
}

function quickStart(txType) {
  showPage("new");
  selNone();
  setTimeout(() => {
    toggleTx(txType);
    document.getElementById("go-btn").click();
  }, 100);
}

// ═══════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════
function dbSearch() {
  clearTimeout(searchTmr);
  searchTmr = setTimeout(() => {
    dbOff = 0;
    loadDB();
  }, 350);
}

// Cache of all saving records for running balance computation
let _allSavingRecords = null;
let _allSavingRecordsTs = 0;
function invalidateSavingCache() {
  _allSavingRecords = null;
}

const SECT_TX_TYPES = {
  gold: ["Gold Loan", "Slips - Loan", "Closing - Loan"],
  od: [
    "OD Loan",
    "New FD-OD Loan",
    "Slips - FD-OD",
    "Slips - OD",
    "Closing - OD",
  ],
  fd: [
    "New FD",
    "New FD - Term",
    "New FD - MIS",
    "Fixed Deposit",
    "Fixed Deposit - MIS",
    "FD - Slips",
    "FD - Slips - MIS",
    "Closing - FD",
    "Closing - FD - Slips",
    "MIS Interest",
  ],
  saving: [
    "Saving Account",
    "Saving Deposit",
    "Saving Withdrawal",
    "Saving - Deposit Slip",
    "Saving - Withdrawal Slip",
    "Saving Acc Transfer",
    "Closing - Saving Account",
  ],
  membership: [
    "New Sadasya",
    "Sadasya",
    "Sadasya - Slips",
    "New Naammatr Sabhasad",
    "Naammatr Sabhasad Account",
    "Naammatr Sabhasad - Slips",
  ],
  current: ["Current Account", "Current - Slips"],
  shares: ["Shares Account", "Shares - Transfer"],
  bank: [
    "Payment Received - Online",
    "Payment Transfer - Online",
    "RTGS",
    "Bank Charges",
    "Other Bank - Cash Withdrawal",
    "Other Bank - Cash Deposit",
    "TDS",
    "Interest Received on FD from Other Bank",
  ],
  office: [
    "Office Rent",
    "Tea & Water Expense",
    "Office Maintenance",
    "Printing & Stationary",
    "Employee Salary",
  ],
};
const CLOSING_TX_TYPES = new Set([
  "Closing - Loan",
  "Closing - FD",
  "Closing - FD - Slips",
  "Closing - FD OD Loan",
  "Closing - Saving Account",
  "Closing - Sadasya",
  "Closing - Naammatr Sadasya",
  "Closing - Gold Loan",
]);

async function loadDB() {
  const q = document.getElementById("db-q").value;
  const sect = dbTxFilter || document.getElementById("db-sect").value;
  const ct = document.getElementById("db-ctype").value;
  const p = new URLSearchParams({ limit: 50, offset: dbOff });
  if (q) p.set("q", q);
  if (sect) p.set("section", sect);
  if (ct) p.set("customer_type", ct);
  if (dbStatusFilter) p.set("status", dbStatusFilter);
  const _dbDate = typeof getAppDate === "function" ? getAppDate() : null;
  if (_dbDate && !q) p.set("date", _dbDate);
  try {
    const _mainRes = await fetch(API + "?" + p);
    if (!_mainRes.ok) {
      const _err = await _mainRes.json().catch(() => ({}));
      throw new Error(_err.error || `Server error ${_mainRes.status}`);
    }
    let { records, total } = await _mainRes.json();
    if (!Array.isArray(records)) records = [];
    if (sect && SECT_TX_TYPES[sect]) {
      const relevantTxTypes = new Set(SECT_TX_TYPES[sect]);
      const crossP = new URLSearchParams({ limit: 9999, offset: 0 });
      if (q) crossP.set("q", q);
      if (ct) crossP.set("customer_type", ct);
      // Always apply the same date filter as the main query so cross-section
      // results are also scoped to the selected date
      const _crossDate = getAppDate ? getAppDate() : null;
      if (_crossDate) {
        crossP.set("date_from", _crossDate);
        crossP.set("date_to", _crossDate);
      }
      const _crossRes = await fetch(API + "?" + crossP);
      const { records: allRecords = [] } = _crossRes.ok
        ? await _crossRes.json()
        : {};
      const existingIds = new Set(records.map((r) => r.id));
      const crossRecords = allRecords.filter((r) => {
        if (existingIds.has(r.id)) return false;
        const rTxTypes = parseTxTypes(r.tx_types);
        if (!rTxTypes.some((t) => relevantTxTypes.has(t))) return false;
        const closedTx = new Set(parseTxTypes(r.closed_tx_types));
        if (dbStatusFilter === "closed")
          return rTxTypes.some(
            (t) => relevantTxTypes.has(t) && closedTx.has(t),
          );
        if (dbStatusFilter === "active")
          return rTxTypes.some(
            (t) => relevantTxTypes.has(t) && !closedTx.has(t),
          );
        return true;
      });
      records = [...records, ...crossRecords];
    }
    if (sect && SECT_TX_TYPES[sect]) {
      const relevantTxTypes = new Set(SECT_TX_TYPES[sect]);
      records = records.filter((r) => {
        const rTxTypes = parseTxTypes(r.tx_types);
        if (rTxTypes.every((t) => CLOSING_TX_TYPES.has(t))) return false;
        if (dbStatusFilter === "active") {
          const closedTx = new Set(parseTxTypes(r.closed_tx_types));
          return rTxTypes.some(
            (t) => relevantTxTypes.has(t) && !closedTx.has(t),
          );
        }
        return true;
      });
    }
    if (dbTxTypeFilter) {
      records = records.filter((r) =>
        parseTxTypes(r.tx_types).includes(dbTxTypeFilter),
      );
    }
    total = records.length;

    // Always fetch ALL saving records to compute running balance chain
    try {
      const now = Date.now();
      if (!_allSavingRecords || now - _allSavingRecordsTs > 30000) {
        const allP = new URLSearchParams({
          section: "saving",
          limit: 9999,
          offset: 0,
        });
        if (ct) allP.set("customer_type", ct);
        const allRes = await (await fetch(API + "?" + allP)).json();
        _allSavingRecords = allRes.records || [];
        _allSavingRecordsTs = now;
      }
      window._runningBalMap = computeRunningBalMap(_allSavingRecords);
    } catch (balErr) {
      console.warn("Balance chain fetch failed", balErr);
      window._runningBalMap = {};
    }

    dbTot = total;
    renderTable(records);
    renderPages();
  } catch (e) {
    console.error("loadDB error:", e);
    document.getElementById("db-body").innerHTML =
      `<tr><td colspan="9"><div class="empty-st"><div class="ei">❌</div><p style="font-weight:700">Server offline</p><p style="font-size:10px;margin-top:4px">Unable to connect — please contact the administrator</p><button onclick="loadDB()" style="margin-top:8px;padding:5px 14px;background:var(--sky-a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:11px">🔄 Retry</button></div></td></tr>`;
    _serverFailCount++;
    if (_serverFailCount >= 2) showOfflineBanner();
  }
}

// Compute running balance for ALL saving deposit/withdrawal records grouped by account
function computeRunningBalMap(allRecords) {
  const map = {};
  // Filter only deposit/withdrawal records
  const depWdRecs = allRecords.filter((r) =>
    parseTxTypes(r.tx_types).some(
      (t) => t === "Saving Deposit" || t === "Saving Withdrawal",
    ),
  );
  // Group by saving_acc_no
  const accGroups = {};
  depWdRecs.forEach((r) => {
    const d =
      typeof r.data === "string"
        ? (function () {
            try {
              return JSON.parse(r.data);
            } catch (e) {
              return {};
            }
          })()
        : r.data || {};
    const acc = (d.saving_acc_no || r.account_no || "__unknown__").trim();
    if (!accGroups[acc]) accGroups[acc] = [];
    accGroups[acc].push({ r, d });
  });
  // For each account, sort chronologically then chain balances
  Object.values(accGroups).forEach((group) => {
    group.sort(
      (a, b) => new Date(a.r.date) - new Date(b.r.date) || a.r.id - b.r.id,
    );
    let runBal = null;
    group.forEach(({ r, d }) => {
      // FIX #6: API exposes saving balance as "balance" (from saving_accounts table).
      // Fall back to JSONB "saving_balance" for legacy records that have no derived row.
      const storedBal =
        d.balance != null
          ? parseFloat(d.balance)
          : d.saving_balance != null
            ? parseFloat(d.saving_balance)
            : null;
      const depAmt =
        d.deposit_amount != null ? parseFloat(d.deposit_amount) : null;
      const isDeposit = parseTxTypes(r.tx_types).includes("Saving Deposit");
      // First record of this account: use its stored balance as starting point
      if (runBal === null && storedBal === null) {
        console.warn(
          "computeRunningBalMap: no stored balance for first record of account, id=" + r.id +
          ". Running balance chain for this account will be incomplete."
        );
      }
      const prevBal = runBal !== null ? runBal : storedBal;
      let resultBal = null;
      if (prevBal !== null && depAmt !== null) {
        resultBal = isDeposit ? prevBal + depAmt : prevBal - depAmt;
        runBal = resultBal;
      } else if (prevBal !== null) {
        runBal = prevBal;
      }
      map[r.id] = { prevBal, resultBal };
    });
  });
  return map;
}

function setDbTxTab(el, section, txType) {
  dbTxFilter = section;
  dbTxTypeFilter = txType || "";
  dbOff = 0;
  document.getElementById("db-sect").value = section;
  document
    .querySelectorAll(".db-tx-tab:not(.db-status-tab)")
    .forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
  loadDB();
}
function setDbStatus(el, status) {
  dbStatusFilter = status;
  dbOff = 0;
  document
    .querySelectorAll(".db-status-tab")
    .forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
  loadDB();
}
function syncTabFromSelect() {
  const s = document.getElementById("db-sect").value;
  dbTxFilter = s;
  dbTxTypeFilter = "";
  document.querySelectorAll(".db-tx-tab:not(.db-status-tab)").forEach((b) => {
    b.classList.remove("active");
    if (b.dataset.tx === s) b.classList.add("active");
  });
}

// FIX: the DATE column used to print r.date verbatim — since records.date
// comes back from the API as a full ISO timestamp (e.g.
// "2026-09-07T18:30:00.000Z", a DATE column serialized with the local
// midnight expressed in UTC), that showed up raw in the table instead of a
// readable date like the Gold Loans admin page already shows. Reparse and
// format it the same way the rest of this tab formats dates.
function _fmtDbDate(raw) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw; // unrecognised format — show as-is rather than hide it
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function renderTable(rows) {
  const b = document.getElementById("db-body");

  // Update the date badge in the database tab header
  const dbDateLbl = document.getElementById("db-date-label");
  if (dbDateLbl) {
    const d = getAppDate();
    const today = new Date().toISOString().split("T")[0];
    if (d === today) {
      dbDateLbl.textContent =
        "Today — " +
        new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
    } else {
      dbDateLbl.textContent = new Date(d + "T00:00:00").toLocaleDateString(
        "en-IN",
        { weekday: "short", day: "numeric", month: "short", year: "numeric" },
      );
    }
  }

  // Update column headers based on current section filter
  const sect = dbTxFilter || document.getElementById("db-sect").value || "";
  const acctHdr = document.getElementById("db-col-acct");
  const extraHdr = document.getElementById("db-col-extra");
  if (acctHdr) {
    if (sect === "gold" || sect === "od") {
      acctHdr.textContent = "Loan A/c No";
      if (extraHdr) extraHdr.textContent = "Loan Amount · Ornaments";
    } else if (sect === "fd") {
      acctHdr.textContent = "FD A/c No";
      if (extraHdr)
        extraHdr.textContent = "FD Amount · Period · Rate · Maturity";
    } else if (dbTxTypeFilter === "Saving Deposit") {
      acctHdr.textContent = "Saving A/c No";
      if (extraHdr) extraHdr.textContent = "Deposit Amount · Running Balance";
    } else if (dbTxTypeFilter === "Saving Withdrawal") {
      acctHdr.textContent = "Saving A/c No";
      if (extraHdr)
        extraHdr.textContent = "Withdrawal Amount · Running Balance";
    } else if (sect === "saving" || sect === "membership") {
      acctHdr.textContent = "Saving A/c No";
      if (extraHdr) extraHdr.textContent = "Saving Balance · Share A/c";
    } else {
      acctHdr.textContent = "Account No";
      if (extraHdr) extraHdr.textContent = "Details";
    }
  }
  if (!rows.length) {
    const _d = getAppDate();
    const _today = new Date().toISOString().split("T")[0];
    const _dFmt = new Date(_d + "T00:00:00").toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const _label = _d === _today ? "today (" + _dFmt + ")" : _dFmt;
    b.innerHTML = `<tr><td colspan="10"><div class="empty-st"><div class="ei">📭</div><p>No records found for ${_label}</p><p style="font-size:9pt;color:var(--textl);margin-top:6px">Add transactions from the <strong>New Transaction</strong> tab</p></div></td></tr>`;
    return;
  }
  b.innerHTML = rows
    .map((r, i) => {
      const bs = `background:${SB[r.section] || "#eee"};color:${SC[r.section] || "#666"}`;
      // Show correct account no + extra details per section
      const d =
        typeof r.data === "string"
          ? (function () {
              try {
                return JSON.parse(r.data);
              } catch (e) {
                return {};
              }
            })()
          : r.data || {};
      let acctDisplay = "";
      let extraInfo = ""; // shown in Name cell (small info)
      let extraCol = "—"; // shown in new Details column

      if (r.section === "gold" || r.section === "od") {
        acctDisplay = d.loan_acc_no || "—"; // Never fall back to saving acc no
        const ornWt = d.ornament_weight ? `${d.ornament_weight}g` : "";
        const ornType =
          d.ornament_items && d.ornament_items.length
            ? [d.metal_type, d.ornament_items[0].name]
                .filter(Boolean)
                .join(" · ")
            : [
                d.metal_type,
                d.gold_ornaments?.split(",")[0],
                d.silver_ornaments?.split(",")[0],
              ]
                .filter(Boolean)
                .join(" · ");
        const lnAmt = d.loan_amount
          ? `₹ ${Number(d.loan_amount).toLocaleString("en-IN")}`
          : "";
        // For OD loans: also show linked FD acc no
        const fdAccInfo = (r.section === "od" && d.fd_acc_no)
          ? `<span style="font-size:8px;color:#2b6cb0;font-weight:700">FD: ${d.fd_acc_no}</span>`
          : "";
        extraCol = [lnAmt, ornWt, ornType].filter(Boolean).join("<br>");
        if (fdAccInfo) extraCol = (extraCol ? extraCol + "<br>" : "") + fdAccInfo;
        if (d.address)
          extraInfo += `<div style="font-size:9px;color:#888;margin-top:1px">${d.address.substring(0, 40)}</div>`;
      } else if (r.section === "fd") {
        acctDisplay = d.fd_acc_no || r.account_no || "—";
        if (d.fd_parvati_no)
          acctDisplay += `<br><span style="font-size:8px;color:#777">Parvati: ${d.fd_parvati_no}</span>`;
        const fdAmt = d.fd_amount
          ? `₹ ${Number(d.fd_amount).toLocaleString("en-IN")}`
          : "";
        const fdPrd = d.fd_period || "";
        const fdRate = d.fd_interest_rate ? `${d.fd_interest_rate}%` : "";
        const fdMat = d.fd_maturity_date ? `Mat: ${d.fd_maturity_date}` : "";
        extraCol = [fdAmt, fdPrd, fdRate, fdMat].filter(Boolean).join("<br>");
      } else if (r.section === "saving" || r.section === "membership") {
        acctDisplay = d.saving_acc_no || r.account_no || "—";
        if (
          dbTxTypeFilter === "Saving Deposit" ||
          dbTxTypeFilter === "Saving Withdrawal"
        ) {
          const isDeposit = dbTxTypeFilter === "Saving Deposit";
          const depAmt = d.deposit_amount ? parseFloat(d.deposit_amount) : null;
          const rb = (window._runningBalMap || {})[r.id] || {};
          const prevBal =
            rb.prevBal != null
              ? rb.prevBal
              : d.saving_balance
                ? parseFloat(d.saving_balance)
                : null;
          const resultBal = rb.resultBal;
          const depAmtFmt =
            depAmt != null ? `₹ ${depAmt.toLocaleString("en-IN")}` : "—";
          const depWrd = d.deposit_amount_words
            ? `<div style="font-style:italic;color:#666;font-size:8px">${d.deposit_amount_words}</div>`
            : "";
          let balCalc = "";
          if (prevBal != null && depAmt != null && resultBal != null) {
            const op = isDeposit
              ? `<span style="color:#155724">₹ ${prevBal.toLocaleString("en-IN")} + ₹ ${depAmt.toLocaleString("en-IN")} = <strong>₹ ${resultBal.toLocaleString("en-IN")}</strong></span>`
              : `<span style="color:#721c24">₹ ${prevBal.toLocaleString("en-IN")} − ₹ ${depAmt.toLocaleString("en-IN")} = <strong>₹ ${resultBal.toLocaleString("en-IN")}</strong></span>`;
            balCalc = `<div style="font-size:8px;margin-top:2px">${op}</div>`;
          } else if (prevBal != null) {
            balCalc = `<div style="font-size:8px;color:#888;margin-top:2px">Bal: ₹ ${prevBal.toLocaleString("en-IN")}</div>`;
          }
          extraCol = `<div style="font-weight:800;font-size:9.5pt">${depAmtFmt}</div>${depWrd}${balCalc}`;
        } else {
          const rb = (window._runningBalMap || {})[r.id] || {};
          const runBal =
            rb.resultBal != null
              ? rb.resultBal
              : d.saving_balance
                ? parseFloat(d.saving_balance)
                : null;
          const savBal =
            runBal != null ? `Bal: ₹ ${runBal.toLocaleString("en-IN")}` : "";
          const shrAcc = d.share_acc_no ? `Share: ${d.share_acc_no}` : "";
          extraCol = [savBal, shrAcc].filter(Boolean).join("<br>") || "—";
        }
      } else if (r.section === "bank") {
        acctDisplay = d.bank_acc_name || d.saving_acc_no || r.account_no || "—";
        const expAmt = d.expense_amount
          ? `₹ ${Number(d.expense_amount).toLocaleString("en-IN")}`
          : "";
        const swAcc = d.saving_acc_no ? `A/c: ${d.saving_acc_no}` : "";
        const rrn = d.upi_rrn ? `RRN: ${d.upi_rrn}` : "";
        const chq = d.cheque_no ? `Chq: ${d.cheque_no}` : "";
        extraCol =
          [expAmt, swAcc, rrn, chq].filter(Boolean).join("<br>") || "—";
      } else {
        // BUG FIX: this catch-all handles section === "general" — which is where
        // every "Closing - FD" (and similar) audit-trail record lives, because
        // the backend buckets closing records under section="general" regardless
        // of what type of account was actually closed (see closePayload in
        // saveAndPDF()). r.account_no on these rows correctly holds the FD/loan/
        // whatever account that was closed; d.saving_acc_no is just the
        // customer's UNRELATED savings account number, carried along in the data
        // blob like most other fields on the record. Falling back to it FIRST
        // (the old order) meant every "Closing - FD" row here showed the
        // customer's savings account number instead of the FD that was actually
        // closed — never aligned with the transaction the row represents.
        // Mirrors the fix already applied above for gold/od ("Never fall back
        // to saving acc no").
        acctDisplay = r.account_no || d.saving_acc_no || "—";
      }

      const acct = acctDisplay;
      const isClosed = r.status === "closed";
      const allTypes = parseTxTypes(r.tx_types);
      const closedTypes = new Set(parseTxTypes(r.closed_tx_types));
      const isClosingRecord = allTypes.every((t) => t.startsWith("Closing"));
      const hasOpenTypes =
        !isClosingRecord && allTypes.some((t) => !closedTypes.has(t));
      const isPartial = !isClosed && closedTypes.size > 0;
      const closedBadge = isClosed
        ? `<span style="display:inline-block;background:#e53e3e;color:#fff;font-size:8px;font-weight:800;border-radius:4px;padding:1px 5px;margin-left:4px;vertical-align:middle">🔒 CLOSED${r.closed_date ? " " + _fmtDbDate(r.closed_date) : ""}</span>`
        : isPartial
          ? `<span style="display:inline-block;background:#f59e0b;color:#fff;font-size:8px;font-weight:800;border-radius:4px;padding:1px 5px;margin-left:4px;vertical-align:middle">🔒 Partial: ${[...closedTypes].join(", ")}</span>`
          : "";
      // Photo thumbnail (customer photo if available)
      const photoThumb = d.photo_customer
        ? `<img src="${d.photo_customer}" style="width:28px;height:28px;border-radius:4px;object-fit:cover;vertical-align:middle;margin-left:4px;border:1px solid #ddd" title="Customer photo">`
        : "";

      // Build expandable detail panel (all sections)
      let detailFields = [];
      if (r.section === "gold" || r.section === "od") {
        detailFields = [
          ["Loan A/c No", d.loan_acc_no],
          ["Saving A/c No", d.saving_acc_no],
          ["Share A/c No", d.share_acc_no],
          [
            "Loan Amount",
            d.loan_amount
              ? "₹ " + Number(d.loan_amount).toLocaleString("en-IN")
              : "",
          ],
          ["Amount (Words)", d.loan_amount_words],
          ["Metal Type", d.metal_type],
          [
            "Ornaments",
            d.ornament_items
              ? d.ornament_items
                  .map((r) => `${r.name} × ${r.qty} (${r.weight}gm)`)
                  .join(", ")
              : [d.gold_ornaments, d.silver_ornaments]
                  .filter(Boolean)
                  .join(" / "),
          ],
          ["Total Weight", d.ornament_weight ? d.ornament_weight + " g" : ""],
          [
            "Nominee",
            d.nominee_name
              ? `${d.nominee_name} (${d.nominee_relation || "—"})`
              : "",
          ],
          ["PAN", d.pan],
          ["DOB", d.dob],
          ["Occupation", d.occupation],
          ["Referral", d.referral],
          ["Comments", d.comments],
        ];
      } else if (r.section === "fd") {
        detailFields = [
          ["FD A/c No", d.fd_acc_no],
          ["Parvati No", d.fd_parvati_no],
          ["Saving A/c No", d.saving_acc_no],
          [
            "FD Amount",
            d.fd_amount
              ? "₹ " + Number(d.fd_amount).toLocaleString("en-IN")
              : "",
          ],
          ["Amount (Words)", d.fd_amount_words],
          ["FD Period", d.fd_period],
          ["Interest Rate", d.fd_interest_rate ? d.fd_interest_rate + "%" : ""],
          ["Maturity Date", d.fd_maturity_date],
          [
            "Maturity Amount",
            d.fd_maturity_amount
              ? "₹ " + Number(d.fd_maturity_amount).toLocaleString("en-IN")
              : "",
          ],
          [
            "Nominee",
            d.nominee_name
              ? `${d.nominee_name} (${d.nominee_relation || "—"})`
              : "",
          ],
          ["PAN", d.pan],
          ["DOB", d.dob],
          ["Comments", d.comments],
        ];
      } else {
        detailFields = [
          ["Saving A/c No", d.saving_acc_no],
          ["Share A/c No", d.share_acc_no],
          ...(dbTxTypeFilter === "Saving Deposit" ||
          dbTxTypeFilter === "Saving Withdrawal"
            ? (function () {
                const isDeposit = dbTxTypeFilter === "Saving Deposit";
                const rb = (window._runningBalMap || {})[r.id] || {};
                const prevBal =
                  rb.prevBal != null
                    ? rb.prevBal
                    : d.saving_balance
                      ? parseFloat(d.saving_balance)
                      : null;
                const resultBal = rb.resultBal;
                return [
                  [
                    isDeposit ? "Deposit Amount" : "Withdrawal Amount",
                    d.deposit_amount
                      ? "₹ " + Number(d.deposit_amount).toLocaleString("en-IN")
                      : "",
                  ],
                  ["Amount (Words)", d.deposit_amount_words],
                  [
                    "Previous Balance",
                    prevBal != null
                      ? "₹ " + prevBal.toLocaleString("en-IN")
                      : "",
                  ],
                  [
                    isDeposit
                      ? "Total Balance After"
                      : "Remaining Balance After",
                    resultBal != null
                      ? "₹ " + resultBal.toLocaleString("en-IN")
                      : "",
                  ],
                ];
              })()
            : [
                [
                  "Saving Balance",
                  d.saving_balance
                    ? "₹ " + Number(d.saving_balance).toLocaleString("en-IN")
                    : "",
                ],
              ]),
          [
            "Nominee",
            d.nominee_name
              ? `${d.nominee_name} (${d.nominee_relation || "—"})`
              : "",
          ],
          ["PAN", d.pan],
          ["DOB", d.dob],
          ["Occupation", d.occupation],
          ["Referral", d.referral],
          ["Comments", d.comments],
        ];
      }
      const photos = [
        { src: d.photo_customer, lbl: "Customer" },
        { src: d.photo_ornament, lbl: "Ornament" },
        { src: d.photo_aadhar_front, lbl: "Aadhar Front" },
        { src: d.photo_aadhar_back, lbl: "Aadhar Back" },
        { src: d.photo_pan, lbl: "PAN" },
      ].filter((p) => p.src);
      const photoHtml = photos
        .map(
          (p) =>
            `<div style="text-align:center"><img src="${p.src}" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1.5px solid #ddd"><div style="font-size:8px;color:#777;margin-top:2px">${p.lbl}</div></div>`,
        )
        .join("");
      const fieldHtml = detailFields
        .filter((f) => f[1])
        .map(
          (f) =>
            `<div style="font-size:8.5pt"><span style="color:#888;font-weight:600">${f[0]}:</span> <strong>${f[1]}</strong></div>`,
        )
        .join("");
      const detailRow = `<tr id="detail-${r.id}" style="display:none;background:#f8f9ff">
    <td colspan="10" style="padding:10px 16px;border-top:1px solid #e0e7ff">
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:220px;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">${fieldHtml}</div>
        ${photos.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${photoHtml}</div>` : ""}
      </div>
    </td>
  </tr>`;

      return `<tr style="cursor:pointer;${isClosed ? "opacity:0.65;" : ""}" onclick="toggleDetail(${r.id},this)">
<td>${dbOff + i + 1}</td><td style="white-space:nowrap">${_fmtDbDate(r.date)}</td>
<td><strong>${r.name || "—"}</strong>${photoThumb}${closedBadge}${extraInfo}</td>
<td>Regular</td>
<td style="font-size:9px">${r.aadhar || "—"}</td>
<td style="white-space:nowrap">${r.mobile || "—"}</td>
<td style="font-size:9px">${acct}</td>
<td style="font-size:8.5pt;color:#555;line-height:1.5">${extraCol}</td>
<td><span class="badge" style="${bs}">${(function (raw) {
        if (!raw) return "—";
        if (Array.isArray(raw)) return raw.join(", ").substring(0, 36);
        const s = String(raw).trim();
        if (s.startsWith("[") || s.startsWith("{")) {
          try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed))
              return parsed.join(", ").substring(0, 36);
            if (typeof parsed === "object")
              return Object.values(parsed).join(", ").substring(0, 36);
          } catch (e) {}
          return s
            .replace(/[\[\]{}\'"]/g, "")
            .replace(/,/g, ", ")
            .substring(0, 36);
        }
        return s.substring(0, 36);
      })(r.tx_types)}</span></td>
<td class="db-actions-col"><div class="abtns">
  ${r.id ? `<button class="sb" style="background:#daeef8;color:#3a8fbf" onclick="event.stopPropagation();editRec(${r.id})">✏️</button>` : ``}
  ${r.id ? `<button class="sb" style="background:#fde8d8;color:#e87b50" onclick="event.stopPropagation();pdfRec(${r.id})">📄</button>` : ``}
  ${(() => {
    if (!r.id) return ``;
    // These types must not be re-closed once closed — show Reopen instead
    const PROTECTED_TYPES = [
      "Gold Loan",
      "Slips - Loan",
      "Closing - Loan",
      "Saving Account",
      "Closing - Saving Account",
      "Sadasya",
      "New Sadasya",
      "Closing - Sadasya",
      "Naammatr Sabhasad Account",
      "New Naammatr Sabhasad",
      "Closing - Naammatr Sadasya",
    ];
    const protectedClosed = [...closedTypes].some((t) =>
      PROTECTED_TYPES.includes(t),
    );
    if (isClosed || protectedClosed) {
      return `<button class="sb" style="background:#d4f5e9;color:#2a7a50" title="Reopen Record" onclick="event.stopPropagation();reopenRec(${r.id})">🔓</button>`;
    }
    const sect = dbTxFilter || document.getElementById("db-sect").value;
    if (hasOpenTypes && sect) {
      return `<button class="sb" style="background:#fde0e8;color:#c0392b" title="Close Account/Loan" data-close-id="${r.id}" data-close-sect="${sect}">🔒</button>`;
    }
    return ``;
  })()}
  <button class="sb" style="background:#fde0e8;color:#d04070" onclick="event.stopPropagation();delRec(${r.id})">🗑️</button>
</div></td></tr>${detailRow}`;
    })
    .join("");
}

function renderPages() {
  const pg = document.getElementById("db-pages");
  const pages = Math.ceil(dbTot / 50),
    cur = Math.floor(dbOff / 50);
  if (pages <= 1) {
    pg.innerHTML = `<span style="font-size:10px;color:var(--textl)">${dbTot} record(s)</span>`;
    return;
  }
  let h = `<span style="font-size:10px;color:var(--textl)">${dbTot} total</span>`;
  if (cur > 0)
    h += `<button class="btn" style="background:var(--mint);color:var(--mint-a);padding:6px 11px;font-size:10px" onclick="goPage(${cur - 1})">← Prev</button>`;
  h += `<span style="font-size:10px;font-weight:700;padding:0 7px">Page ${cur + 1}/${pages}</span>`;
  if (cur < pages - 1)
    h += `<button class="btn" style="background:var(--mint);color:var(--mint-a);padding:6px 11px;font-size:10px" onclick="goPage(${cur + 1})">Next →</button>`;
  pg.innerHTML = h;
}
function goPage(p) {
  dbOff = p * 50;
  loadDB();
}

function toggleDetail(id, row) {
  const detail = document.getElementById("detail-" + id);
  if (!detail) return;
  const isOpen = detail.style.display !== "none";
  detail.style.display = isOpen ? "none" : "table-row";
  row.style.background = isOpen ? "" : "#eef2ff";
}

async function delRec(id) {
  if (!id || id === "null" || id === "undefined") {
    toast("Record ID missing — cannot delete", "err");
    console.error("delRec called with invalid id:", id);
    return;
  }
  if (!confirm("Delete this record?")) return;
  const delRes = await fetch(API + "/" + id, { method: "DELETE", headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
  if (!delRes.ok) {
    const errJ = await delRes.json().catch(() => ({}));
    toast("Delete failed: " + (errJ.error || delRes.status), "err");
    return;
  }
  toast("Deleted", "err");
  invalidateSavingCache();
  loadDB();
  loadDashboard();
}

async function editRec(id) {
  if (!id || id === "null" || id === "undefined") {
    toast("Record ID missing — cannot edit", "err");
    console.error("editRec called with invalid id:", id);
    return;
  }
  const rec = await (await fetch(API + "/" + id)).json();
  window._editRec = rec;
  editId = id;
  const d2 = rec.data || {};
  let html = "";
  SECTIONS.forEach((s) => {
    const vis = s.fields.filter(
      (f) => f.type !== "photo" && (d2[f.id] !== undefined || f.req),
    );
    if (!vis.length) return;
    html += `<div class="sec-lbl">${s.sec}</div><div class="fgrid">`;
    vis.forEach((f) => {
      const cls = f.w === 2 ? "fw" : "",
        val = d2[f.id] || "";
      if (f.type === "textarea")
        html += `<div class="field ${cls}"><label>${f.label}</label><textarea id="ef-${f.id}">${val}</textarea></div>`;
      else if (f.type === "select") {
        const onchg = f.id === "fd_sub_type" ? ` onchange="onFdSubTypeChange(this.value)"` : "";
        const defaultOpt = f.id === "fd_sub_type" ? `<option value="">-- Select FD Type --</option>` : "";
        html += `<div class="field ${cls}"><label>${f.label}</label><select id="ef-${f.id}"${onchg}>${defaultOpt}${(f.opts || []).map((o) => `<option ${o === val ? "selected" : ""}>${o}</option>`).join("")}</select></div>`;
      }
      else
        html += `<div class="field ${cls}"><label>${f.label}</label><input type="${f.type}" id="ef-${f.id}" value="${val}"></div>`;
    });
    html += "</div>";
  });
  document.getElementById("edit-body").innerHTML = html;
  document.getElementById("edit-modal").classList.add("open");
}

async function saveEdit() {
  const rec =
    window._editRec || (await (await fetch(API + "/" + editId)).json());
  const nd = { ...rec.data };
  SECTIONS.forEach((s) =>
    s.fields.forEach((f) => {
      const el = document.getElementById("ef-" + f.id);
      if (el) nd[f.id] = el.value;
    }),
  );
  const editRes = await fetch(API + "/" + editId, {
    method: "PUT",
    headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
    body: JSON.stringify({
      name: nd.customer_name || rec.name,
      customer_id: nd.customer_id || rec.customer_id,
      customer_type: rec.customer_type,
      aadhar: nd.aadhar || rec.aadhar,
      mobile: nd.mobile || rec.mobile,
      account_no:
        rec.section === "gold" || rec.section === "od"
          ? nd.loan_acc_no || rec.account_no
          : rec.section === "fd"
            ? nd.fd_acc_no || nd.mis_acc_no || rec.account_no
            : nd.saving_acc_no || rec.account_no,
      date: nd.date || rec.date,
      section: rec.section,
      tx_types: rec.tx_types,
      data: nd,
      remarks: nd.comments || "",
    }),
  });
  if (!editRes.ok) {
    const errJ = await editRes.json().catch(() => ({}));
    toast("Update failed: " + (errJ.error || editRes.status), "err");
    return;
  }
  // Sync derived tables (gold_loans, fd_accounts, saving_accounts, od_loans, memberships)
  try {
    await fetch(API + "/process-transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify({
        tx_types: rec.tx_types,
        data: nd,
        record_id: editId,
        customer_name: nd.customer_name || rec.name,
      }),
    });
  } catch (e) {
    console.warn("process-transaction after edit failed:", e.message);
  }
  closeEdit();
  invalidateSavingCache();
  loadDB();
  toast("✅ Updated!", "ok");
}
function closeEdit() {
  document.getElementById("edit-modal").classList.remove("open");
  editId = null;
  window._editRec = null;
}

async function pdfRec(id) {
  if (!id || id === "null" || id === "undefined") {
    toast("Record ID missing — cannot generate PDF", "err");
    console.error("pdfRec called with invalid id:", id);
    return;
  }
  const rec = await (await fetch(API + "/" + id)).json();
  const txArr = parseTxTypes(rec.tx_types);
  const data = { ...(rec.data || {}) };
  // Restore key top-level fields if missing in data blob
  if (!data.customer_name) data.customer_name = rec.name;
  if (!data.aadhar) data.aadhar = rec.aadhar;
  if (!data.mobile) data.mobile = rec.mobile;
  if (!data.saving_acc_no && rec.account_no)
    data.saving_acc_no = rec.account_no;
  if (!data.customer_id) data.customer_id = rec.customer_id;
  if (!data.date) data.date = rec.date;
  // For MIS FD records: restore mis_acc_no from account_no if missing in data blob
  if (!data.mis_acc_no && rec.section === "fd" && rec.account_no &&
      String(rec.account_no).startsWith("290"))
    data.mis_acc_no = rec.account_no;
  // For Closing - Loan: always use the closing date from the form, never the original loan date
  if (txArr.includes("Closing - Loan") && window._closingOriginalDate) {
    data.date = data.date || window._closingOriginalDate;
  }
  // BUG FIX: records.data.saving_balance is kept in sync with the live
  // saving_accounts table by the backend (see process-transaction's
  // "saving balance synced to records.data" step) — so by the time we
  // reprint here, it already holds the balance AFTER this deposit/withdrawal
  // was applied. But savingDepositSlipPage()/savingWithdrawalSlipPage() both
  // expect savBal to be the BEFORE balance and compute before±amount=after
  // themselves (see their own comments). Left alone, reprinting double-counts
  // the transaction — e.g. a withdrawal's "उर्वरित शिल्लक" came out as a
  // large negative number instead of the real current balance. Reconstruct
  // the before-balance here so that formula lands back on the correct value.
  if (
    (txArr.includes("Saving Withdrawal") || txArr.includes("Saving Deposit")) &&
    data.saving_balance != null &&
    data.saving_balance !== ""
  ) {
    const _swAmt = parseFloat(data.deposit_amount) || 0;
    const _swStoredBal = parseFloat(data.saving_balance) || 0;
    if (_swAmt > 0) {
      data.saving_balance = txArr.includes("Saving Withdrawal")
        ? _swStoredBal + _swAmt
        : _swStoredBal - _swAmt;
    }
  }
  const pC = ctype;
  try {
    ctype = "regular";
    let pdfTxArrRec = [...txArr];

    // For a CLOSED gold loan record, generate closing PDF (not re-opening PDF)
    const isClosedGoldLoan = (rec.status === "closed" || rec.status === "partially_closed") &&
      txArr.some((t) => ["Gold Loan", "Slips - Loan"].includes(t)) &&
      !txArr.includes("Closing - Loan");
    if (isClosedGoldLoan) {
      // Build closing data from original record
      pdfTxArrRec = ["Closing - Loan"];
      generateTemplatePDF(pdfTxArrRec, data);
      toast("📄 Closing PDF ready", "ok");
      return;
    }

    if (txArr.includes("Gold Loan") && !txArr.includes("Gold Receipt")) {
      pdfTxArrRec = pdfTxArrRec
        .map((t) =>
          t === "Gold Loan"
            ? ["Gold Loan", "Slips - Loan", "Gold Receipt", "Blank Page"]
            : [t],
        )
        .flat();
    }
    if (txArr.includes("New FD-OD Loan") && !txArr.includes("Slips - FD-OD")) {
      pdfTxArrRec = pdfTxArrRec
        .map((t) =>
          t === "New FD-OD Loan" ? ["New FD-OD Loan", "Slips - FD-OD"] : [t],
        )
        .flat();
    }
    if (txArr.includes("New FD") || txArr.includes("New FD - Term")) {
      // Detect MIS from saved data (fd_sub_type or mis_acc_no) — DOM may not be open during pdfRec
      const isMis = (data.fd_sub_type && FD_TYPE_CONFIG[data.fd_sub_type]?.isMis) ||
                    (!!(data.mis_acc_no && data.mis_acc_no !== "290-" && data.mis_acc_no !== "00103290")) ||
                    _fdSubIsMis();
      // Restore mis_acc_no from account_no if missing (MIS FDs store account_no as mis_acc_no)
      if (isMis && !data.mis_acc_no && rec.account_no) data.mis_acc_no = rec.account_no;
      pdfTxArrRec = pdfTxArrRec
        .map((t) =>
          (t === "New FD" || t === "New FD - Term")
            ? (isMis ? ["Fixed Deposit - MIS", "FD - Slips - MIS", "Form 60-61"] : ["Fixed Deposit", "FD - Slips", "Form 60-61"])
            : [t],
        )
        .flat();
    }
    if (txArr.includes("New FD - MIS")) {
      pdfTxArrRec = pdfTxArrRec
        .map((t) =>
          t === "New FD - MIS" ? ["Fixed Deposit - MIS", "FD - Slips - MIS", "Form 60-61"] : [t],
        )
        .flat();
    }
    if (
      txArr.includes("MIS Interest") &&
      !pdfTxArrRec.includes("MIS Interest - Slips")
    ) {
      pdfTxArrRec = pdfTxArrRec
        .map((t) => (t === "MIS Interest" ? ["MIS Interest - Slips"] : [t]))
        .flat();
    }
    if (txArr.includes("Saving Deposit") && !pdfTxArrRec.includes("Saving - Deposit Slip")) {
      pdfTxArrRec = pdfTxArrRec
        .map((t) => (t === "Saving Deposit" ? ["Saving - Deposit Slip"] : [t]))
        .flat();
    }
    if (txArr.includes("Saving Withdrawal") && !pdfTxArrRec.includes("Saving - Withdrawal Slip")) {
      pdfTxArrRec = pdfTxArrRec
        .map((t) => (t === "Saving Withdrawal" ? ["Saving - Withdrawal Slip"] : [t]))
        .flat();
    }
    if (txArr.includes("New Sadasya")) {
      pdfTxArrRec = pdfTxArrRec
        .map((t) => (t === "New Sadasya" ? ["Sadasya", "Sadasya - Slips"] : [t]))
        .flat();
      if (data.saving_balance && Number(data.saving_balance) > 0)
        pdfTxArrRec.push("Saving - Deposit Slip");
    }
    if (txArr.includes("New Naammatr Sabhasad")) {
      pdfTxArrRec = pdfTxArrRec
        .map((t) => (t === "New Naammatr Sabhasad" ? ["Naammatr Sabhasad Account", "Naammatr Sabhasad - Slips"] : [t]))
        .flat();
    }
    if (txArr.includes("Closing - FD") && !pdfTxArrRec.includes("Closing - FD - Slips")) {
      pdfTxArrRec = pdfTxArrRec
        .map((t) => (t === "Closing - FD" ? ["Closing - FD", "Closing - FD - Slips"] : [t]))
        .flat();
    }
    if (txArr.includes("Closing - Loan")) {
      pdfTxArrRec = pdfTxArrRec.filter((t) => t !== "Slips - Loan");
    }
    generateTemplatePDF(pdfTxArrRec, data);
    toast("📄 PDF ready", "ok");
  } finally {
    ctype = pC;
  }
}

async function exportCSV() {
  const q = document.getElementById("db-q")?.value || "";
  const sect = document.getElementById("db-sect")?.value || "";
  const ct = document.getElementById("db-ctype")?.value || "";
  const p = new URLSearchParams({ limit: 9999, offset: 0 });
  if (q) p.set("q", q);
  if (sect) p.set("section", sect);
  if (ct) p.set("customer_type", ct);
  const { records } = await (await fetch(API + "?" + p)).json();
  if (!records.length) {
    toast("No records", "err");
    return;
  }
  const keys = [
    "id",
    "date",
    "name",
    "customer_id",
    "customer_type",
    "aadhar",
    "mobile",
    "account_no",
    "section",
    "tx_types",
    "remarks",
    "created_at",
  ];
  const csv = [
    keys.join(","),
    ...records.map((r) =>
      keys
        .map((k) => `"${(r[k] || "").toString().replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = `JJU_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  toast(`📥 Exported ${records.length} records`, "ok");
}

// ═══════════════════════════════════════
//  IMPORT
// ═══════════════════════════════════════
function onDrop(e) {
  e.preventDefault();
  document.getElementById("drop-zone").classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) processFile(f);
}
function onFileSelect(e) {
  const f = e.target.files[0];
  if (f) processFile(f);
}

function processFile(file) {
  document.getElementById("file-info").style.display = "block";
  document.getElementById("file-info").textContent =
    `📁 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      let rows = [];
      if (file.name.toLowerCase().endsWith(".csv")) {
        rows = parseCSV(e.target.result);
      } else {
        const wb = XLSX.read(e.target.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      }
      if (rows.length < 2) {
        toast("File empty or no data rows", "err");
        return;
      }
      impCols = rows[0].map((c) => String(c).trim());
      impRows = rows.slice(1).filter((r) => r.some((c) => String(c).trim()));
      buildColMap();
      showPreview();
    } catch (err) {
      toast("Error reading file: " + err.message, "err");
    }
  };
  if (file.name.toLowerCase().endsWith(".csv")) reader.readAsText(file);
  else reader.readAsBinaryString(file);
}

function parseCSV(txt) {
  return txt
    .split(/\r?\n/)
    .map((line) => {
      const row = [];
      let cur = "",
        inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') {
            // Escaped quote inside a quoted field
            cur += '"';
            i++;
          } else {
            inQ = !inQ;
          }
        } else if (ch === "," && !inQ) {
          row.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      row.push(cur.trim());
      return row;
    })
    .filter((r) => r.some((c) => c));
}
function autoMatch(fid) {
  const needle = fid.toLowerCase().replace(/_/g, "");
  return impCols.find((c) => {
    const ch = c.toLowerCase().replace(/[\s_\-]/g, "");
    return (
      ch === needle ||
      ch.includes(needle) ||
      needle.includes(ch.substring(0, 5))
    );
  });
}
function buildColMap() {
  document.getElementById("col-map").innerHTML = IMP_FIELDS.map((f) => {
    const match = autoMatch(f.id);
    return `<div class="map-item"><label>${f.label}</label>
<select id="map-${f.id}"><option value="">(skip)</option>
  ${impCols.map((c) => `<option value="${c}"${c === match ? " selected" : ""}>${c}</option>`).join("")}
</select></div>`;
  }).join("");
  document.getElementById("map-card").style.display = "block";
}
function showPreview() {
  const n = Math.min(impRows.length, 5);
  document.getElementById("preview-info").textContent =
    `${impRows.length} records found. Preview of first ${n} rows:`;
  const hd = impCols
    .map(
      (c) =>
        `<th style="background:var(--mint);padding:5px 7px;font-size:8px;font-weight:800;color:var(--mint-a);white-space:nowrap">${c}</th>`,
    )
    .join("");
  const tb = impRows
    .slice(0, n)
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td style="padding:4px 7px;font-size:9px;border-bottom:1px solid var(--border)">${c}</td>`).join("")}</tr>`,
    )
    .join("");
  document.getElementById("preview-table").innerHTML =
    `<table style="border-collapse:collapse;background:#fff;min-width:400px"><thead><tr>${hd}</tr></thead><tbody>${tb}</tbody></table>`;
  document.getElementById("preview-card").style.display = "block";
}

async function doImport() {
  const section = document.getElementById("imp-section").value;
  const custType = document.getElementById("imp-ctype").value;
  const mapping = {};
  IMP_FIELDS.forEach((f) => {
    const v = document.getElementById("map-" + f.id)?.value;
    if (v) mapping[f.id] = v;
  });
  if (!mapping.name) {
    toast("Map Customer Name column first", "err");
    return;
  }
  const colIdx = {};
  impCols.forEach((c, i) => (colIdx[c] = i));
  const records = impRows
    .map((row) => {
      const rec = { section, customer_type: custType, data: {} };
      IMP_FIELDS.forEach((f) => {
        if (mapping[f.id]) {
          const val = String(row[colIdx[mapping[f.id]]] || "").trim();
          rec[f.id] = val;
          rec.data[f.id] = val;
        }
      });
      return rec.name ? rec : null;
    })
    .filter(Boolean);
  if (!records.length) {
    toast("No valid records to import", "err");
    return;
  }
  const progDiv = document.getElementById("import-prog");
  progDiv.style.display = "block";
  const bar = document.getElementById("prog-bar");
  const ptxt = document.getElementById("prog-text");
  let imported = 0;
  let insertedCount = 0;
  let updatedCount = 0;
  let failedChunks = 0;
  const chunk = 50;
  for (let i = 0; i < records.length; i += chunk) {
    try {
      const res = await fetch(API + "/import/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
        body: JSON.stringify({ records: records.slice(i, i + chunk) }),
      });
      const j = await res.json();
      if (!res.ok) {
        // FIX: a bad row anywhere in a chunk rolls back that whole chunk of up
        // to 50 records server-side — surface that instead of silently
        // reporting it as 0 imported with no explanation.
        failedChunks++;
        console.warn("[import] chunk failed:", j.error);
      } else {
        imported += j.count || 0;
        insertedCount += j.inserted || 0;
        updatedCount += j.updated || 0;
      }
    } catch (e) {
      toast("Import error: " + e.message, "err");
      break;
    }
    bar.style.width =
      Math.min(Math.round(((i + chunk) / records.length) * 100), 100) + "%";
    ptxt.textContent = `Imported ${imported} / ${records.length}…`;
  }
  // FIX (ledger-import alignment): show new-vs-updated so it's clear existing
  // accounts were updated in place (nominee/photo/ornament data preserved),
  // not duplicated — and flag any chunk that failed outright instead of
  // letting it pass as a silent shortfall.
  let msg = `✅ Imported: ${insertedCount} new, ${updatedCount} updated`;
  if (failedChunks) msg += ` — ⚠️ ${failedChunks} batch(es) failed, see console`;
  toast(msg, failedChunks ? "err" : "ok");
  loadDashboard();
  setTimeout(resetImport, 1800);
}
function resetImport() {
  impRows = [];
  impCols = [];
  document.getElementById("file-inp").value = "";
  document.getElementById("file-info").style.display = "none";
  document.getElementById("map-card").style.display = "none";
  document.getElementById("preview-card").style.display = "none";
  document.getElementById("import-prog").style.display = "none";
  document.getElementById("prog-bar").style.width = "0%";
}

// ═══════════════════════════════════════
//  CASH BOOK
// ═══════════════════════════════════════

const CB_API = "/api/cashbook";

// Module-level constants — defined once instead of rebuilt on every addCashbookRows call
const BANK_ACC_MAP = {
  "Buldhana Urban Bank - Current Acc (015002100000260)": "945-2",
  "Bank of Maha - FD-OD (60494510691)": "946-2",
  "Bank of Maha - Current Acc (60438097699)": "288-1",
  "THE N.U. BANK Current Acc (003002100000926)": "926-2",
  "Rajarshi Shahu Curr (03202007000046)": "960-2",
  "The Sahyog Urban Curr Acc (8001173)": "952-2",
  "SBI Current Acc (43227989097)": "953-1",
};
const BANK_TASK_MAP = {
  "Buldhana Urban Bank - Current Acc (015002100000260)":
    "Buldhana Urban Bank - Current Acc (015002100000260) - TRF",
  "Bank of Maha - FD-OD (60494510691)":
    "Bank of Maha - FD-OD (60494510691) - TRF",
  "Bank of Maha - Current Acc (60438097699)":
    "Bank of Maha - Current Acc (60438097699) - TRF",
  "THE N.U. BANK Current Acc (003002100000926)":
    "THE N.U. BANK Current Acc (003002100000926) - TRF",
  "Rajarshi Shahu Curr (03202007000046)":
    "Rajarshi Shahu Curr (03202007000046) - TRF",
  "The Sahyog Urban Curr Acc (8001173)":
    "The Sahyog Urban Curr Acc (8001173) - TRF",
  "SBI Current Acc (43227989097)": "SBI Current Acc - TRF",
};

// [static data moved to js/data/static-data.js]

// [static data moved to js/data/static-data.js]

// Determine transaction type from tx type name
function cbTxType(txType) {
  const credits = [
    "Saving Account",
    "Sadasya",
    "Fixed Deposit",
    "Gold Loan",
    "OD Loan",
    "New FD-OD Loan",
    "Naammatr Sabhasad Account",
    "FD - Slips",
    "Sadasya - Slips",
    "Naammatr Sabhasad - Slips",
    "Closing - Loan",
    "Closing - FD",
    "Closing - FD - Slips",
  ];
  const debits = [
    "Slips - Loan",
    "Slips - OD",
    "Slips - FD-OD",
    "Closing - Saving Account",
  ];
  if (credits.includes(txType)) return "Credit";
  if (debits.includes(txType)) return "Debit";
  console.warn(
    "cbTxType: unrecognised txType '" + txType + "' — defaulting to Credit",
  );
  return "Credit";
}

// Determine if transaction is Cash or Transfer
function cbMode(txType) {
  const transfers = [
    "Slips - Loan",
    "Slips - OD",
    "Slips - FD-OD",
    "FD - Slips",
    "Sadasya - Slips",
    "Naammatr Sabhasad - Slips",
    "Closing - FD - Slips",
  ];
  return transfers.includes(txType) ? "Transfer" : "Cash";
}

// Get amount from record data
function cbAmount(rec) {
  const d = rec.data || {};
  return (
    parseFloat(
      d.loan_amount || d.fd_amount || d.expense_amount || d.saving_balance || 0,
    ) || 0
  );
}

// Add cashbook entries automatically when a record is saved
// ── IN-MEMORY ONLY — entries live here until user clicks Generate/Print ──
async function addCashbookRows(recordId, data, txArr) {
  try {
    // For Closing - Loan: always use the form date (= closing date), not fallback to today
    const date = (data.date || new Date().toISOString()).split("T")[0];

    // For Closing - Loan: merge pre-fetched interest data so amountField:"total_amount" resolves correctly
    if (txArr.includes("Closing - Loan") && window._closingInterestData) {
      data = Object.assign({}, data, window._closingInterestData);
    }
    // For internal bank tx (RTGS, Bank Charges, TDS etc), use bank_acc_name or tx type as name
    const internalBankTypes = ["RTGS", "Bank Charges", "Other Bank - Cash Withdrawal", "Other Bank - Cash Deposit", "TDS", "Interest Received on FD from Other Bank"];
    const isInternalBank = txArr.some(t => internalBankTypes.includes(t));
    const name = txArr.includes("RTGS")
      ? ((data.rtgs_from_acc || "") + " → " + (data.rtgs_to_acc || "")).trim() || "RTGS"
      : isInternalBank
        ? (data.bank_acc_name || txArr[0] || "Bank TRF")
        : txArr.includes("Saving Acc Transfer")
          ? ((data.from_saving_acc_no || "") + " → " + (data.to_saving_acc_no || "")).trim() || "Saving Acc Transfer"
          : (data.customer_name || "");
    const entries = [];
    let sortOrder = 0;

    // If Gold Loan is selected along with Slips - Loan, skip Slips - Loan
    // to avoid double entries (Gold Loan already covers all 4 rows)
    const skipTypes = new Set();
    if (txArr.includes("Gold Loan") && txArr.includes("Slips - Loan")) {
      skipTypes.add("Slips - Loan");
    }
    // Skip standalone Saving Account row when Gold Loan is selected
    // (Gold Loan already generates the saving account rows)
    if (txArr.includes("Gold Loan") && txArr.includes("Saving Account")) {
      skipTypes.add("Saving Account");
    }
    // Skip Saving Account when New Sadasya selected — New Sadasya covers all 4 rows
    if (txArr.includes("New Sadasya") && txArr.includes("Saving Account")) {
      skipTypes.add("Saving Account");
    }
    if (txArr.includes("Fixed Deposit") && txArr.includes("FD - Slips")) {
      skipTypes.add("FD - Slips");
    }
    if (txArr.includes("New FD")) {
      skipTypes.add("Fixed Deposit");
      skipTypes.add("FD - Slips");
    }
    if (
      txArr.includes("Closing - FD") &&
      txArr.includes("Closing - FD - Slips")
    ) {
      skipTypes.add("Closing - FD - Slips");
    }

    // Expand txArr: when New Sadasya is selected, also emit "New Saving Account" rows
    const expandedTxArr = [...txArr];
    if (
      txArr.includes("New Sadasya") &&
      !txArr.includes("New Saving Account")
    ) {
      expandedTxArr.push("New Saving Account");
    }

    expandedTxArr.forEach((txType) => {
      if (skipTypes.has(txType)) return;
      const rows = CB_TX_ROWS_MAP[txType];
      if (!rows) return;
      rows.forEach((row) => {
        // Skip saving acc TRF row from New Sadasya when Gold Loan already handles it
        if (row.skipWhenGoldLoan && txArr.includes("Gold Loan")) return;
        // For New FD-OD Loan: skip the Fixed Deposit Debit row (first row) —
        // it's an internal book entry that doesn't belong in the cashbook register
        if (
          txArr.includes("New FD-OD Loan") &&
          (row.acc_type === "Fixed Deposit" || row.task === "Fixed Deposit") &&
          row.tx_type === "Debit"
        ) return;

        let amount = 0;
        if (typeof row.amountField === "number" && row.amountField > 0) {
          // Fixed amount (e.g. Loan Form Fee = 50)
          amount = row.amountField;
        } else if (row.amountField && typeof row.amountField === "string") {
          // Pull from form data field
          amount = parseFloat(data[row.amountField]) || 0;
        }
        entries.push({
          date,
          record_id: recordId,
          name,
          task:
            row.isBeneficiary && row.acc_type_field
              ? (() => {
                  // For RTGS/isBeneficiary rows, use the actual account name as task.
                  // beneficiarySuffix lets a specific row template override the
                  // default " - TRF" (e.g. " - Withdrawal" / " - Deposit" for the
                  // Other Bank - Cash Deposit/Withdrawal pairing) — templates that
                  // don't set it keep the original " - TRF" behavior unchanged.
                  const accVal = data[row.acc_type_field] || "";
                  const suffix =
                    row.beneficiarySuffix !== undefined
                      ? row.beneficiarySuffix
                      : " - TRF";
                  return accVal ? accVal + suffix : row.task;
                })()
              : row.acc_type === "Bank TRF" && data.bank_acc_name
              ? (BANK_TASK_MAP[data.bank_acc_name] || data.bank_acc_name + " - TRF")
              : row.task,
          acc_type: row.isBeneficiary
            ? (() => {
                const accVal = data[row.acc_type_field] || "";
                if (!accVal) return row.acc_type;
                // suffixAccType: show the same suffixed label in the ACCOUNT TYPE
                // column too (renderLedgerCashBook etc. display r.acc_type first),
                // so e.g. "THE N.U. BANK Current Acc (...) - Withdrawal" is what
                // actually appears, matching the paired task label above.
                if (!row.suffixAccType) return accVal;
                const suffix =
                  row.beneficiarySuffix !== undefined
                    ? row.beneficiarySuffix
                    : " - TRF";
                return accVal + suffix;
              })()
            : row.acc_type === "Bank TRF" && data.bank_acc_name
              ? data.bank_acc_name
              : row.acc_type,
          tx_type: row.tx_type,
          acc_no: (() => {
            // Beneficiary rows — resolve ledger code from BANK_ACC_MAP if possible
            if (row.isBeneficiary) {
              const val = data[row.acc_no];
              // FIX: row.acc_no here is a form-field NAME (e.g. "fd_acc_no"),
              // not a literal ledger code — falling back to it verbatim leaks
              // the placeholder string into the account-no cell. Only fall
              // back to it when the template never set accFallback at all
              // (undefined); an explicit accFallback of "" means "show blank".
              return BANK_ACC_MAP[val] || val ||
                (row.accFallback !== undefined ? row.accFallback : row.acc_no);
            }
            // For Bank TRF rows, resolve acc_no from bank_acc_name mapping
            if (
              row.acc_type === "Bank TRF" &&
              data.bank_acc_name &&
              BANK_ACC_MAP[data.bank_acc_name]
            ) {
              return BANK_ACC_MAP[data.bank_acc_name];
            }
            // FIX: same bug as above — when neither the primary nor the alt
            // form field has a value yet, this used to fall back to
            // `row.acc_no` even when that's a field-name reference like
            // "fd_acc_no" rather than a real literal ledger code (e.g. "43"),
            // so the raw placeholder text got written into the ledger row
            // and displayed verbatim. Respect an explicit accFallback of ""
            // (meaning "leave this blank until the real value exists") and
            // only fall back to row.acc_no when no accFallback was set at all.
            return (row.acc_no && data[row.acc_no])
              ? data[row.acc_no]
              : (row.acc_no_alt && data[row.acc_no_alt])
              ? data[row.acc_no_alt]
              : (row.accFallback !== undefined ? row.accFallback : row.acc_no);
          })(),
          amount,
          mode: row.mode,
          scroll_no: txArr.includes("Saving Acc Transfer") ? (data.transfer_ref_no || "") : "",
          loan_date: "",
          sort_order: sortOrder++,
        });
      });
    });

    if (entries.length === 0) {
      console.warn(
        "addCashbookRows: 0 entries built for txArr=",
        txArr,
        "data=",
        data,
      );
      // BUG FIX (robustness): this used to just `return` with no status,
      // which loadLedger()'s auto-gen step treated identically to a real
      // failure vs. a real success — it had no way to tell "nothing to
      // generate for these tx types" apart from "the save failed", so it
      // could never safely decide whether to retry. Returning an explicit
      // status lets the caller make that call (see loadLedger()).
      return { status: "empty" };
    }

    // ── Save to DB: all entries in a single atomic /bulk call ──
    try {
      // Send all entries together; the first has no parent_id (it IS the parent).
      // We don't need a DB-level parent_id link here because record_id already
      // groups sibling rows — using two separate calls was causing orphaned parents
      // when the child insert failed.
      const bulkEntries = entries.map((e, i) => ({
        ...e,
        parent_id: null,          // flat insert — grouped by record_id on read
        record_id: e.record_id || recordId,
        name: e.name || name,
      }));

      const bulkRes = await _fetchWithTimeout(CB_API + "/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
        body: JSON.stringify({ entries: bulkEntries }),
      }, 20000);
      if (!bulkRes.ok) {
        const errText = await bulkRes.text().catch(() => bulkRes.status);
        console.error("addCashbookRows: bulk insert failed:", errText);
        toast("⚠️ Ledger rows save failed: " + errText, "err");
        // BUG FIX: previously returned nothing here, indistinguishable from
        // success to the caller — loadLedger() would mark this record as
        // "auto-gen attempted" forever, so a failed save (e.g. a transient
        // network error) meant that transaction's ledger rows would NEVER
        // be generated again unless someone reloaded the whole page. An
        // explicit "failed" status lets loadLedger() retry it next load.
        return { status: "failed", error: errText };
      }
      const bulkSaved = await bulkRes.json();
      const allSaved = bulkSaved.entries || [];

      // Push all saved rows (with real DB ids) to in-memory arrays
      allSaved.forEach((e) => {
        if (e) {
          e._saved = true;
          ledgerAllRows.push(e);
        }
      });

      // Push parent record to ledgerRecords if not already there
      if (recordId && !ledgerRecords.find((r) => r.id === recordId)) {
        ledgerRecords.push({
          id: recordId,
          name: data.customer_name || data.name || "",
          tx_types: txArr.join(","),
          date: date,
        });
      }
      console.log(
        "addCashbookRows: saved",
        allSaved.length,
        "rows to DB for",
        txArr,
      );
      toast("✅ " + allSaved.length + " ledger rows saved", "ok");
      // Re-render ledger if it's visible. BUG FIX: this used to run after
      // the inner try/catch, unconditionally — moved inside the success
      // path (before its `return`) so adding an early return for the
      // success/failure status (see BUG FIX notes above) doesn't
      // accidentally skip it.
      try {
        renderLedger();
      } catch (e) {}
      return { status: "saved", count: allSaved.length };
    } catch (bulkErr) {
      console.error("addCashbookRows: fetch error:", bulkErr);
      toast("⚠️ Ledger rows error: " + bulkErr.message, "err");
      // See BUG FIX note above — must report failure so the caller can retry.
      return { status: "failed", error: bulkErr.message };
    }
  } catch (e) {
    console.error("Cashbook auto-fill error:", e);
    toast("⚠️ Cashbook auto-fill error: " + e.message, "err");
    // See BUG FIX note above — must report failure so the caller can retry.
    return { status: "failed", error: e.message };
  }
}

let cbData = null;

async function loadPrevClosingAsOpening() {
  const dateEl = document.getElementById("cb-date");
  const openEl = document.getElementById("cb-opening");
  if (!dateEl.value) {
    toast("Select a date first", "err");
    return;
  }
  const dt = new Date(dateEl.value);
  dt.setDate(dt.getDate() - 1);
  const prevDate = dt.toISOString().split("T")[0];
  try {
    let entries;
    const todayStr = new Date().toISOString().split("T")[0];
    if (prevDate === todayStr && ledgerAllRows.length > 0) {
      entries = ledgerAllRows.filter((r) => !r.date || r.date === prevDate);
    } else {
      const resp = await fetch(CB_API + "?date=" + prevDate, { headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
      const json = await resp.json();
      entries = json.entries || [];
    }
    const prevOpening =
      parseFloat(
        document
          .getElementById("cb-opening")
          ?.getAttribute("data-prev-opening") || "0",
      ) || 0;
    const txRows = entries.map((e) => ({
      txType: e.tx_type,
      amount: parseFloat(e.amount) || 0,
      mode: e.mode,
    }));
    const cashRows = txRows.filter((r) => r.mode === "Cash");
    const totalCredit = cashRows
      .filter((r) => r.txType === "Credit")
      .reduce((s, r) => s + r.amount, 0);
    const totalDebit = cashRows
      .filter((r) => r.txType === "Debit")
      .reduce((s, r) => s + r.amount, 0);
    // We need prev opening too - check localStorage
    const savedPrevOpening =
      parseFloat(localStorage.getItem("cb-opening-" + prevDate) || "0") || 0;
    const prevClosing = savedPrevOpening + totalCredit - totalDebit;
    openEl.value = prevClosing;
    localStorage.setItem("cb-opening-" + dateEl.value, prevClosing);
    const missingWarning =
      savedPrevOpening === 0
        ? ` ⚠️ Opening balance for ${prevDate} was 0 or not set — verify this is correct.`
        : "";
    toast(
      `Previous closing (${prevDate}): ₹${prevClosing.toLocaleString("en-IN")} set as opening balance${missingWarning}`,
      savedPrevOpening === 0 ? "err" : "ok",
    );
  } catch (e) {
    toast("Could not load previous day data", "err");
  }
}

async function loadCashBook() {
  const date = document.getElementById("cb-date").value;
  const opening = parseFloat(document.getElementById("cb-opening").value) || 0;
  if (!date) {
    toast("Select a date", "err");
    return;
  }
  try {
    localStorage.setItem("cb-opening-" + date, opening);
  } catch (e) {}

  let sourceEntries;
  try {
    const resp = await fetch(CB_API + "?date=" + date, { headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
    if (!resp.ok) throw new Error("Server returned " + resp.status);
    const json = await resp.json();
    sourceEntries = json.entries || [];
    // Sync in-memory rows with DB state for today
    const today = new Date().toISOString().split("T")[0];
    if (date === today) {
      const dbIds = new Set(sourceEntries.map((e) => String(e.id)));
      // Merge any unsaved in-memory rows not yet in DB
      const unsavedLocal = ledgerAllRows.filter(
        (r) => !r._saved && (!r.date || r.date === date)
      );
      sourceEntries = [...sourceEntries, ...unsavedLocal];
      // Mark saved rows in ledgerAllRows
      ledgerAllRows.forEach((r) => {
        if (dbIds.has(String(r.id))) r._saved = true;
      });
    }
  } catch (e) {
    toast("❌ Server offline — cannot load cash book", "err");
    showOfflineBanner();
    return;
  }

  const txRows = sourceEntries.map((e, i) => ({
    id: e.id,
    txNo: i + 1,
    name: e.name,
    task: e.task || e.acc_type,
    accType: e.acc_type || e.task,
    txType: e.tx_type,
    accNo: e.acc_no,
    amount: parseFloat(e.amount) || 0,
    mode: e.mode,
    scrollNo: e.scroll_no,
    loanDate: e.loan_date,
    recordId: e.record_id,
  }));

  const credits = txRows.filter((r) => r.txType === "Credit");
  const debits = txRows.filter((r) => r.txType === "Debit");
  const totalCredit = credits.reduce((s, r) => s + r.amount, 0);
  const totalDebit = debits.reduce((s, r) => s + r.amount, 0);
  const closing = opening + totalCredit - totalDebit;

  cbData = { date, opening, closing, totalCredit, totalDebit, txRows };
  renderCashBook(cbData);

  // Only flush if there are actually unsaved entries
  const unsaved = sourceEntries.filter((e) => !e._saved);
  if (unsaved.length) {
    await _flushToDB(date, sourceEntries);
  }
}

// Flush in-memory entries to DB (called only when generating cashbook/PDF)
async function _flushToDB(date, entries) {
  const unsaved = entries.filter((e) => !e._saved);
  if (!unsaved.length) return; // nothing new to save

  try {
    const payload = unsaved.map((e) => ({
      date: e.date || date,
      parent_id: e.parent_id || null,
      record_id: e.record_id || null,
      name: e.name || "",
      task: e.task || e.acc_type || "",
      acc_type: e.acc_type || e.task || "",
      tx_type: e.tx_type || "Credit",
      acc_no: e.acc_no || "",
      amount: parseFloat(e.amount) || 0,
      mode: e.mode || "Cash",
      scroll_no: e.scroll_no || "",
      loan_date: e.loan_date || "",
      sort_order: e.sort_order || 0,
    }));

    const res = await fetch(CB_API + "/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify({ entries: payload }),
    });

    if (res.ok) {
      const saved = await res.json();
      // Match by index: unsaved[i] corresponds to saved.entries[i]
      (saved.entries || []).forEach((dbRow, i) => {
        const memRow = unsaved[i];
        if (memRow) {
          memRow.id = dbRow.id;
          memRow._saved = true;
        }
      });
      toast("✅ " + payload.length + " entries saved to database", "ok");
    } else {
      const err = await res.text().catch(() => res.status);
      toast("⚠️ Could not save to DB: " + err, "err");
    }
  } catch (e) {
    // Server offline — silently skip DB save, PDF still works from memory
    console.warn("_flushToDB: server unreachable, skipping DB save", e.message);
  }
}

function fmt(n) {
  return "₹ " + Number(n).toLocaleString("en-IN");
}

async function cbSaveCell(id, field, value) {
  try {
    const res = await fetch(CB_API + "/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      toast("⚠️ Save failed: " + err, "err");
    }
  } catch (e) {
    toast("⚠️ Save failed — network error", "err");
  }
}

async function cbFullSave(id) {
  const row = document.querySelector(`tr[data-cb-id="${id}"]`);
  if (!row) return;
  const get = (f) => row.querySelector(`[data-field="${f}"]`)?.value ?? "";
  const payload = {
    acc_no: get("acc_no"),
    amount: parseFloat(get("amount")) || 0,
    scroll_no: get("scroll_no"),
    loan_date: get("loan_date"),
    tx_type: get("tx_type"),
    mode: get("mode"),
    task: get("task"),
    acc_type: get("acc_type"),
  };
  try {
    const res = await fetch(CB_API + "/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      toast("⚠️ Save failed: " + err, "err");
      return;
    }
    toast("✅ Row saved", "ok");
    loadLedger();
  } catch (e) {
    toast("⚠️ Save failed — network error", "err");
  }
}

async function cbDeleteRow(id) {
  // Delegate to ldgDeleteRow which handles soft-delete + recycle bin
  await ldgDeleteRow(id);
  loadCashBook();
}

function renderCashBook(d) {
  const fmtAmt = (n) =>
    Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0 });
  const fmtDate = (s) => {
    if (!s) return "";
    const dt = new Date(s);
    if (isNaN(dt)) return s;
    return dt
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/ /g, "-");
  };

  const cashRows = d.txRows.filter((r) => r.mode === "Cash");
  const crRows = cashRows.filter((r) => r.txType === "Credit");
  const dbRows = cashRows.filter((r) => r.txType === "Debit");
  const totalCredit = crRows.reduce((s, r) => s + r.amount, 0);
  const totalDebit = dbRows.reduce((s, r) => s + r.amount, 0);
  const closing = d.opening + totalCredit - totalDebit;

  // Compute dates for summary table
  const todayDt = new Date(d.date);
  const prevDt = new Date(todayDt);
  prevDt.setDate(prevDt.getDate() - 1);
  const prevDateFmt = fmtDate(prevDt.toISOString().split("T")[0]);
  const todayDateFmt = fmtDate(d.date);

  // Currency denomination table
  const denominations = [500, 100, 50, 10, 5, 1];
  const denomRows = denominations
    .map(
      (denom) => `
    <tr>
      <td style="padding:3px 8px;border:1px solid #ccc;text-align:center">${denom}</td>
      <td style="padding:3px 8px;border:1px solid #ccc;text-align:center"><input type="number" min="0" aria-label="Count for ₹${denom}" value="0" style="width:70px;border:none;text-align:center;font-size:9pt;background:transparent" oninput="recalcDenom()" data-denom="${denom}"></td>
      <td style="padding:3px 8px;border:1px solid #ccc;text-align:right" id="denom-amt-${denom}">0</td>
    </tr>`,
    )
    .join("");

  const currencyTable = `
    <table style="border-collapse:collapse;width:100%;font-size:9.5pt">
      <tr style="background:#f5f5f5">
        <th style="padding:4px 8px;border:1px solid #ccc;font-weight:700">Currency</th>
        <th style="padding:4px 8px;border:1px solid #ccc;font-weight:700">No. of Notes</th>
        <th style="padding:4px 8px;border:1px solid #ccc;font-weight:700;text-align:right">Amount (₹)</th>
      </tr>
      ${denomRows}
      <tr style="background:#e8f5e9;font-weight:800">
        <td colspan="2" style="padding:4px 8px;border:1px solid #999;text-align:center">Total</td>
        <td id="denom-total" style="padding:4px 8px;border:1px solid #999;text-align:right;color:#c0392b">0</td>
      </tr>
      <tr style="background:#fffde7">
        <td colspan="2" style="padding:4px 8px;border:1px solid #ccc;text-align:center;font-size:8.5pt;color:#7a5800">Closing Balance (should match)</td>
        <td id="denom-closing-ref" data-closing="${closing}" style="padding:4px 8px;border:1px solid #ccc;text-align:right;font-weight:800;font-size:8.5pt;color:#7a5800">${fmtAmt(closing)}</td>
      </tr>
    </table>`;

  // ── Column header — matches screenshot exactly ──
  const colHdr = `
    <tr style="background:#f0f0f0">
      <th style="padding:5px 8px;border:1px solid #ccc;font-size:9pt;text-align:center;width:52px">Trans<br>No</th>
      <th style="padding:5px 8px;border:1px solid #ccc;font-size:9pt;text-align:left">Name</th>
      <th style="padding:5px 8px;border:1px solid #ccc;font-size:9pt;text-align:left">Transaction Type</th>
      <th style="padding:5px 8px;border:1px solid #ccc;font-size:9pt;text-align:center;width:64px">Acc<br>No</th>
      <th style="padding:5px 8px;border:1px solid #ccc;font-size:9pt;text-align:right;width:80px">Amount</th>
    </tr>`;

  // ── Credit rows ──
  const crTblRows =
    crRows
      .map(
        (r, i) => `
    <tr style="${i % 2 === 0 ? "background:#fff" : "background:#f9fdf9"}">
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;color:#555">${r.txNo}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;font-weight:700">${r.name || "—"}</td>
      <td style="padding:4px 8px;border:1px solid #ddd">${r.accType || r.task || "—"}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;font-weight:600;color:#553c9a">${r.accNo || "—"}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-weight:700">${fmtAmt(r.amount)}</td>
    </tr>`,
      )
      .join("") ||
    `<tr><td colspan="5" style="padding:12px;text-align:center;color:#999;border:1px solid #ddd">No credit entries</td></tr>`;

  // ── Debit rows ──
  const dbTblRows =
    dbRows
      .map(
        (r, i) => `
    <tr style="${i % 2 === 0 ? "background:#fff" : "background:#fff8f8"}">
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;color:#555">${r.txNo}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;font-weight:700">${r.name || "—"}</td>
      <td style="padding:4px 8px;border:1px solid #ddd">${r.accType || r.task || "—"}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;font-weight:600;color:#553c9a">${r.accNo || "—"}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-weight:700">${fmtAmt(r.amount)}</td>
    </tr>`,
      )
      .join("") ||
    `<tr><td colspan="5" style="padding:12px;text-align:center;color:#999;border:1px solid #ddd">No debit entries</td></tr>`;

  const closingColor = closing < 0 ? "#c0392b" : "#1D9E75";
  const closingSign = closing < 0 ? "−₹ " : "₹ ";
  const thStyle = `padding:7px 10px;font-size:11px;font-weight:500;color:#888;border-bottom:0.5px solid rgba(0,0,0,0.08);background:#f5f5f5;letter-spacing:0.03em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
  const thR = thStyle + ";text-align:right";
  const thC = thStyle + ";text-align:center";
  const tdBase = `padding:7px 10px;border-bottom:0.5px solid rgba(0,0,0,0.06);overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;

  const crTblRowsNew =
    crRows
      .map(
        (r, i) => `
    <tr style="background:${i % 2 === 0 ? "#f0faf5" : "#fff"}">
      <td style="${tdBase};text-align:center;width:36px">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#d4edda;font-size:11px;color:#1D9E75;font-weight:500">${r.txNo}</span>
      </td>
      <td style="${tdBase};font-weight:500;font-size:12px;max-width:120px">${r.name || "—"}</td>
      <td style="${tdBase};font-size:12px;color:#555;max-width:140px">${r.accType || r.task || "—"}</td>
      <td style="${tdBase};font-size:11px;color:#185FA5;text-align:center;background:#EBF4FF;font-weight:500">${r.accNo || "—"}</td>
      <td style="${tdBase};text-align:right;font-weight:500;font-size:12px;color:#1D9E75;background:#f0faf5;white-space:nowrap">₹ ${fmtAmt(r.amount)}</td>
    </tr>`,
      )
      .join("") ||
    `<tr><td colspan="5" style="padding:16px;text-align:center;font-size:12px;color:#aaa">No credit entries</td></tr>`;

  const dbTblRowsNew =
    dbRows
      .map(
        (r, i) => `
    <tr style="background:${i % 2 === 0 ? "#fff8f7" : "#fff"}">
      <td style="${tdBase};text-align:center;width:36px">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#fde0dc;font-size:11px;color:#c0392b;font-weight:500">${r.txNo}</span>
      </td>
      <td style="${tdBase};font-weight:500;font-size:12px;max-width:120px">${r.name || "—"}</td>
      <td style="${tdBase};font-size:12px;color:#555;max-width:140px">${r.accType || r.task || "—"}</td>
      <td style="${tdBase};font-size:11px;color:#185FA5;text-align:center;background:#EBF4FF;font-weight:500">${r.accNo || "—"}</td>
      <td style="${tdBase};text-align:right;font-weight:500;font-size:12px;color:#c0392b;background:#fff8f7;white-space:nowrap">₹ ${fmtAmt(r.amount)}</td>
    </tr>`,
      )
      .join("") ||
    `<tr><td colspan="5" style="padding:16px;text-align:center;font-size:12px;color:#aaa">No debit entries</td></tr>`;

  document.getElementById("cb-content").innerHTML = `
  <div id="cb-print-area" style="padding:4px 0 16px">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:16px;padding-top:4px">
      <div style="font-size:15px;font-weight:500">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या.</div>
      <div style="font-size:11px;color:#999;margin-top:3px;letter-spacing:0.06em">DAILY CASH BOOK</div>
      <div style="display:inline-block;margin-top:7px;background:#f0f0f0;border:0.5px solid rgba(0,0,0,0.1);border-radius:20px;padding:3px 14px;font-size:12px;color:#666">${fmtDate(d.date)}</div>
    </div>

    <!-- KPI strip -->
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px">
      <div style="background:#f5f5f5;border-radius:10px;padding:12px 14px;border-left:3px solid #bbb">
        <div style="font-size:11px;color:#999;margin-bottom:4px;letter-spacing:0.03em">Opening balance</div>
        <div style="font-size:19px;font-weight:500;color:#333">₹ ${fmtAmt(d.opening)}</div>
      </div>
      <div style="background:#f0faf5;border-radius:10px;padding:12px 14px;border-left:3px solid #1D9E75">
        <div style="font-size:11px;color:#1D9E75;margin-bottom:4px;letter-spacing:0.03em">Total credit</div>
        <div style="font-size:19px;font-weight:500;color:#1D9E75">₹ ${fmtAmt(totalCredit)}</div>
      </div>
      <div style="background:#fff8f7;border-radius:10px;padding:12px 14px;border-left:3px solid #c0392b">
        <div style="font-size:11px;color:#c0392b;margin-bottom:4px;letter-spacing:0.03em">Total debit</div>
        <div style="font-size:19px;font-weight:500;color:#c0392b">₹ ${fmtAmt(totalDebit)}</div>
      </div>
      <div style="background:${closing < 0 ? "#fff8f7" : "#f0faf5"};border-radius:10px;padding:12px 14px;border-left:3px solid ${closingColor}">
        <div style="font-size:11px;color:${closingColor};margin-bottom:4px;letter-spacing:0.03em">Closing balance</div>
        <div style="font-size:19px;font-weight:500;color:${closingColor}">${closingSign}${fmtAmt(Math.abs(closing))}</div>
      </div>
    </div>

    <!-- Credit + Debit tables -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;align-items:start">
      <div style="background:#fff;border:0.5px solid rgba(0,0,0,0.1);border-radius:12px;overflow:hidden;border-top:2px solid #1D9E75">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:0.5px solid rgba(0,0,0,0.08);background:#f8fefb">
          <div style="display:flex;align-items:center;gap:7px;font-size:12px;font-weight:500;color:#1D9E75">
            <div style="width:8px;height:8px;border-radius:50%;background:#1D9E75"></div>Credit entries
          </div>
          <div style="font-size:13px;font-weight:500;color:#1D9E75;background:#d4edda;padding:2px 10px;border-radius:20px">₹ ${fmtAmt(totalCredit)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
          <colgroup><col style="width:36px"><col style="width:24%"><col><col style="width:14%"><col style="width:18%"></colgroup>
          <thead><tr>
            <th style="${thC}">No</th>
            <th style="${thStyle}">Name</th>
            <th style="${thStyle}">Type</th>
            <th style="${thC}">Acc</th>
            <th style="${thR}">Amount</th>
          </tr></thead>
          <tbody>${crTblRowsNew}</tbody>
        </table>
      </div>
      <div style="background:#fff;border:0.5px solid rgba(0,0,0,0.1);border-radius:12px;overflow:hidden;border-top:2px solid #c0392b">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:0.5px solid rgba(0,0,0,0.08);background:#fff9f8">
          <div style="display:flex;align-items:center;gap:7px;font-size:12px;font-weight:500;color:#c0392b">
            <div style="width:8px;height:8px;border-radius:50%;background:#c0392b"></div>Debit entries
          </div>
          <div style="font-size:13px;font-weight:500;color:#c0392b;background:#fde0dc;padding:2px 10px;border-radius:20px">₹ ${fmtAmt(totalDebit)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
          <colgroup><col style="width:36px"><col style="width:24%"><col><col style="width:14%"><col style="width:18%"></colgroup>
          <thead><tr>
            <th style="${thC}">No</th>
            <th style="${thStyle}">Name</th>
            <th style="${thStyle}">Type</th>
            <th style="${thC}">Acc</th>
            <th style="${thR}">Amount</th>
          </tr></thead>
          <tbody>${dbTblRowsNew}</tbody>
        </table>
      </div>
    </div>

    <!-- Summary + Currency -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;align-items:start">
      <div style="background:#fff;border:0.5px solid rgba(0,0,0,0.1);border-radius:12px;overflow:hidden">
        <div style="padding:10px 14px;border-bottom:0.5px solid rgba(0,0,0,0.08);background:#f8fefb">
          <div style="font-size:11px;font-weight:500;color:#1D9E75;letter-spacing:0.04em;margin-bottom:8px">CREDIT SUMMARY</div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;padding:3px 0"><span>Opening balance</span><span>${prevDateFmt} &nbsp;·&nbsp; ₹ ${fmtAmt(d.opening)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;padding:3px 0"><span>Credit for</span><span style="color:#1D9E75">${todayDateFmt} &nbsp;·&nbsp; ₹ ${fmtAmt(totalCredit)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:500;padding:6px 0 0;border-top:0.5px solid rgba(0,0,0,0.08);margin-top:5px"><span>Total credit</span><span style="color:#1D9E75">₹ ${fmtAmt(d.opening + totalCredit)}</span></div>
        </div>
        <div style="padding:10px 14px;border-bottom:0.5px solid rgba(0,0,0,0.08);background:#fff9f8">
          <div style="font-size:11px;font-weight:500;color:#c0392b;letter-spacing:0.04em;margin-bottom:8px">DEBIT SUMMARY</div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;padding:3px 0"><span>Debit for</span><span style="color:#c0392b">${todayDateFmt} &nbsp;·&nbsp; ₹ ${fmtAmt(totalDebit)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;padding:3px 0"><span>Closing balance</span><span style="color:${closingColor};font-weight:500">${closingSign}${fmtAmt(Math.abs(closing))}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:500;padding:6px 0 0;border-top:0.5px solid rgba(0,0,0,0.08);margin-top:5px"><span>Total debit</span><span>₹ ${fmtAmt(totalDebit + closing)}</span></div>
        </div>
        <div style="padding:10px 14px;display:flex;justify-content:space-between;font-size:13px;font-weight:500;background:${closing < 0 ? "#fff8f7" : "#f0faf5"}">
          <span style="color:${closingColor}">Closing balance</span><span style="color:${closingColor}">${closingSign}${fmtAmt(Math.abs(closing))}</span>
        </div>
      </div>
      <div style="background:#fff;border:0.5px solid rgba(0,0,0,0.1);border-radius:12px;overflow:hidden">
        <div style="padding:10px 14px;border-bottom:0.5px solid rgba(0,0,0,0.08);font-size:12px;font-weight:500;color:#555;background:#fafafa">Currency denominations</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr>
            <th style="${thStyle}">Denomination</th>
            <th style="${thR}">Notes</th>
            <th style="${thR}">Amount (₹)</th>
          </tr></thead>
          <tbody>
            ${denominations
              .map(
                (denom, di) => `
            <tr style="background:${di % 2 === 0 ? "#fff" : "#fafafa"}">
              <td style="padding:7px 12px;border-bottom:0.5px solid rgba(0,0,0,0.06);font-weight:500;color:#444">₹ ${denom}</td>
              <td style="padding:7px 12px;border-bottom:0.5px solid rgba(0,0,0,0.06);text-align:right">
                <input type="number" min="0" aria-label="Count for ₹${denom}" value="0"
                  style="width:60px;border:0.5px solid rgba(0,0,0,0.15);border-radius:5px;text-align:center;font-size:12px;background:#f5f5f5;padding:3px 4px"
                  oninput="recalcDenom()" data-denom="${denom}">
              </td>
              <td id="denom-amt-${denom}" style="padding:7px 12px;border-bottom:0.5px solid rgba(0,0,0,0.06);text-align:right;color:#bbb;font-style:italic">—</td>
            </tr>`,
              )
              .join("")}
          </tbody>
        </table>
        <div style="display:flex;justify-content:space-between;padding:10px 14px;border-top:0.5px solid rgba(0,0,0,0.08);font-size:12px;font-weight:500;background:#f0f0f0">
          <span>Total</span><span id="denom-total" style="color:#333">₹ 0</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 14px;font-size:11px;color:#999;background:#fffdf0;border-top:0.5px solid rgba(0,0,0,0.06)">
          <span>Closing balance (should match)</span>
          <span id="denom-closing-ref" data-closing="${closing}" style="font-weight:500;color:${closingColor}">${closingSign}${fmtAmt(Math.abs(closing))}</span>
        </div>
      </div>
    </div>

    <!-- Closing balance bar -->
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:${closing < 0 ? "#fff8f7" : "#f0faf5"};border:1.5px solid ${closingColor};border-radius:10px;margin-bottom:12px">
      <span style="font-size:13px;font-weight:500;color:${closingColor}">Closing balance</span>
      <span style="font-size:22px;font-weight:500;color:${closingColor}">${closingSign}${fmtAmt(Math.abs(closing))}</span>
    </div>

    <!-- Notes / Particulars section -->
    <div style="background:#fff;border:0.5px solid rgba(0,0,0,0.1);border-radius:12px;padding:12px 14px">
      <div style="font-size:11px;font-weight:500;color:#999;letter-spacing:0.04em;margin-bottom:8px">NOTES / PARTICULARS</div>
      <textarea id="cb-notes" rows="3" placeholder="Add daily notes, remarks, or particulars here…"
        style="width:100%;border:0.5px solid rgba(0,0,0,0.12);border-radius:6px;padding:8px 10px;font-size:12px;resize:vertical;box-sizing:border-box;background:#f9f9f9;color:inherit;font-family:inherit"
        oninput="try{localStorage.setItem(\'cb-notes-${d.date}\',this.value)}catch(e){}">${(() => {
          try {
            return localStorage.getItem("cb-notes-${d.date}") || "";
          } catch (e) {
            return "";
          }
        })()}</textarea>
    </div>

  </div>`;
}

function recalcDenom() {
  let total = 0;
  document.querySelectorAll("[data-denom]").forEach((inp) => {
    const denom = parseInt(inp.getAttribute("data-denom"));
    const count = parseInt(inp.value) || 0;
    const amt = denom * count;
    const cell = document.getElementById("denom-amt-" + denom);
    if (cell) cell.textContent = amt.toLocaleString("en-IN");
    total += amt;
  });
  const totEl = document.getElementById("denom-total");
  if (totEl) {
    totEl.textContent = total.toLocaleString("en-IN");
    // Compare with closing balance
    const closingEl = document.getElementById("denom-closing-ref");
    if (closingEl) {
      const closing = parseFloat(closingEl.getAttribute("data-closing")) || 0;
      if (closing > 0 && total !== closing) {
        totEl.style.color = "#c0392b";
        totEl.title = `⚠️ Mismatch! Closing balance is ₹${closing.toLocaleString("en-IN")}`;
      } else if (closing > 0 && total === closing) {
        totEl.style.color = "#2a7a50";
        totEl.title = "✓ Matches closing balance";
      }
    }
  }
}

async function cbAddRow() {
  const date = document.getElementById("cb-date").value;
  if (!date) {
    toast("Select a date first", "err");
    return;
  }
  const newRow = {
    id: -Date.now(),
    date,
    record_id: null,
    name: "",
    task: "Manual Entry",
    acc_type: "",
    tx_type: "Credit",
    acc_no: "",
    amount: 0,
    mode: "Cash",
    scroll_no: "",
    loan_date: "",
    sort_order: 9999,
    _saved: false,
  };
  ledgerAllRows.push(newRow);
  loadCashBook();
}

async function exportCashBook() {
  if (!cbData) {
    toast("Generate Cash Book first", "err");
    return;
  }
  const d = cbData;
  const wb = XLSX.utils.book_new();

  // Sheet 1: Cash Book entries
  const cbRows = [
    ["जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या."],
    ["Daily Cash Book", "", d.date],
    [
      "Opening Balance",
      d.opening,
      "",
      "Total Credit",
      d.totalCredit,
      "",
      "Total Debit",
      d.totalDebit,
      "",
      "Closing Balance",
      d.closing,
    ],
    [],
    [
      "#",
      "Name",
      "Task",
      "Account Type",
      "Cr/Dr",
      "Acc No",
      "Amount",
      "Mode",
      "Scroll No",
      "Loan Date",
    ],
    ...d.txRows.map((r) => [
      r.txNo,
      r.name,
      r.task,
      r.accType,
      r.txType,
      r.accNo,
      r.amount,
      r.mode,
      r.scrollNo,
      r.loanDate,
    ]),
    [],
    ["", "", "", "", "", "Total Credit", d.totalCredit],
    ["", "", "", "", "", "Total Debit", d.totalDebit],
    ["", "", "", "", "", "Closing Balance", d.closing],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(cbRows);
  XLSX.utils.book_append_sheet(wb, ws1, "CashBook");

  // Sheet 2: Covering Vouchers — matches templateData format with Transfer/Cash split
  const taskTrf = {},
    taskCash = {};
  d.txRows.forEach((r) => {
    if (!r.task) return;
    const key = r.task + "|" + (r.tx_type || "");
    if (r.mode === "Transfer")
      taskTrf[key] = (taskTrf[key] || 0) + (r.amount || 0);
    if (r.mode === "Cash")
      taskCash[key] = (taskCash[key] || 0) + (r.amount || 0);
  });

  const vRows = [
    [
      "Account Type",
      "Account Number",
      "Cr/Dr",
      "Date",
      "Transfer",
      "Cash",
      "Transfer Voucher Name",
      "Cash Voucher Name",
    ],
    ...VOUCHER_TEMPLATE.map((v) => {
      const key = (v.task || v.acc_type || "") + "|" + (v.tx_type || "");
      const trfAmt = taskTrf[key] || 0;
      const cashAmt = taskCash[key] || 0;
      return [
        v.acc_type,
        v.acc_no,
        v.tx_type,
        d.date,
        trfAmt || "",
        cashAmt || "",
        v.trf_name || "",
        v.cash_name || "",
      ];
    }),
    [],
    ["", "", "Grand Total Credit", "", d.totalCredit, "", "", ""],
    ["", "", "Grand Total Debit", "", d.totalDebit, "", "", ""],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(vRows);
  XLSX.utils.book_append_sheet(wb, ws2, "Vouchers");

  XLSX.writeFile(wb, "CashBook_" + d.date + ".xlsx");
  toast("📥 Cash Book exported!", "ok");
}

async function printCashBook() {
  if (!cbData) {
    if (ledgerAllRows.length > 0) {
      await loadCashBook();
    } else {
      toast("Generate Cash Book first", "err");
      return;
    }
  }
  const date = cbData.date || new Date().toISOString().split("T")[0];
  await _flushToDB(
    date,
    ledgerAllRows.filter((r) => !r.date || r.date === date),
  );
  const d = cbData;
  const cashRows = d.txRows.filter((r) => r.mode === "Cash");
  const crRows = cashRows.filter((r) => r.txType === "Credit");
  const dbRows = cashRows.filter((r) => r.txType === "Debit");
  const totalCr = crRows.reduce((s, r) => s + Number(r.amount), 0);
  const totalDb = dbRows.reduce((s, r) => s + Number(r.amount), 0);

  // Read denomination inputs from the screen
  const denomData = [500, 100, 50, 20, 10, 5, 2, 1].map((denom) => {
    const inp = document.querySelector(`input[data-denom="${denom}"]`);
    const notes = inp ? parseInt(inp.value) || 0 : 0;
    return { denom, notes, amt: denom * notes };
  });
  const denomTotal = denomData.reduce((s, r) => s + r.amt, 0);

  const opening = Number(d.opening || 0);
  const closing = opening + totalCr - totalDb;

  const html = _buildSahakaarCashBookHTML({
    date: d.date,
    opening,
    crRows: crRows.map((r) => ({
      txNo: r.txNo,
      name: r.name,
      accType: r.accType || r.task,
      accNo: r.accNo,
      lf: r.lf || "",
      amount: r.amount,
    })),
    dbRows: dbRows.map((r) => ({
      txNo: r.txNo,
      name: r.name,
      accType: r.accType || r.task,
      accNo: r.accNo,
      lf: r.lf || "",
      amount: r.amount,
    })),
    totalCr,
    totalDb,
    closing,
    denomData,
    denomTotal,
  });

  openPDFSheet('html', html, 'Daily Cash Book');
}


// ═══════════════════════════════════════════════════════════════════════════
//  TRANSACTION LEDGER — Master sheet + auto-derived child tabs
//  Equivalent to Google Sheets Sheet2 + FILTER formula child tabs
// ═══════════════════════════════════════════════════════════════════════════

let ledgerAllRows = []; // all cashbook entries for selected date
let ledgerRecords = []; // all parent records for selected date
let currentLedgerTab = "main";
let cbRecycleBin = []; // soft-deleted cashbook rows (in-memory)

// Shared bank-account allowlist for the "Bank TRF" ledger tab, the Bank TRF
// Voucher generator, and the Day-End Summary bank section — kept in one
// place so the three can't silently drift out of sync with each other.
const BANK_TRF_ACC_TYPES = new Set([
  "Buldhana Urban Bank - Current Acc (015002100000260)",
  "Bank of Maha - FD-OD (60494510691)",
  "Bank of Maha - Current Acc (60438097699)",
  "THE N.U. BANK Current Acc (003002100000926)",
  "Rajarshi Shahu Curr (03202007000046)",
  "The Sahyog Urban Curr Acc (8001173)",
  "SBI Current Acc (43227989097)",
]);
function isBankTRFRow(r) {
  const t = (r.acc_type || r.task || "").trim();
  // BUG FIX (Task #5 — "Template Data / covering vouchers should
  // auto-generate per bank account"): this used to require mode ===
  // "Transfer", so a Cash-mode entry against one of these bank accounts
  // (e.g. a cash deposit/withdrawal at BU Curr or BoM Curr, both of which
  // show up with real amounts in the Template Data tab) never qualified for
  // a Bank TRF voucher at all — Template Data would show the amount, but no
  // voucher ever got generated for it. Now both modes count.
  return BANK_TRF_ACC_TYPES.has(t) && (r.mode === "Transfer" || r.mode === "Cash");
}

// ── Options for editable dropdowns ───────────────────────────────────────────
// [static data moved to js/data/static-data.js]

// BUG FIX: Cash Book is a tab *inside* the Ledger page (there is no
// standalone "page-cashbook" element), so every Cash Book entry point calls
// showPage('ledger') then switchLedgerTab('cashbook'). showPage() highlights
// the nav item whose data-page matches the id it was given -- "ledger" -- so
// the "Transaction Ledger" nav item got the active/underline styling instead
// of "Cash Book", which never lit up no matter how it was opened. This
// wrapper re-points the nav highlight at the Cash Book item afterward.
function gotoCashbookTab() {
  showPage("ledger");
  switchLedgerTab("cashbook");
  document
    .querySelectorAll(".nav-item,.bnav-btn")
    .forEach((n) => n.classList.toggle("active", n.dataset.page === "cashbook"));
}

function switchLedgerTab(tab) {
  currentLedgerTab = tab;
  document
    .querySelectorAll(".ltab")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById("ltab-" + tab)?.classList.add("active");
  [
    "main",
    "transfer",
    "cashbook",
    "intgl",
    "intfdod",
    "banktrf",
    "template",
    "journal",
    "recycle",
  ].forEach((t) => {
    const el = document.getElementById("ltab-panel-" + t);
    if (el) el.style.display = t === tab ? "" : "none";
  });
  // Always reload fresh data when switching any tab
  if (tab === "recycle") {
    loadRecycleBin();
    renderCbRecycleBin();
  } else {
    loadLedger();
  }
}

let _ldgLoading = false;
async function loadLedger() {
  if (_ldgLoading) return;
  _ldgLoading = true;
  try {
  if (!document.getElementById("ldg-date").value) {
    document.getElementById("ldg-date").value = new Date()
      .toISOString()
      .split("T")[0];
  }
  const d = document.getElementById("ldg-date").value;

  // Clear auto-gen cache when date changes so records for new date get generated
  if (window._autoGenAttemptedDate !== d) {
    window._autoGenAttempted = new Set();
    window._autoGenAttemptedDate = d;
  }

  // Always load from DB (covers today + past dates, and survives page refresh)
  try {
    const [cbResp, recResp] = await Promise.all([
      fetch(CB_API + "?date=" + d, { headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } }),
      fetch(API + "?limit=500&date_from=" + d + "&date_to=" + d),
    ]);
    const cbJson = cbResp.ok ? await cbResp.json() : {};
    const recJson = recResp.ok ? await recResp.json() : {};
    ledgerAllRows = (cbJson.entries || []).map((e) => ({ ...e, _saved: true }));
    ledgerRecords = recJson.records || [];
  } catch (e) {
    console.error("loadLedger fetch error:", e);
    document.getElementById("ldg-main-body").innerHTML =
      `<tr><td colspan="10" style="text-align:center;padding:24px;color:#c0392b;font-weight:700">❌ Server offline — unable to connect<br><button onclick="loadLedger()" style="margin-top:8px;padding:5px 14px;background:var(--sky-a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:11px">🔄 Retry</button></td></tr>`;
    return;
  }

  // Auto-generate cashbook rows for any parent record that has none saved yet
  // Only index by record_id — using cashbook row ids (r.id) caused false-positive
  // matches against parent record ids, which skipped auto-generation entirely.
  const savedIds = new Set(
    ledgerAllRows.map((r) => String(r.record_id)).filter(Boolean)
  );
  // Guard: don't re-attempt records we already tried generating this session
  if (!window._autoGenAttempted) window._autoGenAttempted = new Set();
  const missing = ledgerRecords.filter(
    (r) =>
      !savedIds.has(String(r.id)) &&
      !window._autoGenAttempted.has(String(r.id)),
  );
  // Mark these as "in progress" now so a second loadLedger() call that
  // starts before this one finishes doesn't also pick them up and fire a
  // second, concurrent generation attempt for the same record (that race is
  // what created duplicate ledger rows previously — see BUG FIX below for
  // the other half of that fix).
  missing.forEach((r) => window._autoGenAttempted.add(String(r.id)));
  if (missing.length) {
    const genResults = await Promise.all(
      missing.map(async (rec) => {
        let txArr = parseTxTypes(rec.tx_types);
        // Fallback: derive tx type from section when tx_types not saved
        if (!txArr.length && rec.section) {
          const sectionFallback = {
            gold: ["Gold Loan"],
            fd: ["New FD"],
            od: ["New FD-OD Loan"],
            saving: ["Saving Account"],
            membership: ["New Sadasya"],
          };
          txArr = sectionFallback[rec.section] || [];
        }
        if (!txArr.length) return { id: rec.id, status: "empty" };
        const d2 =
          typeof rec.data === "string"
            ? (() => {
                try {
                  return JSON.parse(rec.data);
                } catch (e) {
                  return {};
                }
              })()
            : rec.data || {};
        // BUG FIX (root cause of repeated duplicate ledger rows): this used
        // to pass rec.date (the record's raw date field as the API returns
        // it, e.g. "2026-09-11T18:30:00.000Z" for a record actually dated
        // 2026-09-12 — a DATE column round-tripping through pg/Node lands on
        // local midnight, which JSON serializes shifted back by the IST
        // offset). addCashbookRows() then does `data.date.split("T")[0]` to
        // get the calendar day to file the row under, extracting "2026-09-11"
        // — one day off. Every generated row was silently filed a day early,
        // so the NEXT time this same date (`d`) was loaded, the check for
        // "does this record already have rows" (savedIds, built from rows
        // dated `d`) never found them — the record looked "missing" again on
        // every single reload, regenerating a fresh duplicate set each time.
        // `d` is the exact date this record was already matched against to
        // land in `ledgerRecords` in the first place (the API call above
        // filtered by date_from=d&date_to=d) — using it here instead is
        // always correct, and keeps generated rows visible under the date
        // the user is actually looking at.
        const data = Object.assign({}, d2, {
          customer_name: rec.name,
          date: d,
        });
        const result = await addCashbookRows(rec.id, data, txArr);
        return { id: rec.id, status: (result && result.status) || "failed" };
      }),
    );
    // BUG FIX: this record's ledger rows were once left permanently missing
    // whenever the very first auto-generate attempt didn't fully succeed —
    // `missing.forEach(...add(...))` above marked every record as "already
    // tried" BEFORE we knew whether addCashbookRows actually saved anything,
    // and nothing ever cleared that mark afterward. So a single transient
    // failure (a slow network blip, a momentary server error) meant that
    // transaction's ledger rows would never be (re)generated again for the
    // rest of the browser session — with no visible error, just permanently
    // empty rows under that transaction. Un-marking failures here means the
    // *next* time the Ledger tab loads for this date, they're retried
    // automatically instead of being silently abandoned.
    const failedIds = genResults
      .filter((r) => r && r.status === "failed")
      .map((r) => r.id);
    failedIds.forEach((id) => window._autoGenAttempted.delete(String(id)));
    if (failedIds.length) {
      toast(
        "⚠️ " + failedIds.length +
          " transaction(s) could not auto-generate their ledger rows — reload this tab to retry",
        "err",
      );
    }
    // Re-fetch after auto-generate
    try {
      const cbResp2 = await fetch(CB_API + "?date=" + d, { headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
      if (cbResp2.ok) {
        const cbJson2 = await cbResp2.json();
        ledgerAllRows = (cbJson2.entries || []).map((e) => ({
          ...e,
          _saved: true,
        }));
      }
    } catch (e) {}
  }

  const count = ledgerRecords.length;
  const subCount = ledgerAllRows.length;
  document.getElementById("ldg-count").textContent =
    count +
    " transaction" +
    (count !== 1 ? "s" : "") +
    ", " +
    subCount +
    " ledger row" +
    (subCount !== 1 ? "s" : "");

  renderLedger();

  } finally {
    _ldgLoading = false;
  }}

function renderLedger() {
  switch (currentLedgerTab) {
    case "main":
      renderLedgerMain();
      break;
    case "transfer":
      renderLedgerTransfer();
      break;
    case "cashbook":
      renderLedgerCashBook();
      break;
    case "intgl":
      renderLedgerIntGL();
      break;
    case "intfdod":
      renderLedgerIntFDOD();
      break;
    case "banktrf":
      renderLedgerBankTRF();
      break;
    case "template":
      renderLedgerTemplate();
      break;
    case "journal":
      renderJournalTemplates();
      break;
  }
}

function ldgFilteredRows() {
  const q = (document.getElementById("ldg-name")?.value || "")
    .toLowerCase()
    .trim();
  return q
    ? ledgerAllRows.filter((r) => (r.name || "").toLowerCase().includes(q))
    : ledgerAllRows;
}
function ldgFilteredParents() {
  const q = (document.getElementById("ldg-name")?.value || "")
    .toLowerCase()
    .trim();
  return q
    ? ledgerRecords.filter((r) => (r.name || "").toLowerCase().includes(q))
    : ledgerRecords;
}

// ── Inline editable cell helpers ─────────────────────────────────────────────
// Compact editable input for secondary tabs (scroll_no / acc_no only)
function ldgInlineEdit(id, field, val, placeholder) {
  return `<td><input type="text" data-id="${id}" data-field="${field}" value="${(val || "").replace(/"/g, "&quot;")}"
    placeholder="${placeholder || ""}"
    title="✏️ Click to edit — saves automatically"
    style="width:100%;min-width:70px;font-size:8.5pt;border:1.5px solid #c5b8f0;border-radius:4px;padding:2px 5px;font-family:'Nunito',sans-serif;background:#f8f4ff;color:#3d2b7a;font-weight:700"
    onblur="ldgSaveCell(this)" onkeydown="if(event.key==='Enter'){this.blur();}"></td>`;
}
function ldgEditTxt(id, field, val, placeholder) {
  placeholder = placeholder || "";
  var _isEmpty = !val || String(val).trim() === "";
  var _bg = _isEmpty ? "#fffbe6" : "#f0f7ff";
  var _bd = _isEmpty ? "#f6c90e" : "#b8d4f0";
  var safeVal = (val || "").replace(/"/g, "&quot;");
  return (
    '<td style="position:relative">' +
    '<span style="position:absolute;left:4px;top:50%;transform:translateY(-50%);font-size:8px;opacity:0.4;pointer-events:none;z-index:1">&#9998;</span>' +
    '<input type="text" data-id="' +
    id +
    '" data-field="' +
    field +
    '" value="' +
    safeVal +
    '"' +
    ' placeholder="' +
    placeholder +
    '"' +
    ' title="Click to edit — auto-saves on blur or Enter"' +
    ' style="width:100%;min-width:80px;font-size:9pt;border:1.5px solid ' +
    _bd +
    ";border-radius:4px;padding:3px 5px 3px 18px;font-family:Nunito,sans-serif;background:" +
    _bg +
    ';color:#1a3a5c;font-weight:600;box-sizing:border-box"' +
    " onfocus=\"this.style.borderColor='#2b6cb0';this.style.boxShadow='0 0 0 2px #bee3f8';this.style.background='#fff'\"" +
    " onblur=\"this.style.borderColor='" +
    _bd +
    "';this.style.boxShadow='none';this.style.background='" +
    _bg +
    "';ldgSaveCell(this)\"" +
    " onkeydown=\"if(event.key==='Enter'){this.blur();}\">" +
    "</td>"
  );
}
function ldgEditNum(id, field, val) {
  // BUG FIX: new ledger rows default to amount 0, and Postgres NUMERIC
  // columns come back through node-postgres as the string "0" (not the
  // number 0), so `val || ""` rendered a literal "0" in the box — clicking
  // in and typing just appended after it (e.g. "0500000"). Clear a lone "0"
  // on focus so typing starts fresh; an existing non-zero amount is left
  // alone (select it instead, so typing still replaces it cleanly).
  return `<td style="position:relative"><input type="number" data-id="${id}" data-field="${field}" value="${val || ""}"
    title="✏️ Editable — Tab or Enter to save"
    style="width:80px;font-size:9pt;border:1.5px solid #b8d4f0;border-radius:4px;padding:3px 5px;font-family:'Nunito',sans-serif;background:#f0f7ff;text-align:right;color:#1a3a5c;font-weight:600"
    onfocus="this.style.borderColor='#2b6cb0';this.style.boxShadow='0 0 0 2px #bee3f8';if(this.value==='0'||Number(this.value)===0){this.value='';}else{this.select();}"
    onblur="this.style.borderColor='#b8d4f0';this.style.boxShadow='none';ldgSaveCell(this)"
    onkeydown="if(event.key==='Enter'){this.blur();}"></td>`;
}
function ldgEditDate(id, field, val) {
  const isLoanDate = field === "loan_date";
  const placeholder = isLoanDate ? 'placeholder="कर्ज घेतल्याची दि."' : "";
  const title = isLoanDate
    ? 'title="कर्ज घेतल्याची दि. — Only fill for Loan Closing entries"'
    : 'title="✏️ Editable date"';
  const bg = isLoanDate && !val ? "#fffbe6" : "#f0f7ff";
  return `<td><input type="date" data-id="${id}" data-field="${field}" value="${val || ""}"
    style="font-size:9pt;border:1.5px solid #b8d4f0;border-radius:4px;padding:3px 5px;font-family:'Nunito',sans-serif;background:${bg};color:#1a3a5c"
    ${placeholder} ${title}
    onfocus="this.style.borderColor='#2b6cb0'"
    onblur="this.style.borderColor='#b8d4f0'"
    onchange="ldgSaveCell(this)"></td>`;
}
function ldgEditSel(id, field, val, opts, colorFn) {
  const color = colorFn ? colorFn(val) : "";
  // If val is not in opts, add it as the first selected option
  const hasVal = opts.includes(val);
  const extraOpt =
    !hasVal && val ? `<option value="${val}" selected>${val}</option>` : "";
  return `<td><select data-id="${id}" data-field="${field}"
    style="width:100%;font-size:9pt;border:1.5px solid #b8d4f0;border-radius:4px;padding:3px 5px;font-family:'Nunito',sans-serif;font-weight:700;${color}"
    onchange="ldgSaveCell(this);this.style.cssText=this.style.cssText+ldgSelColor('${field}',this.value)">
    ${extraOpt}${opts.map((o) => `<option value="${o}" ${hasVal && o === val ? "selected" : ""}>${o || "—"}</option>`).join("")}
  </select></td>`;
}

function ldgSelColor(field, val) {
  if (field === "tx_type") {
    if (val === "Credit") return "background:#d4f5e9;color:#2a7a50;";
    if (val === "Debit") return "background:#fde0e8;color:#c0392b;";
  }
  if (field === "mode") {
    if (val === "Transfer") return "background:#e8f4fd;color:#2b6cb0;";
    if (val === "Cash") return "background:#fff8e1;color:#b7791f;";
  }
  return "background:#fff;color:#333;";
}

async function ldgSaveCell(el) {
  const id = el.dataset.id;
  const field = el.dataset.field;
  const value = el.value;
  if (!id || !field) return;
  // Update dropdown color immediately
  if (field === "tx_type" || field === "mode") {
    el.style.cssText = el.style.cssText.replace(
      /background:[^;]+;color:[^;]+;/g,
      "",
    );
    const col = ldgSelColor(field, value);
    el.style.background = col.match(/background:([^;]+)/)?.[1] || "";
    el.style.color = col.match(/color:([^;]+)/)?.[1] || "";
  }

  // Always update in-memory first
  const row = ledgerAllRows.find((r) => String(r.id) === String(id));
  const oldValue = row ? row[field] : undefined;
  if (row) row[field] = field === "amount" ? parseFloat(value) || 0 : value;

  // FIX: keep linked rows in sync. Rows like "FD OD Loan" (Debit) and
  // "FD OD Loan Closing" (Credit) — or the equivalent Gold Loan pair — are
  // generated from the same record_id and must always reference the same
  // acc_no. Without this, editing the account number on one row silently
  // leaves its sibling stale, producing two different account numbers for
  // what is supposed to be a single loan (see Cash Entries acc_no mismatch).
  const siblingRows =
    field === "acc_no" && row && row.record_id != null
      ? ledgerAllRows.filter(
          (r) =>
            r !== row &&
            r.record_id === row.record_id &&
            String(r.id) !== String(id) &&
            r.acc_no === oldValue,
        )
      : [];
  siblingRows.forEach((r) => {
    r.acc_no = value;
  });

  const isSavedRow = row && row._saved && Number(id) > 0;

  if (isSavedRow) {
    // Already committed to DB (past date) — persist the edit
    el.style.outline = "2px solid #f6c90e";
    try {
      const res = await fetch(CB_API + "/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
        body: JSON.stringify({
          [field]: field === "amount" ? parseFloat(value) || 0 : value,
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      el.style.outline = "2px solid #2a7a50";
      el.style.background = "#d4f5e9";
      setTimeout(() => {
        el.style.outline = "";
        el.style.background = "";
      }, 900);
    } catch (e) {
      el.style.outline = "2px solid #c0392b";
      el.style.background = "#fde0e8";
      setTimeout(() => {
        el.style.outline = "";
        el.style.background = "";
      }, 1200);
      console.error("Save error", e);
      toast("❌ Save failed", "err");
      return;
    }
  } else {
    // In-memory row — just flash green, no DB call
    el.style.outline = "2px solid #2a7a50";
    el.style.background = "#d4f5e9";
    setTimeout(() => {
      el.style.outline = "";
      el.style.background = "";
    }, 600);
  }

  // Sync other inputs on the page with same data-id+data-field
  document
    .querySelectorAll(`[data-id="${id}"][data-field="${field}"]`)
    .forEach((other) => {
      if (other !== el) other.value = value;
    });

  // Sync inputs for any sibling rows we just updated in-memory above, and
  // persist each sibling's new acc_no to the DB if it's already saved.
  for (const sib of siblingRows) {
    document
      .querySelectorAll(`[data-id="${sib.id}"][data-field="acc_no"]`)
      .forEach((other) => {
        other.value = value;
      });
    if (sib._saved && Number(sib.id) > 0) {
      try {
        const res = await fetch(CB_API + "/" + sib.id, {
          method: "PUT",
          headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
          body: JSON.stringify({ acc_no: value }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
      } catch (e) {
        console.error("Sibling acc_no sync failed for row", sib.id, e);
        toast("⚠️ Linked row " + sib.id + " could not be synced — please check it manually", "err");
      }
    }
  }

  // Re-render background tabs — deliberately SKIP whichever tab is
  // currentLedgerTab (the one on screen right now). Every renderLedgerXxx()
  // rebuilds its whole <tbody> via innerHTML, destroying and recreating
  // every <input> in it; re-rendering the active tab here (which used to
  // happen unconditionally, despite this comment already saying
  // "background tabs") raced with the click the user was making on the
  // NEXT field — the click would land on the input a split second before
  // this rAF callback destroyed and replaced it, silently dropping focus,
  // so typing did nothing until a second click landed after the re-render
  // had already happened (see: "Scroll #" needing two clicks to type into).
  // A background tab has no focused element to lose (a hidden tab's inputs
  // can't hold focus), so it's always safe to refresh those immediately.
  requestAnimationFrame(() => {
    const LEDGER_RENDERERS = {
      main: renderLedgerMain,
      transfer: renderLedgerTransfer,
      cashbook: renderLedgerCashBook,
      intgl: renderLedgerIntGL,
      intfdod: renderLedgerIntFDOD,
      banktrf: renderLedgerBankTRF,
      template: renderLedgerTemplate,
    };
    Object.keys(LEDGER_RENDERERS).forEach((key) => {
      if (key === currentLedgerTab) return; // active tab — its cells already show the edit; leave its DOM (and focus) alone
      try {
        LEDGER_RENDERERS[key]();
      } catch (e) {}
    });
  });
}

// ── Helper: parse tx_types regardless of storage format ────────────────
function parseTxTypes(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed))
        return parsed.map((t) => String(t).trim()).filter(Boolean);
      if (typeof parsed === "object")
        return Object.values(parsed)
          .map((t) => String(t).trim())
          .filter(Boolean);
    } catch (e) {}
    // Fallback: strip braces/brackets/quotes then split
    return s
      .replace(/[\[\]{}'"]/g, "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function renderLedgerMain() {
  const tbody = document.getElementById("ldg-main-body");
  // Show unsaved banner if any in-memory (unsaved) rows exist
  const banner = document.getElementById("ldg-unsaved-banner");
  if (banner) {
    const hasUnsaved = ledgerAllRows.some((r) => !r._saved);
    banner.style.display = hasUnsaved ? "flex" : "none";
  }
  const parents = ldgFilteredParents();
  const rows = ldgFilteredRows();

  if (!parents.length && !rows.length) {
    const _ld = document.getElementById("ldg-date")?.value || getAppDate();
    const _today = new Date().toISOString().split("T")[0];
    const _ldFmt = new Date(_ld + "T00:00:00").toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const _ldLabel = _ld === _today ? "today (" + _ldFmt + ")" : _ldFmt;
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--textl)">
      <div style="font-size:32px;margin-bottom:10px">📋</div>
      <div style="font-weight:800;font-size:11pt;color:#555;margin-bottom:6px">No transactions for ${_ldLabel}</div>
      <div style="font-size:9pt;color:#aaa">Submit transactions from the <strong>New Transaction</strong> tab — they will appear here automatically.</div>
    </td></tr>`;
    return;
  }

  // Index cashbook rows by record_id
  const byRec = {};
  rows.forEach((r) => {
    const k = r.record_id ?? "_manual_";
    (byRec[k] = byRec[k] || []).push(r);
  });

  let txNo = 1;
  let html = "";

  parents.forEach((rec) => {
    // Build readable label: "Customer Name — New Gold Loan"
    const taskLabel = parseTxTypes(rec.tx_types).join(" + ") || "—";
    const headerLabel = `${rec.name || "—"} — ${taskLabel}`;

    // ── Header row: full-width "CustomerName — Task" banner ──
    const ldgDateVal = document.getElementById("ldg-date")?.value || "";
    html += `<tr style="background:#fffde7;border-left:4px solid #f6c90e;border-top:2px solid #f6c90e">
<td colspan="10" style="padding:6px 10px">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px">
    <span>
      <span style="font-weight:800;font-size:10pt;color:#7a5800">${rec.name || "—"}</span>
      <span style="color:#ccc;margin:0 6px">—</span>
      <span style="background:var(--lav);color:var(--lav-a);padding:2px 9px;border-radius:5px;font-size:8pt;font-weight:800">${taskLabel}</span>
    </span>
    <div style="display:flex;gap:6px;align-items:center">
      <button data-ldg-add-rec="${rec.id}" data-ldg-date="${ldgDateVal}"
        style="background:#553c9a;color:#fff;border:none;border-radius:5px;padding:3px 10px;cursor:pointer;font-size:9pt;font-weight:700;white-space:nowrap">+ Add Row</button>
      <button data-ldg-del-rec="${rec.id}"
        title="Delete this transaction (can be restored from Recycle Bin)"
        style="background:#fde0e8;color:#c0392b;border:1px solid #f5a0b0;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;white-space:nowrap">🗑️</button>
    </div>
  </div>
</td>
    </tr>`;

    // ── Child rows — grouped by transaction type from journal templates ──
    const children = byRec[rec.id] || [];
    // Map each CB_TX_ROWS_MAP key to its rows for this record
    const txTypes = parseTxTypes(rec.tx_types);
    // Group children by their source tx type using task names from journal templates
    // Build a map: task → which txType it belongs to
    const taskToTxType = {};
    txTypes.forEach((txType) => {
      const rows = CB_TX_ROWS_MAP[txType] || [];
      rows.forEach((row) => {
        if (!taskToTxType[row.task]) taskToTxType[row.task] = txType;
      });
    });

    // Group children by their source txType
    const grouped = {};
    const groupOrder = [];
    children.forEach((r) => {
      const srcTx =
        taskToTxType[r.task] || taskToTxType[r.acc_type] || "_other_";
      if (!grouped[srcTx]) {
        grouped[srcTx] = [];
        groupOrder.indexOf(srcTx) === -1 && groupOrder.push(srcTx);
      }
      grouped[srcTx].push(r);
    });
    // Also add _other_ for rows not matching any template
    if (grouped["_other_"] && groupOrder.indexOf("_other_") === -1)
      groupOrder.push("_other_");

    // If multiple tx types, show sub-group headers; otherwise just show rows
    const showSubHeaders = txTypes.length > 1 && groupOrder.length > 1;

    // Section color map
    const txColors = {
      "Gold Loan": { bg: "#fdf5d0", border: "#c8a020", text: "#7a5800" },
      "Slips - Loan": {
        bg: "#fdf5d0",
        border: "#c8a020",
        text: "#7a5800",
      },
      "Closing - Loan": {
        bg: "#fde0e8",
        border: "#c0392b",
        text: "#c0392b",
      },
      "Saving Account": {
        bg: "#daeef8",
        border: "#3a8fbf",
        text: "#1a3a5c",
      },
      "Saving Deposit": {
        bg: "#daeef8",
        border: "#3a8fbf",
        text: "#1a3a5c",
      },
      "Saving Withdrawal": {
        bg: "#fff8e1",
        border: "#b7791f",
        text: "#7a5200",
      },
      "Saving Acc Transfer": {
        bg: "#e8f8f0",
        border: "#1e8449",
        text: "#145a32",
      },
      "New Sadasya": {
        bg: "#e8f4fd",
        border: "#2b6cb0",
        text: "#1a3a5c",
      },
      "New Saving Account": {
        bg: "#daeef8",
        border: "#3a8fbf",
        text: "#1a3a5c",
      },
      Sadasya: { bg: "#e8f4fd", border: "#2b6cb0", text: "#1a3a5c" },
      "Sadasya - Slips": {
        bg: "#e8f4fd",
        border: "#2b6cb0",
        text: "#1a3a5c",
      },
      "New Naammatr Sabhasad": {
        bg: "#d0f0f0",
        border: "#2a9d8f",
        text: "#134e4a",
      },
      "Naammatr Sabhasad Account": {
        bg: "#d0f0f0",
        border: "#2a9d8f",
        text: "#134e4a",
      },
      "Naammatr Sabhasad - Slips": {
        bg: "#d0f0f0",
        border: "#2a9d8f",
        text: "#134e4a",
      },
      "New FD": { bg: "#d4f5e9", border: "#4CAF7A", text: "#2a7a50" },
      "New FD - Term": { bg: "#d4f5e9", border: "#4CAF7A", text: "#2a7a50" },
      "New FD - MIS": { bg: "#d0f0ff", border: "#0ea5e9", text: "#0369a1" },
      "Fixed Deposit - MIS": { bg: "#d0f0ff", border: "#0ea5e9", text: "#0369a1" },
      "FD - Slips - MIS": { bg: "#d0f0ff", border: "#0ea5e9", text: "#0369a1" },
      "Fixed Deposit": {
        bg: "#d4f5e9",
        border: "#4CAF7A",
        text: "#2a7a50",
      },
      "FD - Slips": { bg: "#d4f5e9", border: "#4CAF7A", text: "#2a7a50" },
      _other_: { bg: "#f5f5f5", border: "#aaa", text: "#555" },
    };

    // Check if this is "New Saving Account + Naammatr" combination
    const isNewSavingPlusNaammatr = txTypes.length === 2 &&
      txTypes.includes("New Saving Account") &&
      txTypes.includes("New Naammatr Sabhasad");

    groupOrder.forEach((grpKey) => {
      let grpRows = grouped[grpKey] || [];
      
      // Limit to first 3 rows for New Saving Account + Naammatr combination
      if (isNewSavingPlusNaammatr) {
        grpRows = grpRows.slice(0, 3);
      }
      
      const col = txColors[grpKey] || txColors["_other_"];
      if (showSubHeaders) {
        html += `<tr style="background:${col.bg};border-left:3px solid ${col.border}">
        <td colspan="10" style="padding:3px 10px 3px 20px;font-size:8.5pt;font-weight:800;color:${col.text}">
          ↳ ${grpKey === "_other_" ? "Other / Manual Entries" : grpKey}
        </td>
      </tr>`;
      }
      grpRows.forEach((r) => {
        const txBg =
          r.tx_type === "Credit"
            ? "background:#d4f5e9;color:#2a7a50;"
            : "background:#fde0e8;color:#c0392b;";
        const modeBg =
          r.mode === "Transfer"
            ? "background:#e8f4fd;color:#2b6cb0;"
            : "background:#fff8e1;color:#b7791f;";
        html += `<tr data-cb-id="${r.id}" style="background:#fff;border-left:3px solid ${showSubHeaders ? col.border : "transparent"}">
    <td style="text-align:center;color:#aaa;padding-left:16px;font-size:9pt">${txNo++}</td>
    <td style="font-size:9pt">${r.name || "—"}</td>
    ${ldgEditSel(r.id, "acc_type", r.acc_type || r.task, LDG_ACC_TYPES, null)}
    <td><select data-id="${r.id}" data-field="tx_type"
      style="width:100%;font-size:9pt;border:1px solid #ddd;border-radius:4px;padding:3px 5px;font-weight:800;${txBg}"
      onchange="ldgSaveCell(this)">
      <option value="Credit" ${r.tx_type === "Credit" ? "selected" : ""}>Credit</option>
      <option value="Debit"  ${r.tx_type === "Debit" ? "selected" : ""}>Debit</option>
    </select></td>
    ${ldgEditTxt(r.id, "acc_no", r.acc_no, "e.g. 43-118")}
    ${ldgEditNum(r.id, "amount", r.amount)}
    <td><select data-id="${r.id}" data-field="mode"
      style="width:100%;font-size:9pt;border:1px solid #ddd;border-radius:4px;padding:3px 5px;font-weight:800;${modeBg}"
      onchange="ldgSaveCell(this)">
      <option value="Cash"     ${r.mode === "Cash" ? "selected" : ""}>Cash</option>
      <option value="Transfer" ${r.mode === "Transfer" ? "selected" : ""}>Transfer</option>
    </select></td>
    ${ldgEditTxt(r.id, "scroll_no", r.scroll_no, "Scroll #")}
    ${ldgEditDate(r.id, "loan_date", r.loan_date)}
    <td style="text-align:center">
      <button data-ldg-del-row="${r.id}" title="Delete row"
        style="background:#fde0e8;color:#c0392b;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:11px">🗑</button>
    </td>
  </tr>`;
      });
    });
  });

  // Orphan / manual rows (no parent record) — added via the standalone
  // "+ Add Row" button at the top of this tab (ldgAddManualRow()). Grouped by
  // parent_id so a manual entry can hold more than one row under a single
  // banner, the same way a real record's rows do: the first row of a group
  // has parent_id=null and IS the anchor; every row added afterward via that
  // banner's own "+ Add Row" (ldgAddRowForManualGroup()) carries parent_id
  // set to the anchor's real DB id. A manual entry with just one row (the
  // common case) still renders exactly as before — one banner, one row —
  // just with "+ Add Row" / delete-group buttons now available on it too,
  // matching every record-backed banner above.
  const manualRows = byRec["_manual_"] || [];
  const manualGroups = {};
  const manualGroupOrder = [];
  manualRows.forEach((r) => {
    const gid = r.parent_id || r.id;
    if (!manualGroups[gid]) {
      manualGroups[gid] = [];
      manualGroupOrder.push(gid);
    }
    manualGroups[gid].push(r);
  });
  manualGroupOrder.forEach((gid) => {
    const grp = manualGroups[gid];
    const anchor = grp.find((r) => !r.parent_id) || grp[0];
    const mName = anchor.name || "Manual Entry";
    const mNameAttr = mName.replace(/"/g, "&quot;");
    const mDate = anchor.date || document.getElementById("ldg-date")?.value || "";
    const rowIds = grp.map((r) => r.id).join(",");
    html += `<tr style="background:#f0fff4;border-left:4px solid var(--mint-a);border-top:2px solid var(--mint-a)">
<td colspan="10" style="padding:6px 10px">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px">
    <span>
      <span style="font-weight:800;font-size:10pt;color:#1a5c3a">${mName}</span>
      <span style="color:#ccc;margin:0 6px">—</span>
      <span style="background:var(--lav);color:var(--lav-a);padding:2px 9px;border-radius:5px;font-size:8pt;font-weight:800">Manual Entry</span>
    </span>
    <div style="display:flex;gap:6px;align-items:center">
      <button data-ldg-add-manual="${anchor.id}" data-ldg-manual-name="${mNameAttr}" data-ldg-date="${mDate}"
        style="background:#553c9a;color:#fff;border:none;border-radius:5px;padding:3px 10px;cursor:pointer;font-size:9pt;font-weight:700;white-space:nowrap">+ Add Row</button>
      <button data-ldg-del-manual="${rowIds}" data-ldg-manual-name="${mNameAttr}"
        title="Delete this manual entry (can be restored from Recycle Bin)"
        style="background:#fde0e8;color:#c0392b;border:1px solid #f5a0b0;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;white-space:nowrap">🗑️</button>
    </div>
  </div>
</td>
    </tr>`;
    grp.forEach((r) => {
      const txBg =
        r.tx_type === "Credit"
          ? "background:#d4f5e9;color:#2a7a50;"
          : "background:#fde0e8;color:#c0392b;";
      const modeBg =
        r.mode === "Transfer"
          ? "background:#e8f4fd;color:#2b6cb0;"
          : "background:#fff8e1;color:#b7791f;";
      html += `<tr data-cb-id="${r.id}" style="background:#fff;border-left:3px solid var(--mint-a)">
<td style="text-align:center;color:#aaa;padding-left:16px;font-size:9pt">${txNo++}</td>
<td>${r.name || "Manual"}</td>
${ldgEditSel(r.id, "acc_type", r.acc_type || r.task, LDG_ACC_TYPES, null)}
<td><select data-id="${r.id}" data-field="tx_type"
  style="width:100%;font-size:9pt;border:1px solid #ddd;border-radius:4px;padding:3px 5px;font-weight:800;${txBg}"
  onchange="ldgSaveCell(this)">
  <option value="Credit" ${r.tx_type === "Credit" ? "selected" : ""}>Credit</option>
  <option value="Debit"  ${r.tx_type === "Debit" ? "selected" : ""}>Debit</option>
</select></td>
${ldgEditTxt(r.id, "acc_no", r.acc_no, "e.g. 43")}
${ldgEditNum(r.id, "amount", r.amount)}
<td><select data-id="${r.id}" data-field="mode"
  style="width:100%;font-size:9pt;border:1px solid #ddd;border-radius:4px;padding:3px 5px;font-weight:800;${modeBg}"
  onchange="ldgSaveCell(this)">
  <option value="Cash"     ${r.mode === "Cash" ? "selected" : ""}>Cash</option>
  <option value="Transfer" ${r.mode === "Transfer" ? "selected" : ""}>Transfer</option>
</select></td>
${ldgEditTxt(r.id, "scroll_no", r.scroll_no, "Scroll #")}
${ldgEditDate(r.id, "loan_date", r.loan_date)}
<td style="text-align:center">
  <button data-ldg-del-row="${r.id}"
    style="background:#fde0e8;color:#c0392b;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:11px">🗑</button>
</td>
    </tr>`;
    });
  });

  tbody.innerHTML =
    html ||
    `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--textl)">No records match the filter</td></tr>`;

  // Event delegation for header buttons (avoids inline onclick with server data)
  tbody.querySelectorAll("[data-ldg-add-rec]").forEach((btn) => {
    const recId = Number(btn.dataset.ldgAddRec);
    const date = btn.dataset.ldgDate || "";
    const rec = ledgerRecords.find((r) => r.id === recId);
    btn.addEventListener("click", () => ldgAddRowForRecord(recId, rec ? rec.name : "", date, rec ? rec.tx_types : null));
  });
  tbody.querySelectorAll("[data-ldg-del-rec]").forEach((btn) => {
    const recId = Number(btn.dataset.ldgDelRec);
    const rec = ledgerRecords.find((r) => r.id === recId);
    btn.addEventListener("click", () => ldgSoftDeleteRecord(recId, rec ? rec.name : ""));
  });
  tbody.querySelectorAll("[data-ldg-del-row]").forEach((btn) => {
    const rowId = Number(btn.dataset.ldgDelRow);
    btn.addEventListener("click", () => ldgDeleteRow(rowId));
  });
  tbody.querySelectorAll("[data-ldg-add-manual]").forEach((btn) => {
    const anchorId = Number(btn.dataset.ldgAddManual);
    const name = btn.dataset.ldgManualName || "";
    const date = btn.dataset.ldgDate || "";
    btn.addEventListener("click", () => ldgAddRowForManualGroup(anchorId, name, date));
  });
  tbody.querySelectorAll("[data-ldg-del-manual]").forEach((btn) => {
    const ids = (btn.dataset.ldgDelManual || "").split(",").filter(Boolean);
    const name = btn.dataset.ldgManualName || "";
    btn.addEventListener("click", () => ldgSoftDeleteManualGroup(ids, name));
  });
}

async function ldgDeleteRow(id) {
  const row = ledgerAllRows.find((r) => String(r.id) === String(id));
  if (!row) return;
  if (
    !confirm(`Move this row to Recycle Bin?

"${row.name || "Manual"} — ${row.acc_type || row.task || ""}"

You can restore it from the Recycle Bin tab.`)
  )
    return;

  // Mark deleted timestamp
  row._deleted = true;
  row._deleted_at = new Date().toISOString();

  // If saved to DB, soft-delete there too
  if (row._saved && Number(id) > 0) {
    try {
      // BUG FIX: errors were silently swallowed — if soft-delete fails the row
      // disappears from the UI but remains active in the DB, reappearing on reload.
      const delRes = await fetch(CB_API + "/" + id + "/soft-delete", { method: "PATCH", headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
      if (!delRes.ok) {
        // Rollback in-memory state — don't move to recycle bin
        row._deleted = false;
        delete row._deleted_at;
        toast("Delete failed — server error", "err");
        return;
      }
    } catch (e) {
      row._deleted = false;
      delete row._deleted_at;
      toast("Delete failed — network error", "err");
      return;
    }
  }

  // Move from active to recycle bin
  ledgerAllRows = ledgerAllRows.filter((r) => String(r.id) !== String(id));
  cbRecycleBin.unshift(row); // newest first

  showCbRowUndoToast(id, row.name, row.acc_type || row.task);
  renderLedger();
}

function showCbRowUndoToast(id, name, type) {
  const existing = document.getElementById("undo-toast-cb");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "undo-toast-cb";
  el.style.cssText =
    "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#c0392b;color:#fff;padding:10px 16px;border-radius:10px;font-size:12px;font-weight:700;z-index:9999;display:flex;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.25);white-space:nowrap;";

  const label = document.createElement("span");
  label.textContent = "🗑️ Moved to Recycle Bin: ";
  const strong = document.createElement("strong");
  strong.textContent = name || "row";
  label.appendChild(strong);
  el.appendChild(label);

  const undoBtn = document.createElement("button");
  undoBtn.textContent = "↩ Undo (8s)";
  undoBtn.style.cssText = "margin-left:12px;background:#fff;color:#c0392b;border:none;border-radius:5px;padding:3px 10px;cursor:pointer;font-weight:800;font-size:11px";
  undoBtn.addEventListener("click", () => ldgUndoDeleteRow(id));
  el.appendChild(undoBtn);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "margin-left:6px;background:transparent;color:#fff;border:none;cursor:pointer;font-size:14px;opacity:0.7";
  closeBtn.addEventListener("click", () => el.remove());
  el.appendChild(closeBtn);

  document.body.appendChild(el);
  setTimeout(() => {
    const t = document.getElementById("undo-toast-cb");
    if (t) {
      t.style.opacity = "0";
      t.style.transition = "opacity 0.4s";
      setTimeout(() => t.remove(), 400);
    }
  }, 8000);
}

async function ldgUndoDeleteRow(id) {
  const idx = cbRecycleBin.findIndex((r) => String(r.id) === String(id));
  // Restore in DB first (works whether or not it's still in cbRecycleBin)
  if (Number(id) > 0) {
    try {
      const res = await fetch(CB_API + "/" + id + "/restore", { method: "PATCH", headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
      if (!res.ok) {
        toast("Restore failed — server error", "err");
        return;
      }
    } catch (e) {
      toast("Restore failed — network error", "err");
      return;
    }
  }
  if (idx !== -1) {
    const row = cbRecycleBin[idx];
    row._deleted = false;
    delete row._deleted_at;
    cbRecycleBin.splice(idx, 1);
    ledgerAllRows.push(row);
    document.getElementById("undo-toast-cb")?.remove();
    toast("Restored: " + (row.name || "row"), "ok");
    renderLedger();
  } else {
    // Row not in memory (e.g. after page reload) — reload from DB
    document.getElementById("undo-toast-cb")?.remove();
    toast("Restored", "ok");
    await loadLedger();
  }
}

// ── SOFT DELETE PARENT RECORD ────────────────────────────────────────────
let _ldgUndoTimer = null;

async function ldgSoftDeleteRecord(recId, name) {
  if (
    !confirm(
      `Delete transaction for "${name}" and all its ledger rows?\n\nThis can be restored from the Recycle Bin tab.`,
    )
  )
    return;
  const res = await fetch(API + "/" + recId + "/soft-delete", {
    method: "PATCH",
  });
  if (!res.ok) {
    toast("Delete failed — server error", "err");
    return;
  }
  ledgerRecords = ledgerRecords.filter((r) => r.id !== recId);
  ledgerAllRows = ledgerAllRows.filter((r) => r.record_id !== recId);
  renderLedger();
  showUndoToast(recId, name);
}

function showUndoToast(recId, name) {
  const existing = document.getElementById("undo-toast");
  if (existing) existing.remove();
  if (_ldgUndoTimer) clearTimeout(_ldgUndoTimer);
  const el = document.createElement("div");
  el.id = "undo-toast";
  el.style.cssText =
    "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#c0392b;color:#fff;padding:10px 16px;border-radius:10px;font-size:12px;font-weight:700;z-index:9999;display:flex;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.25);white-space:nowrap;";
  const label = document.createElement("span");
  label.textContent = "🗑️ Deleted: ";
  const strong = document.createElement("strong");
  strong.textContent = name;
  label.appendChild(strong);
  el.appendChild(label);
  const undoBtn = document.createElement("button");
  undoBtn.textContent = "↩ Undo (10s)";
  undoBtn.style.cssText = "margin-left:12px;background:#fff;color:#c0392b;border:none;border-radius:5px;padding:3px 10px;cursor:pointer;font-weight:800;font-size:11px";
  undoBtn.addEventListener("click", () => ldgUndoDelete(recId, name));
  el.appendChild(undoBtn);
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "margin-left:6px;background:transparent;color:#fff;border:none;cursor:pointer;font-size:14px;opacity:0.7";
  closeBtn.addEventListener("click", () => el.remove());
  el.appendChild(closeBtn);
  document.body.appendChild(el);
  _ldgUndoTimer = setTimeout(() => {
    const t = document.getElementById("undo-toast");
    if (t) {
      t.style.opacity = "0";
      t.style.transition = "opacity 0.4s";
      setTimeout(() => t.remove(), 400);
    }
  }, 10000);
}

async function ldgUndoDelete(recId, name) {
  const res = await fetch(API + "/" + recId + "/restore", {
    method: "PATCH",
  });
  if (!res.ok) {
    toast("Restore failed", "err");
    return;
  }
  document.getElementById("undo-toast")?.remove();
  if (_ldgUndoTimer) clearTimeout(_ldgUndoTimer);
  toast("Restored: " + name, "ok");
  await loadLedger();
}

// ── RECYCLE BIN ──────────────────────────────────────────────────────────
async function loadRecycleBin() {
  const tbody = document.getElementById("recycle-bin-body");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:#aaa">Loading...</td></tr>`;
  renderCbRecycleBin();
  try {
    const res = await fetch(API + "/deleted");
    const data = await res.json();
    const records = data.records || [];
    if (!records.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:#aaa">🎉 Recycle Bin is empty</td></tr>`;
      return;
    }
    tbody.innerHTML = "";
    records.forEach((r) => {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid #f0f0f0";

      // Name
      const tdName = document.createElement("td");
      tdName.style.cssText = "padding:8px 10px;font-weight:700;font-size:10pt";
      tdName.textContent = r.name || "—";
      tr.appendChild(tdName);

      // Tx type badge
      const tdTx = document.createElement("td");
      tdTx.style.cssText = "padding:8px 10px";
      const badge = document.createElement("span");
      badge.style.cssText = "background:var(--lav);color:var(--lav-a);padding:2px 8px;border-radius:5px;font-size:8pt;font-weight:700";
      const raw = r.tx_types;
      if (!raw) { badge.textContent = "—"; }
      else if (Array.isArray(raw)) { badge.textContent = raw.join(" + "); }
      else {
        const s = String(raw).trim();
        try {
          if (s.startsWith("[") || s.startsWith("{")) {
            const p = JSON.parse(s);
            badge.textContent = Array.isArray(p) ? p.join(" + ") : Object.values(p).join(" + ");
          } else { badge.textContent = s.replace(/,/g, " + "); }
        } catch(e) { badge.textContent = s.replace(/[\[\]{}'"]/g,"").replace(/,/g," + "); }
      }
      tdTx.appendChild(badge);
      tr.appendChild(tdTx);

      // Deleted at
      const tdDate = document.createElement("td");
      tdDate.style.cssText = "padding:8px 10px;font-size:9pt;color:#aaa";
      tdDate.textContent = r.deleted_at
        ? new Date(r.deleted_at).toLocaleString("en-IN")
        : (r.date || "—");
      tr.appendChild(tdDate);

      // Ledger rows count
      const tdCb = document.createElement("td");
      tdCb.style.cssText = "padding:8px 10px;font-size:9pt;text-align:center";
      if (r.cashbook_rows > 0) {
        const pill = document.createElement("span");
        pill.style.cssText = "background:#eaf4ff;color:#1a5276;border-radius:5px;padding:2px 8px;font-weight:700;font-size:8.5pt";
        pill.textContent = r.cashbook_rows + " row" + (r.cashbook_rows !== 1 ? "s" : "");
        tdCb.appendChild(pill);
      } else {
        tdCb.textContent = "—";
      }
      tr.appendChild(tdCb);

      // Action buttons
      const tdAct = document.createElement("td");
      tdAct.style.cssText = "padding:8px 10px;text-align:center;white-space:nowrap";

      const restoreBtn = document.createElement("button");
      restoreBtn.style.cssText = "background:#d4f5e9;color:#2a7a50;border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:10px;font-weight:700;margin-right:5px";
      restoreBtn.textContent = "🔄 Restore";
      restoreBtn.title = r.cashbook_rows > 0
        ? "Restores record + " + r.cashbook_rows + " ledger row(s)"
        : "Restore this record";
      restoreBtn.addEventListener("click", () => ldgRestoreRecord(r.id, r.name || "", r.cashbook_rows || 0));
      tdAct.appendChild(restoreBtn);

      const permBtn = document.createElement("button");
      permBtn.style.cssText = "background:#fde0e8;color:#c0392b;border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:10px;font-weight:700";
      permBtn.textContent = "☠️ Delete Forever";
      permBtn.title = r.cashbook_rows > 0
        ? "Permanently deletes record + " + r.cashbook_rows + " ledger row(s)"
        : "Permanently delete this record";
      permBtn.addEventListener("click", () => ldgPermDelete(r.id, r.name || "", r.cashbook_rows || 0));
      tdAct.appendChild(permBtn);

      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:#c0392b">Could not load recycle bin</td></tr>`;
  }
}

async function ldgRestoreRecord(recId, name, cashbookRows) {
  const cbMsg = cashbookRows > 0 ? `\n\nThis will also restore ${cashbookRows} ledger row(s).` : "";
  if (!confirm(`Restore "${name}"?${cbMsg}`)) return;
  const res = await fetch(API + "/" + recId + "/restore", { method: "PATCH", headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
  if (!res.ok) {
    toast("Restore failed", "err");
    return;
  }
  const data = await res.json().catch(() => ({}));
  const restoredCb = data.cashbookRowsRestored || 0;
  toast("✅ Restored: " + name + (restoredCb > 0 ? " + " + restoredCb + " ledger rows" : ""), "ok");
  loadRecycleBin();
  loadLedger();
}

// ── Render cashbook row recycle bin (in-memory + DB deleted) ──────────────
async function renderCbRecycleBin() {
  const tbody = document.getElementById("recycle-cb-rows-body");
  if (!tbody) return;

  // Merge in-memory deleted rows with any DB-deleted rows
  let allDeleted = [...cbRecycleBin];

  // Also fetch DB-deleted rows (for past dates / server restarts)
  try {
    const res = await fetch(CB_API + "/deleted", { headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
    if (res.ok) {
      const json = await res.json();
      const dbRows = json.rows || json.entries || [];
      dbRows.forEach((r) => {
        if (!allDeleted.find((m) => String(m.id) === String(r.id))) {
          allDeleted.push({ ...r, _saved: true, _deleted: true });
        }
      });
    }
    // 404 = server doesn't have soft-delete yet — just use in-memory
  } catch (e) {
    console.log("CB deleted endpoint not available yet");
  }

  if (!allDeleted.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#aaa">No deleted cashbook rows</td></tr>`;
    return;
  }

  const fmtAmt = (n) => "₹ " + Number(n || 0).toLocaleString("en-IN");
  tbody.innerHTML = allDeleted
    .map(
      (r) => `
    <tr style="border-bottom:1px solid #f0e0e0">
      <td style="padding:8px 10px;font-weight:700;font-size:10pt">${r.name || "—"}</td>
      <td style="padding:8px 10px;font-size:9pt">
        <span style="background:#fde0e8;color:#c0392b;padding:2px 8px;border-radius:5px;font-size:8pt;font-weight:700">${r.acc_type || r.task || "—"}</span>
      </td>
      <td style="padding:8px 10px;font-size:9pt;text-align:right;font-weight:700;color:#2a7a50">${fmtAmt(r.amount)}</td>
      <td style="padding:8px 10px;text-align:center">
        <span style="background:${r.tx_type === "Credit" ? "#d4f5e9" : "#fde0e8"};color:${r.tx_type === "Credit" ? "#2a7a50" : "#c0392b"};padding:2px 8px;border-radius:5px;font-size:8pt;font-weight:700">${r.tx_type || "—"}</span>
      </td>
      <td style="padding:8px 10px;font-size:9pt;color:#aaa">${r._deleted_at || r.deleted_at ? new Date(r._deleted_at || r.deleted_at).toLocaleString("en-IN") : "—"}</td>
      <td style="padding:8px 10px;text-align:center;white-space:nowrap">
        <button data-cb-restore-id="${r.id}"
          style="background:#d4f5e9;color:#2a7a50;border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:10px;font-weight:700;margin-right:5px">🔄 Restore</button>
        <button data-cb-perm-id="${r.id}"
          style="background:#fde0e8;color:#c0392b;border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:10px;font-weight:700">☠️ Delete Forever</button>
      </td>
    </tr>`,
    )
    .join("");
  // Event delegation for cashbook recycle bin buttons (no inline onclick with id)
  tbody.querySelectorAll('[data-cb-restore-id]').forEach((btn) => {
    btn.addEventListener('click', () => cbRowRestore(btn.dataset.cbRestoreId));
  });
  tbody.querySelectorAll('[data-cb-perm-id]').forEach((btn) => {
    btn.addEventListener('click', () => cbRowPermDelete(btn.dataset.cbPermId));
  });
}

async function cbRowRestore(id) {
  const idx = cbRecycleBin.findIndex((r) => String(r.id) === String(id));
  let row;
  if (idx !== -1) {
    row = cbRecycleBin[idx];
    cbRecycleBin.splice(idx, 1);
    row._deleted = false;
    delete row._deleted_at;
    ledgerAllRows.push(row);
  }
  // Restore in DB if saved
  if (Number(id) > 0) {
    try {
      const res = await fetch(CB_API + "/" + id + "/restore", {
        method: "PATCH",
        headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' },
      });
      // BUG FIX: toast fired unconditionally even on server error —
      // in-memory state was already mutated, leaving UI and DB out of sync.
      if (!res.ok) {
        // Rollback in-memory changes
        if (idx !== -1) {
          ledgerAllRows = ledgerAllRows.filter((r) => String(r.id) !== String(id));
          row._deleted = true;
          cbRecycleBin.splice(idx, 0, row);
        }
        toast("Restore failed — server error", "err");
        renderLedger();
        renderCbRecycleBin();
        return;
      }
      if (!row) {
        // Row came from DB only — add it back to memory
        const json = await res.json().catch(() => ({}));
        if (json.row) {
          json.row._saved = true;
          ledgerAllRows.push(json.row);
        }
      }
    } catch (e) {
      toast("Restore failed — network error", "err");
      return;
    }
  }
  toast("Cashbook row restored", "ok");
  renderLedger();
  renderCbRecycleBin();
}

async function cbRowPermDelete(id) {
  if (
    !confirm("Permanently delete this cashbook row?\n\nThis CANNOT be undone.")
  )
    return;
  if (Number(id) > 0) {
    try {
      // BUG FIX: the backend requires soft-delete before permanent delete.
      // The old code called DELETE directly, getting a 400 which was silently
      // swallowed — showing a false "Permanently deleted" toast every time.
      // Step 1: soft-delete (no-op if already soft-deleted)
      const sdRes = await fetch(CB_API + "/" + id + "/soft-delete", { method: "PATCH", headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
      // 404 = already soft-deleted, that's fine. Any other non-ok is a real error.
      if (!sdRes.ok && sdRes.status !== 404) {
        toast("Delete failed — server error", "err");
        return;
      }
      // Step 2: permanent delete
      const delRes = await fetch(CB_API + "/" + id, { method: "DELETE", headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
      if (!delRes.ok) {
        toast("Delete failed — server error", "err");
        return;
      }
    } catch (e) {
      toast("Delete failed — network error", "err");
      return;
    }
  }
  cbRecycleBin = cbRecycleBin.filter((r) => String(r.id) !== String(id));
  toast("Permanently deleted", "ok");
  renderCbRecycleBin();
}

async function ldgPermDelete(recId, name, cashbookRows) {
  const cbMsg = cashbookRows > 0 ? `\n\nThis will also permanently delete ${cashbookRows} ledger row(s).` : "";
  if (!confirm(`Permanently delete "${name}"?${cbMsg}\n\nThis CANNOT be undone.`)) return;
  const res = await fetch(API + "/" + recId + "/permanent", { method: "DELETE", headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
  if (!res.ok) {
    toast("Permanent delete failed", "err");
    return;
  }
  const data = await res.json().catch(() => ({}));
  const deletedCb = data.cashbookRowsDeleted || 0;
  toast("☠️ Permanently deleted: " + name + (deletedCb > 0 ? " + " + deletedCb + " ledger rows" : ""), "ok");
  loadRecycleBin();
}

async function ldgAddManualRow() {
  const date = document.getElementById("ldg-date").value;
  if (!date) {
    toast("Select a date first", "err");
    return;
  }
  const name = prompt("Customer name for this row:") || "";
  const newRow = {
    id: -Date.now(),
    date,
    record_id: null,
    name,
    task: "Manual Entry",
    acc_type: "",
    tx_type: "Credit",
    acc_no: "",
    amount: 0,
    mode: "Cash",
    scroll_no: "",
    loan_date: "",
    sort_order: 9999,
    _saved: false,
  };
  ledgerAllRows.push(newRow);
  renderLedger();

  // BUG FIX (same root cause as ldgAddRowForRecord() below, and the one
  // actually reported: "manual entry gone on reload"): this standalone
  // "+ Add Row" button at the top of the Main Data tab is what people
  // actually use for a one-off manual line with no parent record — it had
  // the identical bug, just never wired to any flush path at all, so it
  // never survived a reload. Save it to cashbook_entries immediately, the
  // same way every other ledger row gets created; hold _ldgLoading during
  // the save so a "🔄 Load" click that lands mid-save can't wipe it out
  // before the save has landed in the DB (loadLedger() already no-ops
  // while this flag is set).
  _ldgLoading = true;
  try {
    await _flushToDB(newRow.date, [newRow]);
  } finally {
    _ldgLoading = false;
  }
  if (newRow._saved) {
    toast("Row added — edit inline below", "ok");
  } else {
    toast(
      "⚠️ Row added but could not be saved to the database — it will be lost on reload",
      "err",
    );
  }
  renderLedger();
}

// Add another row to an existing manual entry (its banner's own "+ Add Row"
// button — see the "Manual rows" grouping block in renderLedger()). `anchorId`
// is the group's first row's real DB id; every row sharing a group stores
// parent_id = anchorId, which is how they get re-grouped under one banner
// both immediately and after a reload (parent_id is persisted — see the
// bulkInsert/list BUG FIX comments in cashbook.controller.js).
async function ldgAddRowForManualGroup(anchorId, name, date) {
  const newRow = {
    id: -Date.now(),
    date: date || document.getElementById("ldg-date").value,
    record_id: null,
    parent_id: anchorId,
    name: name || "",
    task: "Manual Entry",
    acc_type: "",
    tx_type: "Credit",
    acc_no: "",
    amount: 0,
    mode: "Cash",
    scroll_no: "",
    loan_date: "",
    sort_order: 9999,
    _saved: false,
  };
  ledgerAllRows.push(newRow);
  renderLedger();

  _ldgLoading = true;
  try {
    await _flushToDB(newRow.date, [newRow]);
  } finally {
    _ldgLoading = false;
  }
  if (newRow._saved) {
    toast("Row added — edit inline below", "ok");
  } else {
    toast(
      "⚠️ Row added but could not be saved to the database — it will be lost on reload",
      "err",
    );
  }
  renderLedger();
}

// Delete every row of a manual entry in one go (the banner's own "🗑" button),
// instead of removing each row individually. Mirrors ldgSoftDeleteRecord()'s
// confirm/soft-delete/recycle-bin pattern but for cashbook_entries rows that
// have no backing parent record.
async function ldgSoftDeleteManualGroup(rowIds, name) {
  if (!rowIds || !rowIds.length) return;
  if (
    !confirm(
      `Move this manual entry ("${name || "Manual Entry"}") and its ${rowIds.length} row(s) to Recycle Bin?\n\nYou can restore them from the Recycle Bin tab.`,
    )
  )
    return;

  let failed = 0;
  for (const id of rowIds) {
    const row = ledgerAllRows.find((r) => String(r.id) === String(id));
    if (!row) continue;
    if (row._saved && Number(id) > 0) {
      try {
        const delRes = await fetch(CB_API + "/" + id + "/soft-delete", {
          method: "PATCH",
          headers: { "x-auth-token": localStorage.getItem("jju_token") || "" },
        });
        if (!delRes.ok) {
          failed++;
          continue;
        }
      } catch (e) {
        failed++;
        continue;
      }
    }
    row._deleted = true;
    row._deleted_at = new Date().toISOString();
    cbRecycleBin.unshift(row);
  }
  ledgerAllRows = ledgerAllRows.filter((r) => !r._deleted);
  renderLedger();
  if (failed) {
    toast(`⚠️ Moved some rows, but ${failed} failed to delete on the server`, "err");
  } else {
    toast(`🗑️ Moved "${name || "Manual Entry"}" (${rowIds.length} row(s)) to Recycle Bin`, "ok");
  }
}

// Add a new cashbook row linked to a specific parent record
async function ldgAddRowForRecord(recordId, name, date, txTypesRaw) {
  // BUG FIX: this used to hardcode task/acc_type to "Gold Loan TRF" no
  // matter what kind of record the row was added under — so a row added
  // under a "Saving Deposit" record showed up mislabeled as a Gold Loan
  // entry, and (since Template Data/Cash Book aggregation keys off `task`
  // first, see renderLedgerTemplate()) stayed silently bucketed under
  // "Gold Loan TRF" even after the acc_type dropdown was corrected inline.
  // Default from the record's own transaction type(s) instead, using the
  // same CB_TX_ROWS_MAP template addCashbookRows() itself uses, so a
  // manually-added row on a Saving Deposit record defaults to task
  // "Saving Deposit" / acc_type "Saving Account" / mode "Cash" — i.e.
  // it behaves like every other Saving Deposit cashbook row.
  const txTypes = parseTxTypes(txTypesRaw);
  let template = null;
  for (const t of txTypes) {
    const rows = CB_TX_ROWS_MAP[t];
    if (rows && rows.length) {
      template = rows[0];
      break;
    }
  }

  const newRow = {
    id: -Date.now(),
    date: date || document.getElementById("ldg-date").value,
    record_id: recordId,
    name: name || "",
    task: template ? template.task : "Manual Entry",
    acc_type: template ? template.acc_type : "Manual Entry",
    tx_type: template ? template.tx_type : "Debit",
    acc_no: "",
    amount: 0,
    mode: template ? template.mode : "Cash",
    scroll_no: "",
    loan_date: "",
    sort_order: 9999,
    _saved: false,
  };
  ledgerAllRows.push(newRow);
  renderLedger();

  // BUG FIX ("manually add entry in ledger, reload, it's gone"): this row
  // used to stay in memory only (_saved: false) with no code path that ever
  // flushed it to the DB unless the user happened to click a PDF/voucher
  // button afterward (see the other _flushToDB() callers) — a reload
  // silently lost it, and ldgSaveCell() also skipped persisting any inline
  // edit made to it in the meantime, since its isSavedRow check requires
  // _saved === true. Save it to cashbook_entries immediately instead, the
  // same way every other ledger row gets created.
  //
  // BUG FIX (race with the "🔄 Load" button): loadLedger() unconditionally
  // REPLACES ledgerAllRows with whatever the server returns
  // (`ledgerAllRows = (cbJson.entries || []).map(...)`). If someone clicked
  // Load while this save was still in flight, that replacement happened
  // before the POST above landed in the DB, so the fresh array never
  // contained this row — it vanished from the screen even though the save
  // itself was still going to succeed a moment later (nothing was left to
  // put it back once ledgerAllRows had already been swapped out). loadLedger
  // already refuses to run a second time while _ldgLoading is set — holding
  // that same flag here makes a Load click during this save a no-op instead
  // of a silent overwrite, so the row is always in place by the time a load
  // is actually allowed to run.
  _ldgLoading = true;
  try {
    await _flushToDB(newRow.date, [newRow]);
  } finally {
    _ldgLoading = false;
  }
  if (newRow._saved) {
    toast("Row added under " + (name || "record") + " — edit inline", "ok");
  } else {
    toast(
      "⚠️ Row added but could not be saved to the database — it will be lost on reload",
      "err",
    );
  }
  renderLedger();
}

// ── TRANSFER ENTRIES TAB ──────────────────────────────────────────────────────
// Only Transfer mode, non-zero amounts
function renderLedgerTransfer() {
  const rows = ldgFilteredRows().filter(
    (r) => r.mode === "Transfer" && Number(r.amount) > 0,
  );
  const tbody = document.getElementById("ldg-trf-body");
  const tfoot = document.getElementById("ldg-trf-foot");
  const fmtAmt = (n) =>
    "₹ " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--textl)">No Transfer transactions for this date</td></tr>';
    tfoot.innerHTML = "";
    return;
  }

  const crRows = rows.filter((r) => r.tx_type === "Credit");
  const dbRows = rows.filter((r) => r.tx_type === "Debit");
  const totalCr = crRows.reduce((s, r) => s + Number(r.amount), 0);
  const totalDb = dbRows.reduce((s, r) => s + Number(r.amount), 0);

  let html = "";
  if (crRows.length) {
    html += `<tr style="background:#ede9f8"><td colspan="8" style="padding:4px 8px;font-weight:800;text-align:center;color:#553c9a">— Credit —</td></tr>`;
    html += crRows
      .map(
        (
          r,
          i,
        ) => `<tr style="${i % 2 === 0 ? "background:#fff" : "background:#f9f6ff"}">
<td style="text-align:center;color:#888;padding:4px 6px">${i + 1}</td>
<td style="padding:4px 8px"><strong>${r.name || "—"}</strong></td>
<td style="padding:4px 8px">${r.acc_type || r.task || "—"}</td>
<td style="text-align:center;padding:4px 6px"><span style="background:#d4f5e9;color:#2a7a50;padding:2px 7px;border-radius:4px;font-size:8pt;font-weight:800">Credit</span></td>
<td style="font-family:monospace;font-weight:700;color:#553c9a;padding:4px 8px">${r.acc_no || "—"}</td>
<td style="text-align:right;font-weight:800;padding:4px 8px">${fmtAmt(r.amount)}</td>
${ldgInlineEdit(r.id, "scroll_no", r.scroll_no, "Scroll #")}
${ldgInlineEdit(r.id, "loan_date", r.loan_date, "Date")}
    </tr>`,
      )
      .join("");
    html += `<tr style="background:#ede9f8;font-weight:800">
<td colspan="5" style="text-align:right;padding:5px 8px">Total Credit (Transfer):</td>
<td style="text-align:right;color:#553c9a;padding:5px 8px">${fmtAmt(totalCr)}</td><td colspan="2"></td>
    </tr>`;
  }
  if (dbRows.length) {
    html += `<tr style="background:#fde0e8"><td colspan="8" style="padding:4px 8px;font-weight:800;text-align:center;color:#c0392b">— Debit —</td></tr>`;
    html += dbRows
      .map(
        (
          r,
          i,
        ) => `<tr style="${i % 2 === 0 ? "background:#fff" : "background:#fdf5f5"}">
<td style="text-align:center;color:#888;padding:4px 6px">${i + 1}</td>
<td style="padding:4px 8px"><strong>${r.name || "—"}</strong></td>
<td style="padding:4px 8px">${r.acc_type || r.task || "—"}</td>
<td style="text-align:center;padding:4px 6px"><span style="background:#fde0e8;color:#c0392b;padding:2px 7px;border-radius:4px;font-size:8pt;font-weight:800">Debit</span></td>
<td style="font-family:monospace;font-weight:700;color:#553c9a;padding:4px 8px">${r.acc_no || "—"}</td>
<td style="text-align:right;font-weight:800;padding:4px 8px">${fmtAmt(r.amount)}</td>
${ldgInlineEdit(r.id, "scroll_no", r.scroll_no, "Scroll #")}
${ldgInlineEdit(r.id, "loan_date", r.loan_date, "Date")}
    </tr>`,
      )
      .join("");
    html += `<tr style="background:#fde0e8;font-weight:800">
<td colspan="5" style="text-align:right;padding:5px 8px">Total Debit (Transfer):</td>
<td style="text-align:right;color:#c0392b;padding:5px 8px">${fmtAmt(totalDb)}</td><td colspan="2"></td>
    </tr>`;
  }
  tbody.innerHTML = html;
  tfoot.innerHTML = `<tr style="background:#f3f0ff;font-weight:800;border-top:2px solid #553c9a">
<td colspan="5" style="text-align:right;padding:6px 8px">Net (Credit − Debit):</td>
<td style="text-align:right;padding:6px 8px;color:${totalCr - totalDb >= 0 ? "#2a7a50" : "#c0392b"}">${fmtAmt(Math.abs(totalCr - totalDb))} ${totalCr - totalDb >= 0 ? "CR" : "DB"}</td>
<td colspan="2"></td>
    </tr>`;

  // wire up inline-edit listeners
  tbody.querySelectorAll("input[data-id]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      const id = inp.dataset.id;
      const field = inp.dataset.field;
      const value = inp.value;
      try {
        await fetch(`${CB_API}/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
          body: JSON.stringify({ [field]: value }),
        });
      } catch (e) {
        console.error("Inline edit error", e);
      }
    });
  });
}


function renderLedgerCashBook() {
  const rows = ldgFilteredRows().filter(
    (r) => r.mode === "Cash" && Number(r.amount) > 0,
  );
  const tbody = document.getElementById("ldg-cb-body");
  const tfoot = document.getElementById("ldg-cb-foot");
  const fmtAmt = (n) =>
    "₹ " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--textl)">No Cash transactions for this date</td></tr>';
    tfoot.innerHTML = "";
    cbSyncOpeningForDate();
    cbRecalcClosing();
    return;
  }

  const crRows = rows.filter((r) => r.tx_type === "Credit");
  const dbRows = rows.filter((r) => r.tx_type === "Debit");
  const totalCr = crRows.reduce((s, r) => s + Number(r.amount), 0);
  const totalDb = dbRows.reduce((s, r) => s + Number(r.amount), 0);

  let html = "";
  if (crRows.length) {
    html += `<tr style="background:#c8e6c9"><td colspan="8" style="padding:4px 8px;font-weight:800;text-align:center">— Credit —</td></tr>`;
    html += crRows
      .map(
        (
          r,
          i,
        ) => `<tr style="${i % 2 === 0 ? "background:#fff" : "background:#f9fafb"}">
<td style="text-align:center;color:#888">${i + 1}</td>
<td><strong>${r.name || "—"}</strong></td>
<td>${r.acc_type || r.task || "—"}</td>
<td style="text-align:center"><span style="background:#d4f5e9;color:#2a7a50;padding:2px 7px;border-radius:4px;font-size:8pt;font-weight:800">Credit</span></td>
<td style="font-family:monospace;font-weight:700;color:#553c9a">${r.acc_no || "—"}</td>
<td style="text-align:right;font-weight:800">${fmtAmt(r.amount)}</td>
<td style="text-align:center;color:#555">${r.scroll_no || "—"}</td>
<td style="text-align:center">${r.loan_date || "—"}</td>
    </tr>`,
      )
      .join("");
    // Fix 7: Total Credit row AFTER all credit entries
    html += `<tr style="background:#d4f5e9;font-weight:800">
<td colspan="5" style="text-align:right;padding:5px 8px">Total Credit (Cash):</td>
<td style="text-align:right;color:#2a7a50;padding:5px 8px">${fmtAmt(totalCr)}</td><td colspan="2"></td>
    </tr>`;
  }
  if (dbRows.length) {
    html += `<tr style="background:#ffcdd2"><td colspan="8" style="padding:4px 8px;font-weight:800;text-align:center">— Debit —</td></tr>`;
    html += dbRows
      .map(
        (
          r,
          i,
        ) => `<tr style="${i % 2 === 0 ? "background:#fff" : "background:#f9fafb"}">
<td style="text-align:center;color:#888">${i + 1}</td>
<td><strong>${r.name || "—"}</strong></td>
<td>${r.acc_type || r.task || "—"}</td>
<td style="text-align:center"><span style="background:#fde0e8;color:#c0392b;padding:2px 7px;border-radius:4px;font-size:8pt;font-weight:800">Debit</span></td>
<td style="font-family:monospace;font-weight:700;color:#553c9a">${r.acc_no || "—"}</td>
<td style="text-align:right;font-weight:800">${fmtAmt(r.amount)}</td>
<td style="text-align:center;color:#555">${r.scroll_no || "—"}</td>
<td style="text-align:center">${r.loan_date || "—"}</td>
    </tr>`,
      )
      .join("");
    // Fix 7: Total Debit row AFTER all debit entries
    html += `<tr style="background:#fde0e8;font-weight:800">
<td colspan="5" style="text-align:right;padding:5px 8px">Total Debit (Cash):</td>
<td style="text-align:right;color:#c0392b;padding:5px 8px">${fmtAmt(totalDb)}</td><td colspan="2"></td>
    </tr>`;
  }
  tbody.innerHTML = html;

  tfoot.innerHTML = `
    <tr style="background:#fffde7;font-weight:800">
<td colspan="5" style="text-align:right;padding:5px 8px">Total Credit - Total Debit (Net):</td>
<td style="text-align:right;color:#7a5800;padding:5px 8px">${fmtAmt(totalCr - totalDb)}</td><td colspan="2"></td>
    </tr>`;
  cbSyncOpeningForDate();
  cbRecalcClosing();
}

// ── INT RECV GOLD LOAN TAB ────────────────────────────────────────────────────
// Shared helper: only keep "Gold Loan TRF" / "Interest Received On Gold Loan TRF"
// rows that belong to an actual Closing - Loan group (i.e. the record_id group
// contains an "Interest Received On Gold Loan TRF" row). Without this, a brand
// new Gold Loan disbursement's "Gold Loan TRF" debit gets mixed in too, since
// that same task name is also used for new loans (Gold Loan -> Saving Acc TRF).
function filterGLClosingRows(allRows, modeFilter) {
  const GL_TASKS = new Set([
    "Interest Received On Gold Loan TRF",
    "Gold Loan TRF",
  ]);
  const closingGroupIds = new Set(
    allRows
      .filter(
        (r) =>
          (r.acc_type || r.task || "").trim() ===
          "Interest Received On Gold Loan TRF",
      )
      .map((r) => r.record_id ?? "_manual_"),
  );
  return allRows.filter((r) => {
    const t = (r.acc_type || r.task || "").trim();
    const groupId = r.record_id ?? "_manual_";
    const modeOk = modeFilter ? modeFilter.includes(r.mode) : true;
    return GL_TASKS.has(t) && modeOk && closingGroupIds.has(groupId);
  });
}

// Fetch + filter the GL-83 closing rows for a given date — used both by the
// manual "Generate GL Int Voucher" button and the automatic Closing Day flow.
async function getGLIntVoucherRowsForDate(date) {
  let allEntries = ledgerAllRows.filter((r) => !r.date || r.date === date);
  if (!allEntries.length) {
    try {
      const { entries } = await (
        await fetch(CB_API + "?date=" + date, {
          headers: { "x-auth-token": localStorage.getItem("jju_token") || "" },
        })
      ).json();
      allEntries = entries || [];
    } catch (e) {}
  }
  return filterGLClosingRows(allEntries, ["Transfer"]);
}

// Builds + opens the GL-83 tabular voucher PDF from a pre-filtered rows array.
// Returns true if a voucher was generated, false if there was nothing to show.
function buildGLIntVoucherPDF(rows, date) {
  if (!rows.length) return false;
  const dtFmt = new Date(date)
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .replace(/ /g, "-");
  generateTemplatePDF(["Int Recv GL Voucher"], {
    _closedLoans: rows,
    date: dtFmt,
  });
  return true;
}

async function generateGLIntVoucherManual() {
  try {
    const date =
      document.getElementById("ldg-date")?.value ||
      new Date().toISOString().split("T")[0];

    // Use the already-loaded Int GL ledger rows when available, else fetch
    let rows = filterGLClosingRows(ledgerAllRows, ["Transfer"]);
    if (!rows.length) {
      rows = await getGLIntVoucherRowsForDate(date);
    }

    if (!rows.length) {
      toast("No GL interest entries found for this date", "err");
      return;
    }

    buildGLIntVoucherPDF(rows, date);
  } catch (e) {
    toast("Failed to generate voucher: " + e.message, "err");
  }
}

// BUG FIX: the FD-OD interest-received voucher's Debit side always showed
// "No entries" / ₹0.00 — every Credit row (task "FDOD Int Recv - TRF" etc.)
// rendered, but its matching Debit row never did. Root cause: the old flat
// FDOD_TASKS filter only listed guessed variants of the CREDIT-side label
// ("FD OD TRF" among them) and never matched the DEBIT side's real live
// label, which is "FD OD Loan - TRF" (note the extra "Loan") — confirmed by
// pulling actual cashbook rows for a live record (id 99795: Credit task
// "FDOD Int Recv - TRF" ₹987, Debit task "FD OD Loan - TRF" ₹10,000, both
// scroll 22, same record_id). Simply adding "FD OD Loan - TRF" to a flat
// filter would be wrong too — that exact task label is ALSO used by a brand
// new FD-OD loan disbursement's debit row, which has nothing to do with an
// interest closing and would then wrongly show up in the voucher. Mirror
// filterGLClosingRows' approach instead: only keep a "FD OD Loan - TRF" /
// "FD OD TRF" debit row when it belongs to the same record_id as a genuine
// interest-credit row, so unrelated disbursements stay excluded.
function filterFDODClosingRows(allRows, modeFilter) {
  const FDOD_CREDIT_TASKS = new Set([
    "Int Received On FD-OD TRF",
    "FDOD Int Recv - TRF",
    "FD OD TRF",
    "FD OD Loan Int - TRF",
  ]);
  const FDOD_DEBIT_TASKS = new Set(["FD OD Loan - TRF", "FD OD TRF"]);
  // The debit row's acc_type ("FD OD Loan") and task ("FD OD Loan - TRF")
  // differ, unlike the credit row where both fields match — so check each
  // field on its own rather than falling back with "acc_type || task"
  // (which would silently prefer acc_type and never see the task value).
  function hasTask(r, taskSet) {
    return taskSet.has((r.task || "").trim()) || taskSet.has((r.acc_type || "").trim());
  }
  const closingGroupIds = new Set(
    allRows
      .filter((r) => hasTask(r, FDOD_CREDIT_TASKS) && r.tx_type === "Credit")
      .map((r) => r.record_id ?? "_manual_"),
  );
  return allRows.filter((r) => {
    const groupId = r.record_id ?? "_manual_";
    const modeOk = modeFilter ? modeFilter.includes(r.mode) : true;
    const isCredit = hasTask(r, FDOD_CREDIT_TASKS) && r.tx_type === "Credit";
    const isDebit = hasTask(r, FDOD_DEBIT_TASKS) && r.tx_type === "Debit";
    return (isCredit || isDebit) && modeOk && closingGroupIds.has(groupId);
  });
}

async function generateFDODIntVoucherManual() {
  try {
    let rows = filterFDODClosingRows(ledgerAllRows, ["Transfer"]).filter(
      (r) => Number(r.amount) > 0,
    );

    // If ledger not loaded, use in-memory or fetch from DB
    if (!rows.length) {
      const d =
        document.getElementById("ldg-date")?.value ||
        new Date().toISOString().split("T")[0];
      let allEntries = ledgerAllRows.filter((r) => !r.date || r.date === d);
      if (!allEntries.length) {
        try {
          const { entries } = await (await fetch(CB_API + "?date=" + d, { headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } })).json();
          allEntries = entries || [];
        } catch (e) {}
      }
      rows = filterFDODClosingRows(allEntries, ["Transfer"]).filter(
        (r) => Number(r.amount) > 0,
      );
    }

    if (!rows.length) {
      toast("No FD-OD interest entries found for this date", "err");
      return;
    }

    const date =
      document.getElementById("ldg-date")?.value ||
      new Date().toISOString().split("T")[0];
    const dtFmt = new Date(date)
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/ /g, "-");

    generateTemplatePDF(["Int Recv FDOD Voucher"], {
      _closedLoans: rows,
      date: dtFmt,
    });
  } catch (e) {
    toast("Failed to generate FD-OD voucher: " + e.message, "err");
  }
}

// Mirrors Google Sheets IntRecGL-83 FILTER formula
function renderLedgerIntGL() {
  // FIX: only Gold Loan TRF / Interest Received On Gold Loan TRF rows that
  // belong to an actual Closing - Loan group (see filterGLClosingRows) —
  // excludes brand-new Gold Loan disbursements that reuse the same task name.
  const rows = filterGLClosingRows(ldgFilteredRows(), ["Transfer", "Cash"]);
  const tbody = document.getElementById("ldg-intgl-body");
  const fmtAmt = (n) =>
    "₹ " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--textl)">No GL interest Transfer entries for this date</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map((r, i) => {
      const crBg =
        r.tx_type === "Credit"
          ? "background:#d4f5e9;color:#2a7a50"
          : "background:#fde0e8;color:#c0392b";
      return `<tr style="${i % 2 === 0 ? "" : "background:#fff8e8"}">
<td style="text-align:center;color:#888">${i + 1}</td>
<td><strong>${r.name || "—"}</strong></td>
<td>${r.acc_type || r.task || "—"}</td>
<td style="text-align:center"><span style="${crBg};padding:2px 7px;border-radius:4px;font-size:8pt;font-weight:800">${r.tx_type}</span></td>
${ldgInlineEdit(r.id, "acc_no", r.acc_no, "Acc No.")}
<td style="text-align:right;font-weight:800">${fmtAmt(r.amount)}</td>
${ldgInlineEdit(r.id, "scroll_no", r.scroll_no, "Scroll #")}
<td style="text-align:center">${r.loan_date || "—"}</td>
    </tr>`;
    })
    .join("");
}

// ── INT RECV FD-OD TAB ────────────────────────────────────────────────────────
// Mirrors Google Sheets IntRecFD-OD-277 FILTER formula
function renderLedgerIntFDOD() {
  // BUG FIX: reuse filterFDODClosingRows (see generateFDODIntVoucherManual)
  // instead of a flat task-name filter — this tab was missing every FD-OD
  // interest closing's Debit row ("FD OD Loan - TRF") for the same reason
  // the voucher's Debit side was blank, and a naive flat-list fix would have
  // also pulled in unrelated new-loan disbursement debits sharing that task
  // label. Grouping by record_id keeps this scoped to real interest closings.
  const rows = filterFDODClosingRows(ldgFilteredRows(), ["Transfer"]).filter(
    (r) => Number(r.amount) > 0,
  );
  const tbody = document.getElementById("ldg-intfdod-body");
  const fmtAmt = (n) =>
    "₹ " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--textl)">No FD-OD interest Transfer entries for this date</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map((r, i) => {
      const crBg =
        r.tx_type === "Credit"
          ? "background:#d4f5e9;color:#2a7a50"
          : "background:#fde0e8;color:#c0392b";
      return `<tr style="${i % 2 === 0 ? "" : "background:#e8f4fd"}">
<td style="text-align:center;color:#888">${i + 1}</td>
<td><strong>${r.name || "—"}</strong></td>
<td>${r.acc_type || r.task || "—"}</td>
<td style="text-align:center"><span style="${crBg};padding:2px 7px;border-radius:4px;font-size:8pt;font-weight:800">${r.tx_type}</span></td>
${ldgInlineEdit(r.id, "acc_no", r.acc_no, "Acc No.")}
<td style="text-align:right;font-weight:800">${fmtAmt(r.amount)}</td>
${ldgInlineEdit(r.id, "scroll_no", r.scroll_no, "Scroll #")}
<td style="text-align:center">${r.loan_date || "—"}</td>
    </tr>`;
    })
    .join("");
}

// ── BANK TRF TAB ──────────────────────────────────────────────────────────────
// Mirrors Google Sheets Bank-TRF-Vouchers — Transfer mode rows for Bank accounts
function renderLedgerBankTRF() {
  const rows = ldgFilteredRows().filter(isBankTRFRow);
  const tbody = document.getElementById("ldg-banktrf-body");
  const tfoot = document.getElementById("ldg-banktrf-foot");
  const fmtAmt = (n) =>
    "₹ " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--textl)">No Bank Transfer transactions for this date</td></tr>';
    tfoot.innerHTML = "";
    return;
  }

  const crRows = rows.filter((r) => r.tx_type === "Credit");
  const dbRows = rows.filter((r) => r.tx_type === "Debit");
  const totalCr = crRows.reduce((s, r) => s + Number(r.amount), 0);
  const totalDb = dbRows.reduce((s, r) => s + Number(r.amount), 0);

  let html = "";
  if (crRows.length) {
    html += `<tr style="background:#bee3f8"><td colspan="8" style="padding:4px 8px;font-weight:800;text-align:center;color:#1a365d">— Credit —</td></tr>`;
    html += crRows
      .map(
        (
          r,
          i,
        ) => `<tr style="${i % 2 === 0 ? "background:#fff" : "background:#ebf8ff"}">
<td style="text-align:center;color:#888;padding:4px 6px">${i + 1}</td>
<td style="padding:4px 8px"><strong>${r.name || "—"}</strong></td>
<td style="padding:4px 8px;font-size:8.5pt">${r.acc_type || r.task || "—"}</td>
<td style="text-align:center;padding:4px 6px"><span style="background:#d4f5e9;color:#2a7a50;padding:2px 7px;border-radius:4px;font-size:8pt;font-weight:800">Credit</span></td>
<td style="font-family:monospace;font-weight:700;color:#1a365d;padding:4px 8px">${r.acc_no || "—"}</td>
<td style="text-align:right;font-weight:800;padding:4px 8px">${fmtAmt(r.amount)}</td>
${ldgInlineEdit(r.id, "scroll_no", r.scroll_no, "Scroll #")}
<td style="padding:4px 8px;font-size:8pt;color:#555">${r.upi_rrn || "—"}</td>
    </tr>`,
      )
      .join("");
    html += `<tr style="background:#bee3f8;font-weight:800">
<td colspan="5" style="text-align:right;padding:5px 8px">Total Credit (Bank TRF):</td>
<td style="text-align:right;color:#1a365d;padding:5px 8px">${fmtAmt(totalCr)}</td><td colspan="2"></td>
    </tr>`;
  }
  if (dbRows.length) {
    html += `<tr style="background:#fde0e8"><td colspan="8" style="padding:4px 8px;font-weight:800;text-align:center;color:#c0392b">— Debit —</td></tr>`;
    html += dbRows
      .map(
        (
          r,
          i,
        ) => `<tr style="${i % 2 === 0 ? "background:#fff" : "background:#fff5f5"}">
<td style="text-align:center;color:#888;padding:4px 6px">${i + 1}</td>
<td style="padding:4px 8px"><strong>${r.name || "—"}</strong></td>
<td style="padding:4px 8px;font-size:8.5pt">${r.acc_type || r.task || "—"}</td>
<td style="text-align:center;padding:4px 6px"><span style="background:#fde0e8;color:#c0392b;padding:2px 7px;border-radius:4px;font-size:8pt;font-weight:800">Debit</span></td>
<td style="font-family:monospace;font-weight:700;color:#1a365d;padding:4px 8px">${r.acc_no || "—"}</td>
<td style="text-align:right;font-weight:800;padding:4px 8px">${fmtAmt(r.amount)}</td>
${ldgInlineEdit(r.id, "scroll_no", r.scroll_no, "Scroll #")}
<td style="padding:4px 8px;font-size:8pt;color:#555">${r.upi_rrn || "—"}</td>
    </tr>`,
      )
      .join("");
    html += `<tr style="background:#fde0e8;font-weight:800">
<td colspan="5" style="text-align:right;padding:5px 8px">Total Debit (Bank TRF):</td>
<td style="text-align:right;color:#c0392b;padding:5px 8px">${fmtAmt(totalDb)}</td><td colspan="2"></td>
    </tr>`;
  }
  tbody.innerHTML = html;
  tfoot.innerHTML = `<tr style="background:#ebf8ff;font-weight:800;border-top:2px solid #1a365d">
<td colspan="5" style="text-align:right;padding:6px 8px">Net (Credit − Debit):</td>
<td style="text-align:right;padding:6px 8px;color:${totalCr - totalDb >= 0 ? "#2a7a50" : "#c0392b"}">${fmtAmt(Math.abs(totalCr - totalDb))} ${totalCr - totalDb >= 0 ? "CR" : "DB"}</td>
<td colspan="2"></td>
    </tr>`;

  // Wire up scroll_no inline edit
  tbody.querySelectorAll("input[data-id]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      try {
        await fetch(`${CB_API}/${inp.dataset.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
          body: JSON.stringify({ [inp.dataset.field]: inp.value }),
        });
      } catch (e) {
        console.error("Inline edit error", e);
      }
    });
  });
}

// Shared by the Ledger tab's "Generate Bank TRF Vouchers" button and the
// Day-End Summary's bank section — builds and opens that date's Bank TRF
// voucher PDF. `presetRows`, when given, is filtered and used as-is (lets a
// caller that already has the day's rows in memory skip a redundant
// fetch); if that yields nothing, falls back to a fresh fetch for `date`.
async function generateBankTRFVoucherForDate(date, presetRows) {
  try {
    date = date || new Date().toISOString().split("T")[0];
    let rows = (presetRows || []).filter(isBankTRFRow);

    if (!rows.length) {
      try {
        const { entries } = await (
          await fetch(CB_API + "?date=" + date, {
            headers: {
              "x-auth-token": localStorage.getItem("jju_token") || "",
            },
          })
        ).json();
        rows = (entries || []).filter(
          (r) => isBankTRFRow(r) && Number(r.amount) > 0,
        );
      } catch (e) {}
    }

    if (!rows.length) {
      toast("No Bank Transfer entries found for this date", "err");
      return;
    }

    const dtFmt = new Date(date)
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .replace(/ /g, "-");

    generateTemplatePDF(["Bank TRF Voucher"], {
      _bankRows: rows,
      date: dtFmt,
    });
  } catch (e) {
    toast("Failed to generate Bank TRF voucher: " + e.message, "err");
  }
}

async function generateBankTRFVoucherManual() {
  const d =
    document.getElementById("ldg-date")?.value ||
    new Date().toISOString().split("T")[0];
  await generateBankTRFVoucherForDate(d, ledgerAllRows);
}

// ── TEMPLATE DATA TAB ─────────────────────────────────────────────────────────
// Aggregated voucher covering data — exactly matches Google Sheets templateData tab
// Columns: Account Type | Account Number | Tx Mode | Tx Type | Date | Transfer | Cash | Voucher Names
function renderLedgerTemplate() {
  const rows = ldgFilteredRows();
  const tbody = document.getElementById("ldg-tmpl-body");
  const tfoot = document.getElementById("ldg-tmpl-foot");
  const date =
    document.getElementById("ldg-date").value ||
    new Date().toISOString().split("T")[0];
  const fmtAmt = (n) =>
    n > 0
      ? "₹ " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })
      : "";

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--textl)">No data loaded</td></tr>';
    tfoot.innerHTML = "";
    return;
  }

  const taskTrf = {};
  const taskCash = {};

  // Index by "task|tx_type" so Credit and Debit entries for the same task
  // are tracked separately — prevents doubling when VOUCHER_TEMPLATE has
  // both a Credit and Debit row with the same task name.
  rows.forEach((r) => {
    const key = (r.task || r.acc_type || "").trim() + "|" + (r.tx_type || "");
    if (!key) return;
    if (r.mode === "Transfer")
      taskTrf[key] = (taskTrf[key] || 0) + Number(r.amount);
    if (r.mode === "Cash")
      taskCash[key] = (taskCash[key] || 0) + Number(r.amount);
  });

  let totalTrf = 0,
    totalCash = 0;
  let rowNum = 0,
    html = "";

  VOUCHER_TEMPLATE.forEach((v) => {
    // Match on "task|tx_type" composite key — avoids false matches when the
    // same task appears in both Credit and Debit VOUCHER_TEMPLATE rows.
    const keyTrf = (v.task || v.acc_type || "") + "|" + (v.tx_type || "");
    const trfAmt = taskTrf[keyTrf] || 0;
    const cashAmt = taskCash[keyTrf] || 0;
    if (trfAmt === 0 && cashAmt === 0) return;

    totalTrf += trfAmt;
    totalCash += cashAmt;

    const crBg =
      v.tx_type === "Credit"
        ? "background:#d4f5e9;color:#2a7a50"
        : "background:#fde0e8;color:#c0392b";
    const modeBg =
      trfAmt > 0
        ? "background:#e8f4fd;color:#2b6cb0"
        : "background:#fff8e1;color:#b7791f";
    const modeLabel =
      trfAmt > 0 && cashAmt > 0 ? "Both" : trfAmt > 0 ? "Transfer" : "Cash";
    const trfCell =
      trfAmt > 0
        ? `<strong style="color:var(--sky-a)">${fmtAmt(trfAmt)}</strong>`
        : `<span style="color:#ddd">—</span>`;
    const cashCell =
      cashAmt > 0
        ? `<strong style="color:var(--lem-a)">${fmtAmt(cashAmt)}</strong>`
        : `<span style="color:#ddd">—</span>`;

    html += `<tr style="${rowNum % 2 === 0 ? "background:#fff" : "background:#f9f6ff"}">
<td style="font-weight:700">${v.acc_type}</td>
<td>${v.acc_no}</td>
<td style="text-align:center"><span style="${modeBg};padding:2px 6px;border-radius:4px;font-size:8pt;font-weight:800">${modeLabel}</span></td>
<td style="text-align:center"><span style="${crBg};padding:2px 6px;border-radius:4px;font-size:8pt;font-weight:800">${v.tx_type}</span></td>
<td style="text-align:center">${date}</td>
<td style="text-align:right">${trfCell}</td>
<td style="text-align:right">${cashCell}</td>
<td style="font-size:8pt;color:#555">${v.trf_name || "—"}</td>
<td style="font-size:8pt;color:#555">${v.cash_name || "—"}</td>
    </tr>`;
    rowNum++;
  });

  tbody.innerHTML =
    html ||
    '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--textl)">No voucher entries found for this date</td></tr>';

  const fmtT = (n) =>
    "₹ " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  tfoot.innerHTML = `
    <tr style="background:#e8f4fd;font-weight:800">
<td colspan="5" style="text-align:right;padding:5px 9px">Total Transfer:</td>
<td style="text-align:right;color:var(--sky-a);padding:5px 9px">${fmtT(totalTrf)}</td>
<td colspan="3"></td>
    </tr>
    <tr style="background:#fff8e1;font-weight:800">
<td colspan="5" style="text-align:right;padding:5px 9px">Total Cash:</td>
<td colspan="1"></td>
<td style="text-align:right;color:var(--lem-a);padding:5px 9px">${fmtT(totalCash)}</td>
<td colspan="2"></td>
    </tr>`;
}

// ── JOURNAL ENTRY TEMPLATES ──────────────────────────────────────────────────
// [static data moved to js/data/static-data.js]

function renderJournalTemplates() {
  const container = document.getElementById("journal-tmpl-content");
  if (!container) return;
  const modeColor = { Transfer: "#2b6cb0", Cash: "#b7791f" };
  const modeBg = { Transfer: "#e8f4fd", Cash: "#fff8e1" };
  let html = "";
  for (const [txType, rows] of Object.entries(JOURNAL_TEMPLATES)) {
    const hasTransfer = rows.some((r) => r[4] === "Transfer");
    const hasCash = rows.some((r) => r[4] === "Cash");
    const badgeTrf = hasTransfer
      ? `<span style="background:#d6eaff;color:#2b6cb0;padding:2px 7px;border-radius:4px;font-size:7.5pt;font-weight:800;margin-left:4px">TRF</span>`
      : "";
    const badgeCash = hasCash
      ? `<span style="background:#fff0c0;color:#b7791f;padding:2px 7px;border-radius:4px;font-size:7.5pt;font-weight:800;margin-left:4px">CASH</span>`
      : "";
    html += `<div style="background:#fff;border-radius:10px;border:1.5px solid #e0d7f5;overflow:hidden;box-shadow:0 1px 5px #0001">
    <div style="background:#553c9a;color:#fff;padding:7px 12px;font-weight:800;font-size:9.5pt;display:flex;align-items:center;justify-content:space-between">
      <span>${txType}</span><span>${badgeTrf}${badgeCash}</span>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:8pt">
      <tr style="background:#f0ebff">
        <th style="padding:4px 8px;text-align:left;color:#553c9a;font-weight:700">Account</th>
        <th style="padding:4px 6px;text-align:center;color:#553c9a;font-weight:700">Dr/Cr</th>
        <th style="padding:4px 6px;text-align:left;color:#553c9a;font-weight:700">Acc No.</th>
        <th style="padding:4px 6px;text-align:left;color:#553c9a;font-weight:700">Amount</th>
        <th style="padding:4px 6px;text-align:center;color:#553c9a;font-weight:700">Mode</th>
      </tr>`;
    rows.forEach((r, i) => {
      const [account, drCr, accNo, amount, mode] = r;
      const drCrBg = drCr === "Debit" ? "#fde0e8" : "#d4f5e9";
      const drCrColor = drCr === "Debit" ? "#c0392b" : "#2a7a50";
      html += `<tr style="background:${i % 2 === 0 ? "#fff" : "#faf8ff"}">
      <td style="padding:4px 8px;color:#333">${account || "—"}</td>
      <td style="padding:4px 6px;text-align:center"><span style="background:${drCrBg};color:${drCrColor};padding:1px 6px;border-radius:3px;font-size:7pt;font-weight:800">${drCr}</span></td>
      <td style="padding:4px 6px;font-family:monospace;color:#553c9a;font-weight:700">${accNo || "—"}</td>
      <td style="padding:4px 6px;color:#666;font-size:7.5pt">${amount || "—"}</td>
      <td style="padding:4px 6px;text-align:center"><span style="background:${modeBg[mode] || "#eee"};color:${modeColor[mode] || "#666"};padding:1px 6px;border-radius:3px;font-size:7pt;font-weight:800">${mode}</span></td>
    </tr>`;
    });
    html += `</table></div>`;
  }
  container.innerHTML = html;
}

// ── EXPORT ALL TABS TO EXCEL (5 sheets) ──────────────────────────────────────
function exportLedgerExcel() {
  if (!ledgerAllRows.length && !ledgerRecords.length) {
    toast("Load data first", "err");
    return;
  }
  const wb = XLSX.utils.book_new();
  const date = document.getElementById("ldg-date").value || "Today";
  const fmtAmt = (n) => Number(n) || 0;

  // Sheet 1: Main Data
  const mainRows = [
    [
      "Trans No",
      "Name",
      "Account Type",
      "Transaction Type",
      "Account No",
      "Total Amount",
      "Transaction Mode",
      "Scroll No",
      "Loan Date",
      "Task",
    ],
  ];
  let n = 1;
  ledgerRecords.forEach((rec) => {
    mainRows.push([
      n++,
      rec.name,
      "Account Type",
      "",
      "Account No",
      "##",
      "",
      "##",
      "",
      rec.tx_types || "",
    ]);
    ledgerAllRows
      .filter((r) => r.record_id === rec.id)
      .forEach((r) =>
        mainRows.push([
          n++,
          r.name,
          r.acc_type || r.task,
          r.tx_type,
          r.acc_no,
          fmtAmt(r.amount),
          r.mode,
          r.scroll_no,
          r.loan_date,
          "",
        ]),
      );
  });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(mainRows),
    "Main Data",
  );

  // Sheet 2: Cash Book
  const cbRows = [
    [
      "#",
      "Name",
      "Account Type",
      "Transaction Type",
      "Account No",
      "Amount",
      "Scroll No",
      "Loan Date",
    ],
  ];
  ledgerAllRows
    .filter((r) => r.mode === "Cash" && Number(r.amount) > 0)
    .forEach((r, i) =>
      cbRows.push([
        i + 1,
        r.name,
        r.acc_type || r.task,
        r.tx_type,
        r.acc_no,
        fmtAmt(r.amount),
        r.scroll_no,
        r.loan_date,
      ]),
    );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cbRows), "CashBook");

  // Sheet 3: Int Recv Gold Loan
  const glRows = [
    [
      "#",
      "Name",
      "Account Type",
      "Transaction Type",
      "Account No",
      "Amount",
      "Scroll No",
      "Loan Date",
    ],
  ];
  const GL_TASKS = ["Interest Received On Gold Loan TRF", "Gold Loan TRF"];
  ledgerAllRows
    .filter(
      (r) =>
        GL_TASKS.some((t) =>
          (r.acc_type || r.task || "").includes(t.split(" ")[0]),
        ) &&
        r.mode === "Transfer" &&
        Number(r.amount) > 0,
    )
    .forEach((r, i) =>
      glRows.push([
        i + 1,
        r.name,
        r.acc_type || r.task,
        r.tx_type,
        r.acc_no,
        fmtAmt(r.amount),
        r.scroll_no,
        r.loan_date,
      ]),
    );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(glRows),
    "IntRecGL-83",
  );

  // Sheet 4: Int Recv FD-OD
  const fdodRows = [
    [
      "#",
      "Name",
      "Account Type",
      "Transaction Type",
      "Account No",
      "Amount",
      "Scroll No",
      "Loan Date",
    ],
  ];
  // BUG FIX: same class of bug as generateFDODIntVoucherManual/
  // renderLedgerIntFDOD — the old filter (a loose ".includes()" substring
  // match on top of it) never matched the Debit-side task "FD OD Loan -
  // TRF", so this export sheet silently dropped every FD-OD interest
  // closing's debit leg. Reuse the shared record_id-grouped filter so both
  // legs export correctly without also pulling in unrelated new-loan
  // disbursement debits.
  filterFDODClosingRows(ledgerAllRows, ["Transfer"])
    .filter((r) => Number(r.amount) > 0)
    .forEach((r, i) =>
      fdodRows.push([
        i + 1,
        r.name,
        r.acc_type || r.task,
        r.tx_type,
        r.acc_no,
        fmtAmt(r.amount),
        r.scroll_no,
        r.loan_date,
      ]),
    );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(fdodRows),
    "IntRecFD-OD-277",
  );

  // Sheet 5: Template Data
  const tmplRows = [
    [
      "Account Type",
      "Account Number",
      "Transaction Mode",
      "Transaction Type",
      "Date of Trans",
      "Transfer",
      "Cash",
      "Transfer Voucher Name",
      "Cash Voucher Name",
    ],
  ];
  const tTrf = {},
    tCash = {};
  ledgerAllRows.forEach((r) => {
    const k = r.task || "";
    if (!k || !r.amount) return;
    if (r.mode === "Transfer") tTrf[k] = (tTrf[k] || 0) + Number(r.amount);
    if (r.mode === "Cash") tCash[k] = (tCash[k] || 0) + Number(r.amount);
  });
  VOUCHER_TEMPLATE.forEach((v) => {
    const ta = tTrf[v.task] || 0;
    const ca = tCash[v.task] || 0;
    if (!ta && !ca) return;
    const mode = ta > 0 && ca > 0 ? "Both" : ta > 0 ? "Transfer" : "Cash";
    tmplRows.push([
      v.acc_type,
      v.acc_no,
      mode,
      v.tx_type,
      date,
      ta || "",
      ca || "",
      v.trf_name || "",
      v.cash_name || "",
    ]);
  });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(tmplRows),
    "templateData",
  );

  XLSX.writeFile(wb, "TransactionLedger_" + date + ".xlsx");
  toast(
    "📥 Exported — 5 sheets: Main Data, CashBook, IntRecGL-83, IntRecFD-OD-277, templateData",
    "ok",
  );
}

// ─── Generate Vouchers PDF directly from ledger (Template Data tab) ───────────
async function generateVouchersPDFFromLedger() {
  if (!ledgerAllRows.length) {
    toast("Load ledger data first", "err");
    return;
  }
  const date =
    document.getElementById("ldg-date").value ||
    new Date().toISOString().split("T")[0];
  await _flushToDB(
    date,
    ledgerAllRows.filter((r) => !r.date || r.date === date),
  );
  // Build synthetic cbData from ledger rows
  const taskTrf = {},
    taskCash = {};
  ledgerAllRows.forEach((r) => {
    const key = r.task || "";
    if (!key) return;
    if (r.mode === "Transfer")
      taskTrf[key] = (taskTrf[key] || 0) + Number(r.amount);
    if (r.mode === "Cash")
      taskCash[key] = (taskCash[key] || 0) + Number(r.amount);
  });
  const txRowsForPDF = ledgerAllRows.map((r) => ({
    task: r.task || r.acc_type || "",
    mode: r.mode,
    amount: Number(r.amount) || 0,
    name: r.name,
    scrollNo: r.scroll_no,
    accNo: r.acc_no,
    loanDate: r.loan_date,
    txType: r.tx_type,
  }));
  // Borrow the existing generateAllVouchersPDF logic by temporarily setting cbData
  const prevCbData = cbData;
  cbData = {
    date,
    opening: 0,
    closing: 0,
    totalCredit: 0,
    totalDebit: 0,
    txRows: txRowsForPDF,
  };
  // generateAllVouchersPDF() itself now folds the GL-83 (Interest Received
  // On Gold Loan) closing sheet into the SAME PDF when there's Closing -
  // Loan activity for the date — previously this fired that as a second,
  // separate popup ~600ms later, so one click produced two downloadable
  // PDFs (reported as "not feasible" — a second popup is also liable to be
  // silently blocked by the browser). One click now always opens exactly
  // one PDF.
  await generateAllVouchersPDF();
  cbData = prevCbData;
}

// ─── Generate Cash Book PDF directly from ledger ───────────────────────────────
// ── Cash Book tab: opening balance + live closing balance ──────────────────
// This tab is now the single home for cash book (view + opening balance +
// print) — see generateCashBookPDFFromLedger() below, called from the
// "🧾 Print Cash Book" button in ltab-panel-cashbook.

// Load the opening balance for the currently-selected ledger date whenever
// the date changes (doesn't clobber a value being typed for the same date
// across re-renders).
//
// FIX: this used to read ONLY localStorage ("cb-opening-<date>"), so the
// value lived on whichever single browser/computer last set it — a
// different device (or a cleared browser) saw nothing. daily_cash_balance
// (see v7_daily_cash_balance migration) is now the source of truth; the
// localStorage copy is kept only as an instant-paint cache while the
// network round-trip is in flight, and is overwritten by the server value
// once it arrives.
async function cbSyncOpeningForDate() {
  const dateEl = document.getElementById("ldg-date");
  const openEl = document.getElementById("cb-opening");
  if (!dateEl || !openEl) return;
  const date = dateEl.value;
  if (openEl.dataset.loadedDate === date) return;
  const cached = localStorage.getItem("cb-opening-" + date);
  openEl.value = cached !== null ? cached : "";
  openEl.dataset.loadedDate = date;
  cbRecalcClosing();
  try {
    const resp = await fetch(
      CB_API + "/opening-balance?date=" + date,
      { headers: { "x-auth-token": localStorage.getItem("jju_token") || "" } },
    );
    const json = await resp.json();
    // Bail if the date changed again while this request was in flight.
    if (openEl.dataset.loadedDate !== date) return;
    if (json.set) {
      openEl.value = json.opening_balance;
      try { localStorage.setItem("cb-opening-" + date, json.opening_balance); } catch (e) {}
      cbRecalcClosing();
    }
  } catch (e) {
    // Offline / server unreachable — keep whatever the local cache showed.
  }
}

// Called on input — persists the opening balance for this date (both
// locally, for instant re-paint, and to the server, which is the value
// other devices/users will actually see) and refreshes the closing
// balance shown next to it.
let _cbOpeningSaveTimer = null;
function cbOnOpeningChange() {
  const dateEl = document.getElementById("ldg-date");
  const openEl = document.getElementById("cb-opening");
  if (!dateEl || !openEl) return;
  const date = dateEl.value;
  const value = openEl.value || "0";
  try {
    localStorage.setItem("cb-opening-" + date, value);
  } catch (e) {}
  cbRecalcClosing();

  // Debounce the server write so fast typing doesn't fire a PUT per
  // keystroke — 600ms of no further input before it saves.
  clearTimeout(_cbOpeningSaveTimer);
  _cbOpeningSaveTimer = setTimeout(() => {
    fetch(CB_API + "/opening-balance", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-auth-token": localStorage.getItem("jju_token") || "",
      },
      body: JSON.stringify({ date, opening_balance: parseFloat(value) || 0 }),
    }).catch(() => {
      toast("⚠️ Opening balance saved locally only — could not reach server", "err");
    });
  }, 600);
}

// Recompute and display closing balance = opening + credit - debit,
// using the same cash-mode rows the table above is already showing.
function cbRecalcClosing() {
  const openEl = document.getElementById("cb-opening");
  const dispEl = document.getElementById("cb-closing-display");
  if (!openEl || !dispEl) return;
  const opening = parseFloat(openEl.value) || 0;
  const rows = ldgFilteredRows().filter(
    (r) => r.mode === "Cash" && Number(r.amount) > 0,
  );
  const totalCr = rows
    .filter((r) => r.tx_type === "Credit")
    .reduce((s, r) => s + Number(r.amount), 0);
  const totalDb = rows
    .filter((r) => r.tx_type === "Debit")
    .reduce((s, r) => s + Number(r.amount), 0);
  const closing = opening + totalCr - totalDb;
  dispEl.textContent =
    "₹ " + closing.toLocaleString("en-IN", { minimumFractionDigits: 2 });
  dispEl.style.color = closing < 0 ? "#c0392b" : "#2a7a50";

  // Keep the shared cbData global fresh from this tab's own already-computed
  // totals — the Physical Cash Count section (below, on this same tab) reads
  // it to match counted cash against the book closing balance. Previously
  // cbData was only set by the separate loadCashBook()/PDF-preview path, so
  // Physical Cash Count (formerly on Day End Summary) could see a stale or
  // empty value; this tab is the natural, always-fresh source for it.
  const ldgDateEl = document.getElementById("ldg-date");
  cbData = {
    date: ldgDateEl ? ldgDateEl.value : "",
    opening,
    closing,
    totalCredit: totalCr,
    totalDebit: totalDb,
    txRows: rows.map((r) => ({
      mode: r.mode,
      txType: r.tx_type,
      amount: Number(r.amount),
    })),
  };
  if (typeof window._recalcDenom === "function") window._recalcDenom();
}

// "↺ Use previous day's closing" button — fetches the previous date's
// entries and sets its computed closing as today's opening.
async function ldgLoadPrevClosingAsOpening() {
  const dateEl = document.getElementById("ldg-date");
  const openEl = document.getElementById("cb-opening");
  if (!dateEl || !dateEl.value) {
    toast("Select a date first", "err");
    return;
  }
  const dt = new Date(dateEl.value);
  dt.setDate(dt.getDate() - 1);
  const prevDate = dt.toISOString().split("T")[0];
  try {
    // FIX: previous day's opening balance now comes from the server
    // (daily_cash_balance), not localStorage — so "previous day's closing"
    // is correct even if today's session is on a different device than
    // whichever one last typed it in.
    const [openingResp, entriesResp] = await Promise.all([
      fetch(CB_API + "/opening-balance?date=" + prevDate, {
        headers: { "x-auth-token": localStorage.getItem("jju_token") || "" },
      }),
      fetch(CB_API + "?date=" + prevDate, {
        headers: { "x-auth-token": localStorage.getItem("jju_token") || "" },
      }),
    ]);
    const openingJson = await openingResp.json();
    const savedPrevOpening = parseFloat(openingJson.opening_balance) || 0;
    const prevOpeningWasSet = !!openingJson.set;
    const json = await entriesResp.json();
    const entries = json.entries || [];
    const cashRows = entries.filter(
      (e) => e.mode === "Cash" && Number(e.amount) > 0,
    );
    const totalCr = cashRows
      .filter((e) => e.tx_type === "Credit")
      .reduce((s, e) => s + Number(e.amount), 0);
    const totalDb = cashRows
      .filter((e) => e.tx_type === "Debit")
      .reduce((s, e) => s + Number(e.amount), 0);
    const prevClosing = savedPrevOpening + totalCr - totalDb;
    openEl.value = prevClosing;
    openEl.dataset.loadedDate = dateEl.value;
    cbOnOpeningChange();
    const missingWarning = !prevOpeningWasSet
      ? ` ⚠️ Opening balance for ${prevDate} was never set — verify this is correct.`
      : "";
    toast(
      `Previous closing (${prevDate}): ₹${prevClosing.toLocaleString("en-IN")} set as opening balance${missingWarning}`,
      !prevOpeningWasSet ? "err" : "ok",
    );
  } catch (e) {
    toast("Could not load previous day data", "err");
  }
}

// `viewOnly=true` opens the exact same Sahakaar Vibhag T-format sheet used for
// printing, but as a preview only — no print dialog pops up automatically.
// This is what backs the "👁 View Cash Book" button so staff can check the
// print-format layout without triggering an actual print job.
async function generateCashBookPDFFromLedger(viewOnly) {
  if (!ledgerAllRows.length) {
    toast("Load ledger data first", "err");
    return;
  }
  const date =
    document.getElementById("ldg-date").value ||
    new Date().toISOString().split("T")[0];
  await _flushToDB(
    date,
    ledgerAllRows.filter((r) => !r.date || r.date === date),
  );
  const cashRows = ledgerAllRows.filter(
    (r) => r.mode === "Cash" && Number(r.amount) > 0,
  );
  const crRows = cashRows.filter((r) => r.tx_type === "Credit");
  const dbRows = cashRows.filter((r) => r.tx_type === "Debit");
  const totalCr = crRows.reduce((s, r) => s + Number(r.amount), 0);
  const totalDb = dbRows.reduce((s, r) => s + Number(r.amount), 0);

  // Opening balance from the cb-opening input on the ledger/cash-book tab
  const openingInput = document.getElementById("cb-opening");
  const opening = openingInput ? Number(openingInput.value) || 0 : 0;
  const closing = opening + totalCr - totalDb;

  // Denomination table from the screen inputs
  const denomData = [500, 100, 50, 20, 10, 5, 2, 1].map((denom) => {
    const inp = document.querySelector(`input[data-denom="${denom}"]`);
    const notes = inp ? parseInt(inp.value) || 0 : 0;
    return { denom, notes, amt: denom * notes };
  });
  const denomTotal = denomData.reduce((s, r) => s + r.amt, 0);

  const html = _buildSahakaarCashBookHTML({
    date,
    opening,
    crRows: crRows.map((r) => ({
      txNo: r.scroll_no,
      name: r.name,
      accType: r.acc_type || r.task,
      accNo: r.acc_no,
      lf: r.lf || "",
      amount: r.amount,
    })),
    dbRows: dbRows.map((r) => ({
      txNo: r.scroll_no,
      name: r.name,
      accType: r.acc_type || r.task,
      accNo: r.acc_no,
      lf: r.lf || "",
      amount: r.amount,
    })),
    totalCr,
    totalDb,
    closing,
    denomData,
    denomTotal,
  });

  openPDFSheet(
    'html',
    html,
    viewOnly ? 'Cash Book — Preview' : 'Cash Book',
    !viewOnly, // autoPrint
  );
}

// ─── Shared Sahakaar Vibhag T-format (रोखवही) HTML builder ─────────────────
// Called by both printCashBook() and generateCashBookPDFFromLedger().
// Produces the standard double-sided T-account layout required by Maharashtra
// Sahakaar Vibhag auditors: जमा (Receipts/Dr.) on left, नावे (Payments/Cr.)
// on right. Opening balance opens the Dr. side; Closing balance closes the
// Cr. side. Both column totals are equal (Opening + Receipts = Payments + Closing).
function _buildSahakaarCashBookHTML({
  date,
  opening,
  crRows,   // receipt / जमा rows  (mapped: txNo, name, accType, accNo, lf, amount)
  dbRows,   // payment / नावे rows (same shape)
  totalCr,
  totalDb,
  closing,
  denomData,
  denomTotal,
}) {
  const BANK = "जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या.";
  const fmtAmt = (n) => Number(n || 0).toLocaleString("en-IN");
  const fmtDate = (s) => {
    try {
      return new Date(s)
        .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        .replace(/ /g, "-");
    } catch (_e) { return s || ""; }
  };

  const todayFmt = fmtDate(date);
  const prevDt   = new Date(date);
  prevDt.setDate(prevDt.getDate() - 1);
  const prevFmt  = fmtDate(prevDt.toISOString().split("T")[0]);

  // Grand total for both sides: Opening + all receipts = all payments + closing
  const grandTotal = Number(opening) + Number(totalCr);

  // ── Column header style strings ──────────────────────────────────────────
  const TH = "border:1px solid #555;padding:3px 6px;background:#e8e8e8;font-weight:700;font-size:7pt;text-align:center;";
  const TD = "border:1px solid #aaa;padding:3px 6px;font-size:7pt;";
  const TDC = "border:1px solid #aaa;padding:3px 6px;font-size:7pt;text-align:center;";
  // BUG FIX (print legibility): the ₹ amount columns shared the same 7pt as
  // every other cell, making the actual money figures hard to read at print
  // size — bumped just these two (Particulars/Sr No/Voucher No stay at 7pt).
  const TDR = "border:1px solid #aaa;padding:3px 6px;font-size:9pt;font-weight:600;text-align:right;";
  const TDRB = "border:1px solid #aaa;padding:3px 6px;font-size:9pt;text-align:right;font-weight:800;";
  const TOT = "border:1px solid #555;padding:3px 6px;font-size:7pt;font-weight:800;background:#f0f4f8;";
  const TOTR = "border:1px solid #555;padding:3px 6px;font-size:7pt;font-weight:800;background:#f0f4f8;text-align:right;";
  const GRAND = "border:2px solid #333;padding:4px 6px;font-size:7.5pt;font-weight:800;background:#d9eaf7;text-align:right;";
  const GRANDL = "border:2px solid #333;padding:4px 6px;font-size:7.5pt;font-weight:800;background:#d9eaf7;";

  // ── Build receipt rows (जमा / Dr. side) ──────────────────────────────────
  // First row: Opening Balance — FIX: दिनांक column removed entirely (per
  // user request); the previous day's date is now folded straight into the
  // Particulars text itself, e.g. "07-Sept-2026 - To Opening Balance".
  const crBody =
    `<tr>
      <td style="${TDC}">1</td>
      <td style="${TDC}">—</td>
      <td style="${TD}font-weight:700;">${prevFmt} - To Opening Balance</td>
      <td style="${TDRB}">${fmtAmt(opening)}</td>
    </tr>` +
    crRows.map((r, i) =>
      `<tr>
        <td style="${TDC}">${i + 2}</td>
        <td style="${TDC}">${r.txNo || "—"}</td>
        <td style="${TD}font-weight:600;">To ${r.name || "—"}${r.accType ? " / " + r.accType : ""}${r.accNo ? " [" + r.accNo + "]" : ""}</td>
        <td style="${TDR}">${fmtAmt(r.amount)}</td>
      </tr>`
    ).join("");

  // ── Build payment rows (नावे / Cr. side) ─────────────────────────────────
  // Last row: Closing Balance (By Closing Balance) — दिनांक column removed here too.
  const dbBody =
    dbRows.map((r, i) =>
      `<tr>
        <td style="${TDC}">${i + 1}</td>
        <td style="${TDC}">${r.txNo || "—"}</td>
        <td style="${TD}font-weight:600;">By ${r.name || "—"}${r.accType ? " / " + r.accType : ""}${r.accNo ? " [" + r.accNo + "]" : ""}</td>
        <td style="${TDR}">${fmtAmt(r.amount)}</td>
      </tr>`
    ).join("") +
    `<tr>
      <td style="${TDC}">${dbRows.length + 1}</td>
      <td style="${TDC}">—</td>
      <td style="${TD}font-weight:700;font-style:italic;">By Closing Balance (शिल्लक)</td>
      <td style="${TDRB}">${fmtAmt(closing)}</td>
    </tr>`;

  // ── Denomination table rows ───────────────────────────────────────────────
  const denomRows = denomData.filter((r) => r.notes > 0).map((r) =>
    `<tr>
      <td style="${TDC}">₹ ${r.denom}</td>
      <td style="${TDC}">${r.notes}</td>
      <td style="${TDR}">${fmtAmt(r.amt)}</td>
    </tr>`
  ).join("") || `<tr><td colspan="3" style="${TDC};color:#999;">—</td></tr>`;

  // Balance difference (should be zero)
  // BUG FIX ("Cash Book difference ≠ 0 logic looked wrong"): this used to be
  // `(denomTotal || closing) - closing`. denomTotal is the sum of whatever is
  // typed into the denomination boxes on screen, which is legitimately 0
  // before anyone has filled them in — and 0 is falsy in JS, so `||` silently
  // substituted `closing` for it, making diff always compute as
  // closing - closing = 0. That showed a green "✅ 0.00" match even when the
  // denomination table was completely empty (nothing counted yet), instead
  // of the real mismatch. Only treat it as reconciled when notes have
  // actually been entered; otherwise show a neutral "not counted" state
  // rather than a false match.
  const hasDenomEntry = denomData.some((r) => r.notes > 0);
  const diff = hasDenomEntry ? denomTotal - closing : null;
  const diffColor = diff === null ? "#888" : diff === 0 ? "#27ae60" : "#c0392b";
  const denomTotalDisplay = hasDenomEntry ? denomTotal : null;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>रोखवही — ${todayFmt}</title>
<style>
  @page { size: A4 landscape; margin: 10mm 6mm 8mm 6mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, 'Noto Sans Devanagari', sans-serif; font-size: 7pt; color: #000; padding: 10px 16px 16px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #aaa; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; }
  /* Side padding above is for on-screen preview only (iframe/tab view) — the
     @page margin already handles the printed page, so strip it back out when
     actually printing to avoid doubling the margin. */
  @media print { body { margin: 0; padding: 0; } }
</style>
</head><body>

<!-- ══ HEADER ══ -->
<div style="text-align:center;font-size:11.5pt;font-weight:800;letter-spacing:.5px;margin-bottom:1mm;">${BANK}</div>
<div style="text-align:center;font-size:9pt;font-weight:700;margin-bottom:1mm;">रोखवही (Daily Cash Book) &nbsp;—&nbsp; दिनांक: ${todayFmt}</div>
<div style="text-align:center;border-bottom:2px solid #333;margin-bottom:3mm;padding-bottom:1mm;font-size:7.5pt;color:#444;">महाराष्ट्र सहकारी संस्था अधिनियम — नागरी पत संस्था</div>

<!-- ══ T-ACCOUNT: जमा (Credit) LEFT | नावे (Debit) RIGHT ══ -->
<table style="width:100%;border-collapse:collapse;">
  <thead>
    <tr>
      <!-- Credit side header -->
      <th colspan="4" style="border:2px solid #333;padding:4px 8px;background:#c8e6c9;font-size:8.5pt;font-weight:800;text-align:center;width:50%;">
        जमा &nbsp;(Receipts / Credit)
      </th>
      <!-- thick rule -->
      <th style="width:3px;background:#333;border:none;padding:0;"></th>
      <!-- Debit side header -->
      <th colspan="4" style="border:2px solid #333;padding:4px 8px;background:#ffcdd2;font-size:8.5pt;font-weight:800;text-align:center;width:50%;">
        नावे &nbsp;(Payments / Debit)
      </th>
    </tr>
    <!-- FIX: दिनांक (Date) column removed per user request — the header already
         states the book's date, and the one date that mattered per-row (the
         previous day's date on the Opening Balance line) now lives inline in
         the Particulars text instead of its own column.
         FIX 2: ले.खा. (ledger-folio) column removed per user request — it was
         almost always "—" in practice — and replaced with a running अ.क्र.
         (Sr. No.) column, moved to the front of each side so every row is
         numbered from the first column. -->
    <tr>
      <!-- BUG FIX (print layout): Sr No / Voucher No columns were wider than
           the 1-3 digit values they ever hold, crowding the Particulars
           column — narrowed both and handed the freed width to Particulars. -->
      <th style="${TH}width:4%;">अ.क्र.</th>
      <th style="${TH}width:6%;">व्हा.नं.</th>
      <th style="${TH}width:30%;">तपशील / Particulars</th>
      <th style="${TH}width:9%;text-align:right;">रक्कम (₹)</th>
      <th style="width:3px;background:#333;border:none;padding:0;"></th>
      <th style="${TH}width:4%;">अ.क्र.</th>
      <th style="${TH}width:6%;">व्हा.नं.</th>
      <th style="${TH}width:30%;">तपशील / Particulars</th>
      <th style="${TH}width:9%;text-align:right;">रक्कम (₹)</th>
    </tr>
  </thead>
  <tbody>
    <!-- Interleaved rows: Dr. left, Cr. right. Each logical row is one <tr> with 9 cells. -->
    ${_interleaveRows(crBody, dbBody)}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="3" style="${TOT}text-align:right;">एकूण जमा (Total Receipts + Opening)</td>
      <td style="${TOTR}">${fmtAmt(grandTotal)}</td>
      <td style="width:3px;background:#333;border:none;padding:0;"></td>
      <td colspan="3" style="${TOT}text-align:right;">एकूण नावे (Total Payments + Closing)</td>
      <td style="${TOTR}">${fmtAmt(grandTotal)}</td>
    </tr>
  </tfoot>
</table>

<!-- ══ BOTTOM SECTION: Denomination | Reconciliation ══ -->
<table style="width:100%;margin-top:4mm;border-collapse:collapse;">
  <tr>
    <!-- LEFT: denomination table -->
    <td style="width:45%;vertical-align:top;border:none;padding-right:4mm;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th colspan="3" style="${TH}background:#fff9c4;font-size:8pt;">नोट / नाणी तपशील (Denomination)</th>
          </tr>
          <tr>
            <th style="${TH}">नोट / नाणी (₹)</th>
            <th style="${TH}">संख्या (Nos.)</th>
            <th style="${TH}text-align:right;">रक्कम (₹)</th>
          </tr>
        </thead>
        <tbody>${denomRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="${TOT}text-align:center;">एकूण (Total)</td>
            <td style="${TOTR}">${denomTotalDisplay === null ? "—" : fmtAmt(denomTotalDisplay)}</td>
          </tr>
        </tfoot>
      </table>
    </td>
    <!-- RIGHT: balance reconciliation box -->
    <td style="width:55%;vertical-align:top;border:none;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th colspan="2" style="${TH}background:#d1c4e9;font-size:8pt;">शिल्लक पडताळणी (Balance Reconciliation)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="${TD}">प्रारंभिक शिल्लक (Opening Balance)</td>
            <td style="${TDR}">₹ ${fmtAmt(opening)}</td>
          </tr>
          <tr>
            <td style="${TD}">जमा — आजची प्राप्ती (Add: Today's Receipts)</td>
            <td style="${TDR}">₹ ${fmtAmt(totalCr)}</td>
          </tr>
          <tr>
            <td style="${TD}font-weight:700;">एकूण (Gross Total)</td>
            <td style="${TDRB}">₹ ${fmtAmt(grandTotal)}</td>
          </tr>
          <tr>
            <td style="${TD}">नावे — आजची देयके (Less: Today's Payments)</td>
            <td style="${TDR}">₹ ${fmtAmt(totalDb)}</td>
          </tr>
          <tr>
            <td style="${TD}font-weight:800;background:#e8f5e9;">अंतिम शिल्लक (Closing Balance)</td>
            <td style="${TDRB}background:#e8f5e9;">₹ ${fmtAmt(closing)}</td>
          </tr>
          <tr>
            <td style="${TD}">नोट तपशील एकूण (Denomination Total)</td>
            <td style="${TDR}">${denomTotalDisplay === null ? "— (not counted)" : "₹ " + fmtAmt(denomTotalDisplay)}</td>
          </tr>
          <tr>
            <td style="${TD}font-weight:700;">फरक (Difference — must be 0)</td>
            <td style="border:1px solid #aaa;padding:3px 6px;font-size:7pt;text-align:right;font-weight:800;color:${diffColor};">${diff === null ? "— Not counted" : diff === 0 ? "✅ 0.00" : "⚠ " + fmtAmt(Math.abs(diff))}</td>
          </tr>
        </tbody>
      </table>
    </td>
  </tr>
</table>

<!-- ══ SIGNATURE LINE ══ -->
<table style="width:100%;margin-top:6mm;border-collapse:collapse;">
  <tr>
    ${["रोखपाल (Cashier)", "लेखापाल (Accountant)", "व्यवस्थापक (Manager)"]
      // BUG FIX: dropped "अध्यक्ष (Chairman)" per user request — daily cash
      // book sign-off is Cashier/Accountant/Manager only; rebalanced to 3
      // equal columns instead of 4.
      .map((lbl) => `<td style="width:33.33%;border:none;text-align:center;padding:2mm 4mm;">
        <div style="border-top:1.5px solid #333;margin:0 8mm;padding-top:2mm;font-size:7pt;font-weight:700;">${lbl}</div>
      </td>`).join("")}
  </tr>
</table>

<div style="display:flex;justify-content:space-between;font-size:6.5pt;color:#888;margin-top:3mm;border-top:1px solid #ddd;padding-top:1mm;">
  <span>${BANK}</span><span>रोखवही — ${todayFmt}</span>
</div>
</body></html>`;
  // BUG FIX: this used to end with its own
  // <script>window.onload=()=>setTimeout(()=>window.print(),600)</script>,
  // which fired a SECOND print dialog on top of the one openPDFSheet already
  // triggers via the iframe's frame.onload handler — the "double print"
  // option the user sees. openPDFSheet is now the single place that decides
  // whether/when to auto-print (see its `autoPrint` param below), so this
  // builder just returns plain viewable/printable HTML.
}

// Helper: interleave Dr. and Cr. row HTML strings into a single <tr> each.
// Each side's rows are parsed from the pre-built HTML string.
function _interleaveRows(crBodyHtml, dbBodyHtml) {
  // Split each body into individual <tr>…</tr> chunks
  const splitRows = (html) => {
    const matches = html.match(/<tr>[\s\S]*?<\/tr>/g) || [];
    return matches;
  };
  const crTrs = splitRows(crBodyHtml);
  const dbTrs = splitRows(dbBodyHtml);
  const len = Math.max(crTrs.length, dbTrs.length);
  // FIX: 4 cells now (व्हा.नं., ले.खा., तपशील, रक्कम) — दिनांक column removed.
  const EMPTY_CELLS =
    `<td style="border:1px solid #aaa;padding:3px 6px;"></td>`.repeat(4);
  const DIVIDER = `<td style="width:3px;background:#333;border:none;padding:0;"></td>`;
  const rows = [];
  for (let i = 0; i < len; i++) {
    const crCells = crTrs[i]
      ? crTrs[i].replace(/^<tr>/, "").replace(/<\/tr>$/, "")
      : EMPTY_CELLS;
    const dbCells = dbTrs[i]
      ? dbTrs[i].replace(/^<tr>/, "").replace(/<\/tr>$/, "")
      : EMPTY_CELLS;
    rows.push(`<tr>${crCells}${DIVIDER}${dbCells}</tr>`);
  }
  return rows.join("\n");
}


// ═══════════════════════════════════════════════════════════════════════════
//  BANK CLOSING — GENERATE ALL COVERING VOUCHERS PDF
//  Matches the exact format produced by Google Apps Script / Google Docs
// ═══════════════════════════════════════════════════════════════════════════

function convertNumberToWords(number) {
  const num = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  if (!number || number === 0) return "Zero";
  const whole = Math.floor(Math.abs(number));
  const paisa = Math.round((Math.abs(number) - whole) * 100);
  function words(n) {
    if (n === 0) return "";
    if (n < 20) return num[n] + " ";
    if (n < 100)
      return tens[Math.floor(n / 10)] + (n % 10 ? " " + num[n % 10] : "") + " ";
    if (n < 1000)
      return num[Math.floor(n / 100)] + " Hundred " + words(n % 100);
    if (n < 100000)
      return words(Math.floor(n / 1000)) + "Thousand " + words(n % 1000);
    if (n < 10000000)
      return words(Math.floor(n / 100000)) + "Lakh " + words(n % 100000);
    return words(Math.floor(n / 10000000)) + "Crore " + words(n % 10000000);
  }
  let result = words(whole).trim();
  if (paisa > 0) result += " and " + words(paisa).trim() + " Paisa";
  return result;
}

async function generateAllVouchersPDF() {
  if (!cbData) {
    if (ledgerAllRows.length > 0) {
      // Ensure cb-date is populated before loadCashBook() reads it
      const _cbDateEl = document.getElementById("cb-date");
      if (_cbDateEl && !_cbDateEl.value) {
        _cbDateEl.value =
          document.getElementById("ldg-date")?.value ||
          (typeof getAppDate === "function" ? getAppDate() : "") ||
          new Date().toISOString().split("T")[0];
      }
      await loadCashBook();
    } else {
      toast("Generate Cash Book first, then click Bank Closing", "err");
      return;
    }
  }
  if (!cbData) {
    toast("Cash Book data not available", "err");
    return;
  }

  // ── CR = DB balance verification ──────────────────────────────────────────
  const _crTotal = cbData.totalCredit || 0;
  const _dbTotal = cbData.totalDebit  || 0;
  if (Math.abs(_crTotal - _dbTotal) > 0.01) {
    const proceed = window.confirm(
      "⚠️ Cash Book Imbalance\n\n" +
      "  Credit Total : ₹ " + _crTotal.toLocaleString("en-IN") + "\n" +
      "  Debit Total  : ₹ " + _dbTotal.toLocaleString("en-IN") + "\n" +
      "  Difference   : ₹ " + Math.abs(_crTotal - _dbTotal).toLocaleString("en-IN") + "\n\n" +
      "Credits and Debits do not match. Vouchers may be incorrect.\n" +
      "Press OK to generate anyway, or Cancel to review the cash book."
    );
    if (!proceed) return;
  }
  const date = cbData.date || new Date().toISOString().split("T")[0];
  await _flushToDB(
    date,
    ledgerAllRows.filter((r) => !r.date || r.date === date),
  );

  const d = cbData;
  if (!d) { toast("Cash Book data not available — please Generate Cash Book first", "err"); return; }
  const dateStr = d.date || date;
  const fmtDate = (s) => {
    try {
      return new Date(s)
        .toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
        .replace(/ /g, "-");
    } catch (_e) {
      return s || "";
    }
  };
  const BANK =
    "जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव जामोद र.नं.१०६७";

  // Build per-task totals split by Cash / Transfer
  // BUG FIX: keyed by task alone, a same-day Credit AND Debit transaction
  // sharing the same task/account (e.g. a bank account both receiving and
  // paying out on the same date) got summed together into one bucket, so
  // the Credit voucher and the Debit voucher both showed the SAME
  // (wrong, merged) total, and getDetailRows() below returned every name
  // from both directions under each voucher. Keying by task+tx_type keeps
  // Credit and Debit fully separate, matching the same task+tx_type key
  // convention already used for the Excel export a few hundred lines up.
  const taskTrf = {},
    taskCash = {};
  d.txRows.forEach((r) => {
    if (!r.task || !r.amount) return;
    const key = r.task + "|" + (r.txType || "");
    if (r.mode === "Transfer")
      taskTrf[key] = (taskTrf[key] || 0) + r.amount;
    if (r.mode === "Cash")
      taskCash[key] = (taskCash[key] || 0) + r.amount;
  });

  // Build detailed rows from txRows for a specific task + mode + tx_type
  // (tx_type included for the same reason as the key fix above — without
  // it, both the Credit and Debit voucher for the same task would list
  // every name from both directions).
  function getDetailRows(taskName, mode, txType) {
    return d.txRows
      .filter(
        (r) =>
          r.task === taskName &&
          r.mode === mode &&
          r.txType === txType &&
          r.amount > 0,
      )
      .map((r) => ({
        scrollNo: r.scrollNo,
        name: r.name,
        amt: r.amount,
        accNo: r.accNo,
        loanDate: r.loanDate,
      }));
  }

  // Build a single voucher block matching Image 2 format
  // voucherLabel = the slip label e.g. "Pink Slip - CASH" or "SAV - CR - TRF"
  // mode = 'Cash' | 'Transfer'
  // accType, accCode, amount, txType
  function buildVoucherBlock(
    accType,
    accCode,
    dateDisplay,
    modeLabel,
    amount,
    voucherLabel,
    txType,
    rows,
  ) {
    const amtFmt =
      "₹ " +
      Number(amount).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
      });
    const words = convertNumberToWords(amount);
    const modeCol = modeLabel === "Cash" ? "Cash" : "Transfer";

    // Individual name rows if present
    const rowsHtml =
      rows.length > 0
        ? `
<table class="row-table">
  <thead><tr style="background:#f0f0f0">
    <th>Scroll No</th>
    <th style="text-align:left">Name</th>
    <th style="text-align:right">Amount (₹)</th>
    <th>Acc No</th>
  </tr></thead>
  <tbody>${rows
    .map(
      (r) => `<tr>
    <td style="text-align:center">${r.scrollNo || ""}</td>
    <td>${r.name || ""}</td>
    <td style="text-align:right">${r.amt > 0 ? "₹ " + Number(r.amt).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : ""}</td>
    <td>${r.accNo || ""}</td>
  </tr>`,
    )
    .join("")}</tbody>
</table>`
        : "";

    return `
<div class="voucher-block">
  <div class="v-bank">** ${BANK} **</div>
  <div class="v-sub">Covering Voucher — ${txType} &nbsp;—&nbsp; ${voucherLabel}</div>
  <table class="v-table">
    <thead><tr>
      <th>Account Type</th><th>Acc Code</th><th>Date</th><th>${modeCol}</th>
    </tr></thead>
    <tbody><tr>
      <td>${accType}</td><td>${accCode}</td><td>${dateDisplay}</td>
      <td style="font-weight:800">${amtFmt}</td>
    </tr></tbody>
  </table>
  ${rowsHtml}
  <div class="v-total">एकूण / Total — ${amtFmt} &nbsp; ( ₹ ${words} )</div>
  <div class="v-sig">
    <div class="v-sig-left">लेखापाल / व्यवस्थापक / अधिकृत अधिकारी<br><span style="display:inline-block;border-top:1px solid #000;min-width:90px;margin-top:5mm">&nbsp;</span></div>
  </div>
</div>`;
  }

  // Build combined voucher (Cash + Transfer) — matches 3rd block in Image 2
  function buildCombinedBlock(
    accType,
    accCode,
    dateDisplay,
    cashAmt,
    trfAmt,
    txType,
  ) {
    const totalAmt = cashAmt + trfAmt;
    const amtFmt =
      "₹ " +
      Number(totalAmt).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
      });
    const words = convertNumberToWords(totalAmt);
    return `
<div class="voucher-block">
  <div class="v-bank">** ${BANK} **</div>
  <div class="v-sub">Covering Voucher — Combined (Cash + Transfer) — ${txType}</div>
  <table class="v-table">
    <thead><tr>
      <th>Account Type</th><th>Acc Code</th><th>Date</th><th>Cash</th><th>Transfer</th><th>Total</th>
    </tr></thead>
    <tbody><tr>
      <td>${accType}</td><td>${accCode}</td><td>${dateDisplay}</td>
      <td>${cashAmt > 0 ? "₹ " + Number(cashAmt).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—"}</td>
      <td>${trfAmt > 0 ? "₹ " + Number(trfAmt).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—"}</td>
      <td style="font-weight:800">${amtFmt}</td>
    </tr></tbody>
  </table>
  <div class="v-total">एकूण / Total — ${amtFmt} &nbsp; ( ₹ ${words} )</div>
  <div class="v-sig">
    <div class="v-sig-left">लेखापाल / व्यवस्थापक / अधिकृत अधिकारी<br><span style="display:inline-block;border-top:1px solid #000;min-width:90px;margin-top:5mm">&nbsp;</span></div>
   
  </div>
</div>`;
  }

  // Generate all voucher blocks
  let pages = "";
  const displayDate = fmtDate(dateStr);

  VOUCHER_TEMPLATE.forEach((v) => {
    const voucherKey = v.task + "|" + (v.tx_type || "");
    const trfAmt = taskTrf[voucherKey] || 0;
    const cashAmt = taskCash[voucherKey] || 0;

    // Cash voucher (e.g. Pink Slip - CASH)
    if (v.cash_name && cashAmt > 0) {
      const rows = getDetailRows(v.task, "Cash", v.tx_type);
      pages += buildVoucherBlock(
        v.acc_type,
        v.acc_no,
        displayDate,
        "Cash",
        cashAmt,
        v.cash_name,
        v.tx_type,
        rows,
      );
    }

    // Transfer voucher (e.g. SAV - CR - TRF)
    if (v.trf_name && trfAmt > 0) {
      const rows = getDetailRows(v.task, "Transfer", v.tx_type);
      pages += buildVoucherBlock(
        v.acc_type,
        v.acc_no,
        displayDate,
        "Transfer",
        trfAmt,
        v.trf_name,
        v.tx_type,
        rows,
      );
    }

    // Combined voucher when both exist (e.g. Cash + Transfer Combined)
    if (v.cash_name && v.trf_name && cashAmt > 0 && trfAmt > 0) {
      pages += buildCombinedBlock(
        v.acc_type,
        v.acc_no,
        displayDate,
        cashAmt,
        trfAmt,
        v.tx_type,
      );
    }
  });

  // Bank transfer vouchers (no cash_name/trf_name — pure Transfer rows)
  VOUCHER_TEMPLATE.filter((v) => !v.trf_name && !v.cash_name).forEach((v) => {
    const voucherKey = v.task + "|" + (v.tx_type || "");
    const trfAmt = taskTrf[voucherKey] || 0;
    if (trfAmt <= 0) return;
    const rows = getDetailRows(v.task, "Transfer", v.tx_type);
    pages += buildVoucherBlock(
      v.acc_type,
      v.acc_no,
      displayDate,
      "Transfer",
      trfAmt,
      "Bank TRF",
      v.tx_type,
      rows,
    );
  });

  // Build full print window
  const voucherHTML = `<!DOCTYPE html><html><head>
  <meta charset="UTF-8">
  <title>Covering Vouchers — ${dateStr}</title>
  <style>
    /* Compact redesign (per user request — the old single-column, full-width
       cards were mostly whitespace: ~4mm outer margin + 3mm/5mm padding per
       block plus a 5mm gap above the signature line, so 3-4 short vouchers
       filled a whole A4 page each. Vouchers are laid out 2-per-row in a CSS
       grid instead of stacked full-width, and every internal spacing value
       is tightened — same information, far fewer pages. */
    @page { size: A4; margin: 6mm 6mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, 'Noto Sans Devanagari', sans-serif; font-size: 8pt; color: #000; margin: 0; }
    .voucher-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5mm; align-items: start; }
    /* BUG FIX (print legibility): covering-voucher text sized down to 6.3-7pt
       was hard to read on a printed slip — bumped every size up a couple
       points while keeping the same compact, natural-height block. */
    .voucher-block { width: 100%; border: 1px solid #999; border-radius: 2px; padding: 1.5mm 2.5mm 1mm; page-break-inside: avoid; break-inside: avoid; }
    .v-bank { font-size: 8pt; text-align: center; font-weight: 700; margin: 0 0 0.5mm; border-bottom: 1px solid #000; padding-bottom: 0.5mm; }
    .v-sub { font-size: 9pt; font-weight: 600; text-align: center; margin: 0.5mm 0 1mm; color: #333; }
    .v-table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 1mm; }
    .v-table th { border: 1px solid #000; padding: 2px 4px; background: #f0f0f0; font-weight: 700; text-align: left; }
    .v-table td { border: 1px solid #000; padding: 2px 4px; }
    .v-total { font-size: 9pt; font-weight: 700; margin: 0.5mm 0; }
    .v-sig { display: flex; justify-content: space-between; font-size: 8.5pt; margin-top: 2mm; border-top: 1px dashed #888; padding-top: 0.5mm; }
    .v-sig-left { text-align: left; }
    .v-sig-left span { margin-top: 3mm !important; min-width: 60px !important; }
    .v-divider { border: none; border-top: 1.5px dashed #555; margin: 3mm 0; }
    .row-table { width: 100%; border-collapse: collapse; margin: 0.5mm 0; font-size: 6.3pt; }
    .row-table th { border: 1px solid #000; padding: 1px 3px; background: #f5f5f5; }
    .row-table td { border: 1px solid #000; padding: 1px 3px; }
    @media print {
.voucher-block { page-break-inside: avoid; break-inside: avoid; }
    }
  </style>
  </head><body>
  <div class="voucher-wrap">
  ${pages || '<p style="padding:20mm;text-align:center;color:#999;grid-column:1/-1">No voucher entries found for this date.</p>'}
  </div>
  </body></html>`;

  // GL-83 (Interest Received On Gold Loan) closing sheet — bundled into
  // THIS SAME document (rather than a second, separate popup fired a
  // moment later) whenever there's Closing - Loan activity for the date,
  // so one click always produces exactly one PDF instead of two.
  let finalHtml = voucherHTML;
  try {
    const glRows = filterGLClosingRows(
      ledgerAllRows.filter((r) => !r.date || r.date === dateStr),
      ["Transfer"],
    );
    if (glRows.length) {
      const glPageHtml = glIntVoucherPage(glRows, fmtDate(dateStr));
      // glIntVoucherPage() returns a `.page`-classed div — that class isn't
      // defined in THIS document's stylesheet (only pdf-template.js's own
      // wrapHTML() defines it), so it harmlessly falls back to a plain
      // block and just needs a forced page break before it. Explicitly
      // sizing it to 297mm tall here (on top of the @page margin this
      // document already reserves) was tried first and over-shot the
      // printable area by the margin amount, spilling a blank 3rd page —
      // same class of bug wrapHTML() itself already had to fix once (see
      // its own comment) — so this stays unsized and lets it flow within
      // the page's normal margin box like everything else in this document.
      const glSection =
        '<div style="page-break-before:always">' + glPageHtml + "</div>";
      finalHtml = voucherHTML.replace(
        "</body></html>",
        glSection + "</body></html>",
      );
    }
  } catch (e) {
    console.warn("GL-83 auto voucher generation skipped:", e.message);
  }

  openPDFSheet('html', finalHtml, `Covering Vouchers — ${dateStr}`);
}

function toast(msg, type = "ok") {
  const t = document.getElementById("toast");
  document.getElementById("toast-msg").textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 3500);
}
document.getElementById("edit-modal").addEventListener("click", function (e) {
  if (e.target === this) closeEdit();
});

// ══════════════════════════════════════════════════
//  CLOSE ACCOUNT / LOAN SYSTEM
// ══════════════════════════════════════════════════
let closeRecId = null;
// Which SECTIONS key (gold/fd/od/saving/shares) the close modal was opened
// for — set by openCloseModal's activeSect param when known (e.g. opened
// from the Quick Close search widget). confirmClose() uses this as a
// fallback to route to the right pre-filled closing form (Gold/FD/OD) when
// the record's own tx_types don't clearly say what type it is — which
// happens for legacy/PDF-Sync-imported records whose tx_types is just
// ["PDF Sync"] instead of a recognizable type label.
let closeRecActiveSect = null;

// ── Human-readable labels for raw tx_type strings ──────────────────────────
// The "Select types to close" checkboxes used to show the raw DB tx_type
// string verbatim — including internal/legacy tags like "PDF Sync" that
// mean nothing to whoever is actually closing an account. This maps the
// known raw strings to plain-language labels; the checkbox's underlying
// `value` (what actually gets sent to the close API) is unchanged, only
// the displayed text differs.
const CLOSE_TYPE_LABELS = {
  "PDF Sync": "Close this account",
  "New Gold Loan": "Gold Loan",
  "Gold Loan Closing": "Gold Loan (Closing entry)",
  "Gold Loan TRF": "Gold Loan Transfer",
  "Interest Received On Gold Loan TRF": "Gold Loan Interest",
  "Slips - Loan": "Gold Loan Slips",
  "Closing - Loan": "Gold Loan Closing",
  "New FD-OD Loan": "OD Loan",
  "Fixed Deposit - MIS": "Fixed Deposit (MIS)",
  "FD - Slips": "FD Slips",
  "FD - Slips - MIS": "FD Slips (MIS)",
  "New FD": "Fixed Deposit",
  "New FD - Term": "Fixed Deposit (Term)",
  "New FD - MIS": "Fixed Deposit (MIS)",
  "MIS Interest": "FD MIS Interest",
  "Saving Deposit": "Saving Account Deposit",
  "Saving Withdrawal": "Saving Account Withdrawal",
  "Saving - Deposit Slip": "Saving Deposit Slip",
  "Saving - Withdrawal Slip": "Saving Withdrawal Slip",
  "Closing - Saving Account": "Saving Account Closing",
};
function _closeTypeLabel(t) {
  return CLOSE_TYPE_LABELS[t] || t;
}

// ── Payoff / account-context summary for the Close modal ───────────────────
// Fetches the same live figures the Quick Close search widget shows on its
// card (loan amount, days elapsed, interest, total payoff for Gold/OD;
// FD amount + maturity for FD; balance for Saving/Shares) — reused here so
// closing an account from this modal is no longer a "blind" action with no
// money figures shown before you confirm. sectKey is the SECTIONS key
// ('gold'/'od'/'fd'/'saving'/'shares'); accNo is the account number. Returns
// null (renders nothing) when the section/account can't be resolved.
async function _fetchCloseSummary(accNo, sectKey) {
  const SECT_EP = {
    gold: "/api/combined/gold-loans",
    od: "/api/combined/od-loans",
    fd: "/api/combined/fd-accounts",
    saving: "/api/combined/saving-accounts",
    shares: "/api/combined/share-accounts",
  };
  const ep = SECT_EP[sectKey];
  if (!ep || !accNo) return null;
  const token = localStorage.getItem("jju_token") || "";
  try {
    const r = await fetch(
      ep + "?status=all&search=" + encodeURIComponent(accNo),
      { headers: { "x-auth-token": token } },
    );
    if (!r.ok) return null;
    const rows = await r.json();
    const row = Array.isArray(rows)
      ? rows.find((x) => x.acc_no === accNo) || rows[0]
      : null;
    if (!row) return null;

    const result = { sectKey, row };
    if (sectKey === "gold" || sectKey === "od") {
      const principal =
        parseFloat(row.loan_amount != null ? row.loan_amount : row.balance) ||
        0;
      const rate = sectKey === "gold" ? 18 : parseFloat(row.interest_rate) || 0;
      const startDate = (row.start_date || "").split("T")[0];
      const today = new Date().toISOString().split("T")[0];
      result.principal = principal;
      if (rate && principal && startDate) {
        const ir = await fetch("/api/interest/gold-loan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-auth-token": token,
          },
          body: JSON.stringify({
            principal,
            rate,
            from_date: startDate,
            to_date: today,
            apply_gold_charge: sectKey === "gold",
          }),
        });
        const id2 = await ir.json();
        if (!id2.error) {
          result.days = id2.days;
          result.interest = parseFloat(id2.interest) || 0;
          result.total = principal + result.interest;
          result.lakhCharge = parseFloat(id2.lakh_charge_amount) || 0;
          result.calcOk = true;
        }
      }
    } else if (sectKey === "fd") {
      result.fdAmount = parseFloat(row.fd_amount) || 0;
      result.maturityAmount = parseFloat(row.maturity_amount) || 0;
      result.endDate = (row.end_date || "").split("T")[0];
    } else {
      result.balance = parseFloat(row.balance) || 0;
    }
    return result;
  } catch (e) {
    console.error("[_fetchCloseSummary] failed:", e);
    return null;
  }
}

function _renderCloseSummary(s) {
  const box = document.getElementById("close-summary");
  if (!box) return;
  if (!s) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  const fmt = (n) =>
    "₹ " +
    Number(n || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  const row = (label, val, opts) =>
    `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;color:#555;${opts || ""}"><span>${label}</span><strong style="color:#333">${val}</strong></div>`;

  let html = "";
  if (s.sectKey === "gold" || s.sectKey === "od") {
    if (s.calcOk) {
      const interestTitle = s.lakhCharge
        ? ` title="includes ₹${fmt(s.lakhCharge).replace("₹ ", "")} handling charge"`
        : "";
      html = `<div class="qc-row2" style="margin-top:0;">
        <span class="qc-chip qc-chip-amt">${fmt(s.principal)}</span>
        <span class="qc-chip">${s.days}d</span>
      </div>`;
    } else {
      html =
        row("Loan Amount", fmt(s.principal)) +
        `<div style="font-size:10.5px;color:#c0392b;margin-top:3px;">⚠️ Interest could not be calculated automatically — verify the payoff amount manually before closing.</div>`;
    }
  } else if (s.sectKey === "fd") {
    html =
      row("FD Amount", fmt(s.fdAmount)) +
      (s.maturityAmount ? row("Maturity Amount", fmt(s.maturityAmount)) : "") +
      (s.endDate ? row("Maturity Date", s.endDate) : "");
  } else if (s.sectKey === "saving" || s.sectKey === "shares") {
    html = row("Current Balance", fmt(s.balance));
  } else {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  box.innerHTML = html;
  box.style.display = "block";
}

// Warns when the staff member manually picks "— No closing PDF —" for a
// Gold/OD/FD account — those closures involve real money and should almost
// always leave a printed receipt behind.
function _onClosePdfTypeChange() {
  const sel = document.getElementById("close-pdf-type");
  const warn = document.getElementById("close-pdf-warn");
  if (!sel || !warn) return;
  const moneySect = ["gold", "od", "fd"].includes(closeRecActiveSect);
  warn.style.display = moneySect && !sel.value ? "block" : "none";
}

function openCloseModal(id, name, txTypes, subNo, activeSect) {
  if (!id || id === "null" || id === "undefined") {
    toast("Record ID missing — cannot open close modal", "err");
    console.error("openCloseModal called with invalid id:", id);
    return;
  }
  closeRecId = id;
  closeRecActiveSect = activeSect || null;
  // BUG FIX: this used to show "(Sub: X)" where X was literally the same
  // account number already visible elsewhere — its only caller (the Quick
  // Close search widget) passes the account number as `subNo`, so the old
  // text just repeated it in a confusing "Sub:" frame. Show it plainly as
  // the account number instead, on the types line below the name.
  document.getElementById("close-rec-title").textContent = "🔒 Close: " + name;
  document.getElementById("close-rec-types").textContent =
    "Type: " + txTypes + (subNo ? "  ·  Acc: " + subNo : "");
  document.getElementById("close-date").value = new Date()
    .toISOString()
    .split("T")[0];
  document.getElementById("close-remarks").value = "";
  // Clear previous entry's checkboxes and PDF dropdown immediately
  const txSelEl = document.getElementById("close-tx-select");
  if (txSelEl) txSelEl.innerHTML = '<div style="color:#aaa;font-size:11px">Loading…</div>';
  const selEl = document.getElementById("close-pdf-type");
  if (selEl) selEl.innerHTML = '<option value="">— Loading… —</option>';
  const warningEl = document.getElementById("close-warning");
  if (warningEl) warningEl.style.display = "none";
  const pdfWarnEl = document.getElementById("close-pdf-warn");
  if (pdfWarnEl) pdfWarnEl.style.display = "none";
  // Payoff/context summary panel — loads asynchronously below (see
  // _fetchCloseSummary/_renderCloseSummary), independent of the tx_types
  // fetch already in flight above, so it doesn't block the modal opening.
  const summaryEl = document.getElementById("close-summary");
  if (summaryEl) {
    summaryEl.style.display = "block";
    summaryEl.innerHTML = '<div style="color:#aaa;font-size:11px">Loading account summary…</div>';
  }
  _fetchCloseSummary(subNo, activeSect).then(_renderCloseSummary);
  // Reset the confirm button — re-enabled here in case a previous open of
  // this modal (for an already-closed record) disabled it below.
  const confirmBtnReset = document.getElementById("close-confirm-btn");
  if (confirmBtnReset) {
    confirmBtnReset.disabled = false;
    confirmBtnReset.style.opacity = "";
    confirmBtnReset.style.cursor = "pointer";
    confirmBtnReset.textContent = "🔒 Confirm Close";
  }
  const SECT_TX_MAP = {
    // BUG FIX: was missing real-world Gold Loan tx_type labels — "New Gold
    // Loan" and "Gold Loan Closing" are the actual strings used elsewhere in
    // the app (see static-data.js LDG_TASKS / JOURNAL_TEMPLATES, which treat
    // "New Gold Loan" as equivalent to "Gold Loan" and "Gold Loan Closing"
    // as equivalent to "Closing - Loan"), plus the two journal sub-entries
    // ("Gold Loan TRF", "Interest Received On Gold Loan TRF") that a Gold
    // Loan closing transaction can carry. A sub-loan record tagged with any
    // of these wasn't recognized here, so it fell out of `openTypes` below
    // and the modal wrongly reported "already closed" on a still-active,
    // still-owing account.
    gold: [
      "Gold Loan",
      "New Gold Loan",
      "Gold Loan Closing",
      "Gold Loan TRF",
      "Interest Received On Gold Loan TRF",
      "Slips - Loan",
      "Closing - Loan",
    ],
    od: ["OD Loan", "New FD-OD Loan"],
    fd: ["Fixed Deposit", "Fixed Deposit - MIS", "FD - Slips", "FD - Slips - MIS", "New FD", "New FD - Term", "New FD - MIS", "MIS Interest"],
    saving: [
      "Saving Account",
      "Saving Deposit",
      "Saving Withdrawal",
      "Saving - Deposit Slip",
      "Saving - Withdrawal Slip",
      "Closing - Saving Account",
    ],
    membership: [
      "New Sadasya",
      "Sadasya",
      "New Naammatr Sabhasad",
      "Naammatr Sabhasad Account",
    ],
    current: ["Current Account"],
    shares: ["Shares Account", "Shares - Transfer"],
  };

  fetch(API + "/" + id)
    .then((r) => r.json())
    .then((rec) => {
      const allTypes = parseTxTypes(rec.tx_types);
      const closedTypes = new Set(parseTxTypes(rec.closed_tx_types));
      const openTypesRaw = allTypes.filter((t) => !closedTypes.has(t));
      let openTypes = openTypesRaw;
      const sectAllowed = activeSect && SECT_TX_MAP[activeSect];
      if (sectAllowed) {
        const openTypesSect = openTypesRaw.filter((t) => sectAllowed.includes(t));
        // BUG FIX: previously this filter's result was used unconditionally.
        // If a record's actual (not-yet-closed) tx_type string isn't in
        // SECT_TX_MAP[activeSect] — e.g. a naming variant nobody's added to
        // the map yet — openTypesSect comes back empty even though the
        // account genuinely still has open types (openTypesRaw is
        // non-empty), and the code below would wrongly tell staff "this
        // account has already been closed" on an account that still owes
        // money. Only trust the sect-filtered (empty) result when the raw,
        // unfiltered list agrees there's nothing open; otherwise fall back
        // to showing the raw type(s) so the account can still be closed.
        if (openTypesSect.length > 0 || openTypesRaw.length === 0) {
          openTypes = openTypesSect;
        } else {
          openTypes = openTypesRaw;
          console.warn(
            '[openCloseModal] tx_type(s) not recognized by SECT_TX_MAP.' + activeSect + ':',
            openTypesRaw,
            '— showing them anyway instead of reporting "already closed".',
          );
        }
      }

      // Build checkboxes for open types only. When nothing is left to close
      // (either it's genuinely already fully closed, or — before the v6
      // data-sync migration — the derived-table mirror was just stuck
      // 'active' while the record itself was already closed) there is
      // nothing a Confirm Close here would meaningfully do, so disable it
      // instead of leaving a red-button no-op click waiting to confuse staff.
      const confirmBtn = document.getElementById("close-confirm-btn");
      if (confirmBtn) {
        if (openTypes.length === 0) {
          confirmBtn.disabled = true;
          confirmBtn.style.opacity = "0.5";
          confirmBtn.style.cursor = "not-allowed";
          confirmBtn.textContent = "✅ Already Closed";
        } else {
          confirmBtn.disabled = false;
          confirmBtn.style.opacity = "";
          confirmBtn.style.cursor = "pointer";
          confirmBtn.textContent = "🔒 Confirm Close";
        }
      }
      const checkHtml =
        openTypes.length === 0
          ? `<div style="color:#e53e3e;font-weight:700;font-size:11px">⚠️ All transaction types already closed — this account has already been closed.</div>`
          : openTypes
              .map(
                (t) => `
        <label style="display:flex;align-items:center;gap:7px;font-size:11px;padding:4px 0;cursor:pointer">
          <input type="checkbox" class="close-tx-chk" aria-label="Close ${t}" value="${t}" checked style="width:14px;height:14px">
          <span>${_closeTypeLabel(t)}</span>
        </label>`,
              )
              .join("");

      // Already-closed badges
      const alreadyHtml =
        closedTypes.size > 0
          ? `<div style="margin-top:6px;font-size:10px;color:#888">Already closed: ${[...closedTypes].map((t) => `<span style="background:#fde0e8;color:#c0392b;border-radius:3px;padding:1px 5px;margin-right:3px;font-weight:700">${t}</span>`).join("")}</div>`
          : "";

      const txSelEl = document.getElementById("close-tx-select");
      if (txSelEl) txSelEl.innerHTML = checkHtml + alreadyHtml;

      // Sadasya warning
      const txList = parseTxTypes(rec.tx_types);
      const hasSadasya = txList.some((t) =>
        [
          "New Sadasya",
          "Sadasya",
          "New Naammatr Sabhasad",
          "Naammatr Sabhasad Account",
        ].includes(t.trim()),
      );
      const warningEl = document.getElementById("close-warning");
      if (warningEl) {
        if (hasSadasya && openTypes.length > 1) {
          warningEl.style.display = "block";
          warningEl.textContent =
            "⚠️ This record includes Sadasya / membership. Uncheck types you want to keep active.";
        } else {
          warningEl.style.display = "none";
        }
      }

      // PDF type dropdown — suggest based on open types
      const map = {
        "Gold Loan": "Closing - Gold Loan",
        "Slips - Loan": "Closing - Gold Loan",
        "Closing - Loan": "Closing - Gold Loan",
        "Fixed Deposit": "Closing - FD",
        "Fixed Deposit - MIS": "Closing - FD",
        "FD - Slips": "Closing - FD",
        "FD - Slips - MIS": "Closing - FD",
        "New FD": "Closing - FD",
        "New FD - Term": "Closing - FD",
        "New FD - MIS": "Closing - FD",
        "OD Loan": "Closing - FD OD Loan",
        "New FD-OD Loan": "Closing - FD OD Loan",
        "Saving Account": "Closing - Saving Account",
        Sadasya: "Closing - Sadasya",
        "New Sadasya": "Closing - Sadasya",
        "Naammatr Sabhasad Account": "Closing - Naammatr Sadasya",
        "New Naammatr Sabhasad": "Closing - Naammatr Sadasya",
      };
      let suggested = "";
      openTypes.forEach((t) => {
        if (map[t] && !suggested) suggested = map[t];
      });
      // Fallback: if no open type matched, check ALL types (e.g. partially-closed Gold Loan)
      if (!suggested) {
        allTypes.forEach((t) => {
          if (map[t] && !suggested) suggested = map[t];
        });
      }
      // BUG FIX: same root cause as confirmClose()'s routing bug — a record
      // whose tx_types is just ["PDF Sync"] (legacy/imported) never matches
      // any key in `map` above, so the PDF suggestion silently stayed blank
      // even for an actual Gold/OD/FD account. Fall back to the section the
      // modal was opened for (known from the Quick Close search widget).
      if (!suggested && closeRecActiveSect) {
        const sectPdfMap = {
          gold: "Closing - Gold Loan",
          od: "Closing - FD OD Loan",
          fd: "Closing - FD",
        };
        suggested = sectPdfMap[closeRecActiveSect] || "";
      }
      const sel = document.getElementById("close-pdf-type");
      sel.innerHTML =
        '<option value="">— No closing PDF —</option>' +
        [
          "Closing - Gold Loan",
          "Closing - FD OD Loan",
          "Closing - Saving Account",
          "Closing - FD",
          "Closing - FD - Slips",
          "Closing - FD + Slips (Both)",
          "Closing - Sadasya",
          "Closing - Naammatr Sadasya",
        ]
          .map(
            (t) =>
              `<option value="${t}"${t === suggested ? " selected" : ""}>${t}</option>`,
          )
          .join("");
      _onClosePdfTypeChange();
    });

  document.getElementById("close-modal").style.display = "flex";
}

function closeCloseModal() {
  document.getElementById("close-modal").style.display = "none";
  closeRecId = null;
}

async function confirmClose() {
  if (!closeRecId) return;
  // BUG FIX: closeCloseModal() (below) sets the module-level closeRecId back
  // to null. Every branch here used to call closeCloseModal() and THEN pass
  // closeRecId as an argument in the same statement — but JS evaluates that
  // argument only once the closeCloseModal() call ahead of it has already
  // run, so it was always passing null. That made openClosingLoanForm/
  // openClosingFdForm/openClosingOdForm fetch "/api/records/null" (400) right
  // after every successful close. Snapshot the id up front and use this copy
  // everywhere closeRecId would otherwise be read after closeCloseModal().
  const closeRecIdSnapshot = closeRecId;
  const d = document.getElementById("close-date").value;
  const rem = document.getElementById("close-remarks").value;
  const pdfType = document.getElementById("close-pdf-type").value;

  // Collect which tx types user checked
  const checkedBoxes = [
    ...document.querySelectorAll(".close-tx-chk:checked"),
  ].map((cb) => cb.value);
  if (checkedBoxes.length === 0) {
    toast("Select at least one type to close", "err");
    return;
  }

  const currentRec = await (await fetch(API + "/" + closeRecId)).json();

  // For Gold Loan closing: navigate to pre-filled form
  const recAllTypes = parseTxTypes(currentRec.tx_types);
  let isGoldLoanRecord = recAllTypes.some((t) =>
    ["Gold Loan", "Slips - Loan", "Closing - Loan"].includes(t),
  );
  let isFdRecord = recAllTypes.some((t) =>
    ["Fixed Deposit", "Fixed Deposit - MIS", "New FD", "New FD - Term", "New FD - MIS", "FD - Slips", "FD - Slips - MIS", "MIS Interest"].includes(t),
  );
  // OD records must be detected before isFdRecord check — OD loans can also
  // have FD data and would otherwise fall into the FD branch incorrectly.
  let isOdRecord = recAllTypes.some((t) =>
    ["OD Loan", "New FD-OD Loan", "Closing - OD"].includes(t),
  );
  // BUG FIX: records imported/synced via PDF Sync (or any other path that
  // doesn't set a recognizable tx_type) carry tx_types like ["PDF Sync"],
  // which none of the three checks above ever match — so closing one of
  // these always fell through to the generic "Record fully CLOSED ✓" path
  // with no pre-filled closing form, even for an actual Gold/FD/OD account.
  // When none of the tx_type-based checks matched anything, fall back to
  // the section the modal was opened for (known when opened from the
  // Quick Close search widget, which always knows the real account type).
  if (!isGoldLoanRecord && !isFdRecord && !isOdRecord) {
    if (closeRecActiveSect === "gold") isGoldLoanRecord = true;
    else if (closeRecActiveSect === "fd") isFdRecord = true;
    else if (closeRecActiveSect === "od") isOdRecord = true;
  }

  if (pdfType === "Closing - Gold Loan" || isGoldLoanRecord) {
    // ── REGULAR (non-sub-case) GOLD LOAN CLOSING ─────────────────────────
    const closeRes = await fetch(API + "/" + closeRecId + "/close", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify({
        closed_date: d,
        closed_remarks: rem,
        tx_types_to_close: checkedBoxes,
      }),
    });
    
    if (!closeRes.ok) {
      toast("⚠️ Close failed: " + closeRes.status, "err");
      return;
    }
    
    closeCloseModal();
    await openClosingLoanForm(currentRec, d, rem, closeRecIdSnapshot);
    return;
  }

  if ((pdfType === "Closing - FD" || pdfType === "Closing - FD + Slips (Both)" || isFdRecord) && !isGoldLoanRecord && !isOdRecord) {
    // FD closing: close the record then navigate to a pre-filled Closing - FD form
    const closeRes = await fetch(API + "/" + closeRecId + "/close", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify({
        closed_date: d,
        closed_remarks: rem,
        tx_types_to_close: checkedBoxes,
      }),
    });
    if (!closeRes.ok) {
      toast("⚠️ Close failed: " + closeRes.status, "err");
      return;
    }
    closeCloseModal();
    await openClosingFdForm(currentRec, d, rem, closeRecIdSnapshot);
    return;
  }

  if ((pdfType === "Closing - FD OD Loan" || isOdRecord) && !isGoldLoanRecord) {
    // OD loan closing: close the record then navigate to a pre-filled Closing - OD form
    const closeRes = await fetch(API + "/" + closeRecId + "/close", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify({
        closed_date: d,
        closed_remarks: rem,
        tx_types_to_close: checkedBoxes,
      }),
    });
    if (!closeRes.ok) {
      toast("⚠️ Close failed: " + closeRes.status, "err");
      return;
    }
    closeCloseModal();
    await openClosingOdForm(currentRec, d, rem, closeRecIdSnapshot);
    return;
  }

  // Partial/full close
  const r = await fetch(API + "/" + closeRecId + "/close", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
    body: JSON.stringify({
      closed_date: d,
      closed_remarks: rem,
      tx_types_to_close: checkedBoxes,
    }),
  });
  if (!r.ok) {
    toast("Close failed", "err");
    return;
  }
  const result = await r.json();
  toast(
    result.allClosed
      ? "Record fully CLOSED ✓"
      : `${checkedBoxes.join(", ")} closed ✓ (other types remain active)`,
  );
  const _closedId = closeRecId;
  closeCloseModal();
  loadDB();
  loadDashboard();

  // Optionally open closing PDF — reuse already-fetched record
  if (pdfType) {
    const d2 = { ...(currentRec.data || {}) };
    if (!d2.customer_name) d2.customer_name = currentRec.name;
    if (!d2.aadhar) d2.aadhar = currentRec.aadhar;
    if (!d2.mobile) d2.mobile = currentRec.mobile;
    if (!d2.saving_acc_no && currentRec.account_no)
      d2.saving_acc_no = currentRec.account_no;
    if (!d2.customer_id) d2.customer_id = currentRec.customer_id;
    d2.date = d;
    if (pdfType === "Closing - FD + Slips (Both)") {
      generateTemplatePDF(["Closing - FD", "Closing - FD - Slips"], d2);
    } else {
      const pdfMap = {
        "Closing - Gold Loan": "Closing - Loan",
        "Closing - FD OD Loan": "Closing - OD",
        "Closing - Sadasya": "Closing - Saving Account",
        "Closing - Naammatr Sadasya": "Closing - Saving Account",
      };
      generateTemplatePDF([pdfMap[pdfType] || pdfType], d2);
    }
  }
}

// ── Open Gold Loan closing form pre-populated from DB ──
async function openClosingLoanForm(rec, closingDate, remarks, recId) {
  try {
    // Fetch fresh record data to ensure we have the latest customer info
    const freshRec = await fetch(API + "/" + recId).then(r => r.json());
    
    // Switch to New Transaction tab — force navigation, bypassing confirm dialog
    window._forceNav = true;
    showPage("new");
    // Clear any existing selection AND wipe the form-card so previous entries don't bleed through
    clearForm();
    // Wait for tab to render
    await new Promise((r) => setTimeout(r, 100));
    // Select "Closing - Loan" in the tx list
    const closingTx = "Closing - Loan";
    // Make Closing - Loan available — it's in Gold Loan group
    toggleTx(closingTx);
    buildForm();
    // Pre-fill all form fields from DB record data
    await new Promise((r) => setTimeout(r, 150));
    const d = freshRec.data || {};
    let closingLoanAccNo = d.loan_acc_no;
    let closingLoanAmount = d.loan_amount;
    let closingLoanAmountWords = d.loan_amount_words;
    const fill = (id, val) => {
      const el = document.getElementById("f-" + id);
      if (el && val) el.value = val;
    };
    fill("customer_name", freshRec.name || d.customer_name);
    fill("customer_id", freshRec.customer_id || d.customer_id);
    fill("aadhar", freshRec.aadhar || d.aadhar);
    fill("mobile", freshRec.mobile || d.mobile);
    fill("pan", d.pan);
    fill("address", d.address);
    fill("saving_acc_no", d.saving_acc_no || freshRec.account_no);
    fill("share_acc_no", d.share_acc_no);
    fill("loan_acc_no", closingLoanAccNo);
    fill("loan_amount", closingLoanAmount);
    fill("loan_amount_words", closingLoanAmountWords);
    fill("nominee_name", d.nominee_name);
    fill("nominee_relation", d.nominee_relation);
    // Restore ornament_items into the dynamic table
    if (d.ornament_items && d.ornament_items.length) {
      setTimeout(function () {
        const tbody = document.getElementById("orn-items-tbody");
        if (tbody) {
          tbody.innerHTML = "";
          d.ornament_items.forEach(function (item) {
            ornAddRow(item);
          });
        }
      }, 400);
    }
    fill("comments", remarks || d.comments);
    // Fix 3: Pre-populate photos from DB — intentionally exclude photo_ornament
    // so staff must take a FRESH photo of the returned ornament at closing time.
    const photoFields = [
      "photo_customer",
      "photo_aadhar_front",
      "photo_aadhar_back",
      "photo_pan",
    ];
    photoFields.forEach((pid) => {
      if (d[pid]) {
        photos[pid] = d[pid];
        const pbox = document.getElementById("pbox-" + pid);
        if (pbox) {
          pbox.innerHTML = _photoBoxFilledHtml(pid, d[pid]);
        }
      }
    });
    // photo_ornament is intentionally LEFT BLANK — staff must tap it to take a
    // new photo of the ornament being returned to the customer at closing.
    // Show a prominent reminder badge over the ornament photo box.
    setTimeout(function() {
      const ornBox = document.getElementById("pbox-photo_ornament");
      if (ornBox && !ornBox.querySelector("img")) {
        ornBox.style.border = "2.5px dashed #e53e3e";
        ornBox.style.background = "#fff5f5";
        const hint = ornBox.querySelector(".ph-hint");
        if (hint) {
          hint.innerHTML = '<div class="ph-icon">📸</div><div class="ph-lbl" style="color:#c0392b;font-weight:800;font-size:10px">Take NEW photo<br>with ornament</div>';
        }
      }
    }, 500);
    // Also restore multicheck ornament selections
    if (d.gold_ornaments) {
      const hiddenEl = document.getElementById("f-gold_ornaments");
      if (hiddenEl) {
        hiddenEl.value = d.gold_ornaments;
        const lbl = document.getElementById("mchk-lbl-gold_ornaments");
        if (lbl) {
          lbl.innerHTML = d.gold_ornaments
            .split(",")
            .map((o) => `<span class="mchk-tag">${o.trim()}</span>`)
            .join("");
        }
      }
    }
    if (d.silver_ornaments) {
      const hiddenEl = document.getElementById("f-silver_ornaments");
      if (hiddenEl) {
        hiddenEl.value = d.silver_ornaments;
        const lbl = document.getElementById("mchk-lbl-silver_ornaments");
        if (lbl) {
          lbl.innerHTML = d.silver_ornaments
            .split(",")
            .map((o) => `<span class="mchk-tag">${o.trim()}</span>`)
            .join("");
        }
      }
    }
    // Leave date empty so user must fill the closing date
    const dateEl = document.getElementById("f-date");
    if (dateEl) dateEl.value = closingDate || "";
    // Mark the DB record ID for closing on submit
    window._closingRecId = recId;
    window._closingOriginalDate = closingDate;

    // Fetch interest so cashbook entries have the correct total amount
    window._closingInterestData = null;
    const _loanAmtForInt = parseFloat(closingLoanAmount) || 0;
    const _fromDateForInt = (d.date || freshRec.date || "").split("T")[0];
    const _toDateForInt = (closingDate || new Date().toISOString()).split("T")[0];
    if (_loanAmtForInt && _fromDateForInt && _toDateForInt) {
      fetch("/api/interest/gold-loan", {
        method: "POST",
        headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
        body: JSON.stringify({ principal: _loanAmtForInt, rate: 18, from_date: _fromDateForInt, to_date: _toDateForInt }),
      }).then(function(r) { return r.json(); }).then(function(intData) {
        if (!intData.error) {
          window._closingInterestData = {
            interest_amount: parseFloat(intData.interest) || 0,
            total_amount: parseFloat(intData.total) || _loanAmtForInt,
          };
        }
      }).catch(function() {});
    }
    // Preserve original record's customer_type so the Closing record inherits it
    window._closingMeta = {
      customer_type: freshRec.customer_type || "regular",
      account_no: null,
    };
    // Set ctype so the new closing record is saved with the correct customer_type
    ctype = freshRec.customer_type || "regular";
    toast(
      "✅ Form pre-filled! 📸 Tap the ornament photo box to take a new photo with the ornament, then enter closing date & save PDF.",
      "ok",
    );
    // Scroll to form
    document
      .getElementById("form-card")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error("Error in openClosingLoanForm:", err);
    toast("⚠️ Error opening closing form: " + err.message, "err");
  }
}


// ── Open OD Loan closing form pre-populated from DB ──────────────────────────
async function openClosingOdForm(rec, closingDate, remarks, recId) {
  try {
    const freshRec = await fetch(API + "/" + recId).then(r => r.json());
    const d = freshRec.data || {};
    window._forceNav = true;
    showPage("new");
    clearForm();
    await new Promise(r => setTimeout(r, 100));
    if (typeof setSection === "function") setSection("od");
    toggleTx("Closing - OD");
    buildForm();
    await new Promise(r => setTimeout(r, 150));
    const fill = (id, val) => { const el = document.getElementById("f-" + id); if (el && val != null && val !== "") el.value = val; };
    fill("customer_name",      freshRec.name || d.customer_name);
    fill("customer_id",        freshRec.customer_id || d.customer_id);
    fill("aadhar",             freshRec.aadhar || d.aadhar);
    fill("mobile",             freshRec.mobile || d.mobile);
    fill("pan",                d.pan);
    fill("address",            d.address);
    fill("saving_acc_no",      d.saving_acc_no);
    fill("share_acc_no",       d.share_acc_no);
    // FIX: prefer whichever of data.loan_acc_no / records.account_no is the more
    // complete value — on older/imported records these two can drift apart (e.g.
    // data.loan_acc_no left truncated from a past bug), and the cashbook rows
    // generated from this form must match what the customer card actually shows
    // (which reads records.account_no). Picking the longer of the two avoids
    // silently carrying forward a shorter/stale account number into new entries.
    const _ldnJson = d.loan_acc_no || "";
    const _ldnCol  = freshRec.account_no || "";
    const _loanAccNo = _ldnJson.length >= _ldnCol.length ? (_ldnJson || _ldnCol) : _ldnCol;
    fill("loan_acc_no",        _loanAccNo);
    fill("loan_amount",        d.loan_amount);
    fill("loan_amount_words",  d.loan_amount_words);
    // FIX 1: COALESCE fd_acc_no — for MIS loans fd_acc_no may be empty; fall back to mis_acc_no
    const _fdAccNo  = d.fd_acc_no  || d.mis_acc_no  || "";
    const _misAccNo = d.mis_acc_no || "";
    fill("fd_acc_no",          _fdAccNo);
    fill("mis_acc_no",         _misAccNo);
    fill("fd_parvati_no",      d.fd_parvati_no);
    fill("fd_amount",          d.fd_amount);
    fill("fd_amount_words",    d.fd_amount_words);
    fill("fd_period",          d.fd_period);
    fill("fd_interest_rate",   d.fd_interest_rate);
    fill("fd_maturity_date",   d.fd_maturity_date);
    fill("fd_maturity_amount", d.fd_maturity_amount);
    fill("fd_maturity_words",  d.fd_maturity_words);
    fill("nominee_name",       d.nominee_name);
    fill("nominee_relation",   d.nominee_relation);
    fill("date",               closingDate || "");
    fill("comments",           remarks || d.comments);
    const photoFields = ["photo_customer", "photo_aadhar_front", "photo_aadhar_back", "photo_pan", "photo_fd"];
    photoFields.forEach(pid => {
      if (d[pid]) {
        photos[pid] = d[pid];
        const pbox = document.getElementById("pbox-" + pid);
        if (pbox) pbox.innerHTML = _photoBoxFilledHtml(pid, d[pid]);
      }
    });
    window._closingRecId = recId;
    window._closingOriginalDate = closingDate;
    ctype = freshRec.customer_type || "regular";
    window._closingMeta = { customer_type: ctype, account_no: null };

    // FIX 3 (Path A): Prefetch OD loan interest so cashbook can use total amount
    window._closingInterestData = null;
    const _odPrincipal  = parseFloat(d.loan_amount) || 0;
    const _odFromDate   = (d.date || freshRec.date || "").split("T")[0];
    const _odToDate     = (closingDate || new Date().toISOString()).split("T")[0];
    const _odRate       = parseFloat(d.fd_interest_rate) || parseFloat(d.loan_interest_rate) || 0;
    if (_odPrincipal && _odFromDate && _odToDate && _odRate) {
      fetch("/api/interest/gold-loan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": localStorage.getItem("jju_token") || "" },
        body: JSON.stringify({ principal: _odPrincipal, rate: _odRate, from_date: _odFromDate, to_date: _odToDate }),
      }).then(function(r) { return r.json(); }).then(function(intData) {
        if (!intData.error) {
          window._closingInterestData = {
            interest_amount: parseFloat(intData.interest) || 0,
            total_amount: parseFloat(intData.total) || _odPrincipal,
          };
        }
      }).catch(function() {});
    }

    toast("✅ OD closing form pre-filled! Enter closing date & save.", "ok");
    document.getElementById("form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error("Error in openClosingOdForm:", err);
    toast("⚠️ Error opening OD closing form: " + err.message, "err");
  }
}
// ── Open FD closing form pre-populated from DB ──
async function openClosingFdForm(rec, closingDate, remarks, recId) {
  try {
    const freshRec = await fetch(API + "/" + recId).then(r => r.json());
    const d = freshRec.data || {};

    // Determine tx type: MIS or Term FD
    const allTypes = typeof parseTxTypes === "function" ? parseTxTypes(freshRec.tx_types) : [];
    const isMis = allTypes.some(t => ["Fixed Deposit - MIS", "New FD - MIS", "FD - Slips - MIS", "MIS Interest"].includes(t));
    const closingTx = "Closing - FD";

    // Navigate to New Transaction page and clear form
    window._forceNav = true;
    showPage("new");
    clearForm();
    await new Promise(r => setTimeout(r, 100));

    // Select section = fd and Closing - FD tx
    if (typeof setSection === "function") setSection("fd");
    toggleTx(closingTx);
    buildForm();
    await new Promise(r => setTimeout(r, 150));

    const fill = (id, val) => {
      const el = document.getElementById("f-" + id);
      if (el && val != null && val !== "") el.value = val;
    };

    fill("customer_name", freshRec.name || d.customer_name);
    fill("customer_id", freshRec.customer_id || d.customer_id);
    fill("aadhar", freshRec.aadhar || d.aadhar);
    fill("mobile", freshRec.mobile || d.mobile);
    fill("pan", d.pan);
    fill("address", d.address);
    fill("saving_acc_no", d.saving_acc_no || freshRec.account_no);
    fill("share_acc_no", d.share_acc_no);
    fill("fd_acc_no", d.fd_acc_no || (isMis ? "" : freshRec.account_no));
    fill("mis_acc_no", d.mis_acc_no || (isMis ? freshRec.account_no : ""));
    fill("fd_parvati_no", d.fd_parvati_no);
    fill("fd_amount", d.fd_amount);
    fill("fd_amount_words", d.fd_amount_words);
    fill("fd_period", d.fd_period);
    fill("fd_interest_rate", d.fd_interest_rate);
    fill("fd_maturity_date", d.fd_maturity_date);
    fill("fd_maturity_amount", d.fd_maturity_amount);
    fill("fd_maturity_words", d.fd_maturity_words);
    fill("nominee_name", d.nominee_name);
    fill("nominee_relation", d.nominee_relation);
    fill("date", closingDate || "");
    fill("comments", remarks || d.comments);

    // Restore photos
    const photoFields = ["photo_customer", "photo_aadhar_front", "photo_aadhar_back", "photo_pan"];
    photoFields.forEach(pid => {
      if (d[pid]) {
        photos[pid] = d[pid];
        const pbox = document.getElementById("pbox-" + pid);
        if (pbox) {
          pbox.innerHTML = _photoBoxFilledHtml(pid, d[pid]);
        }
      }
    });

    window._closingRecId = recId;
    window._closingOriginalDate = closingDate;

    // Inherit customer type
    ctype = freshRec.customer_type || "regular";
    window._closingMeta = {
      customer_type: ctype,
      account_no: null,
    };

    toast("✅ FD closing form pre-filled! Enter closing date & save PDF.", "ok");
    document.getElementById("form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error("Error in openClosingFdForm:", err);
    toast("⚠️ Error opening FD closing form: " + err.message, "err");
  }
}

async function reopenRec(id) {
  if (!confirm("Reopen this record?")) return;
  const res = await fetch(API + "/" + id + "/reopen", { method: "PATCH", headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    toast("⚠️ Could not reopen record: " + err, "err");
    return;
  }
  toast("Record reopened");
  loadDB();
  loadDashboard();
}

// ── Customer Search ──────────────────────────────────────────
let _custSearchTimer = null;

function initCustomerSearch() {
  const nameEl = document.getElementById("f-customer_name");
  if (!nameEl || document.getElementById("cust-search-dropdown")) return;
  const wrap = document.createElement("div");
  wrap.className = "cust-search-wrap";
  nameEl.parentNode.insertBefore(wrap, nameEl);
  wrap.appendChild(nameEl);
  const dropdown = document.createElement("div");
  dropdown.id = "cust-search-dropdown";
  dropdown.className = "cust-search-dropdown";
  dropdown.style.display = "none";
  wrap.appendChild(dropdown);
  nameEl.addEventListener("input", () => {
    clearTimeout(_custSearchTimer);
    const q = nameEl.value.trim();
    if (q.length < 2) {
      dropdown.style.display = "none";
      return;
    }
    dropdown.style.display = "block";
    dropdown.innerHTML =
      '<div class="cust-search-item csi-loading">Searching...</div>';
    _custSearchTimer = setTimeout(() => doCustomerSearch(q, dropdown), 350);
  });
  document.addEventListener(
    "click",
    (e) => {
      if (!wrap.contains(e.target)) dropdown.style.display = "none";
    },
    true,
  );
}

async function doCustomerSearch(q, dropdown) {
  try {
    const rows = await fetch(
      API + "/customers/search?q=" + encodeURIComponent(q),
    ).then((r) => r.json());
    if (!rows.length) {
      dropdown.innerHTML =
        '<div class="cust-search-item csi-loading">No existing customer — will create new</div>';
      return;
    }
    dropdown.innerHTML = "";
    rows.forEach(function (r) {
      const div = document.createElement("div");
      div.className = "cust-search-item";
      const nameSpan = document.createElement("span");
      nameSpan.className = "csi-name";
      nameSpan.textContent = r.name || "—";
      const metaSpan = document.createElement("span");
      metaSpan.className = "csi-meta";
      metaSpan.textContent =
        "ID: " +
        r.customer_id +
        "  ·  Aadhar: " +
        (r.aadhar || "—") +
        "  ·  Mobile: " +
        (r.mobile || "—");
      div.appendChild(nameSpan);
      div.appendChild(metaSpan);
      div.addEventListener("click", function () {
        selectCustomer(r);
      });
      dropdown.appendChild(div);
    });
  } catch (e) {
    dropdown.innerHTML = "";
    const errDiv = document.createElement("div");
    errDiv.className = "cust-search-item csi-loading";
    errDiv.textContent = "Error: " + e.message;
    dropdown.appendChild(errDiv);
  }
}

function selectCustomer(r) {
  // r is always the full customer object from the search API
  if (typeof r !== "object" || !r) return;
  var custId = r.customer_id;

  // For new Gold Loan forms: clear loan-specific and gold-specific fields
  // before re-populating with the newly selected customer. Without this,
  // switching to a different customer leaves the previous customer's loan
  // number, amount, ornaments etc. in the form.
  var _isNewGoldLoan = window.checked && [...window.checked].some(function(t) { return t === "Gold Loan"; });
  if (_isNewGoldLoan) {
    var _goldFieldsToClear = [
      "f-loan_acc_no", "f-loan_amount", "f-loan_amount_words",
      "f-net_weight", "f-gross_weight", "f-gold_rate",
      "f-ornament_items", "f-comments", "f-metal_type",
      "f-saving_balance",
    ];
    _goldFieldsToClear.forEach(function(fid) {
      var el = document.getElementById(fid);
      if (el) el.value = "";
    });
    // Clear ornament rows UI if present
    var ornWrap = document.getElementById("ornament-rows-wrap");
    if (ornWrap) ornWrap.innerHTML = "";
    window._ornamentItems = [];
  }

  var map = {
    "f-customer_name": r.name,
    "f-customer_id": custId,
    "f-aadhar": r.aadhar,
    "f-mobile": r.mobile,
    "f-address": r.address,
    "f-dob": r.dob ? String(r.dob).split("T")[0] : "",
    "f-pan": r.pan,
    "f-occupation": r.occupation,
    "f-saving_acc_no": (r.saving_acc_no && !/^\d+-$/.test(r.saving_acc_no) ? r.saving_acc_no : null),
    // saving_balance is intentionally omitted here — the customers search returns
    // COALESCE(saving_balance::text,'0') from the stale customers table, not the
    // live saving_accounts balance. enrichCustomerFromHistory will fill the real
    // value from saving_accounts once the full history loads.
    "f-share_acc_no": r.share_acc_no,
  };
  Object.keys(map).forEach(function (id) {
    var el = document.getElementById(id);
    if (el && map[id]) {
      el.value = map[id];
    } else if (el && !map[id] && id === "f-saving_acc_no") {
      // Clear the "43-" prefix so enrichCustomerFromHistory can fill the real account no
      el.value = "";
    }
  });
  // BUG FIX: an existing customer was just selected, so any "Next available: ..."
  // new-account-number suggestion that fired before this selection (race between
  // the 200ms auto-suggest timer and the user searching/picking a customer) is now
  // stale — clear the hint text so it doesn't linger next to the real account
  // number (or blank field) set above/by enrichCustomerFromHistory.
  var savingHintEl = document.getElementById("saving-acc-hint");
  if (savingHintEl) savingHintEl.innerHTML = "";
  var savingAccEl = document.getElementById("f-saving_acc_no");
  if (savingAccEl) { savingAccEl.style.background = ""; savingAccEl.title = ""; }
  var dd = document.getElementById("cust-search-dropdown");
  if (dd) dd.style.display = "none";
  // Re-suggest loan number for gold/od when a customer is picked (uses correct 14-digit endpoint)
  // SKIP for Closing - Loan / Closing - OD: the loan_acc_no field for these forms
  // must be filled by selecting an existing ACTIVE loan from the picker below
  // (loadCustomerLoanAccounts / loadCustomerOdLoanAccounts), not auto-filled with
  // a brand-new "next loan number" — doing so previously caused closing forms to
  // submit against a non-existent loan account number.
  var _isClosingLoanOrOd =
    window.checked &&
    [...window.checked].some(function (t) {
      return t === "Closing - Loan" || t === "Closing - OD";
    });
  var lnEl = document.getElementById("f-loan_acc_no");
  if (lnEl && !lnEl.value && !_isClosingLoanOrOd) suggestNextLoanNo();
  // For FD-OD loan forms AND FD closing: load customer's FD accounts as a dropdown
  var isOdTx =
    window.checked &&
    [...window.checked].some(function (t) {
      return t === "New FD-OD Loan";
    });
  var isFdClosing =
    window.checked &&
    [...window.checked].some(function (t) {
      return t === "Closing - FD" || t === "Closing - FD - Slips" || t === "MIS Interest";
    });
  if ((isOdTx || isFdClosing)) {
    loadCustomerFdAccounts(r);
  }
  // For Closing - Loan: fetch active gold loans and show a picker
  var isLoanClosing =
    window.checked &&
    [...window.checked].some(function (t) { return t === "Closing - Loan"; });
  if (isLoanClosing) {
    loadCustomerLoanAccounts(r);
  }
  // For Closing - OD: fetch active FD-OD loans and show a picker
  var isOdClosing =
    window.checked &&
    [...window.checked].some(function (t) { return t === "Closing - OD"; });
  if (isOdClosing) {
    loadCustomerOdLoanAccounts(r);
  }
  // Enrich form with full history (nominee, referral, all account numbers etc.)
  // BUG FIX: store the Promise so isSavingDepWd can chain off it instead of using a
  // fixed 600ms setTimeout that loses races on slow connections.
  var enrichPromise = enrichCustomerFromHistory(r);
  // For Saving Deposit / Withdrawal — auto-fill acc no + balance after customer selected
  var isSavingDepWd =
    window.checked &&
    [...window.checked].some(function (t) {
      return ["Saving Deposit", "Saving Withdrawal", "Saving - Deposit Slip", "Saving - Withdrawal Slip"].includes(t);
    });
  if (isSavingDepWd) {
    // BUG FIX: was setTimeout(..., 600) which races with enrichCustomerFromHistory on
    // slow networks — whichever finished last would overwrite the other's value.
    // Chain off the enrich Promise so prefill always runs after enrich completes.
    Promise.resolve(enrichPromise).then(function() { prefillSavingAccFromHistory(); });
  }

  // Duplicate account-opening guard — warns immediately if this (existing)
  // customer already has an active Saving Account / Shares Account /
  // New Sadasya / New Naammatr Sabhasad and one of those is checked. This is
  // a convenience early-warning only; the real block is server-side (see
  // records.controller.js's create()), which still applies even if this
  // check is skipped (no customer_db_id, a network error, etc.).
  window._dupAccountViolation = null;
  checkDuplicateAccountGuard(r);
}

// ── Duplicate account-opening guard (client-side early warning) ────────────
// tx_type string → which /customers/:id/profile array to check, plus the
// membership_type to filter on for the two membership tasks (they share one
// "memberships" array, distinguished only by that field).
var DUP_GUARD_TASKS = {
  "Saving Account": { key: "saving_accounts", label: "Saving Account" },
  "Shares Account": { key: "shares", label: "Shares Account" },
  "New Sadasya": { key: "memberships", label: "New Sadasya membership", membershipType: "New Sadasya" },
  "New Naammatr Sabhasad": { key: "memberships", label: "New Naammatr Sabhasad membership", membershipType: "New Naammatr Sabhasad" },
};
async function checkDuplicateAccountGuard(customer) {
  if (!customer || !customer.customer_db_id) return;
  var activeTasks = window.checked ? [...window.checked] : [];
  var guardedTasks = activeTasks.filter(function (t) { return DUP_GUARD_TASKS[t]; });
  if (!guardedTasks.length) return;
  try {
    var profile = await fetch(API + "/customers/" + customer.customer_db_id + "/profile").then(function (res) {
      return res.json();
    });
    if (!profile || !profile.customer) return;
    for (var i = 0; i < guardedTasks.length; i++) {
      var cfg = DUP_GUARD_TASKS[guardedTasks[i]];
      var rows = profile[cfg.key] || [];
      var hasActive = rows.some(function (row) {
        if (row.status === "closed") return false;
        return cfg.membershipType ? row.membership_type === cfg.membershipType : true;
      });
      if (hasActive) {
        var msg = (customer.name || "This customer") + " already has an active " + cfg.label + " — uncheck \"" + guardedTasks[i] + "\" before saving.";
        window._dupAccountViolation = msg;
        toast("⚠️ " + msg, "err");
        return;
      }
    }
  } catch (e) {
    console.warn("[checkDuplicateAccountGuard]", e.message);
    // Fail open — the server-side check in create() is still authoritative.
  }
}

// ── FD Account Picker for FD-OD Loan ─────────────────────────────────────
// Called after a customer is selected on an OD-section form.
// Fetches all active FD accounts for that customer and replaces the plain
// fd_acc_no text input with a checkbox picker — an OD loan can be secured
// against 2 or more FDs at once, not just one, so this is a multi-select.
// A hidden input (kept at id "f-fd_acc_no") carries the actual submitted
// value as a comma-separated list of the checked FDs' account numbers;
// collect() reads it exactly like it read the old single-select's value.
async function loadCustomerFdAccounts(customer) {
  // BUG FIX: this replaces the plain #f-fd_acc_no input with a hidden
  // carrier input that REUSES the same id "f-fd_acc_no" (so collect() can
  // keep reading it unchanged) plus a separate #fd-acc-multi-picker div. If
  // this function ran a second time for the same form (e.g. the customer
  // search fires its selection handler more than once), the second call
  // would find the hidden carrier by that same id, replace IT with a new
  // picker, but leave the FIRST picker div behind as an orphaned sibling —
  // rendering two overlapping FD lists stacked on top of each other, which
  // looked like the results weren't scoped to one customer even though the
  // underlying query was. Always clear out any previous picker first so
  // this function is safe to call more than once.
  document
    .querySelectorAll("#fd-acc-multi-picker")
    .forEach(function (el) { el.remove(); });

  var fdAccEl = document.getElementById("f-fd_acc_no");
  if (!fdAccEl) return;

  var hint = document.getElementById("fd-acc-hint");
  if (hint)
    hint.innerHTML =
      '<span style="color:#888;font-style:italic">🔍 Loading FD accounts…</span>';

  // This picker is shared between two different flows: choosing which FD(s)
  // back a new OD loan, and choosing which FD to close/pay out. The prompt
  // text below should say the right one instead of always saying "OD loan".
  var isForOdLoan =
    window.checked &&
    [...window.checked].some(function (t) { return t === "New FD-OD Loan"; });
  var pickerVerb = isForOdLoan ? "back this OD loan" : "proceed";
  // BUG FIX: an OD loan can legitimately be secured against 2+ FDs at once,
  // which is why this list was built as checkboxes — but closing an FD (or
  // its Slips/MIS-Interest variants) is always exactly ONE FD at a time.
  // Reusing the same multi-select checkboxes there let staff accidentally
  // tick more than one FD on a single closing transaction. Render the list
  // as radio buttons (native, mutually-exclusive selection) whenever this
  // ISN'T the OD-loan flow.
  var isSingleSelect = !isForOdLoan;

  var params = new URLSearchParams();
  // customer_id is the most reliable key — immune to corrupted customers.name values
  // (e.g. "GANDHI BHIKAMCHAND FATTELAL STAND ,"). Always send it when available.
  if (customer.customer_id) params.set("customer_id", customer.customer_id);
  // Keep name/aadhar/mobile as fallback for any older code paths
  if (customer.name)   params.set("name",   customer.name);
  if (customer.aadhar) params.set("aadhar", customer.aadhar);
  if (customer.mobile) params.set("mobile", customer.mobile);

  var fdList = [];
  try {
    fdList = await fetch(API + "/fd-accounts/by-customer?" + params).then(
      function (r) {
        return r.json();
      },
    );
  } catch (e) {
    if (hint)
      hint.innerHTML =
        '<span style="color:#c0392b">⚠️ Could not load FD accounts: ' +
        e.message +
        "</span>";
    return;
  }

  // Hidden field that actually carries the value collect() submits.
  var hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.id = "f-fd_acc_no";
  hiddenInput.name = fdAccEl.name || "fd_acc_no";

  // Visible checkbox list.
  var wrap = document.createElement("div");
  wrap.id = "fd-acc-multi-picker";

  if (!fdList.length) {
    wrap.innerHTML =
      '<div style="padding:8px 10px;font-size:12px;color:#c0392b;font-style:italic;border:1px solid #f3c6c6;border-radius:6px;background:#fff5f5">⚠️ No active FDs found for this customer</div>';
  } else {
    var listBox = document.createElement("div");
    listBox.style.cssText =
      "border:1px solid #ccc;border-radius:8px;max-height:220px;overflow-y:auto;background:#fff;";
    fdList.forEach(function (fd, i) {
      var row = document.createElement("label");
      row.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:12px;cursor:pointer;" +
        (i < fdList.length - 1 ? "border-bottom:1px solid #eee;" : "");
      var cb = document.createElement("input");
      cb.type = isSingleSelect ? "radio" : "checkbox";
      if (isSingleSelect) cb.name = "fd-acc-picker";
      cb.className = "fd-multi-cb";
      cb.dataset.fd = JSON.stringify(fd);
      cb.style.cssText = "width:15px;height:15px;flex:0 0 auto;";
      var parts = [];
      if (fd.fd_acc_no) parts.push("Acc: " + fd.fd_acc_no);
      if (fd.fd_parvati_no) parts.push("Parvati: " + fd.fd_parvati_no);
      if (fd.fd_amount)
        parts.push("₹" + Number(fd.fd_amount).toLocaleString("en-IN"));
      if (fd.fd_maturity_date)
        parts.push("Matures: " + String(fd.fd_maturity_date).split("T")[0]);
      var span = document.createElement("span");
      span.textContent = parts.join("  ·  ");
      row.appendChild(cb);
      row.appendChild(span);
      listBox.appendChild(row);
    });
    wrap.appendChild(listBox);

    // Auto-check if only one FD
    if (fdList.length === 1) {
      listBox.querySelector(".fd-multi-cb").checked = true;
    }

    listBox.addEventListener("change", recomputeFdSelection);
  }

  // Recompute the hidden value + auto-filled fields from whichever FDs are checked.
  function recomputeFdSelection() {
    var checked = Array.prototype.slice.call(
      wrap.querySelectorAll(".fd-multi-cb:checked"),
    );
    var fds = checked
      .map(function (cb) {
        try { return JSON.parse(cb.dataset.fd); } catch (e) { return null; }
      })
      .filter(Boolean);

    // FIX: an MIS Special deposit has no fd_acc_no in the DB at all — it's
    // keyed by mis_acc_no instead — so checking an MIS FD here silently left
    // this hidden input (what collect()/validation actually reads) blank
    // even though the "✅ N FD selected" hint above is driven purely by
    // checkbox count and had no idea the value never made it through.
    hiddenInput.value = fds
      .map(function (fd) { return fd.fd_acc_no || fd.mis_acc_no || ""; })
      .filter(Boolean)
      .join(",");
    hiddenInput.dispatchEvent(new Event("input"));

    if (fds.length === 1) {
      // Single FD — same full auto-fill as before this was multi-select.
      var fd = fds[0];
      var fill = {
        "f-fd_parvati_no": fd.fd_parvati_no || "",
        "f-fd_amount": fd.fd_amount != null ? fd.fd_amount : "",
        "f-fd_amount_words": fd.fd_amount_words || "",
        "f-fd_period": fd.fd_period || "",
        "f-fd_interest_rate": fd.fd_interest_rate || "",
        "f-fd_maturity_date": fd.fd_maturity_date
          ? String(fd.fd_maturity_date).split("T")[0]
          : "",
        "f-fd_maturity_amount":
          fd.fd_maturity_amount != null ? fd.fd_maturity_amount : "",
        "f-fd_maturity_words": fd.fd_maturity_words || "",
      };
      Object.keys(fill).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
          el.value = fill[id];
          el.dispatchEvent(new Event("input"));
        }
      });
      if (fill["f-fd_amount"] !== "" && typeof autoFillWords === "function") {
        autoFillWords("fd_amount", fill["f-fd_amount"]);
      }
    } else if (fds.length >= 2) {
      // 2+ FDs secure this OD loan: FD Amount = sum (used for the OD margin
      // calc), Maturity Date = the earliest one (the binding constraint on
      // the OD loan). Interest Rate and Period are left for staff to enter
      // manually since different FDs can carry different rates/terms.
      var totalAmount = fds.reduce(
        function (s, fd) { return s + (parseFloat(fd.fd_amount) || 0); }, 0,
      );
      var totalMaturityAmount = fds.reduce(
        function (s, fd) { return s + (parseFloat(fd.fd_maturity_amount) || 0); }, 0,
      );
      var maturityDates = fds
        .map(function (fd) {
          return fd.fd_maturity_date ? String(fd.fd_maturity_date).split("T")[0] : null;
        })
        .filter(Boolean)
        .sort();
      var parvatiNos = fds
        .map(function (fd) { return fd.fd_parvati_no; })
        .filter(Boolean)
        .join(" + ");

      var fill2 = {
        "f-fd_parvati_no": parvatiNos,
        "f-fd_amount": totalAmount || "",
        "f-fd_maturity_date": maturityDates.length ? maturityDates[0] : "",
        "f-fd_maturity_amount": totalMaturityAmount || "",
      };
      Object.keys(fill2).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
          el.value = fill2[id];
          el.dispatchEvent(new Event("input"));
        }
      });
      if (totalAmount && typeof autoFillWords === "function") {
        autoFillWords("fd_amount", totalAmount);
      }
      if (totalMaturityAmount && typeof convertNumberToWords === "function") {
        var matWordsEl = document.getElementById("f-fd_maturity_words");
        if (matWordsEl) matWordsEl.value = convertNumberToWords(totalMaturityAmount);
      }
    }

    if (hint) {
      if (fds.length) {
        hint.innerHTML =
          '<span style="color:#27ae60;font-weight:600">✅ ' +
          fds.length + (fds.length > 1 ? " FDs selected — amounts & maturity summed/earliest, set Interest Rate manually" : " FD selected") +
          "</span>";
      } else {
        hint.innerHTML =
          '<span style="color:#e67e22;font-weight:600">⚠️ ' +
          (isSingleSelect ? "Select the FD to close" : "Check at least one FD to " + pickerVerb) +
          "</span>";
      }
    }
  }

  // Swap input → hidden value carrier + checkbox picker in the DOM
  fdAccEl.parentNode.insertBefore(hiddenInput, fdAccEl);
  fdAccEl.parentNode.replaceChild(wrap, fdAccEl);

  // Trigger auto-fill if only one FD was found (auto-checked above)
  if (fdList.length === 1) {
    recomputeFdSelection();
  } else if (hint) {
    hint.innerHTML = fdList.length
      ? '<span style="color:#27ae60;font-weight:600">✅ ' + fdList.length + " active FD(s) found — " +
        (isSingleSelect ? "select the one to close" : "check one or more to " + pickerVerb) + "</span>"
      : '<span style="color:#e67e22;font-weight:600">⚠️ No active FDs found for this customer</span>';
  }
}


// ── Active Loan Picker for Closing - Loan ────────────────────────────────────
// Called from selectCustomer() when "Closing - Loan" is ticked.
// Fetches all active gold loans for the selected customer, renders a clickable
// picker panel above the loan_acc_no field, and on click fills every loan field
// + sets window._closingRecId / _closingMeta exactly as openClosingLoanForm does.
async function loadCustomerLoanAccounts(customer) {
  var loanAccEl = document.getElementById("f-loan_acc_no");
  if (!loanAccEl) return;

  // Remove any previous picker
  var prev = document.getElementById("loan-acc-picker");
  if (prev) prev.remove();

  // Insert picker container above the loan_acc_no field
  var wrap = document.createElement("div");
  wrap.id = "loan-acc-picker";
  wrap.style.cssText = "margin-bottom:8px;border:1.5px solid #c8971a;border-radius:8px;overflow:hidden;background:#fffbf0;";
  loanAccEl.parentNode.insertBefore(wrap, loanAccEl);
  wrap.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:#888;font-style:italic;">🔍 Loading active loans…</div>';

  // BUG FIX: this used to send aadhar/mobile as query params to GET
  // /api/records, but that endpoint never actually implemented an aadhar/
  // mobile filter — it silently ignored them and returned the 200 most
  // recent active gold loans system-wide. The ONLY thing narrowing that
  // down was a client-side name-match filter requiring the first-OR-last
  // word to match exactly — which still readily matches a totally
  // different customer sharing a common surname (this app's own data has
  // real examples: "VASANTA SAKHARAM HANDE" vs "DAWAR SAKHARAM SAWARSING"
  // sharing a middle name; "DAWAR" itself recurring across many unrelated
  // families). /api/records now supports real exact-match customer_id/
  // aadhar/mobile filters (see list() in records.controller.js).
  //
  // Two more things this rewrite fixes, found while verifying the above:
  //   1. Many aadhar/mobile values in this data are placeholder junk (e.g.
  //      literally "22") shared across MULTIPLE unrelated customers — an
  //      "exact match" on a fake value is not actually safe. Only trust
  //      aadhar/mobile that are shaped like a real one.
  //   2. customer_id is reliable but not always present on the loan record
  //      itself (a known gap on bulk-imported rows) — a customer_id lookup
  //      can legitimately come back empty even though the customer has an
  //      active loan. And the loan section also contains "Closing - Loan"
  //      audit rows (account_no suffixed "-C") for loans already closed —
  //      these are history log entries, not open loans, and must never be
  //      offered in a "select the loan to close" picker. So: try each
  //      identifier in priority order (customer_id > aadhar > mobile >
  //      name), always excluding closing-audit rows, and only fall through
  //      to the next, weaker identifier if the stronger one finds nothing.
  function _isClosingAuditRow(rec) {
    var types = parseTxTypes(rec.tx_types);
    return types.length > 0 && types.every(function (t) { return /^Closing/i.test(t); });
  }
  var candidates = [];
  if (customer.customer_id) candidates.push({ param: "customer_id", value: customer.customer_id });
  if (customer.aadhar && /^\d{12}$/.test(customer.aadhar.replace(/\s/g, "")))
    candidates.push({ param: "aadhar", value: customer.aadhar.replace(/\s/g, "") });
  if (customer.mobile && /^\d{10}$/.test(customer.mobile.replace(/\s/g, "")))
    candidates.push({ param: "mobile", value: customer.mobile.replace(/\s/g, "") });
  if (customer.name) candidates.push({ param: "q", value: customer.name });

  var loans = [];
  try {
    for (var ci = 0; ci < candidates.length; ci++) {
      var cand = candidates[ci];
      var params = new URLSearchParams({ section: "gold", status: "active", limit: 200 });
      params.set(cand.param, cand.value);
      var res = await fetch(API + "?" + params).then(function (r) { return r.json(); });
      var all = res.records || res || [];
      var filtered = all.filter(function (rec) { return !_isClosingAuditRow(rec); });
      // q= is a loose LIKE across several fields, not scoped to this
      // customer alone — the name-only fallback still needs an exact-name
      // sanity check before offering these loans up to close. customer_id/
      // aadhar/mobile are already exact server-side matches, trusted as-is.
      if (cand.param === "q") {
        filtered = filtered.filter(function (rec) {
          return rec.name && customer.name &&
            rec.name.trim().toLowerCase() === customer.name.trim().toLowerCase();
        });
      }
      if (filtered.length) { loans = filtered; break; }
    }
  } catch (e) {
    wrap.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:#c0392b;">⚠️ Could not load loans: ' + e.message + "</div>";
    return;
  }

  if (!loans.length) {
    // BUG FIX: this used to just say "No active loans found" with no
    // mention of "gold" — this picker only ever searches Gold Loans, so a
    // customer with an active OD loan but no gold loan (real case: PRMILA
    // VASUDEVRAO BHAD, active OD loan ₹25,000, no gold loan) read as "no
    // active loan of any kind", when actually the wrong checkbox had been
    // ticked ("Closing - Loan" instead of "Closing - OD"). Say "gold"
    // explicitly, and — since we're already asking the server anyway —
    // check whether the customer has an active OD loan instead and say so
    // directly,
    // so the fix is obvious without needing to go re-check the OD Loans
    // page separately.
    var odHint = "";
    try {
      var odParams = new URLSearchParams();
      if (customer.customer_id) odParams.set("customer_id", customer.customer_id);
      if (customer.name) odParams.set("name", customer.name);
      if (customer.aadhar) odParams.set("aadhar", customer.aadhar);
      if (customer.mobile) odParams.set("mobile", customer.mobile);
      var odLoans = await fetch(API + "/od-loans/by-customer?" + odParams).then(function (r) { return r.json(); });
      if (Array.isArray(odLoans) && odLoans.length) {
        odHint =
          '<div style="padding:6px 12px;font-size:11.5px;color:#7a5800;background:#fffbe6;border-top:1px solid #f0dca0;">' +
          "💡 This customer has " + odLoans.length + " active OD loan" + (odLoans.length > 1 ? "s" : "") +
          " instead — did you mean to check <strong>Closing - OD</strong> rather than <strong>Closing - Loan</strong>?</div>";
      }
    } catch (e) {
      // Cross-check is a nice-to-have — a failure here shouldn't block the
      // (already-accurate) "no gold loan" message below.
    }
    wrap.innerHTML =
      '<div style="padding:8px 12px;font-size:12px;color:#c0392b;font-weight:700;">⚠️ No active GOLD loans found for this customer.</div>' +
      odHint;
    return;
  }

  // Header
  var header = document.createElement("div");
  header.style.cssText = "background:#c8971a;color:#fff;padding:6px 12px;font-size:12px;font-weight:700;";
  header.textContent = "🏦 Select Loan to Close — " + loans.length + " active loan" + (loans.length > 1 ? "s" : "") + " found";
  wrap.innerHTML = "";
  wrap.appendChild(header);

  // FIX: guard flag — once a loan row is selected, stop forEach from
  // appending subsequent rows into the already-replaced green summary bar.
  var _loanSelected = false;

  loans.forEach(function (rec) {
    var d = (typeof rec.data === "string")
      ? (function () { try { return JSON.parse(rec.data || "{}"); } catch (e) { return {}; } })()
      : (rec.data || {});

    var loanNo = d.loan_acc_no || rec.account_no || "—";
    var amount = d.loan_amount ? "₹" + Number(d.loan_amount).toLocaleString("en-IN") : "—";
    var _rawDate = d.date || rec.date || "";
    var dated = _rawDate ? (function(s) {
      var p = (s || "").split("T")[0].split("-");
      if (p.length === 3) {
        var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return p[2] + " " + (months[parseInt(p[1],10)-1]||p[1]) + " " + p[0];
      }
      return s;
    })(_rawDate) : "—";
    var orns   = d.gold_ornaments || d.silver_ornaments || "";
    var ornSnip = orns
      ? " · " + orns.split(",").slice(0, 2).map(function (s) { return s.trim(); }).join(", ") + (orns.split(",").length > 2 ? "…" : "")
      : "";

    var row = document.createElement("div");
    row.style.cssText = "padding:10px 12px;cursor:pointer;border-top:1px solid #f0dfa0;display:flex;align-items:center;gap:12px;transition:background .15s;";
    row.innerHTML =
      '<div style="flex:1;">' +
        '<div style="font-size:13px;font-weight:700;color:#1a3a5c;">Loan No: ' + loanNo + "</div>" +
        '<div style="font-size:11px;color:#555;margin-top:2px;">' + amount + " · Date: " + dated + ornSnip + "</div>" +
      "</div>" +
      '<div style="background:#1a3a5c;color:#fff;padding:4px 14px;border-radius:16px;font-size:11px;font-weight:700;white-space:nowrap;">Select →</div>';

    row.addEventListener("mouseenter", function () { row.style.background = "#fff8e0"; });
    row.addEventListener("mouseleave", function () { row.style.background = ""; });

    row.addEventListener("click", function () {
      // FIX: prevent double-firing if somehow clicked after selection
      if (_loanSelected) return;
      _loanSelected = true;

      function fill(id, val) {
        var el = document.getElementById("f-" + id);
        if (el && val != null && String(val) !== "") {
          el.value = val;
          el.dispatchEvent(new Event("input"));
        }
      }
      fill("loan_acc_no",       d.loan_acc_no || rec.account_no);
      fill("loan_amount",       d.loan_amount);
      fill("loan_amount_words", d.loan_amount_words);
      fill("saving_acc_no",     d.saving_acc_no);
      fill("share_acc_no",      d.share_acc_no);
      fill("nominee_name",      d.nominee_name);
      fill("nominee_relation",  d.nominee_relation);
      fill("comments",          d.comments);

      // Restore ornament rows
      if (d.ornament_items && d.ornament_items.length) {
        setTimeout(function () {
          var tbody = document.getElementById("orn-items-tbody");
          if (tbody) {
            tbody.innerHTML = "";
            d.ornament_items.forEach(function (item) {
              if (typeof ornAddRow === "function") ornAddRow(item);
            });
          }
        }, 200);
      }

      // Restore ornament multicheck badges
      ["gold_ornaments", "silver_ornaments"].forEach(function (key) {
        if (!d[key]) return;
        var hid = document.getElementById("f-" + key);
        if (hid) hid.value = d[key];
        var lbl = document.getElementById("mchk-lbl-" + key);
        if (lbl) {
          lbl.innerHTML = d[key].split(",").map(function (o) {
            return '<span class="mchk-tag">' + o.trim() + "</span>";
          }).join("");
        }
      });

      // Set closing state — same as openClosingLoanForm
      window._closingRecId = rec.id;
      window._closingOriginalDate = d.date || rec.date || null;
      window._closingMeta = {
        customer_type:   rec.customer_type   || "regular",
        account_no:      null,
      };
      if (typeof ctype !== "undefined") ctype = rec.customer_type || "regular";

      // Fetch interest so cashbook entries have the correct total amount
      window._closingInterestData = null;
      var _loanAmtCI = parseFloat(d.loan_amount) || 0;
      var _fromDateCI = (d.date || rec.date || "").split("T")[0];
      var _todayCI = new Date().toISOString().split("T")[0];
      if (_loanAmtCI && _fromDateCI) {
        fetch("/api/interest/gold-loan", {
          method: "POST",
          headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
          body: JSON.stringify({ principal: _loanAmtCI, rate: 18, from_date: _fromDateCI, to_date: _todayCI }),
        }).then(function(r) { return r.json(); }).then(function(intData) {
          if (!intData.error) {
            window._closingInterestData = {
              interest_amount: parseFloat(intData.interest) || 0,
              total_amount: parseFloat(intData.total) || _loanAmtCI,
            };
          }
        }).catch(function() {});
      }

      // Restore photos — list API strips base64, so fetch the full record
      var photoFields = [
        "photo_customer",
        "photo_ornament",
        "photo_aadhar_front",
        "photo_aadhar_back",
        "photo_pan",
      ];
      // First apply any photos already present in the list-response data blob
      // (in case the server does include them), then fetch full record to fill gaps
      photoFields.forEach(function (pid) {
        if (d[pid]) {
          photos[pid] = d[pid];
          var pbox = document.getElementById("pbox-" + pid);
          if (pbox) {
            pbox.innerHTML = _photoBoxFilledHtml(pid, d[pid]);
          }
        }
      });
      // Fetch full record to get base64 photos and ornament data (stripped from list endpoint)
      fetch(API + "/" + rec.id).then(function (r) { return r.json(); }).then(function (fullRec) {
        var fd = fullRec && fullRec.data ? fullRec.data : {};
        if (typeof fd === "string") { try { fd = JSON.parse(fd); } catch(e) { fd = {}; } }

        // Restore photos from full record (authoritative)
        photoFields.forEach(function (pid) {
          if (!fd[pid]) return;
          photos[pid] = fd[pid];
          var pbox = document.getElementById("pbox-" + pid);
          if (pbox) {
            pbox.innerHTML = _photoBoxFilledHtml(pid, fd[pid]);
          }
        });

        // Restore ornament items from full record (list endpoint may strip these)
        if (fd.ornament_items && fd.ornament_items.length) {
          setTimeout(function () {
            var tbody = document.getElementById("orn-items-tbody");
            if (tbody) {
              tbody.innerHTML = "";
              fd.ornament_items.forEach(function (item) {
                if (typeof ornAddRow === "function") ornAddRow(item);
              });
            }
          }, 200);
        }

        // Restore ornament multicheck badges from full record
        ["gold_ornaments", "silver_ornaments"].forEach(function (key) {
          if (!fd[key]) return;
          var hid = document.getElementById("f-" + key);
          if (hid) hid.value = fd[key];
          var lbl = document.getElementById("mchk-lbl-" + key);
          if (lbl) {
            lbl.innerHTML = fd[key].split(",").map(function (o) {
              return '<span class="mchk-tag">' + o.trim() + "</span>";
            }).join("");
          }
        });
      }).catch(function () { /* non-fatal — photos/ornaments stay as-is */ });

      // Collapse to a green summary bar
      var lno = d.loan_acc_no || rec.account_no || "—";
      var amt = d.loan_amount ? "₹" + Number(d.loan_amount).toLocaleString("en-IN") : "—";
      wrap.style.border = "1.5px solid #27ae60";
      // FIX: Build the green bar via DOM (not innerHTML with embedded JSON) so
      // customer names/aadhar containing quotes cannot break the markup,
      // and the ↩ Change button reliably calls loadCustomerLoanAccounts.
      var bar = document.createElement("div");
      bar.style.cssText = "background:#27ae60;color:#fff;padding:8px 14px;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:space-between;";
      var infoSpan = document.createElement("span");
      infoSpan.textContent = "✅ Loan Selected: " + lno + " · " + amt;
      var changeSpan = document.createElement("span");
      changeSpan.style.cssText = "opacity:.75;font-size:11px;cursor:pointer;text-decoration:underline;";
      changeSpan.textContent = "↩ Change";
      // Capture customer reference safely in closure — no JSON embedded in HTML attribute
      changeSpan.addEventListener("click", function (e) {
        e.stopPropagation();
        loadCustomerLoanAccounts({ name: customer.name, aadhar: customer.aadhar, mobile: customer.mobile });
      });
      bar.appendChild(infoSpan);
      bar.appendChild(changeSpan);
      wrap.innerHTML = "";
      wrap.appendChild(bar);
    });

    // FIX: only append the row if no selection has been made yet
    if (!_loanSelected) wrap.appendChild(row);
  });

  // Auto-select when only one active loan
  if (loans.length === 1) {
    setTimeout(function () {
      var onlyRow = wrap.querySelectorAll("div[style*='cursor:pointer']");
      if (onlyRow.length === 1) onlyRow[0].click();
    }, 500);
  }
}

// ── Active OD Loan Picker for Closing - OD ───────────────────────────────
// Called from selectCustomer() when "Closing - OD" is ticked.
// Fetches all active FD-OD loans for the selected customer, renders a
// clickable picker panel above the loan_acc_no field, and on click fills
// every loan + FD field — mirrors the gold loan picker pattern exactly.
async function loadCustomerOdLoanAccounts(customer) {
  var loanAccEl = document.getElementById("f-loan_acc_no");
  if (!loanAccEl) return;

  // Remove any previous picker
  var prev = document.getElementById("od-loan-acc-picker");
  if (prev) prev.remove();

  // Insert picker container above the loan_acc_no field
  var wrap = document.createElement("div");
  wrap.id = "od-loan-acc-picker";
  wrap.style.cssText = "margin-bottom:8px;border:1.5px solid #2b6cb0;border-radius:8px;overflow:hidden;background:#f0f6ff;";
  loanAccEl.parentNode.insertBefore(wrap, loanAccEl);
  wrap.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:#888;font-style:italic;">🔍 Loading active FD-OD loans…</div>';

  // Fetch active FD-OD loans for this customer
  var params = new URLSearchParams();
  if (customer.customer_id) params.set("customer_id", customer.customer_id);
  if (customer.name)   params.set("name",   customer.name);
  if (customer.aadhar) params.set("aadhar", customer.aadhar);
  if (customer.mobile) params.set("mobile", customer.mobile);

  var loans = [];
  try {
    loans = await fetch(API + "/od-loans/by-customer?" + params).then(function (r) { return r.json(); });
    if (!Array.isArray(loans)) loans = [];
  } catch (e) {
    wrap.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:#c0392b;">⚠️ Could not load FD-OD loans: ' + e.message + "</div>";
    return;
  }

  if (!loans.length) {
    // Mirrors the same fix on the Gold Loan side (loadCustomerLoanAccounts)
    // — cross-check for an active Gold Loan instead, so ticking the wrong
    // one of "Closing - Loan" / "Closing - OD" is obvious immediately
    // rather than reading as "no active loan of any kind".
    var goldHint = "";
    try {
      var goldParams = new URLSearchParams({ section: "gold", status: "active", limit: 200 });
      if (customer.customer_id) goldParams.set("customer_id", customer.customer_id);
      else if (customer.aadhar && /^\d{12}$/.test(customer.aadhar.replace(/\s/g, "")))
        goldParams.set("aadhar", customer.aadhar.replace(/\s/g, ""));
      else if (customer.mobile && /^\d{10}$/.test(customer.mobile.replace(/\s/g, "")))
        goldParams.set("mobile", customer.mobile.replace(/\s/g, ""));
      else if (customer.name) goldParams.set("q", customer.name);
      var goldRes = await fetch(API + "?" + goldParams).then(function (r) { return r.json(); });
      var goldAll = goldRes.records || goldRes || [];
      var goldActive = goldAll.filter(function (rec) {
        var types = parseTxTypes(rec.tx_types);
        var isClosingAudit = types.length > 0 && types.every(function (t) { return /^Closing/i.test(t); });
        if (isClosingAudit) return false;
        if (goldParams.get("q")) {
          return rec.name && customer.name &&
            rec.name.trim().toLowerCase() === customer.name.trim().toLowerCase();
        }
        return true;
      });
      if (goldActive.length) {
        goldHint =
          '<div style="padding:6px 12px;font-size:11.5px;color:#7a5800;background:#fffbe6;border-top:1px solid #f0dca0;">' +
          "💡 This customer has " + goldActive.length + " active Gold Loan" + (goldActive.length > 1 ? "s" : "") +
          " instead — did you mean to check <strong>Closing - Loan</strong> rather than <strong>Closing - OD</strong>?</div>";
      }
    } catch (e) {
      // Cross-check is a nice-to-have — a failure here shouldn't block the
      // (already-accurate) "no FD-OD loan" message below.
    }
    wrap.innerHTML =
      '<div style="padding:8px 12px;font-size:12px;color:#c0392b;font-weight:700;">⚠️ No active FD-OD loans found for this customer.</div>' +
      goldHint;
    return;
  }

  // Header
  var header = document.createElement("div");
  header.style.cssText = "background:#2b6cb0;color:#fff;padding:6px 12px;font-size:12px;font-weight:700;";
  header.textContent = "💳 Select FD-OD Loan to Close — " + loans.length + " active loan" + (loans.length > 1 ? "s" : "") + " found";
  wrap.innerHTML = "";
  wrap.appendChild(header);

  var _loanSelected = false;

  loans.forEach(function (loan) {
    // record_data may be a JSON string
    var rd = loan.record_data;
    if (typeof rd === "string") { try { rd = JSON.parse(rd || "{}"); } catch (e) { rd = {}; } }
    rd = rd || {};

    var loanNo = loan.loan_acc_no || "—";
    var amount = loan.loan_amount ? "₹" + Number(loan.loan_amount).toLocaleString("en-IN") : "—";
    var fdNo   = loan.fd_acc_no   || "—";
    var dated  = loan.loan_date   ? String(loan.loan_date).split("T")[0] : "—";
    var fdAmt  = loan.fd_amount   ? " · FD ₹" + Number(loan.fd_amount).toLocaleString("en-IN") : "";

    var row = document.createElement("div");
    row.style.cssText = "padding:10px 12px;cursor:pointer;border-top:1px solid #cce0f5;display:flex;align-items:center;gap:12px;transition:background .15s;";
    row.innerHTML =
      '<div style="flex:1;">' +
        '<div style="font-size:13px;font-weight:700;color:#1a3a5c;">Loan No: ' + loanNo + "</div>" +
        '<div style="font-size:11px;color:#555;margin-top:2px;">' + amount + " · FD Acc: " + fdNo + fdAmt + " · Date: " + dated + "</div>" +
      "</div>" +
      '<div style="background:#2b6cb0;color:#fff;padding:4px 14px;border-radius:16px;font-size:11px;font-weight:700;white-space:nowrap;">Select →</div>';

    row.addEventListener("mouseenter", function () { row.style.background = "#dbeafe"; });
    row.addEventListener("mouseleave", function () { row.style.background = ""; });

    row.addEventListener("click", function () {
      if (_loanSelected) return;
      _loanSelected = true;

      function fill(id, val) {
        var el = document.getElementById("f-" + id);
        if (el && val != null && String(val) !== "") {
          el.value = val;
          el.dispatchEvent(new Event("input"));
        }
      }

      // Fill loan fields
      fill("loan_acc_no",         loan.loan_acc_no);
      fill("loan_amount",         loan.loan_amount);
      fill("loan_amount_words",   rd.loan_amount_words);
      fill("comments",            rd.comments);

      // Fill FD fields linked to this OD loan
      // FIX 1 (picker): also fill mis_acc_no — loan.mis_acc_no is returned by the API
      fill("fd_acc_no",           loan.fd_acc_no || loan.mis_acc_no);
      fill("mis_acc_no",          loan.mis_acc_no);
      fill("fd_parvati_no",       loan.fd_parvati_no);
      fill("fd_amount",           loan.fd_amount);
      fill("fd_amount_words",     rd.fd_amount_words);
      fill("fd_period",           loan.fd_period);
      fill("fd_interest_rate",    loan.fd_interest_rate);
      fill("fd_maturity_date",    loan.fd_maturity_date ? String(loan.fd_maturity_date).split("T")[0] : null);
      fill("fd_maturity_amount",  loan.fd_maturity_amount);
      fill("fd_maturity_words",   rd.fd_maturity_words);

      // Auto-fill words if available
      if (loan.loan_amount && typeof autoFillWords === "function") {
        autoFillWords("loan_amount", loan.loan_amount);
      }
      if (loan.fd_amount && typeof autoFillWords === "function") {
        autoFillWords("fd_amount", loan.fd_amount);
      }

      // Set closing state
      window._closingRecId = loan.record_id;
      window._closingOriginalDate = rd.date || loan.loan_date || null;
      window._closingMeta = {
        customer_type:   rd.customer_type   || "regular",
        account_no:      null,
      };
      if (typeof ctype !== "undefined") ctype = rd.customer_type || "regular";

      // FIX 3 (Path B): Prefetch OD loan interest so cashbook can use total amount
      window._closingInterestData = null;
      var _pickerPrincipal = parseFloat(loan.loan_amount) || 0;
      var _pickerFromDate  = (rd.date || loan.loan_date || "").split("T")[0];
      var _pickerToDate    = new Date().toISOString().split("T")[0];
      var _pickerRate      = parseFloat(loan.fd_interest_rate) || parseFloat(rd.loan_interest_rate) || 0;
      if (_pickerPrincipal && _pickerFromDate && _pickerToDate && _pickerRate) {
        fetch("/api/interest/gold-loan", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-auth-token": localStorage.getItem("jju_token") || "" },
          body: JSON.stringify({ principal: _pickerPrincipal, rate: _pickerRate, from_date: _pickerFromDate, to_date: _pickerToDate }),
        }).then(function(r) { return r.json(); }).then(function(intData) {
          if (!intData.error) {
            window._closingInterestData = {
              interest_amount: parseFloat(intData.interest) || 0,
              total_amount: parseFloat(intData.total) || _pickerPrincipal,
            };
          }
        }).catch(function() {});
      }

      // Restore photos from record data if present
      var photoFields = ["photo_customer", "photo_aadhar_front", "photo_aadhar_back", "photo_pan", "photo_fd"];
      photoFields.forEach(function (pid) {
        if (!rd[pid]) return;
        photos[pid] = rd[pid];
        var pbox = document.getElementById("pbox-" + pid);
        if (pbox) {
          pbox.innerHTML = _photoBoxFilledHtml(pid, rd[pid]);
        }
      });
      // Fetch full record for photos (list endpoint may strip base64)
      if (loan.record_id) {
        fetch(API + "/" + loan.record_id).then(function (r) { return r.json(); }).then(function (fullRec) {
          var fd2 = fullRec && fullRec.data ? fullRec.data : {};
          if (typeof fd2 === "string") { try { fd2 = JSON.parse(fd2); } catch(e) { fd2 = {}; } }
          photoFields.forEach(function (pid) {
            if (!fd2[pid]) return;
            photos[pid] = fd2[pid];
            var pbox = document.getElementById("pbox-" + pid);
            if (pbox) {
              pbox.innerHTML = _photoBoxFilledHtml(pid, fd2[pid]);
            }
          });
        }).catch(function () { /* non-fatal */ });
      }

      // Collapse to green summary bar
      wrap.style.border = "1.5px solid #27ae60";
      var bar = document.createElement("div");
      bar.style.cssText = "background:#27ae60;color:#fff;padding:8px 14px;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:space-between;";
      var infoSpan = document.createElement("span");
      infoSpan.textContent = "✅ OD Loan Selected: " + loanNo + " · " + amount + " · FD: " + fdNo;
      var changeSpan = document.createElement("span");
      changeSpan.style.cssText = "opacity:.75;font-size:11px;cursor:pointer;text-decoration:underline;";
      changeSpan.textContent = "↩ Change";
      changeSpan.addEventListener("click", function (e) {
        e.stopPropagation();
        loadCustomerOdLoanAccounts({ name: customer.name, aadhar: customer.aadhar, mobile: customer.mobile });
      });
      bar.appendChild(infoSpan);
      bar.appendChild(changeSpan);
      wrap.innerHTML = "";
      wrap.appendChild(bar);
    });

    if (!_loanSelected) wrap.appendChild(row);
  });

  // Auto-select if only one active OD loan
  if (loans.length === 1) {
    setTimeout(function () {
      var onlyRow = wrap.querySelectorAll("div[style*='cursor:pointer']");
      if (onlyRow.length === 1) onlyRow[0].click();
    }, 500);
  }
}

// ── Enrich form from customer's full record history ───────────────────────
// Called after selectCustomer(). Fetches ALL fields from the customer's
// most recent records — nominee, referral, all account numbers — and fills
// any form field that is currently empty.
async function enrichCustomerFromHistory(customer) {
  var params = new URLSearchParams();
  // BUG FIX: was sending "name" but backend /customer-full-data expects "customer_id".
  // Name is not a query param the route accepts — it caused 400s for customers with
  // no aadhar/mobile, making the entire enrich silently abort and leaving all fields blank.
  if (customer.customer_id) params.set("customer_id", customer.customer_id);
  if (customer.aadhar)      params.set("aadhar",      customer.aadhar);
  if (customer.mobile)      params.set("mobile",       customer.mobile);
  if (!customer.customer_id && !customer.aadhar && !customer.mobile) return;

  var merged;
  try {
    window._enrichFetching = true;
    merged = await fetch(API + "/customer-full-data?" + params).then(
      function (r) {
        return r.json();
      },
    );
  } catch (e) {
    window._enrichFetching = false;
    return;
  } finally {
    window._enrichFetching = false;
  }
  if (!merged || typeof merged !== "object") return;

  // Determine what kind of form is open
  var activeTx = window.checked ? [...window.checked] : [];
  var isNewGold = activeTx.some(function (t) {
    return ["Gold Loan"].includes(t);
  });
  var isNewFD = activeTx.some(function (t) {
    return ["New FD", "New FD - Term", "New FD - MIS"].includes(t);
  });
  var isNewSaving = activeTx.some(function (t) {
    return ["Saving Account", "New Sadasya", "New Naammatr Sabhasad"].includes(
      t,
    );
  });
  var isFollowUp = activeTx.some(function (t) {
    return [
      "Closing - Loan",
      "Slips - Loan",
      "Closing - FD",
      "Closing - FD - Slips",
      "MIS Interest",
      "Closing - OD",
      "Saving Deposit",
      "Saving Withdrawal",
      "Closing - Saving Account",
    ].includes(t);
  });

  // Personal details — always fill if empty
  var personalMap = {
    "f-customer_id": merged.customer_id,
    "f-dob": merged.dob,
    "f-pan": merged.pan,
    "f-occupation": merged.occupation,
    "f-address": merged.address,
    "f-referral": merged.referral,
    "f-nominee_name": merged.nominee_name,
    "f-nominee_relation": merged.nominee_relation,
    "f-share_acc_no": merged.share_acc_no,
  };

  // Saving acc — always fill from history for existing customers (all tx types)
  // The apply loop only sets if field is currently empty, so no overwrite risk
  if (merged.saving_acc_no)
    personalMap["f-saving_acc_no"] = merged.saving_acc_no;
  if (merged.saving_balance != null)
    personalMap["f-saving_balance"] = String(merged.saving_balance);

  // Fallback: if customer-full-data didn't return saving_acc_no, search saving
  // records directly by name/aadhar/mobile and pull it from the JSONB data field.
  if (!merged.saving_acc_no && (customer.name || customer.aadhar || customer.mobile)) {
    try {
      var savP = new URLSearchParams({ section: "saving", limit: 50 });
      if (customer.name) savP.set("q", customer.name);
      var savRes = await fetch(API + "?" + savP).then(function(r) { return r.json(); });
      var savRecs = (savRes.records || []).filter(function(rec) {
        var d = typeof rec.data === "string" ? (function() { try { return JSON.parse(rec.data); } catch(e) { return {}; } })() : rec.data || {};
        var nameMatch = customer.name && (rec.name || "").toLowerCase() === customer.name.toLowerCase();
        var aadharMatch = customer.aadhar && (d.aadhar || rec.aadhar || "") === customer.aadhar;
        var mobileMatch = customer.mobile && (d.mobile || rec.mobile || "") === customer.mobile;
        return nameMatch || aadharMatch || mobileMatch;
      });
      // Sort newest first, pick the record that has a valid saving_acc_no
      savRecs.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
      for (var si = 0; si < savRecs.length; si++) {
        var srec = savRecs[si];
        var sd = typeof srec.data === "string" ? (function() { try { return JSON.parse(srec.data); } catch(e) { return {}; } })() : srec.data || {};
        var accNo = sd.saving_acc_no || srec.account_no || "";
        if (accNo && !/^\d+-$/.test(accNo) && !accNo.endsWith("-CLOSE")) {
          personalMap["f-saving_acc_no"] = accNo;
          if (sd.saving_balance != null && !personalMap["f-saving_balance"])
            personalMap["f-saving_balance"] = String(sd.saving_balance);
          break;
        }
      }
    } catch(e) { /* non-fatal */ }
  }

  // FD account details — only for follow-up FD transactions
  if (
    isFollowUp &&
    activeTx.some(function (t) {
      return ["Closing - FD", "Closing - FD - Slips", "MIS Interest"].includes(
        t,
      );
    })
  ) {
    personalMap["f-fd_acc_no"] = merged.fd_acc_no;
    personalMap["f-fd_parvati_no"] = merged.fd_parvati_no;
    personalMap["f-fd_amount"] = merged.fd_amount;
    personalMap["f-fd_period"] = merged.fd_period;
    personalMap["f-fd_interest_rate"] = merged.fd_interest_rate;
    personalMap["f-fd_maturity_date"] = merged.fd_maturity_date;
    personalMap["f-fd_maturity_amount"] = merged.fd_maturity_amount;
    personalMap["f-fd_maturity_words"] = merged.fd_maturity_words;
  }
  if (activeTx.includes("MIS Interest")) {
    personalMap["f-mis_acc_no"] = merged.mis_acc_no;
  }

  // Loan/OD details — only for follow-up transactions.
  // Skip Closing - Loan: loadCustomerLoanAccounts() owns these fields.
  // Filling them here uses stale data from the most-recent customer record
  // (could be a Slips entry, not the active loan being closed).
  var isLoanClosingFlow = activeTx.includes("Closing - Loan");
  if (
    isFollowUp &&
    !isLoanClosingFlow &&
    activeTx.some(function (t) {
      return ["Slips - Loan", "Closing - OD"].includes(t);
    })
  ) {
    personalMap["f-loan_acc_no"] = merged.loan_acc_no;
    personalMap["f-loan_amount"] = merged.loan_amount;
    personalMap["f-loan_amount_words"] = merged.loan_amount_words;
  }
  if (isFollowUp && activeTx.includes("Closing - OD")) {
    personalMap["f-fd_acc_no"]          = merged.fd_acc_no;
    personalMap["f-fd_parvati_no"]      = merged.fd_parvati_no;
    personalMap["f-fd_amount"]          = merged.fd_amount;
    personalMap["f-fd_amount_words"]    = merged.fd_amount_words;
    personalMap["f-fd_maturity_date"]   = merged.fd_maturity_date;
    personalMap["f-fd_maturity_amount"] = merged.fd_maturity_amount;
    personalMap["f-fd_maturity_words"]  = merged.fd_maturity_words;
  }

  // Apply all — only set if element exists AND is currently empty
  // For saving_acc_no, treat "43-" (the default prefix) as empty
  Object.keys(personalMap).forEach(function (id) {
    var val = personalMap[id];
    if (!val && val !== 0) return;
    var el = document.getElementById(id);
    if (!el) return; // field not in current form — skip
    // Treat bare prefix (e.g. "43-") or "-CLOSE" suffixed account as empty.
    // Also treat "0" as overwritable for f-saving_balance — selectCustomer used
    // to stamp "0" from the stale customers table; enrich must be able to
    // overwrite it with the real live balance from saving_accounts.
    var isEmpty = !el.value ||
      (id === "f-saving_acc_no" && /^\d+-$/.test(el.value)) ||
      (id === "f-saving_acc_no" && el.value.endsWith("-CLOSE")) ||
      (id === "f-saving_balance" && el.value === "0");
    if (isEmpty) {
      el.value = val;
      el.dispatchEvent(new Event("input"));
      if (id === "f-saving_acc_no" && typeof onSavingAccNoInput === "function") {
        onSavingAccNoInput(val);
      }
    }
  });

  // ── Ornament items are intentionally NOT restored from customer history ──
  // Each Gold Loan must have ornaments entered fresh by staff at time of pledge.
  // The loan picker (loadCustomerLoanAccounts) fills ornaments only for
  // Closing - Loan from the specific active loan record — not from history.
  // (Old code that restored ornaments from history has been removed to prevent
  //  previous loan's ornaments appearing on a new Gold Loan form.)

  // ── Restore photos from customer history into form photo boxes ──
  // Photos are base64 strings stored in the data blob. We populate the
  // global `photos` object AND render a preview so the user can see them.
  // photo_ornament is excluded — each Gold Loan needs a fresh ornament photo.
  // ID photos (customer, Aadhar, PAN) are pre-filled from history as they rarely change.
  //
  // BUG FIX: this must NOT run for follow-up/closing transactions (Closing -
  // FD, Closing - Loan, Closing - OD, Slips - Loan, MIS Interest, ...).
  // `merged` here is the customer's most-recent value for each field across
  // ALL of their records (any section, any date) — exactly the same reason
  // the loan/OD fields just above are skipped with `isFollowUp` ("uses stale
  // data from the most-recent customer record ... not the active loan being
  // closed"). Left unguarded, this used to race with openClosingFdForm() /
  // openClosingLoanForm() / openClosingOdForm() (and the loan/OD pickers in
  // selectCustomer()), which restore photos from the SPECIFIC record being
  // closed — if that record itself has no photo for a given field, this
  // block would silently fill it in first with a photo from a DIFFERENT
  // record (sometimes a different customer entirely, sometimes just old/
  // stale), which is what produced "closing form is printing photos of
  // someone else / old data". The closing-form openers own photo restore
  // for closing flows; this block only pre-fills for brand-new records.
  if (!isFollowUp) {
    var photoFields = [
      "photo_customer",
      "photo_aadhar_front",
      "photo_aadhar_back",
      "photo_pan",
    ];
    photoFields.forEach(function (pid) {
      var src = merged[pid];
      if (!src) return; // no photo in history for this field
      // Only set if not already uploaded in this session
      if (photos[pid]) return;
      photos[pid] = src;
      var pbox = document.getElementById("pbox-" + pid);
      if (pbox) {
        pbox.innerHTML = _photoBoxFilledHtml(pid, src);
      }
    });
  }
}

async function suggestNextLoanNo() {
  try {
    // Use section-aware auto endpoint for FD-OD (od) vs gold (03- prefix)
    var isOdForm = window.checked && [...window.checked].some(function(t) {
      return t === "New FD-OD Loan" || t === "OD Loan" || t === "Slips - OD" || t === "Closing - OD";
    });
    var url = isOdForm
      ? API + "/next-loan-no-auto?section=od"
      : API + "/next-loan-no-auto?section=gold";
    var r = await fetch(url).then(function (res) { return res.json(); });
    var lnEl = document.getElementById("f-loan_acc_no");
    if (lnEl && !lnEl.value && r.next) {
      lnEl.value = r.next;
      lnEl.style.background = "#fffbe6";
      lnEl.title = "Auto-suggested — confirm before submitting";
    }
  } catch (e) {}
}

(function () {
  var obs = new MutationObserver(function () {
    if (
      document.getElementById("f-customer_name") &&
      !document.getElementById("cust-search-dropdown")
    ) {
      initCustomerSearch();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();

// ═══════════════════════════════════════════════════════════════════════════
//  GLOBAL DATE SELECTOR
//  All pages read window.APP_DATE. Defaults to today → zero behaviour change.
// ═══════════════════════════════════════════════════════════════════════════

window.APP_DATE = new Date().toISOString().split("T")[0];

function getAppDate() {
  return window.APP_DATE || new Date().toISOString().split("T")[0];
}

function isToday(d) {
  return d === new Date().toISOString().split("T")[0];
}

// Called once on login / page load to set the date picker to today
function initGlobalDate() {
  const inp = document.getElementById("global-date");
  if (!inp) return;
  const today = new Date().toISOString().split("T")[0];
  inp.value = today;
  window.APP_DATE = today;
  _updateDateUI(today);
  _updateCloseDayBtn(today);
  // Auto-load ledger for today on startup
  setTimeout(() => loadLedger(), 300);
}

// Triggered by the date input's onchange
function onGlobalDateChange() {
  const inp = document.getElementById("global-date");
  if (!inp) return;
  const d = inp.value || new Date().toISOString().split("T")[0];
  window.APP_DATE = d;
  _updateDateUI(d);

  // Sync all page-level date inputs so Ledger / Cash Book stay in step
  _syncPageDates(d);

  // Reload whatever page is currently visible
  const activePage = document.querySelector(".page.active");
  if (activePage) {
    const pageId = activePage.id.replace("page-", "");
    _refreshPageForDate(pageId);
  }

  // Always auto-load the ledger (main data tab) for the selected date
  // This ensures rows populate from DB when switching dates
  setTimeout(() => {
    loadLedger();
  }, 100);

  // Toast confirmation
  const fmt = new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  toast("📅 Switched to " + fmt + " — loading data…", "ok");
}

// Jump back to today
function setTodayDate() {
  const today = new Date().toISOString().split("T")[0];
  const inp = document.getElementById("global-date");
  if (inp) inp.value = today;
  window.APP_DATE = today;
  _updateDateUI(today);
  _syncPageDates(today);
  const activePage = document.querySelector(".page.active");
  if (activePage) {
    const pageId = activePage.id.replace("page-", "");
    _refreshPageForDate(pageId);
  }
}

// ── Update Close Day button to reflect day-closed status ─────────────────────
function _updateCloseDayBtn(d) {
  const closeBtn = document.getElementById("close-day-btn");
  if (!closeBtn) return;
  let info = null;
  try {
    const raw = localStorage.getItem("day-closed-" + d);
    if (raw) info = JSON.parse(raw);
  } catch (e) {}
  if (info && info.syncedAt) {
    const syncTime = new Date(info.syncedAt).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    closeBtn.innerHTML = `<span>🔒</span><span>Day Closed · ${syncTime}</span>`;
    closeBtn.style.background = "rgba(39,174,96,0.18)";
    closeBtn.style.color = "#27ae60";
    closeBtn.style.borderColor = "rgba(39,174,96,0.3)";
    closeBtn.title = `Day synced at ${syncTime} — ${info.records || 0} records, ${info.ledgerRows || 0} ledger rows`;
  } else {
    closeBtn.innerHTML = "<span>🔒</span><span>Close Day</span>";
    closeBtn.style.background = "";
    closeBtn.style.color = "";
    closeBtn.style.borderColor = "";
    closeBtn.title = "Sync & close this day to database";
  }
}

function _updateDateUI(d) {
  const today = new Date().toISOString().split("T")[0];
  const isPast = d && d !== today;

  // Past-date badge on header
  const badge = document.getElementById("hdate-badge");
  if (badge) badge.style.display = isPast ? "inline-block" : "none";

  // Close Day button — show whenever any date is set, update closed state
  const closeBtn = document.getElementById("close-day-btn");
  if (closeBtn) closeBtn.style.display = d ? "flex" : "none";
  _updateCloseDayBtn(d);

  // Past date banner inside Dashboard
  _renderPastDateBanner(d);
}

function _renderPastDateBanner(d) {
  // Remove any existing banner first
  document.querySelectorAll(".past-date-banner").forEach((el) => el.remove());
  if (!d || isToday(d)) return;

  const fmt = new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const banner = document.createElement("div");
  banner.className = "past-date-banner";
  banner.innerHTML = `
    <span>📅</span>
    <div>
      <div class="pdb-date">${fmt}</div>
      <div style="font-size:9px;font-weight:600;opacity:0.8">Viewing past date — data filtered for this day</div>
    </div>
    <button class="pdb-back" onclick="setTodayDate()">↩ Back to Today</button>
  `;

  // Insert at top of every visible .page
  document.querySelectorAll(".page.active").forEach((page) => {
    page.insertBefore(banner.cloneNode(true), page.firstChild);
  });
}

// Keep Ledger + Cash Book date inputs in sync with global date
function _syncPageDates(d) {
  const ldgDate = document.getElementById("ldg-date");
  if (ldgDate) ldgDate.value = d;

  const cbDate = document.getElementById("cb-date");
  if (cbDate) cbDate.value = d;

  // Restore any previously saved opening balance for that date
  try {
    const saved = localStorage.getItem("cb-opening-" + d);
    const openEl = document.getElementById("cb-opening");
    if (openEl && saved) openEl.value = saved;
  } catch (e) {}
}

// Reload data for the given page using the global date
function _refreshPageForDate(pageId) {
  switch (pageId) {
    case "home":
      loadDashboard();
      break;
    case "database":
      dbOff = 0;
      loadDB();
      break;
    case "ledger":
      loadLedger();
      break;
    case "cashbook":
      // Don't auto-generate cash book on date change — user clicks the button
      // Just make sure the date input is correct (already done in _syncPageDates)
      break;
  }
}

// ── Patch loadDashboard to accept a date param ────────────────────────────────
// We wrap the existing function so the stats endpoint can receive ?date=
// The original call was: fetch(API + "/stats")
// New call adds: fetch(API + "/stats?date=" + getAppDate())
// If backend doesn't support the param it's silently ignored — zero risk.
const _origLoadDashboard = loadDashboard;
loadDashboard = async function () {
  // Patch the stats fetch URL inside the call by temporarily overriding
  // We achieve this by tagging APP_DATE onto the URL via a global intercept
  window._dashDateParam = getAppDate();

  // Update dash-date label to reflect selected date
  const d = getAppDate();
  const fmt = new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const dashDateEl = document.getElementById("dash-date");
  if (dashDateEl) {
    dashDateEl.textContent = isToday(d) ? fmt : "📅 Viewing: " + fmt;
  }

  // Update label on "Today's Entries" KPI card to reflect date context
  const todayLbl =
    document.querySelector("#s-today + .stat-lbl") ||
    document.querySelector('[id="s-today"]')?.nextElementSibling;
  if (todayLbl)
    todayLbl.textContent = isToday(d) ? "Today's Entries" : "Day's Entries";

  // Re-render the past-date banner
  _renderPastDateBanner(d);

  await _origLoadDashboard();
};

// ── Patch loadDB to filter by selected date ────────────────────────────────────
// Always filter Database tab by selected date (today or past).
// This ensures the database tab only shows the current selected date's records.
const _origLoadDB = loadDB;
loadDB = async function () {
  const d = getAppDate();
  const _q = document.getElementById("db-q")?.value || "";
  // Only inject date filter when not searching and no status filter is set.
  // Search must scan all dates to find older records.
  // Status filters (Active/Closed) must also scan all dates — an active loan
  // from 3 months ago should be visible when the user clicks "Active".
  if (!_q && !dbStatusFilter) {
    window._dbDateFilter = d;
  }
  await _origLoadDB();
  window._dbDateFilter = null;
};

// Inject date filter safely by patching the URLSearchParams constructor only when the
// db date filter flag is active and the query string contains 'limit' (records queries).
// Uses a robust approach that works for both string and object init forms.
const _NativeURLSearchParams = window.URLSearchParams;
function _PatchedURLSearchParams(init) {
  const instance = new _NativeURLSearchParams(init);
  if (window._dbDateFilter && !instance.has("date_from")) {
    // Only inject for records API queries (have 'limit' param)
    if (
      instance.has("limit") ||
      (typeof init === "string" && init.includes("limit"))
    ) {
      instance.set("date_from", window._dbDateFilter);
      instance.set("date_to", window._dbDateFilter);
    }
  }
  return instance;
}
_PatchedURLSearchParams.prototype = _NativeURLSearchParams.prototype;
Object.setPrototypeOf(_PatchedURLSearchParams, _NativeURLSearchParams);
window.URLSearchParams = _PatchedURLSearchParams;

// ── Patch showPage to always sync dates when switching pages ──────────────────
const _origShowPage = showPage;
showPage = function (id) {
  // FIX 3: "cashbook" is a tab inside page-ledger, not a standalone page.
  // Redirect to ledger and switch to the cashbook tab.
  if (id === 'cashbook') {
    _origShowPage('ledger');
    const _d = getAppDate ? getAppDate() : new Date().toISOString().split('T')[0];
    const _cbDateEl = document.getElementById('cb-date');
    if (_cbDateEl && !_cbDateEl.value) _cbDateEl.value = _d;
    setTimeout(function() {
      if (typeof switchLedgerTab === 'function') switchLedgerTab('cashbook');
      // Also load the standalone cash book view if cb-content exists
      if (document.getElementById('cb-content') && typeof loadCashBook === 'function') {
        loadCashBook();
      }
    }, 100);
    return;
  }
  _origShowPage(id);
  const d = getAppDate();
  _syncPageDates(d);
  _renderPastDateBanner(d);
  _updateCloseDayBtn(d);
  // When switching to ledger tab, always reload for the current date
  if (id === "ledger") {
    setTimeout(() => loadLedger(), 80);
  }
  // When switching to database tab, reload for the current date
  if (id === "database") {
    setTimeout(() => {
      dbOff = 0;
      loadDB();
    }, 80);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  CLOSE DAY SYNC ENGINE
// ═══════════════════════════════════════════════════════════════════════════

async function openCloseDayModal() {
  const d = getAppDate();
  const fmt = new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Check if this day was already closed
  let prevClose = null;
  try {
    const raw = localStorage.getItem("day-closed-" + d);
    if (raw && raw !== "syncing") prevClose = JSON.parse(raw);
  } catch (e) {}

  const subtitle = document.getElementById("close-day-subtitle");
  if (subtitle) {
    subtitle.textContent = fmt;
    if (prevClose && prevClose.syncedAt) {
      const t = new Date(prevClose.syncedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      subtitle.innerHTML = `${fmt} &nbsp;<span style="background:#d4f5e9;color:#2a7a50;border-radius:4px;padding:2px 8px;font-size:9px;font-weight:800">✅ Already closed at ${t}</span>`;
    }
  }

  // Reset UI
  ["cd-gold-n", "cd-closed-n", "cd-fd-n", "cd-ledger-n"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "…";
  });
  const log = document.getElementById("close-day-log");
  if (log) {
    log.style.display = "none";
    log.innerHTML = "";
  }
  const btn = document.getElementById("close-day-confirm-btn");
  if (btn) {
    btn.disabled = false;
    btn.textContent = prevClose ? "🔄 Re-sync This Day" : "✅ Sync & Close Day";
  }

  document.getElementById("close-day-modal").style.display = "flex";

  // Fetch day summary from backend
  try {
    const [recRes, cbRes] = await Promise.all([
      fetch(API + "?limit=500&date_from=" + d + "&date_to=" + d),
      fetch(CB_API + "?date=" + d, { headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' } }),
    ]);
    const recJson = recRes.ok ? await recRes.json() : {};
    const cbJson = cbRes.ok ? await cbRes.json() : {};
    const records = recJson.records || [];
    const entries = cbJson.entries || [];

    // Count by type
    let newGold = 0,
      closedLoans = 0,
      newFD = 0;
    records.forEach((r) => {
      const txs = parseTxTypes(r.tx_types);
      if (txs.some((t) => t === "Gold Loan" || t === "Slips - Loan")) newGold++;
      if (txs.some((t) => t === "Closing - Loan")) closedLoans++;
      if (txs.some((t) => t === "New FD" || t === "New FD - Term" || t === "New FD - MIS" || t === "Fixed Deposit" || t === "Fixed Deposit - MIS")) newFD++;
    });

    document.getElementById("cd-gold-n").textContent = newGold;
    document.getElementById("cd-closed-n").textContent = closedLoans;
    document.getElementById("cd-fd-n").textContent = newFD;
    document.getElementById("cd-ledger-n").textContent = entries.length;

    // Store for sync
    window._closeDayData = { d, records, entries };
  } catch (e) {
    toast("Could not load day summary: " + e.message, "err");
  }
}

function _cdLog(msg, type) {
  const log = document.getElementById("close-day-log");
  if (!log) return;
  log.style.display = "block";
  const color = type === "ok" ? "#27ae60" : type === "err" ? "#c0392b" : "#555";
  { const d=document.createElement('div'); d.style.color=color; d.textContent=msg; log.appendChild(d); }
  log.scrollTop = log.scrollHeight;
}

async function runCloseDaySync() {
  const btn = document.getElementById("close-day-confirm-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Syncing…";
  }

  const log = document.getElementById("close-day-log");
  if (log) {
    log.style.display = "block";
    log.innerHTML = "";
  }

  const { d, records, entries } = window._closeDayData || {};
  if (!d) {
    toast("No data loaded — reopen the modal", "err");
    return;
  }

  // Mark day as syncing in localStorage
  try {
    localStorage.setItem("day-closed-" + d, "syncing");
  } catch (e) {}
  let ok = 0,
    errs = 0;

  _cdLog(
    `📅 Syncing ${d} — ${records.length} records, ${entries.length} ledger rows`,
    "info",
  );

  // ── 1. Process each record through process-transaction ──────────────────────
  // This is idempotent — it upserts gold_loans, fd_accounts, saving_accounts
  for (const rec of records) {
    const txs = parseTxTypes(rec.tx_types);
    const d2 =
      typeof rec.data === "string"
        ? (() => {
            try {
              return JSON.parse(rec.data);
            } catch (e) {
              return {};
            }
          })()
        : rec.data || {};

    try {
      const res = await fetch(API + "/process-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
        body: JSON.stringify({
          tx_types: txs,
          data: d2,
          record_id: rec.id,
          customer_name: rec.name,
        }),
      });
      if (res.ok) {
        ok++;
        _cdLog(`✅ ${rec.name} — ${txs.join(", ")}`, "ok");
      } else {
        const j = await res.json().catch(() => ({}));
        errs++;
        _cdLog(`⚠️ ${rec.name}: ${j.error || res.status}`, "err");
      }
    } catch (e) {
      errs++;
      _cdLog(`❌ ${rec.name}: ${e.message}`, "err");
    }
  }

  // ── 2. Flush any unsaved ledger entries ─────────────────────────────────────
  const unsaved = (ledgerAllRows || []).filter(
    (r) => !r._saved && (!r.date || r.date === d),
  );
  if (unsaved.length) {
    _cdLog(`📋 Flushing ${unsaved.length} unsaved ledger rows…`, "info");
    try {
      await _flushToDB(d, unsaved);
      _cdLog(`✅ Ledger rows saved`, "ok");
    } catch (e) {
      _cdLog(`❌ Ledger flush failed: ${e.message}`, "err");
      errs++;
    }
  } else {
    _cdLog(`📋 All ledger entries already saved`, "ok");
  }

  // ── 3. Mark closed loans as closed in gold_loans table ──────────────────────
  for (const rec of records) {
    const txs = parseTxTypes(rec.tx_types);
    if (!txs.includes("Closing - Loan")) continue;
    if (rec.closed_date) continue; // already closed

    const closingDate = rec.date || d;
    try {
      const res = await fetch(API + "/" + rec.id + "/close", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
        body: JSON.stringify({
          closed_date: closingDate,
          closed_remarks: rec.remarks || "",
        }),
      });
      if (res.ok) {
        _cdLog(`🔒 Marked closed: ${rec.name} (${closingDate})`, "ok");
        ok++;
      } else {
        errs++;
        _cdLog(`⚠️ Close failed for ${rec.name}`, "err");
      }
    } catch (e) {
      errs++;
      _cdLog(`❌ Close error for ${rec.name}: ${e.message}`, "err");
    }
  }

  // ── Summary & mark day closed ────────────────────────────────────────────────
  const summary = `✅ Day Closed — ${ok} synced, ${errs} error(s)`;
  _cdLog(summary, errs > 0 ? "err" : "ok");
  toast(summary, errs > 0 ? "err" : "ok");

  // Store day-closed marker with timestamp in localStorage
  try {
    const closedInfo = {
      date: d,
      syncedAt: new Date().toISOString(),
      records: records.length,
      ledgerRows: entries.length,
      errors: errs,
    };
    localStorage.setItem("day-closed-" + d, JSON.stringify(closedInfo));
  } catch (e) {}

  if (btn) {
    btn.disabled = false;
    btn.textContent = "✅ Done — Close Modal";
  }
  if (btn)
    btn.onclick = () => {
      document.getElementById("close-day-modal").style.display = "none";
      // Refresh all data for the closed day
      loadDashboard();
      loadDB();
      loadLedger();
      // Update the close button appearance to show day is closed
      _updateCloseDayBtn(d);
    };

  invalidateSavingCache();
  _updateCloseDayBtn(d);
}

// ── initGlobalDate is called directly in DOMContentLoaded (after appCheckAuth)
//    and in appDoLogin (after token stored). The old setTimeout(initGlobalDate,50)
//    caused a race condition — API calls fired before the auth token was ready,
//    producing 401 errors on desktop and login failures on mobile. ────────────

// ═══════════════════════════════════════════════════════════════════════════
//  FEATURE ADDITIONS — JJU Bank v2
//  #1  Dashboard Alerts   #2  Inline Interest  #3  Customer 360
//  #6  Day-End Summary    #7  Duplicate Check  #9  Bulk MIS Interest
// ═══════════════════════════════════════════════════════════════════════════

// ── #1  Dashboard Alerts ─────────────────────────────────────────────────
// Patch loadDashboard: after stats load, fetch & display notification alerts
(function patchDashboardAlerts() {
  const _prev = loadDashboard;
  loadDashboard = async function () {
    await _prev.apply(this, arguments);
    // Restore PDF history panel on every dashboard load
    if (typeof renderPdfPanel === "function") renderPdfPanel();
    try {
      // Trigger backend check (silent)
      fetch(API_BASE + "/notifications/run-checks", { method: "POST" }).catch(
        () => {},
      );
      const data = await fetch(API_BASE + "/notifications?limit=50").then((r) =>
        r.json(),
      );
      const unread = (data.notifications || []).filter((n) => !n.is_read);
      const card = document.getElementById("dash-alerts-card");
      const list = document.getElementById("dash-alerts-list");
      if (!card || !list) return;
      if (!unread.length) {
        card.style.display = "none";
        return;
      }
      card.style.display = "";
      // Helper: clean raw date strings like "Wed Apr 23 2025 00:00:00 GMT+0530 (India Standard Time)"
      // into a readable "23 Apr 2025" format
      function _fmtNotifBody(body) {
        if (!body) return "";
        // Replace any JS Date.toString() pattern with a clean date
        return body.replace(
          /([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{4})\s+\d{2}:\d{2}:\d{2}\s+GMT[+-]\d{4}[^)]*\)/g,
          (match) => {
            try {
              const d = new Date(match);
              return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
            } catch (_) { return match; }
          }
        ).replace(
          // Also catch ISO strings like 2025-04-23T00:00:00.000Z
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g,
          (match) => {
            try {
              const d = new Date(match);
              return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
            } catch (_) { return match; }
          }
        );
      }

      list.innerHTML = unread
        .map((n) => {
          const isFD = n.type === "fd_maturity";
          const color = isFD ? "#8e44ad" : "#c0392b";
          const icon = isFD ? "📋" : "⚠️";
          const cleanBody = _fmtNotifBody(n.body || "");
          return `<div style="padding:4px 0;border-bottom:1px dashed #f0d9c0;display:flex;gap:8px;align-items:flex-start;">
          <span style="font-size:13px;">${icon}</span>
          <div>
            <div style="font-weight:700;color:${color};font-size:9.5pt;">${n.title}</div>
            <div style="color:#555;font-size:8.5pt;">${cleanBody}</div>
          </div>
        </div>`;
        })
        .join("");
    } catch (_) {}
  };
})();

// ── #2  Inline Gold Loan Interest Calculator ──────────────────────────────
// Patched into the record-row action buttons via a global function.
// Called from the 💰 button added in the patched renderDB section below.

window.showLoanInterestModal = async function (
  recordId,
  loanAmount,
  rate,
  fromDate,
) {
  const modal = document.getElementById("interest-modal");
  const content = document.getElementById("interest-modal-content");
  if (!modal || !content) return;
  modal.style.display = "flex";
  content.innerHTML =
    '<div style="color:#aaa;text-align:center;padding:20px;">Calculating…</div>';
  try {
    const res = await fetch(API_BASE + "/interest/gold-loan", {
      method: "POST",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify({
        principal: parseFloat(loanAmount) || 0,
        rate: parseFloat(rate) || 12,
        from_date: fromDate || new Date().toISOString().split("T")[0],
      }),
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    const fmt = (n) => "₹ " + Number(n).toLocaleString("en-IN");
    content.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        <div style="background:#eaf6ff;border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Principal</div>
          <div style="font-weight:800;font-size:13pt;color:#1a5276;">${fmt(d.principal)}</div>
        </div>
        <div style="background:#fef9e7;border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Days Elapsed</div>
          <div style="font-weight:800;font-size:13pt;color:#7d6608;">${d.days} days</div>
        </div>
        <div style="background:#fdf2f8;border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Interest Owed</div>
          <div style="font-weight:800;font-size:13pt;color:#8e44ad;">${fmt(d.interest)}</div>
        </div>
        <div style="background:#eafaf1;border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Total to Close</div>
          <div style="font-weight:800;font-size:13pt;color:#1e8449;">${fmt(d.total)}</div>
        </div>
      </div>
      <div style="font-size:9pt;color:#888;text-align:center;">
        From: ${d.from_date} &nbsp;·&nbsp; To: ${d.to_date}
      </div>`;
  } catch (e) {
    { const ed=document.createElement("div"); ed.style.cssText="color:#c0392b;padding:16px;"; ed.textContent="Error: "+e.message; content.innerHTML=""; content.appendChild(ed); }
  }
};

// Patch renderDB to inject 💰 button on active gold loan rows.
// We wrap the existing render loop output safely — no HTML structure changed.
// patchGoldInterestButton: renderDB was never defined in this codebase; actual function is
// renderTable. Injection is handled by the MutationObserver in observeDBTable() below,
// which now has access to _lastDBRows via the renderTable cache patch above.
(function patchGoldInterestButton() {
  // No-op: MutationObserver approach handles button injection correctly.
})();

function _injectInterestButtons() {
  // Find all rows already rendered in the DB table and add interest button
  // We use a data-attribute to avoid double-injection
  document.querySelectorAll("tr[data-rid]").forEach((tr) => {
    const rid = tr.dataset.rid;
    const sect = tr.dataset.section;
    const status = tr.dataset.status;
    if (sect !== "gold" || status === "closed") return;
    const abtns = tr.querySelector(".abtns");
    if (!abtns || abtns.querySelector(".sb-interest")) return;
    const loanAmt = tr.dataset.loanAmount || "";
    const rate = tr.dataset.rate || "";
    const fromDate = tr.dataset.date || "";
    const btn = document.createElement("button");
    btn.className = "sb sb-interest";
    btn.title = "Calculate Interest";
    btn.style.cssText = "background:#eafaf1;color:#1e8449;";
    btn.innerHTML = "💰";
    btn.onclick = (e) => {
      e.stopPropagation();
      window.showLoanInterestModal(rid, loanAmt, rate, fromDate);
    };
    // Insert before the delete button (last button)
    const lastBtn = abtns.querySelector("button:last-child");
    if (lastBtn) abtns.insertBefore(btn, lastBtn);
    else abtns.appendChild(btn);
  });
}

// The record rows in this codebase are rendered via innerHTML, not DOM elements with data attrs.
// We take a different approach: patch the row HTML template string directly.
// Find the exact pattern in the render output and inject the button via a MutationObserver.
(function observeDBTable() {
  const observer = new MutationObserver(() => {
    // For each tr in the db table that is a gold active row, add the button
    document.querySelectorAll("#db-body tr").forEach((tr) => {
      // Detect gold section via badge color / section badge text — use existing data
      const badgeEl = tr.querySelector(".badge");
      if (!badgeEl) return;
      const abtns = tr.querySelector(".abtns");
      if (!abtns || abtns.querySelector(".sb-interest")) return;
      // Section detection from badge background color (gold uses #fadbd8 BG defined in SB)
      // More reliable: check if row contains a loan_acc_no pattern in any cell
      const cells = tr.querySelectorAll("td");
      if (!cells.length) return;

      // The onclick attr of the row includes the record id
      const rowOnclick = tr.getAttribute("onclick") || "";
      const ridMatch = rowOnclick.match(/toggleDetail\((\d+)/);
      if (!ridMatch) return;
      const rid = ridMatch[1];

      // Check if this record is gold+active from the window._dbRows cache
      const rec = (window._lastDBRows || []).find((r) => String(r.id) === rid);
      if (!rec || rec.section !== "gold" || rec.status === "closed") return;

      // Parse data for interest calc
      const d =
        typeof rec.data === "string"
          ? (() => {
              try {
                return JSON.parse(rec.data);
              } catch (e) {
                return {};
              }
            })()
          : rec.data || {};
      const loanAmt = d.loan_amount || "";
      const rate = d.loan_interest_rate || d.interest_rate || "12";
      const fromDate = rec.date || "";

      const btn = document.createElement("button");
      btn.className = "sb sb-interest";
      btn.title = "Calculate Interest";
      btn.style.cssText = "background:#eafaf1;color:#1e8449;";
      btn.textContent = "💰";
      btn.onclick = (e) => {
        e.stopPropagation();
        window.showLoanInterestModal(rid, loanAmt, rate, fromDate);
      };
      const lastBtn = abtns.querySelector("button:last-child");
      if (lastBtn) abtns.insertBefore(btn, lastBtn);
      else abtns.appendChild(btn);
    });
  });

  // Start observing once DOM is ready
  const startObs = () => {
    const dbBody = document.getElementById("db-body");
    if (dbBody) observer.observe(dbBody, { childList: true, subtree: true });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", startObs);
  else startObs();
})();

// Store last loaded records for the observer to reference.
// FIX: _dbRows was never set by loadDB — patch renderTable instead, which receives rows directly.
(function patchRenderTableCache() {
  const _origRenderTable = typeof renderTable === "function" ? renderTable : null;
  if (!_origRenderTable) return;
  renderTable = function (rows) {
    window._lastDBRows = Array.isArray(rows) ? rows : [];
    return _origRenderTable.apply(this, arguments);
  };
  window.renderTable = renderTable;
  window.renderDB = renderTable; // alias so any renderDB references also work
})();

// ── #3  Customer 360° View ────────────────────────────────────────────────
window.showCustomer360 = async function (recordId) {
  const modal = document.getElementById("cust360-modal");
  const content = document.getElementById("cust360-content");
  if (!modal || !content) return;
  modal.style.display = "block";
  content.innerHTML =
    '<div style="color:#aaa;text-align:center;padding:30px;">Loading…</div>';
  try {
    const data = await fetch(`${API_BASE}/customers/${recordId}/profile`).then(
      (r) => r.json(),
    );
    if (data.error) throw new Error(data.error);
    const c = data.customer || {};
    const fmt = (n) => (n ? "₹ " + Number(n).toLocaleString("en-IN") : "—");
    const fmtD = (d) => (d ? String(d).split("T")[0] : "—");
    const badge = (text, color) =>
      `<span style="background:${color}20;color:${color};border-radius:4px;padding:1px 7px;font-size:9px;font-weight:700;">${text}</span>`;

    const sectionBlock = (title, rows, emptyMsg) => {
      if (!rows.length)
        return `<div style="margin-bottom:14px;"><div style="font-weight:700;font-size:9.5pt;color:#555;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:6px;">${title}</div><div style="color:#aaa;font-size:9pt;">${emptyMsg}</div></div>`;
      const cells = rows
        .map(
          (r) => `
        <div style="background:#f9f9f9;border-radius:7px;padding:8px 10px;margin-bottom:6px;font-size:9.5pt;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span style="font-weight:700;color:#1a3a5c;">${r.acc_no || "—"}</span>
            ${r.status === "active" ? badge("Active", "#27ae60") : badge("Closed", "#c0392b")}
          </div>
          ${r.amount ? `<div style="color:#555;font-size:9pt;">${r.label}: ${fmt(r.amount)}</div>` : ""}
          ${r.extra ? `<div style="color:#888;font-size:8.5pt;">${r.extra}</div>` : ""}
        </div>`,
        )
        .join("");
      return `<div style="margin-bottom:14px;"><div style="font-weight:700;font-size:9.5pt;color:#555;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:6px;">${title} (${rows.length})</div>${cells}</div>`;
    };

    const goldRows = (data.gold_loans || []).map((r) => ({
      acc_no: r.acc_no,
      status: r.status,
      amount: r.loan_amount,
      label: "Loan",
      extra: r.end_date ? `End: ${fmtD(r.end_date)}` : "",
    }));
    const fdRows = (data.fd_accounts || []).map((r) => ({
      acc_no: r.acc_no,
      status: r.status,
      amount: r.fd_amount,
      label: "Amount",
      extra: r.end_date ? `Matures: ${fmtD(r.end_date)}` : "",
    }));
    const savRows = (data.saving_accounts || []).map((r) => ({
      acc_no: r.acc_no,
      status: r.status,
      amount: r.balance,
      label: "Balance",
      extra: "",
    }));
    const odRows = (data.od_loans || []).map((r) => ({
      acc_no: r.acc_no,
      status: r.status,
      amount: r.loan_amount,
      label: "Loan",
      extra: r.fd_acc_no ? `FD: ${r.fd_acc_no}` : "",
    }));
    const memRows = (data.memberships || []).map((r) => ({
      acc_no: r.acc_no,
      status: r.status,
      amount: null,
      label: "",
      extra: r.membership_type || "",
    }));

    content.innerHTML = `
      <div style="background:#eaf3fb;border-radius:8px;padding:10px 14px;margin-bottom:14px;">
        <div style="font-weight:800;font-size:12pt;margin-bottom:2px;">${c.name || "—"}</div>
        <div style="font-size:9pt;color:#555;display:flex;gap:14px;flex-wrap:wrap;">
          ${c.aadhar ? `<span>🪪 ${c.aadhar}</span>` : ""}
          ${c.mobile ? `<span>📱 ${c.mobile}</span>` : ""}
          ${c.pan_no ? `<span>💳 ${c.pan_no}</span>` : ""}
          ${c.dob ? `<span>🎂 ${fmtD(c.dob)}</span>` : ""}
        </div>
        ${c.address ? `<div style="font-size:8.5pt;color:#777;margin-top:4px;">📍 ${c.address}</div>` : ""}
      </div>
      ${sectionBlock("🥇 Gold Loans", goldRows, "No gold loans")}
      ${sectionBlock("📋 Fixed Deposits", fdRows, "No FDs")}
      ${sectionBlock("💰 Saving Accounts", savRows, "No saving accounts")}
      ${sectionBlock("🔄 OD Loans", odRows, "No OD loans")}
      ${sectionBlock("🪪 Memberships", memRows, "No memberships")}
      <div style="text-align:right;margin-top:8px;">
        <button onclick="document.getElementById('cust360-modal').style.display='none'"
          style="padding:7px 18px;background:#1a3a5c;color:#fff;border:none;border-radius:7px;font-weight:700;font-size:11px;cursor:pointer;">Close</button>
      </div>`;
  } catch (e) {
    { const ed=document.createElement("div"); ed.style.cssText="color:#c0392b;padding:16px;"; ed.textContent="Error loading profile: "+e.message; content.innerHTML=""; content.appendChild(ed); }
  }
};

// Add 👤 button to record rows via MutationObserver (same pattern as interest button)
(function addCustomer360Buttons() {
  const observer = new MutationObserver(() => {
    document.querySelectorAll("#db-body tr").forEach((tr) => {
      const abtns = tr.querySelector(".abtns");
      if (!abtns || abtns.querySelector(".sb-360")) return;
      const rowOnclick = tr.getAttribute("onclick") || "";
      const ridMatch = rowOnclick.match(/toggleDetail\((\d+)/);
      if (!ridMatch) return;
      const rid = ridMatch[1];
      const rec = (window._lastDBRows || []).find((r) => String(r.id) === rid);
      if (!rec) return;

      // BUG FIX: "Customer 360° View shows Customer not found" — this button
      // used to render on every row and always fall back to the RECORD's own
      // integer id (rid) when rec.customer_id/cust_code was empty. That id is
      // meaningless to /api/customers/:id/profile (it's a records.id, not a
      // customers.id), so it always 404'd. Confirmed live: "bank" section
      // rows (Cash Withdrawal/Deposit to a bank account — no customer
      // involved at all) and a batch of legacy PDF-Sync membership rows
      // (imported with no aadhar/mobile either, so there's no reliable way
      // to match them to a customer row) both have customer_id/cust_code
      // genuinely empty. Rather than guess with the wrong id and fail after
      // a click, skip the button for rows with no real link — a disabled,
      // explained state instead of a false promise of a profile that can't
      // be resolved.
      const profileKey = rec.customer_id || rec.cust_code || null;

      const btn = document.createElement("button");
      btn.className = "sb sb-360";
      btn.textContent = "👤";
      if (!profileKey) {
        btn.title = "No linked customer record for this entry";
        btn.disabled = true;
        btn.style.cssText = "background:#f2f2f2;color:#aaa;cursor:not-allowed;";
      } else {
        btn.title = "Customer 360° View";
        btn.style.cssText = "background:#eaf3fb;color:#1a5276;";
        btn.onclick = (e) => {
          e.stopPropagation();
          window.showCustomer360(profileKey);
        };
      }
      // Insert as first button
      const firstBtn = abtns.querySelector("button:first-child");
      if (firstBtn) abtns.insertBefore(btn, firstBtn);
      else abtns.appendChild(btn);
    });
  });
  const start = () => {
    const dbBody = document.getElementById("db-body");
    if (dbBody) observer.observe(dbBody, { childList: true, subtree: true });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();

// ── #6  Day-End Summary ───────────────────────────────────────────────────
(function initDayEnd() {
  // Extend (not replace) the already-patched showPage so date-sync logic is preserved.
  const _origShowPage2 = showPage;
  showPage = function (id) {
    _origShowPage2.call(this, id); // runs all prior patches (date-sync, ledger reload, db reload)
    if (id === "dayend") {
      const el = document.getElementById("dayend-date");
      if (el && !el.value) {
        el.value = new Date().toISOString().split("T")[0];
        loadDayEnd();
      }
    }
    if (id === "mis") {
      const el = document.getElementById("mis-post-date");
      if (el && !el.value) el.value = new Date().toISOString().split("T")[0];
    }
  };
})();

// BUG FIX / FEATURE (Day-End Summary): each of these print/voucher actions
// (generateCashBookPDFFromLedger, generateGLIntVoucherManual, etc.) reads
// module-level ledgerAllRows/cbData, which are only populated for whatever
// date the Transaction Ledger's own #ldg-date last loaded — not necessarily
// the date currently shown on Day-End Summary. Calling them directly from
// here without this sync would silently print/generate for the WRONG date
// whenever they differ. This mirrors what a user does manually today (open
// the Ledger tab, set the date, click the tab's own button) so Day-End
// Summary can offer the same actions without sending them there first.
async function dayendSyncAndRun(fn) {
  const date = window._dayendDate;
  if (!date) {
    toast("Load Day-End Summary first", "err");
    return;
  }
  const ldgDateEl = document.getElementById("ldg-date");
  if (ldgDateEl) ldgDateEl.value = date;
  await loadLedger();
  await fn();
}

async function loadDayEnd() {
  const dateEl = document.getElementById("dayend-date");
  const date = dateEl ? dateEl.value : new Date().toISOString().split("T")[0];
  const content = document.getElementById("dayend-content");
  if (!content) return;
  content.innerHTML =
    '<div style="color:#aaa;text-align:center;padding:20px;">Loading…</div>';
  try {
    const [summary, cashbook] = await Promise.all([
      fetch(`${API_BASE}/reports/daily-summary?date=${date}`, {
        headers: { 'x-auth-token': localStorage.getItem('jju_token') || '' }
      }).then((r) =>
        r.json(),
      ),
      fetch(`${CB_API}?date_from=${date}&date_to=${date}&limit=500`)
        .then((r) => r.json())
        .catch(() => ({ entries: [] })),
    ]);
    const fmt = (n) => "₹ " + (Number(n) || 0).toLocaleString("en-IN");
    const fmtD = (d) =>
      new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    const cb = summary.cashbook || {};
    const secs = summary.sections || [];

    const secRows = secs
      .map(
        (s) =>
          `<tr style="border-bottom:1px solid #eee;">
        <td style="padding:6px 10px;font-weight:600;">${s.section}</td>
        <td style="padding:6px 10px;color:#27ae60;text-align:center;">${s.opened || 0}</td>
        <td style="padding:6px 10px;color:#c0392b;text-align:center;">${s.closed || 0}</td>
      </tr>`,
      )
      .join("");

    const entries = cashbook.entries || [];
    const cbTotal = { in: 0, out: 0 };
    entries.forEach((e) => {
      if (e.tx_type === "credit") cbTotal.in += parseFloat(e.amount || 0);
      else cbTotal.out += parseFloat(e.amount || 0);
    });

    // Bank Transfer transactions for this date — same allowlist the Ledger's
    // Bank TRF tab and voucher generator use (see isBankTRFRow). Stashed on
    // window so the "Generate Bank TRF Vouchers" button below can hand them
    // straight to generateBankTRFVoucherForDate() without re-fetching.
    const bankRows = entries.filter(
      (r) => isBankTRFRow(r) && Number(r.amount) > 0,
    );
    const bankTotal = { cr: 0, db: 0 };
    bankRows.forEach((r) => {
      const amt = parseFloat(r.amount) || 0;
      if ((r.tx_type || "").trim() === "Credit") bankTotal.cr += amt;
      else bankTotal.db += amt;
    });
    window._dayendDate = date;
    window._dayendBankRows = bankRows;

    content.innerHTML = `
      <div id="dayend-printable">
        <div style="text-align:center;margin-bottom:14px;">
          <div style="font-weight:800;font-size:13pt;">JJU Bank — Day-End Summary</div>
          <div style="font-size:10pt;color:#555;">${fmtD(date)}</div>
        </div>

        <!-- Quick Print / Voucher Actions — every ledger sub-tab's own
             print/voucher button, gathered here so a user doesn't have to
             open each tab individually just to print the day's paperwork. -->
        <div style="background:#fff;border:1px solid #eee;border-radius:9px;padding:10px 12px;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <span style="font-size:9px;color:#777;text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-right:4px;">🖨️ Quick Print:</span>
          <button onclick="dayendSyncAndRun(() => generateCashBookPDFFromLedger())"
            style="background:#1a3a5c;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:9.5pt;font-weight:700;white-space:nowrap">
            🧾 Print Cash Book
          </button>
          <button onclick="dayendSyncAndRun(generateGLIntVoucherManual)"
            style="background:#1a3a5c;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:9.5pt;font-weight:700;white-space:nowrap">
            🥇 GL-83 Int Voucher
          </button>
          <button onclick="dayendSyncAndRun(generateFDODIntVoucherManual)"
            style="background:#2b6cb0;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:9.5pt;font-weight:700;white-space:nowrap">
            📈 FD-OD Int Voucher
          </button>
          <button onclick="generateBankTRFVoucherForDate(window._dayendDate, window._dayendBankRows)"
            style="background:#1a365d;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:9.5pt;font-weight:700;white-space:nowrap">
            🏦 Bank TRF Vouchers
          </button>
          <button onclick="dayendSyncAndRun(generateVouchersPDFFromLedger)"
            style="background:#553c9a;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:9.5pt;font-weight:700;white-space:nowrap">
            📋 Covering Vouchers
          </button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
          <div style="background:#eafaf1;border-radius:9px;padding:12px;text-align:center;">
            <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Total Cash In</div>
            <div style="font-weight:800;font-size:14pt;color:#1e8449;">${fmt(cb.total_in || cbTotal.in)}</div>
          </div>
          <div style="background:#fdedec;border-radius:9px;padding:12px;text-align:center;">
            <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Total Cash Out</div>
            <div style="font-weight:800;font-size:14pt;color:#c0392b;">${fmt(cb.total_out || cbTotal.out)}</div>
          </div>
          <div style="background:#eaf3fb;border-radius:9px;padding:12px;text-align:center;">
            <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Net Position</div>
            <div style="font-weight:800;font-size:14pt;color:#1a5276;">${fmt((cb.total_in || cbTotal.in) - (cb.total_out || cbTotal.out))}</div>
          </div>
          <div style="background:#fef9e7;border-radius:9px;padding:12px;text-align:center;">
            <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Cashbook Entries</div>
            <div style="font-weight:800;font-size:14pt;color:#7d6608;">${cb.entries || entries.length}</div>
          </div>
        </div>

        <div style="background:#fff;border:1px solid #eee;border-radius:9px;overflow:hidden;margin-bottom:16px;">
          <div style="background:#1a3a5c;color:#fff;padding:9px 14px;font-weight:700;font-size:10pt;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <span>🏦 Bank Transactions (Transfer)</span>
            <button onclick="generateBankTRFVoucherForDate(window._dayendDate, window._dayendBankRows)"
              style="background:#fff;color:#1a3a5c;border:none;border-radius:5px;padding:4px 11px;cursor:pointer;font-size:9.5pt;font-weight:700;white-space:nowrap">
              📄 Generate Bank TRF Vouchers
            </button>
          </div>
          ${
            bankRows.length
              ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;text-align:center;">
            <div style="padding:10px;border-right:1px solid #eee;">
              <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Credit</div>
              <div style="font-weight:800;font-size:12pt;color:#1e8449;">${fmt(bankTotal.cr)}</div>
            </div>
            <div style="padding:10px;border-right:1px solid #eee;">
              <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Debit</div>
              <div style="font-weight:800;font-size:12pt;color:#c0392b;">${fmt(bankTotal.db)}</div>
            </div>
            <div style="padding:10px;">
              <div style="font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Entries</div>
              <div style="font-weight:800;font-size:12pt;color:#1a3a5c;">${bankRows.length}</div>
            </div>
          </div>`
              : '<div style="padding:12px;color:#aaa;font-size:9pt;">No Bank Transfer entries for this date.</div>'
          }
        </div>

        <div style="background:#fff;border:1px solid #eee;border-radius:9px;overflow:hidden;margin-bottom:16px;">
          <div style="background:#1a3a5c;color:#fff;padding:9px 14px;font-weight:700;font-size:10pt;">📂 Records by Section</div>
          ${
            secs.length
              ? `<table style="width:100%;border-collapse:collapse;font-size:10pt;">
            <thead><tr style="background:#f5f5f5;">
              <th style="padding:7px 10px;text-align:left;font-size:9px;color:#777;text-transform:uppercase;">Section</th>
              <th style="padding:7px 10px;text-align:center;font-size:9px;color:#27ae60;text-transform:uppercase;">Opened</th>
              <th style="padding:7px 10px;text-align:center;font-size:9px;color:#c0392b;text-transform:uppercase;">Closed</th>
            </tr></thead>
            <tbody>${secRows}</tbody>
          </table>`
              : '<div style="padding:12px;color:#aaa;font-size:9pt;">No records for this date.</div>'
          }
        </div>

        ${
          entries.length
            ? `
        <div style="background:#fff;border:1px solid #eee;border-radius:9px;overflow:hidden;">
          <div style="background:#1a3a5c;color:#fff;padding:9px 14px;font-weight:700;font-size:10pt;">📒 Cashbook Entries (${entries.length})</div>
          <table style="width:100%;border-collapse:collapse;font-size:9.5pt;">
            <thead><tr style="background:#f5f5f5;">
              <th style="padding:6px 10px;text-align:left;font-size:9px;color:#777;text-transform:uppercase;">Task</th>
              <th style="padding:6px 10px;text-align:right;font-size:9px;color:#777;text-transform:uppercase;">Amount</th>
              <th style="padding:6px 10px;text-align:center;font-size:9px;color:#777;text-transform:uppercase;">Type</th>
            </tr></thead>
            <tbody id="dayend-entries-tbody">${entries
              .map(
                (e) => `<tr style="border-bottom:1px solid #f0f0f0;">
              <td style="padding:5px 10px;">${e.task || "—"}</td>
              <td style="padding:5px 10px;text-align:right;font-weight:600;">${fmt(e.amount)}</td>
              <td style="padding:5px 10px;text-align:center;">${
                e.tx_type === "credit"
                  ? '<span style="background:#eafaf1;color:#1e8449;border-radius:4px;padding:1px 7px;font-size:9px;font-weight:700;">IN</span>'
                  : '<span style="background:#fdedec;color:#c0392b;border-radius:4px;padding:1px 7px;font-size:9px;font-weight:700;">OUT</span>'
              }</td>
            </tr>`,
              )
              .join("")}</tbody>
          </table>
        </div>`
            : ""
        }
      </div>`;
  } catch (e) {
    content.innerHTML = `<div style="color:#c0392b;padding:16px;">Error: ${e.message}</div>`;
  }
}

// ── Denomination recalc ───────────────────────────────────────────────────────
window._recalcDenom = function () {
  let grand = 0;
  document.querySelectorAll(".denom-inp").forEach((inp) => {
    const d = parseInt(inp.dataset.denom) || 0;
    const n = parseInt(inp.value) || 0;
    const tot = d * n;
    grand += tot;
    const cell = document.getElementById("denom-tot-" + d);
    if (cell) cell.textContent = tot > 0 ? "₹ " + tot.toLocaleString("en-IN") : "—";
  });
  const grandEl = document.getElementById("denom-grand-total");
  if (grandEl) grandEl.textContent = "₹ " + grand.toLocaleString("en-IN");
  const row = document.getElementById("denom-match-row");
  const msg = document.getElementById("denom-match-msg");
  if (!row || !msg || grand === 0) { if (row) row.style.display = "none"; return; }
  if (cbData) {
    const cashIn  = (cbData.txRows || []).filter((r) => r.mode === "Cash" && r.txType === "Credit").reduce((s, r) => s + r.amount, 0);
    const cashOut = (cbData.txRows || []).filter((r) => r.mode === "Cash" && r.txType === "Debit").reduce((s, r)   => s + r.amount, 0);
    const bookCash = (cbData.opening || 0) + cashIn - cashOut;
    const diff = grand - bookCash;
    row.style.display = "";
    if (Math.abs(diff) < 0.01) {
      row.style.background = "#d4edda";
      msg.style.color = "#155724";
      msg.textContent = "✅ Physical cash matches cash book closing balance ₹ " + bookCash.toLocaleString("en-IN");
    } else {
      row.style.background = "#fff3cd";
      msg.style.color = "#856404";
      msg.textContent = "⚠️ Mismatch: physical ₹ " + grand.toLocaleString("en-IN") + " vs book ₹ " + bookCash.toLocaleString("en-IN") + " (diff " + (diff > 0 ? "+" : "") + "₹ " + Math.abs(diff).toLocaleString("en-IN") + ")";
    }
  }
};

function printDayEnd() {
  const el = document.getElementById("dayend-printable");
  if (!el) return;
  const html = `<html><head><title>Day-End Summary</title>
    <style>body{font-family:Nunito,sans-serif;padding:20px;font-size:11pt;}table{width:100%;border-collapse:collapse;}th,td{padding:7px 10px;border:1px solid #ddd;}th{background:#f5f5f5;}
    @media print{body{padding:0;}}</style></head><body>${el.innerHTML}</body></html>`;
  openPDFSheet('html', html, 'Day-End Summary');
}

// ── #7  Duplicate Customer Detection (Aadhar/Mobile blur) ─────────────────
// We inject a MutationObserver on the form-card to attach blur handlers
// to aadhar and mobile fields whenever the form is rebuilt.
(function initDuplicateDetection() {
  let _dupTimer = null;

  async function checkDuplicate(field, value) {
    if (!value || value.length < 8) return;
    // Show spinner hint
    const hintId = field === "aadhar" ? "dup-aadhar-hint" : "dup-mobile-hint";
    let hint = document.getElementById(hintId);
    if (!hint) return;
    hint.innerHTML =
      '<span style="color:#aaa;font-size:10px;">Checking…</span>';
    try {
      const param =
        field === "aadhar"
          ? `aadhar=${encodeURIComponent(value)}`
          : `mobile=${encodeURIComponent(value)}`;
      const data = await fetch(`${API}/customers/search?${param}`).then((r) =>
        r.json(),
      );
      const matches = data.customers || data || [];
      if (!matches.length) {
        hint.innerHTML =
          '<span style="color:#27ae60;font-size:10px;font-weight:700;">✅ No existing customer found</span>';
        return;
      }
      // BUG FIX: customer name and ID came from the server and were interpolated
      // directly into innerHTML — a stored XSS vector. Use textContent for all
      // server-supplied values; build the DOM with createElement/appendChild.
      hint.innerHTML = ''; // clear first
      const wrapper = document.createElement('span');
      wrapper.style.cssText = 'color:#c0392b;font-size:10px;font-weight:700;';

      const label = document.createTextNode(
        `⚠️ Existing customer(s) with same ${field}: `
      );
      wrapper.appendChild(label);

      matches.slice(0, 3).forEach((m, i) => {
        if (i > 0) wrapper.appendChild(document.createTextNode(', '));
        const strong = document.createElement('strong');
        strong.textContent = m.name || '—';
        wrapper.appendChild(strong);
      });

      // BUG FIX: matches[0].id was injected into an inline onclick attribute —
      // another XSS vector. Attach handler via addEventListener instead.
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.textContent = 'View 360°';
      viewBtn.style.cssText =
        'font-size:9px;background:#1a5276;color:#fff;border:none;border-radius:4px;' +
        'padding:2px 7px;cursor:pointer;margin-left:6px;';
      const firstId = matches[0].id;
      viewBtn.addEventListener('click', () => window.showCustomer360(firstId));
      wrapper.appendChild(viewBtn);

      hint.appendChild(wrapper);
    } catch (_) {
      hint.innerHTML = "";
    }
  }

  function attachDupHandlers() {
    ["aadhar", "mobile"].forEach((field) => {
      const input = document.getElementById(`f-${field}`);
      if (!input || input.dataset.dupAttached) return;
      input.dataset.dupAttached = "1";

      // Create hint div if it doesn't exist
      const hintId = `dup-${field}-hint`;
      if (!document.getElementById(hintId)) {
        const hint = document.createElement("div");
        hint.id = hintId;
        hint.style.cssText =
          "grid-column:1/-1;margin:-10px 0 4px;padding:0 2px;font-size:10px;";
        input.closest(".field")?.insertAdjacentElement("afterend", hint);
      }

      input.addEventListener("blur", () => {
        clearTimeout(_dupTimer);
        _dupTimer = setTimeout(
          () => checkDuplicate(field, input.value.trim()),
          300,
        );
      });
    });
  }

  // Watch form-card for rebuilds
  const obs = new MutationObserver(attachDupHandlers);
  const start = () => {
    const card = document.getElementById("form-card");
    if (card) {
      obs.observe(card, { childList: true, subtree: true });
      attachDupHandlers(); // initial
    }
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();

// ── #9  Bulk MIS Interest Posting ─────────────────────────────────────────
async function loadMISDue() {
  const dateEl = document.getElementById("mis-post-date");
  const date = dateEl ? dateEl.value : new Date().toISOString().split("T")[0];
  const list = document.getElementById("mis-due-list");
  const area = document.getElementById("mis-post-area");
  if (!list) return;
  list.innerHTML =
    '<div style="color:#aaa;font-size:9pt;padding:10px;">Loading…</div>';
  if (area) area.style.display = "none";
  try {
    const rows = await fetch(`${API_BASE}/mis-due`).then((r) => r.json());
    if (!rows.length) {
      list.innerHTML =
        '<div style="color:#aaa;font-size:9pt;padding:10px;">No active MIS accounts with a payment day configured.</div>';
      return;
    }
    const today = new Date(date).getDate();
    const fmt = (n) => (n ? "₹ " + Number(n).toLocaleString("en-IN") : "—");

    // Build static header via innerHTML (no user data), then append rows via DOM
    list.innerHTML = `
      <div style="font-size:9pt;color:#555;margin-bottom:6px;">
        ${rows.length} active MIS account(s).
        <span style="color:#27ae60;font-weight:700;">${rows.filter((r) => r.due_today).length} due today (day ${today}).</span>
      </div>
      <div style="background:#fff;border:1px solid #eee;border-radius:9px;overflow:hidden;max-height:340px;overflow-y:auto;overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="width:100%;min-width:560px;border-collapse:collapse;font-size:9.5pt;">
          <thead style="position:sticky;top:0;background:#1a3a5c;color:#fff;">
            <tr>
              <th style="padding:7px 10px;text-align:center;width:36px;">
                <input type="checkbox" id="mis-chk-all" onchange="toggleAllMIS(this.checked)" checked>
              </th>
              <th style="padding:7px 10px;text-align:left;">Customer</th>
              <th style="padding:7px 10px;text-align:left;">MIS Acc</th>
              <th style="padding:7px 10px;text-align:right;">Principal</th>
              <th style="padding:7px 10px;text-align:right;">Rate</th>
              <th style="padding:7px 10px;text-align:right;">Monthly Interest</th>
              <th style="padding:7px 10px;text-align:center;">Pay Day</th>
            </tr>
          </thead>
          <tbody id="mis-due-tbody"></tbody>
        </table>
      </div>`;

    const tbody = document.getElementById("mis-due-tbody");
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.style.cssText = "border-bottom:1px solid #f0f0f0;" + (r.due_today ? "background:#eafaf1;" : "");

      // Checkbox cell
      const tdChk = document.createElement("td");
      tdChk.style.cssText = "padding:6px 10px;text-align:center;";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "mis-row-chk";
      chk.dataset.id = r.id;
      chk.checked = !!r.due_today;
      tdChk.appendChild(chk);
      tr.appendChild(tdChk);

      // Customer cell
      const tdName = document.createElement("td");
      tdName.style.cssText = "padding:6px 10px;font-weight:600;";
      tdName.textContent = r.name || "—";
      if (r.mobile) {
        const br = document.createElement("br");
        const mob = document.createElement("span");
        mob.style.cssText = "font-size:8.5pt;color:#888;";
        mob.textContent = r.mobile;
        tdName.appendChild(br);
        tdName.appendChild(mob);
      }
      tr.appendChild(tdName);

      // Acc No cell
      const tdAcc = document.createElement("td");
      tdAcc.style.cssText = "padding:6px 10px;font-family:monospace;font-size:9pt;";
      tdAcc.textContent = r.mis_acc_no || r.account_no || "—";
      tr.appendChild(tdAcc);

      // Principal
      const tdPrinc = document.createElement("td");
      tdPrinc.style.cssText = "padding:6px 10px;text-align:right;";
      tdPrinc.textContent = fmt(r.principal);
      tr.appendChild(tdPrinc);

      // Rate
      const tdRate = document.createElement("td");
      tdRate.style.cssText = "padding:6px 10px;text-align:right;";
      tdRate.textContent = r.rate ? r.rate + "%" : "—";
      tr.appendChild(tdRate);

      // Interest
      const tdInt = document.createElement("td");
      tdInt.style.cssText = "padding:6px 10px;text-align:right;font-weight:700;color:#1e8449;";
      tdInt.textContent = fmt(r.interest_amount);
      tr.appendChild(tdInt);

      // Pay Day
      const tdDay = document.createElement("td");
      tdDay.style.cssText = "padding:6px 10px;text-align:center;";
      if (r.payment_day) {
        tdDay.textContent = "Day " + r.payment_day;
        if (r.due_today) {
          const badge = document.createElement("span");
          badge.style.cssText = "background:#27ae60;color:#fff;border-radius:3px;padding:0 4px;font-size:8px;margin-left:3px;";
          badge.textContent = "TODAY";
          tdDay.appendChild(badge);
        }
      } else {
        tdDay.textContent = "—";
      }
      tr.appendChild(tdDay);

      tbody.appendChild(tr);
    });

    if (area) area.style.display = "";
    document.getElementById("mis-post-result")?.replaceChildren();
  } catch (e) {
    const errDiv = document.createElement("div");
    errDiv.style.cssText = "color:#c0392b;font-size:9pt;padding:10px;";
    errDiv.textContent = "Error: " + e.message;
    list.innerHTML = "";
    list.appendChild(errDiv);
  }
}

function toggleAllMIS(checked) {
  document
    .querySelectorAll(".mis-row-chk")
    .forEach((c) => (c.checked = checked));
  const all = document.getElementById("mis-chk-all");
  if (all) all.checked = checked;
}

async function postMISInterest() {
  const dateEl = document.getElementById("mis-post-date");
  const date = dateEl ? dateEl.value : new Date().toISOString().split("T")[0];
  const checked = [...document.querySelectorAll(".mis-row-chk:checked")].map(
    (c) => parseInt(c.dataset.id, 10),
  );
  const result = document.getElementById("mis-post-result");
  if (!checked.length) {
    if (result)
      result.innerHTML =
        '<span style="color:#c0392b;font-size:10px;">No accounts selected.</span>';
    return;
  }
  if (
    !confirm(`Post MIS interest for ${checked.length} account(s) on ${date}?`)
  )
    return;
  if (result)
    result.innerHTML =
      '<span style="color:#aaa;font-size:10px;">Posting…</span>';
  try {
    const res = await fetch(`${API_BASE}/mis-bulk-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", 'x-auth-token': localStorage.getItem('jju_token') || '' },
      body: JSON.stringify({
        record_ids: checked,
        date,
        remarks: "Bulk MIS Interest Posting",
      }),
    });
    const data = await res.json();
    const fmt = (n) => "₹ " + Number(n).toLocaleString("en-IN");
    if (data.ok || data.posted) {
      const total = (data.results || []).reduce(
        (s, r) => s + (r.interest || 0),
        0,
      );
      result.innerHTML = "";
      const box = document.createElement("div");
      box.style.cssText = "background:#eafaf1;border:1px solid #a9dfbf;border-radius:7px;padding:10px 14px;font-size:9.5pt;";
      const strong = document.createElement("strong");
      strong.style.color = "#1e8449";
      strong.textContent = "✅ Posted " + data.posted + " entries — Total: " + fmt(total);
      box.appendChild(strong);
      if (data.errors && data.errors.length) {
        const errDiv = document.createElement("div");
        errDiv.style.cssText = "color:#c0392b;margin-top:4px;font-size:9pt;";
        errDiv.textContent = "⚠️ " + data.errors.length + " error(s): " + data.errors.map((e) => e.error).join(", ");
        box.appendChild(errDiv);
      }
      result.appendChild(box);
    } else {
      const errDiv = document.createElement("div");
      errDiv.style.cssText = "color:#c0392b;font-size:9.5pt;";
      errDiv.textContent = "Errors: " + ((data.errors || []).map((e) => e.error).join(", ") || "Unknown error");
      result.innerHTML = "";
      result.appendChild(errDiv);
    }
  } catch (e) {
    if (result) {
      const errDiv = document.createElement("div");
      errDiv.style.cssText = "color:#c0392b;font-size:9.5pt;";
      errDiv.textContent = "Error: " + e.message;
      result.innerHTML = "";
      result.appendChild(errDiv);
    }
  }
}


// ═══════════════════════════════════════════════════════════════
//  ACCOUNT SEARCH — search Gold Loan, Fixed Deposit, Saving Account,
//  FD-OD Loan, and Shares by name / mobile / Aadhar / account number.
//  Shows live balance for every match (plus accrued interest and a
//  "Total to Collect" figure for Gold Loan and OD Loan), and lets staff
//  close any active case directly from the results without needing the
//  exact case number first.
//
//  Replaces two older, narrower widgets that used to cover this ground:
//   - the dashboard's Gold-Loan-only "🔍 Gold Loan Search" panel
//   - "Quick Close" (Gold + FD + OD only, no balances, no Saving/Shares)
//
//  Adds: floating 🔍 button + search modal injected at runtime.
// ═══════════════════════════════════════════════════════════════
(function initAccountSearch() {
  'use strict';

  // One entry per account type. `endpoint` is one of the /api/combined/*
  // routes — all five accept the same ?status=&search=&limit=&offset=
  // params and return a flat array of rows (see combined.routes.js).
  var SECTIONS = [
    { key: 'gold',   label: 'Gold Loan',      shortLabel: 'Gold',   badge: 'qc-badge-gold',   endpoint: '/api/combined/gold-loans' },
    { key: 'fd',     label: 'Fixed Deposit',  shortLabel: 'FD',     badge: 'qc-badge-fd',     endpoint: '/api/combined/fd-accounts' },
    { key: 'saving', label: 'Saving Account', shortLabel: 'Saving', badge: 'qc-badge-saving', endpoint: '/api/combined/saving-accounts' },
    { key: 'od',     label: 'OD Loan',        shortLabel: 'OD',     badge: 'qc-badge-od',     endpoint: '/api/combined/od-loans' },
    { key: 'shares', label: 'Shares',         shortLabel: 'Shares', badge: 'qc-badge-shares', endpoint: '/api/combined/share-accounts' },
  ];

  // ── Inject styles ──────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = `
    #qc-fab {
      position: fixed;
      bottom: 24px;
      right: 22px;
      z-index: 8800;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1a3a5c 0%, #21618c 100%);
      color: #fff;
      font-size: 22px;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(26,58,92,.55);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform .15s, box-shadow .15s;
    }
    #qc-fab:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(26,58,92,.7); }
    #qc-fab-label {
      position: fixed;
      bottom: 84px;
      right: 14px;
      z-index: 8800;
      background: #21618c;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .4px;
      border-radius: 6px;
      padding: 4px 8px;
      pointer-events: none;
      white-space: nowrap;
      opacity: 0;
      transition: opacity .2s;
    }
    #qc-fab:hover + #qc-fab-label { opacity: 1; }

    #qc-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.55);
      z-index: 8900;
      align-items: center;
      justify-content: center;
    }
    #qc-modal {
      background: #fff;
      border-radius: 16px;
      width: 640px;
      max-width: 96vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 12px 48px rgba(0,0,0,.35);
      overflow: hidden;
    }
    #qc-header {
      background: linear-gradient(135deg, #1a3a5c 0%, #21618c 100%);
      color: #fff;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    #qc-search-wrap {
      display: flex;
      gap: 8px;
      flex: 1;
      position: relative;
    }
    /* Roomier suggestions dropdown — bigger rows and text so each match is
       an easy, unambiguous tap target instead of a dense list where two
       adjacent names are hard to tell apart or hit precisely on a phone. */
    #qc-suggest {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: 6px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.3);
      max-height: 340px;
      overflow-y: auto;
      overscroll-behavior: contain;
      z-index: 30;
    }
    .qc-suggest-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 52px;
      padding: 14px 16px;
      cursor: pointer;
      border-bottom: 1px solid #eee;
      color: #222;
    }
    .qc-suggest-item:last-child { border-bottom: none; }
    .qc-suggest-item:hover, .qc-suggest-item.qc-suggest-active { background: #eef4fa; }
    .qc-suggest-left { min-width: 0; overflow: hidden; }
    .qc-suggest-name { font-weight: 800; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .qc-suggest-meta { font-size: 12.5px; color: #888; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .qc-suggest-right { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
    .qc-suggest-empty, .qc-suggest-loading {
      padding: 16px 14px;
      font-size: 13px;
      color: #999;
      text-align: center;
    }
    #qc-q {
      flex: 1;
      min-height: 46px;
      padding: 12px 16px;
      border-radius: 10px;
      border: none;
      font-size: 16px;
      outline: none;
    }
    #qc-btn-search {
      background: #c0392b;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 0 22px;
      min-height: 46px;
      font-weight: 700;
      font-size: 14.5px;
      cursor: pointer;
      white-space: nowrap;
    }
    #qc-btn-search:hover { background: #a93226; }
    #qc-close-btn {
      background: rgba(255,255,255,.15);
      border: none;
      border-radius: 10px;
      color: #fff;
      width: 46px;
      height: 46px;
      font-size: 19px;
      cursor: pointer;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #qc-body {
      overflow-y: auto;
      padding: 16px 18px;
      flex: 1;
    }
    #qc-status {
      font-size: 13.5px;
      color: #888;
      text-align: center;
      padding: 12px 0;
    }
    #qc-filter-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px 14px;
      background: #f4f6f8;
      border-bottom: 1px solid #e2e2e2;
      flex-shrink: 0;
    }
    .qc-filter-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      flex-shrink: 0;
      font-size: 13px;
      font-weight: 700;
      padding: 7px 15px;
      border-radius: 999px;
      border: 1px solid #c7d0d8;
      background: #fff;
      color: #7a8792;
      cursor: pointer;
      user-select: none;
      transition: background .12s, color .12s, border-color .12s;
    }
    .qc-filter-chip.qc-filter-active {
      background: #21618c;
      border-color: #21618c;
      color: #fff;
    }
    .qc-filter-chip.qc-filter-shortcut {
      border-style: dashed;
      margin-left: auto;
    }
    .qc-filter-chip.qc-filter-shortcut.qc-filter-active {
      background: #1a7a3c;
      border-color: #1a7a3c;
      border-style: solid;
    }
    /* One card per matching account. Roomier than before — enough padding
       and font size that the name, numbers, and Close button are each easy
       to read and tap on a phone, while still fitting several results in
       view at once on desktop. */
    .qc-card {
      border: 1px solid #e2e2e2;
      border-radius: 10px;
      margin-bottom: 10px;
      padding: 12px 14px;
      transition: box-shadow .15s;
    }
    .qc-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.10); }
    .qc-row1 { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .qc-row1-left { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1 1 auto; overflow: hidden; }
    .qc-name { font-weight: 800; font-size: 15px; color: #1a2e1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .qc-meta { font-size: 12.5px; color: #888; white-space: nowrap; flex: 0 0 auto; }
    .qc-row1-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .qc-badge {
      font-size: 10.5px;
      font-weight: 700;
      border-radius: 5px;
      padding: 3px 8px;
      white-space: nowrap;
    }
    .qc-badge-gold   { background: #fef9e7; color: #b7770d; border: 1px solid #f0d060; }
    .qc-badge-fd     { background: #eaf4fb; color: #1a6fa0; border: 1px solid #a9d4ee; }
    .qc-badge-saving { background: #eafaf1; color: #1e8449; border: 1px solid #a3e4c1; }
    .qc-badge-od     { background: #fdf2f8; color: #8e44ad; border: 1px solid #d7aef0; }
    .qc-badge-shares { background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe; }
    .qc-row2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-top: 6px; font-size: 12.5px; line-height: 1.4; }
    .qc-chip { color: #666; white-space: nowrap; }
    .qc-chip-amt { font-weight: 800; color: #1a5276; }
    .qc-chip-interest { font-weight: 700; color: #8e44ad; }
    .qc-chip-total { font-weight: 800; color: #1a7a4a; }
    .qc-manual-note { margin-top: 4px; font-size: 11px; color: #999; font-style: italic; }
    .qc-btn-close {
      background: linear-gradient(135deg, #c0392b 0%, #922b21 100%);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 9px 16px;
      min-height: 38px;
      font-weight: 700;
      font-size: 12.5px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
      transition: opacity .15s;
    }
    .qc-btn-close:hover { opacity: .88; }
    /* Mobile: go full-screen instead of a floating card, wrap the filter
       chips onto multiple lines instead of a thumb-scrolled strip, and
       size every tap target (search box, Search/Close buttons, chips,
       suggestion rows, card Close buttons) to a comfortable touch size. */
    @media (max-width: 600px) {
      #qc-overlay { align-items: flex-end; }
      #qc-modal {
        width: 100vw;
        max-width: 100vw;
        height: 100vh;
        max-height: 100vh;
        border-radius: 0;
      }
      #qc-header { padding: 12px; gap: 8px; }
      #qc-search-wrap { gap: 6px; }
      #qc-q { padding: 12px 14px; }
      #qc-btn-search { padding: 0 16px; }
      #qc-suggest { max-height: 50vh; }
      #qc-filter-row { padding: 10px 12px; }
      .qc-filter-chip { font-size: 13.5px; padding: 9px 16px; }
      #qc-body { padding: 14px; }
      .qc-card { padding: 14px; }
      .qc-name, .qc-suggest-name { font-size: 15.5px; }
      .qc-btn-close { padding: 10px 16px; font-size: 13px; }
    }
  `;
  document.head.appendChild(style);

  // ── Search-scope filter state ───────────────────────────────
  // Which SECTIONS keys are currently included in a search. Defaults to
  // just the two loan types (Gold Loan + OD Loan, the ones with live
  // interest/closing-amount calculation) since that's the common case;
  // the filter chips let the user widen this to any/all of the five types.
  var LOANS_ONLY_KEYS = ['gold', 'od'];
  var activeKeys = LOANS_ONLY_KEYS.slice();

  function isLoansOnlyActive() {
    return activeKeys.length === LOANS_ONLY_KEYS.length &&
      LOANS_ONLY_KEYS.every(function(k) { return activeKeys.indexOf(k) !== -1; });
  }

  function renderFilterChips() {
    var row = document.getElementById('qc-filter-row');
    if (!row) return;
    row.innerHTML = '';
    SECTIONS.forEach(function(sect) {
      var chip = document.createElement('span');
      chip.className = 'qc-filter-chip' + (activeKeys.indexOf(sect.key) !== -1 ? ' qc-filter-active' : '');
      chip.textContent = sect.shortLabel;
      chip.dataset.key = sect.key;
      chip.addEventListener('click', function() {
        var idx = activeKeys.indexOf(sect.key);
        if (idx !== -1) {
          if (activeKeys.length === 1) return; // keep at least one type active
          activeKeys.splice(idx, 1);
        } else {
          activeKeys.push(sect.key);
        }
        renderFilterChips();
      });
      row.appendChild(chip);
    });
    var shortcut = document.createElement('span');
    shortcut.className = 'qc-filter-chip qc-filter-shortcut' + (isLoansOnlyActive() ? ' qc-filter-active' : '');
    shortcut.textContent = '💰 Loans Only';
    shortcut.title = 'Show only Gold Loan + OD Loan (the types with live interest calculation)';
    shortcut.addEventListener('click', function() {
      activeKeys = isLoansOnlyActive() ? SECTIONS.map(function(s) { return s.key; }) : LOANS_ONLY_KEYS.slice();
      renderFilterChips();
    });
    row.appendChild(shortcut);
  }

  // ── DOM injection ──────────────────────────────────────────
  function inject() {
    if (document.getElementById('qc-fab')) return;

    // Floating Action Button
    var fab = document.createElement('button');
    fab.id = 'qc-fab';
    fab.title = 'Account Search';
    fab.innerHTML = '🔍';
    fab.addEventListener('click', openQC);
    document.body.appendChild(fab);

    var lbl = document.createElement('div');
    lbl.id = 'qc-fab-label';
    lbl.textContent = 'Account Search';
    document.body.appendChild(lbl);

    // Modal overlay
    var overlay = document.createElement('div');
    overlay.id = 'qc-overlay';
    overlay.innerHTML = `
      <div id="qc-modal" role="dialog" aria-modal="true" aria-label="Account Search">
        <div id="qc-header">
          <div id="qc-search-wrap">
            <input id="qc-q" type="text" placeholder="Search by name, mobile, Aadhar, or account number…" autocomplete="off" />
            <button id="qc-btn-search">Search</button>
            <div id="qc-suggest"></div>
          </div>
          <button id="qc-close-btn" title="Close">✕</button>
        </div>
        <div id="qc-filter-row"></div>
        <div id="qc-body">
          <div id="qc-status">Type a name, mobile number, Aadhar, or account number and press Search.</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeQC(); });
    document.getElementById('qc-close-btn').addEventListener('click', closeQC);
    document.getElementById('qc-btn-search').addEventListener('click', function() {
      hideSuggestions();
      doSearch();
    });
    var qInput = document.getElementById('qc-q');
    qInput.addEventListener('input', function() {
      scheduleSuggest(qInput.value);
    });
    qInput.addEventListener('keydown', function(e) {
      var box = document.getElementById('qc-suggest');
      var open = box && box.style.display !== 'none' && box.children.length;
      if (e.key === 'ArrowDown' && open) {
        e.preventDefault();
        moveSuggestActive(1);
        return;
      }
      if (e.key === 'ArrowUp' && open) {
        e.preventDefault();
        moveSuggestActive(-1);
        return;
      }
      if (e.key === 'Enter') {
        var active = open ? box.querySelector('.qc-suggest-active') : null;
        if (active) {
          e.preventDefault();
          active.click();
          return;
        }
        hideSuggestions();
        doSearch();
        return;
      }
      if (e.key === 'Escape' && open) {
        hideSuggestions();
      }
    });
    // A click anywhere outside the search box / dropdown closes the dropdown
    // (but not the whole modal — only the backdrop click in the listener
    // above does that).
    document.addEventListener('click', function(e) {
      var wrap = document.getElementById('qc-search-wrap');
      if (wrap && !wrap.contains(e.target)) hideSuggestions();
    });
    renderFilterChips();
  }

  function openQC() {
    inject();
    document.getElementById('qc-overlay').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(function() { var q = document.getElementById('qc-q'); if (q) q.focus(); }, 60);
  }

  // FIX: closing the modal used to leave the previous search text, results,
  // and status message sitting there — reopening it (e.g. to look up a
  // different customer) showed stale data until a new search was run.
  // Close now resets everything back to the modal's just-opened state.
  function closeQC() {
    var ov = document.getElementById('qc-overlay');
    if (ov) ov.style.display = 'none';
    document.body.style.overflow = '';
    resetQC();
  }

  function resetQC() {
    var q = document.getElementById('qc-q');
    if (q) q.value = '';
    hideSuggestions();
    var body = document.getElementById('qc-body');
    if (body) body.querySelectorAll('.qc-card').forEach(function(el) { el.remove(); });
    var status = document.getElementById('qc-status');
    if (status) status.textContent = 'Type a name, mobile number, Aadhar, or account number and press Search.';
  }

  // ── Live suggestions (name / mobile / Aadhar / account no) ─────────────
  // Debounced as-you-type lookup, reusing the same /api/combined/* search
  // endpoints as the full search (?search= already matches name, acc_no,
  // cust_code, mobile and Aadhar — see searchClause() in combined.routes.js)
  // but with a small limit and no per-row interest calc, so it's cheap
  // enough to fire on every keystroke pause.
  var _qcSuggestTimer = null;
  var _qcSuggestSeq = 0;

  function scheduleSuggest(raw) {
    clearTimeout(_qcSuggestTimer);
    var q = (raw || '').trim();
    if (q.length < 2) { hideSuggestions(); return; }
    _qcSuggestTimer = setTimeout(function() { fetchSuggestions(q); }, 300);
  }

  function hideSuggestions() {
    var box = document.getElementById('qc-suggest');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }

  function moveSuggestActive(dir) {
    var box = document.getElementById('qc-suggest');
    if (!box) return;
    var items = Array.prototype.slice.call(box.querySelectorAll('.qc-suggest-item'));
    if (!items.length) return;
    var idx = items.findIndex(function(el) { return el.classList.contains('qc-suggest-active'); });
    if (idx !== -1) items[idx].classList.remove('qc-suggest-active');
    idx = idx === -1 ? (dir > 0 ? 0 : items.length - 1) : (idx + dir + items.length) % items.length;
    items[idx].classList.add('qc-suggest-active');
    items[idx].scrollIntoView({ block: 'nearest' });
  }

  async function fetchSuggestions(q) {
    var mySeq = ++_qcSuggestSeq;
    var box = document.getElementById('qc-suggest');
    if (!box) return;
    box.style.display = 'block';
    box.innerHTML = '<div class="qc-suggest-loading">Searching…</div>';

    var token = localStorage.getItem('jju_token') || '';
    var headers = token ? { 'x-auth-token': token } : {};
    var searchSections = SECTIONS.filter(function(sect) { return activeKeys.indexOf(sect.key) !== -1; });

    var allRows = [];
    await Promise.all(searchSections.map(async function(sect) {
      try {
        var url = sect.endpoint + '?status=active&search=' + encodeURIComponent(q) + '&limit=5';
        var r = await fetch(url, { headers: headers });
        if (!r.ok) return;
        var rows = await r.json();
        if (!Array.isArray(rows)) return;
        rows.forEach(function(row) { allRows.push({ row: row, sect: sect }); });
      } catch (e) {}
    }));

    // A newer keystroke started a fresher request while this one was
    // in flight — drop this stale result instead of clobbering the box.
    if (mySeq !== _qcSuggestSeq) return;

    if (!allRows.length) {
      box.innerHTML = '<div class="qc-suggest-empty">No matches for "' + _qcEsc(q) + '"</div>';
      return;
    }

    box.innerHTML = '';
    allRows.slice(0, 20).forEach(function(item) {
      var row = item.row, sect = item.sect;
      var name = row.customer_name || '—';
      var accNo = row.acc_no || '—';
      var metaBits = [];
      if (row.mobile) metaBits.push(row.mobile);
      if (row.aadhar) metaBits.push(row.aadhar);
      var el = document.createElement('div');
      el.className = 'qc-suggest-item';
      el.innerHTML =
        '<div class="qc-suggest-left">' +
          '<div class="qc-suggest-name">' + _qcEsc(name) + '</div>' +
          '<div class="qc-suggest-meta">' + _qcEsc(accNo) + (metaBits.length ? ' · ' + _qcEsc(metaBits.join(' · ')) : '') + '</div>' +
        '</div>' +
        '<div class="qc-suggest-right"><span class="qc-badge ' + sect.badge + '">' + sect.shortLabel + '</span></div>';
      el.addEventListener('click', function() {
        var qInput = document.getElementById('qc-q');
        if (qInput) qInput.value = accNo !== '—' ? accNo : name;
        hideSuggestions();
        doSearch();
      });
      box.appendChild(el);
    });
  }

  // ── Search across Gold + FD + Saving + OD + Shares ─────────
  async function doSearch() {
    var q = (document.getElementById('qc-q') || {}).value || '';
    q = q.trim();
    var status = document.getElementById('qc-status');
    var body   = document.getElementById('qc-body');
    if (!q) { status.textContent = 'Please enter a name, mobile, Aadhar, or account number.'; return; }

    var searchSections = SECTIONS.filter(function(sect) { return activeKeys.indexOf(sect.key) !== -1; });
    var scopeLabel = isLoansOnlyActive()
      ? 'Gold Loan + OD Loan'
      : searchSections.map(function(s) { return s.shortLabel; }).join(', ');

    status.textContent = '🔍 Searching ' + scopeLabel + '…';
    // Remove old cards
    body.querySelectorAll('.qc-card').forEach(function(el) { el.remove(); });

    var token = localStorage.getItem('jju_token') || '';
    var headers = token ? { 'x-auth-token': token } : {};

    try {
      var allRows = [];
      await Promise.all(searchSections.map(async function(sect) {
        try {
          var url = sect.endpoint + '?status=active&search=' + encodeURIComponent(q);
          var r = await fetch(url, { headers: headers });
          if (!r.ok) return;
          var rows = await r.json();
          if (!Array.isArray(rows)) return;
          rows.forEach(function(row) { allRows.push({ row: row, sect: sect }); });
        } catch(e) {}
      }));

      if (!allRows.length) {
        status.textContent = 'No active accounts found for "' + q + '" in ' + scopeLabel + '.';
        return;
      }

      status.textContent = allRows.length + ' account(s) found. Click 🔒 Close to close any case directly.';

      // ── Render cards ──
      var today = new Date().toISOString().split('T')[0];
      await Promise.all(allRows.map(async function(item) {
        var row  = item.row;
        var sect = item.sect;

        var name      = row.customer_name || '—';
        var mobile    = row.mobile || '—';
        var accNo     = row.acc_no || '—';
        var startDate = (row.start_date || '').split('T')[0];
        // Loan sections (Gold/OD) must price off the loan_amount (principal),
        // not the running balance — matches the interest/closing convention
        // used by the real Close flows (see closingLoanAmount/_odPrincipal
        // above, both = d.loan_amount). Non-loan sections (Saving/Shares)
        // have no loan_amount field, so they fall through to balance/
        // fd_amount/share_amount unchanged.
        var principal = parseFloat(
          row.loan_amount != null ? row.loan_amount
            : (row.balance != null ? row.balance
              : (row.fd_amount != null ? row.fd_amount
                : (row.share_amount || 0)))
        ) || 0;

        // Live interest calc — Gold Loan uses the standard 18% rate; OD Loan
        // uses its own recorded rate (od.interest_rate, sourced from the
        // linked record's data, same as the existing OD-closing flow).
        // FD/Saving/Shares show balance only, no accrual calc here.
        var rate = sect.key === 'gold' ? 18
          : (sect.key === 'od' ? (parseFloat(row.interest_rate) || 0) : 0);
        var interest = 0, days = 0, total = principal, calcOk = false, lakhCharge = 0;
        if (rate && principal && startDate) {
          try {
            var ir = await fetch('/api/interest/gold-loan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
              // Gold Loan carries the ₹200-per-₹1,00,000 handling/appraisal
              // charge (folded into `interest` by the backend); OD Loan does not.
              body: JSON.stringify({ principal: principal, rate: rate, from_date: startDate, to_date: today, apply_gold_charge: sect.key === 'gold' })
            });
            var id2 = await ir.json();
            if (!id2.error) {
              interest = parseFloat(id2.interest) || 0;
              days = id2.days || 0;
              total = principal + interest;
              calcOk = true;
              lakhCharge = parseFloat(id2.lakh_charge_amount) || 0;
            }
          } catch(e) {}
        }

        var fmtR = function(n) { return '₹\u00a0' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };

        // Type-specific extra chip (kept to one short phrase, not a labeled row)
        var extraChip = '';
        if (sect.key === 'fd' && row.fd_sub_type) {
          extraChip = _qcEsc(row.fd_sub_type) + (row.end_date ? ' \u00b7 matures ' + row.end_date : '');
        } else if (sect.key === 'shares' && row.num_shares) {
          extraChip = _qcEsc(row.num_shares) + ' shares';
        }

        var card = document.createElement('div');
        card.className = 'qc-card';
        card.innerHTML =
          // Row 1: name + mobile on the left, type badge + close button on the right \u2014
          // everything that identifies "who / which account type / act on it" in one line.
          '<div class="qc-row1">' +
            '<div class="qc-row1-left">' +
              '<span class="qc-name">' + _qcEsc(name) + '</span>' +
              (mobile && mobile !== '\u2014' ? '<span class="qc-meta">' + _qcEsc(mobile) + '</span>' : '') +
            '</div>' +
            '<div class="qc-row1-right">' +
              '<span class="qc-badge ' + sect.badge + '">' + sect.shortLabel + '</span>' +
              (row.record_id
                ? '<button class="qc-btn-close" data-rec-id="' + _qcEsc(row.record_id) + '" data-rec-name="' + _qcEsc(name) + '" data-rec-sect="' + sect.key + '">🔒 Close</button>'
                : '') +
            '</div>' +
          '</div>' +
          // Row 2: all the numbers, as small inline chips instead of a label/value
          // grid \u2014 keeps a card to ~2 lines total instead of ~6.
          '<div class="qc-row2">' +
            '<span class="qc-chip" style="font-family:monospace">' + _qcEsc(accNo) + '</span>' +
            '<span class="qc-chip qc-chip-amt">' + fmtR(principal) + '</span>' +
            (startDate ? '<span class="qc-chip">' + startDate + '</span>' : '') +
            (calcOk ? '<span class="qc-chip">' + days + 'd</span>' : '') +
            (extraChip ? '<span class="qc-chip">' + extraChip + '</span>' : '') +
          '</div>' +
          (!row.record_id ? '<div class="qc-manual-note">No linked transaction \u2014 close/update from the ' + _qcEsc(sect.label) + ' screen</div>' : '');

        // Wire close button (only present when row.record_id exists)
        var closeBtn = card.querySelector('.qc-btn-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', function(e) {
            var btn = e.currentTarget;
            closeQC();
            if (typeof openCloseModal === 'function') {
              openCloseModal(
                btn.getAttribute('data-rec-id'),
                btn.getAttribute('data-rec-name'),
                sect.label,
                accNo,
                btn.getAttribute('data-rec-sect')
              );
            } else {
              alert('Close modal not available. Record ID: ' + btn.getAttribute('data-rec-id'));
            }
          });
        }

        body.appendChild(card);
      }));

    } catch(e) {
      status.textContent = 'Error: ' + e.message;
    }
  }

  function _qcEsc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Bootstrap after DOM ready ──────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

})(); // end initQuickClose

// ================================================================
//  ENRICH IMPORTED RECORD
//  Called from the loan search panel "Update" button on each row.
//  Pre-fills the Gold Loan form from the imported record and sets
//  window._enrichRecId so saveAndPDF writes photos/ornaments back.
// ================================================================
window.openEnrichRecordForm = async function(recId) {
  if (!recId) return;
  try {
    toast('Loading record...', 'ok');
    var rec = await fetch(API + '/' + recId).then(function(r) { return r.json(); });
    if (!rec || !rec.id) { toast('Record not found', 'err'); return; }
    var d = rec.data || {};

    // Go to new-transaction page and select Gold Loan
    showPage('new');
    selNone();
    checked.clear();
    var goldRow = document.getElementById('row-Gold Loan');
    if (goldRow) goldRow.click();
    await new Promise(function(r) { setTimeout(r, 130); });
    buildForm();
    var wrap = document.getElementById('tx-layout-wrap');
    if (wrap) wrap.classList.add('mob-form-open');
    await new Promise(function(r) { setTimeout(r, 80); });

    // Fill a form input by its field key
    var fill = function(id, val) {
      if (val == null || val === '') return;
      var el = document.getElementById('f-' + id);
      if (el) { el.value = val; el.dispatchEvent(new Event('input')); }
    };

    // Pre-fill all text fields from the imported record
    fill('customer_name',    d.customer_name    || rec.name        || '');
    fill('loan_acc_no',      d.loan_acc_no      || rec.account_no  || '');
    fill('loan_amount',      d.loan_amount      || '');
    fill('aadhar',           d.aadhar           || rec.aadhar      || '');
    fill('mobile',           d.mobile           || rec.mobile      || '');
    fill('customer_id',      d.customer_id      || rec.customer_id || '');
    fill('address',          d.address          || '');
    fill('ornament_weight',  d.ornament_weight  || '');
    fill('ornament_qty',     d.ornament_qty     || '');
    fill('gold_ornaments',   d.gold_ornaments   || '');
    fill('silver_ornaments', d.silver_ornaments || '');

    // Pre-load any photos already saved so staff can review or replace them
    var photoSlots = ['photo_customer', 'photo_aadhar_front', 'photo_aadhar_back', 'photo_pan'];
    photoSlots.forEach(function(pid) {
      if (!d[pid]) return;
      if (typeof photos === 'object') photos[pid] = d[pid];
      var pbox = document.getElementById('pbox-' + pid);
      if (!pbox) return;
      pbox.style.position = 'relative';
      pbox.innerHTML = _photoBoxFilledHtml(pid, d[pid]);
    });
    // photo_ornament is intentionally left blank — staff must take a fresh photo

    // Tag this save as an enrichment so saveAndPDF PUTs back to the original record
    window._enrichRecId = rec.id;

    // Show yellow info banner at top of form
    var formEl = document.getElementById('form-card') || document.querySelector('.form-wrap');
    if (formEl) {
      var old = document.getElementById('enrich-banner');
      if (old) old.remove();
      var banner = document.createElement('div');
      banner.id = 'enrich-banner';
      banner.style.cssText = 'background:#fff3cd;border:1.5px solid #ffc107;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:11px;color:#856404;font-weight:600;display:flex;gap:8px;align-items:flex-start;';
      banner.innerHTML =
        '<span style="font-size:16px;">&#x1F4CB;</span>'
        + '<div style="flex:1;">'
        + '<div style="font-weight:800;margin-bottom:2px;">Updating Imported Record #' + rec.id + '</div>'
        + '<div>Fill in the missing photos &amp; ornament details, then tap <strong>Save &amp; PDF</strong>.</div>'
        + '<div style="margin-top:3px;color:#555;">Account: <strong>' + (d.loan_acc_no || rec.account_no || '&mdash;') + '</strong>'
        + '&nbsp;&middot;&nbsp;' + (rec.name || '') + '</div>'
        + '</div>';
      formEl.insertBefore(banner, formEl.firstChild);
    }

    toast('Form pre-filled. Add photos and save.', 'ok');
  } catch(e) {
    toast('Error: ' + e.message, 'err');
    console.error('[enrich]', e);
  }
};

// ================================================================
//  MOBILE EXIT CONFIRMATION
//  Staff often lose in-progress form data by swiping/tapping back or
//  closing the tab on a phone. On mobile-sized screens, confirm first.
//  (Desktop staff are not prompted — this is scoped to mobile only.)
// ================================================================
(function () {
  function isMobileScreen() {
    return (
      /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent || "",
      ) || window.innerWidth <= 820
    );
  }

  if (!isMobileScreen()) return;

  // 1) Tab close / page refresh / navigating away to another site.
  //    Browsers show their own built-in confirmation text — the message
  //    text set here is ignored by modern browsers, only the prompt itself.
  window.addEventListener("beforeunload", function (e) {
    e.preventDefault();
    e.returnValue = "";
    return "";
  });

  // 2) Phone hardware/gesture back button. beforeunload does not reliably
  //    fire for this on mobile, so guard it separately: push a sentinel
  //    history entry, and if the user goes "back", intercept with a
  //    confirm() — re-push the sentinel if they choose to stay.
  try {
    history.pushState({ jjuExitGuard: true }, "", location.href);
    window.addEventListener("popstate", function () {
      var leave = window.confirm(
        "⚠️ Are you sure you want to exit? Any unsaved changes will be lost.",
      );
      if (!leave) {
        history.pushState({ jjuExitGuard: true }, "", location.href);
      }
    });
  } catch (e) {
    console.warn("[exit-guard] history guard failed:", e.message);
  }
})();
