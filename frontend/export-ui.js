// ── JJU Export UI ────────────────────────────────────────────────────────────
// Usage: showExportModal('gold_loans')
// Renders a small modal with Excel + PDF buttons for the given account type.
//
// Supported types:
//   gold_loans | saving_accounts | fd_accounts | od_loans |
//   memberships | customers | share_accounts
//
// Add this to the bottom of app.js (or include as a separate <script> tag).

(function initExportUI() {

  const EXPORT_LABELS = {
    gold_loans:       'Gold Loans',
    saving_accounts:  'Saving Accounts',
    fd_accounts:      'Fixed Deposits',
    od_loans:         'OD Loans',
    memberships:      'Memberships',
    customers:        'Customers',
    share_accounts:   'Share Accounts',
  };

  // ── Inject modal HTML once ─────────────────────────────────────────────────
  function _inject() {
    if (document.getElementById('export-modal')) return;
    const el = document.createElement('div');
    el.id = 'export-modal';
    el.style.cssText = `
      display:none;position:fixed;inset:0;z-index:10000;
      background:rgba(0,0,0,.5);align-items:center;justify-content:center;
    `;
    el.innerHTML = `
      <div style="
        background:#fff;border-radius:14px;padding:28px 24px;
        min-width:320px;max-width:420px;width:90%;
        box-shadow:0 20px 60px rgba(0,0,0,.25);
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
          <h2 id="export-modal-title" style="font-size:15pt;color:#1a3a5c;margin:0;">Export</h2>
          <button onclick="closeExportModal()" style="
            background:none;border:none;font-size:18pt;cursor:pointer;
            color:#888;line-height:1;padding:0 4px;
          ">✕</button>
        </div>

        <p style="font-size:10pt;color:#555;margin-bottom:16px;">
          Select status filter and format:
        </p>

        <div style="margin-bottom:18px;">
          <label style="font-size:9pt;font-weight:600;color:#444;display:block;margin-bottom:6px;">Status</label>
          <div style="display:flex;gap:8px;">
            <label style="display:flex;align-items:center;gap:5px;font-size:10pt;cursor:pointer;">
              <input type="radio" name="export-status" value="all" checked> All
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:10pt;cursor:pointer;">
              <input type="radio" name="export-status" value="active"> Active
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:10pt;cursor:pointer;">
              <input type="radio" name="export-status" value="closed"> Closed
            </label>
          </div>
        </div>

        <div style="display:flex;gap:12px;flex-direction:column;">
          <button id="export-xlsx-btn" onclick="_doExport('xlsx')" style="
            background:#1a7f3c;color:#fff;border:none;border-radius:8px;
            padding:13px 20px;font-size:11pt;font-weight:600;cursor:pointer;
            display:flex;align-items:center;justify-content:center;gap:8px;
          ">
            📊 Download Excel (.xlsx)
          </button>
          <button id="export-pdf-btn" onclick="_doExport('pdf')" style="
            background:#1a3a5c;color:#fff;border:none;border-radius:8px;
            padding:13px 20px;font-size:11pt;font-weight:600;cursor:pointer;
            display:flex;align-items:center;justify-content:center;gap:8px;
          ">
            🖨️ Export PDF / Print
          </button>
        </div>

        <p style="font-size:8pt;color:#aaa;margin-top:14px;text-align:center;">
          PDF opens in a new tab — use browser print dialog to print or save.
        </p>
      </div>
    `;
    document.body.appendChild(el);
    el.addEventListener('click', function(e) {
      if (e.target === el) closeExportModal();
    });
  }

  let _currentType = null;

  // ── Public: open the modal for a given account type ───────────────────────
  window.showExportModal = function(type) {
    _inject();
    _currentType = type;
    document.getElementById('export-modal-title').textContent =
      'Export — ' + (EXPORT_LABELS[type] || type);
    // Reset to "all"
    document.querySelector('input[name="export-status"][value="all"]').checked = true;
    const modal = document.getElementById('export-modal');
    modal.style.display = 'flex';
  };

  window.closeExportModal = function() {
    const modal = document.getElementById('export-modal');
    if (modal) modal.style.display = 'none';
  };

  // ── Internal: trigger the actual export ──────────────────────────────────
  window._doExport = function(format) {
    if (!_currentType) return;
    const status = document.querySelector('input[name="export-status"]:checked')?.value || 'all';
    const url = `/api/export/${_currentType}?format=${format}&status=${status}`;

    if (format === 'xlsx') {
      // Download directly
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      a.click();
      closeExportModal();
      if (typeof toast === 'function') toast('📥 Excel download started', 'ok');
    } else {
      // PDF: open in new tab → auto print dialog
      const win = window.open(url, '_blank');
      if (!win && typeof toast === 'function') {
        toast('⚠️ Allow popups to open PDF', 'warn');
      }
      closeExportModal();
    }
  };

})();


// ── Helper to add export button to any section toolbar ───────────────────────
// Call this from section init functions:
//   addExportButton('gold_loans', '#gold-toolbar');
//
// Or manually add a button in your HTML:
//   <button onclick="showExportModal('gold_loans')">⬇ Export</button>

window.addExportButton = function(type, toolbarSelector) {
  const toolbar = document.querySelector(toolbarSelector);
  if (!toolbar) return;
  if (toolbar.querySelector('.jju-export-btn')) return; // already added

  const btn = document.createElement('button');
  btn.className = 'jju-export-btn';
  btn.innerHTML = '⬇ Export';
  btn.title = 'Export to Excel or PDF';
  btn.style.cssText = `
    background:#2d6a4f;color:#fff;border:none;border-radius:6px;
    padding:6px 14px;font-size:10pt;cursor:pointer;margin-left:8px;
  `;
  btn.onclick = () => showExportModal(type);
  toolbar.appendChild(btn);
};
