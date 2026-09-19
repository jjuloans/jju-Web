// ═══════════════════════════════════════════════════════════════
//  JJU PDF GENERATOR v17
//  - Gold Loan: exact 6-col table, full rules, customer name replaces signature text
//  - Slips: clean tabular 3-slip format
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  ORNAMENT ITEMS FORM BUILDER
//  Call renderOrnamentItemsForm(containerId) to inject a dynamic
//  add-row form. Returns current items via getOrnamentItems().
//
//  Data format expected in data.ornament_items:
//  [ { name: "Gold Chain", qty: 1, weight: 22 }, ... ]
// ═══════════════════════════════════════════════════════════════
function renderOrnamentItemsForm(containerId) {
  var wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.innerHTML =
    "<style>" +
    ".orn-form-table{width:100%;border-collapse:collapse;margin-top:4px}" +
    ".orn-form-table th{background:#1a3a5c;color:#fff;padding:5px 8px;font-size:9pt;border:1px solid #999;text-align:left}" +
    ".orn-form-table td{padding:4px 6px;border:1px solid #ccc;vertical-align:middle}" +
    ".orn-inp{width:100%;padding:4px 6px;border:1px solid #bbb;border-radius:3px;font-size:9.5pt;box-sizing:border-box}" +
    ".orn-del{background:#c62828;color:#fff;border:none;border-radius:3px;padding:3px 10px;cursor:pointer;font-size:9pt}" +
    ".orn-add-btn{margin-top:6px;background:#1a3a5c;color:#fff;border:none;border-radius:4px;padding:6px 16px;cursor:pointer;font-size:9.5pt;font-weight:700}" +
    ".orn-summary{font-size:8.5pt;color:#2e7d52;font-weight:700;margin-top:4px}" +
    "</style>" +
    '<table class="orn-form-table">' +
    "<thead><tr>" +
    '<th style="width:45%">दागिन्याचे नाव / Ornament Name</th>' +
    '<th style="width:20%">नग / Qty</th>' +
    '<th style="width:25%">वजन / Weight (gm)</th>' +
    '<th style="width:10%"></th>' +
    "</tr></thead>" +
    '<tbody id="' +
    containerId +
    '_tbody"></tbody>' +
    "</table>" +
    '<button class="orn-add-btn" onclick="window._ornAddRow(\'' +
    containerId +
    "')\">+ दागिना जोडा / Add Ornament</button>" +
    '<div class="orn-summary" id="' +
    containerId +
    '_summary"></div>';

  window._ornAddRow = function (cid) {
    var tbody = document.getElementById(cid + "_tbody");
    var idx = tbody.rows.length;
    var tr = document.createElement("tr");
    tr.setAttribute("data-idx", idx);
    tr.innerHTML =
      '<td><input class="orn-inp" type="text" placeholder="e.g. Gold Chain / गोल्ड चेन" data-field="name"></td>' +
      '<td><input class="orn-inp" type="number" min="1" placeholder="1" data-field="qty" style="text-align:center"></td>' +
      '<td><input class="orn-inp" type="number" min="0" step="0.01" placeholder="0.00" data-field="weight" style="text-align:center"></td>' +
      '<td style="text-align:center"><button class="orn-del" onclick="this.closest(&quot;tr&quot;).remove();window._ornUpdateSummary(\'' +
      cid +
      "')\">✕</button></td>";
    tbody.appendChild(tr);
    window._ornUpdateSummary(cid);
    tr.querySelector('[data-field="name"]').focus();
    tr.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("input", function () {
        window._ornUpdateSummary(cid);
      });
    });
  };

  window._ornUpdateSummary = function (cid) {
    var items = window.getOrnamentItems(cid);
    var totalQty = 0,
      totalWt = 0;
    items.forEach(function (r) {
      totalQty += parseInt(r.qty) || 0;
      totalWt += parseFloat(r.weight) || 0;
    });
    var el = document.getElementById(cid + "_summary");
    if (el && items.length)
      el.textContent =
        "एकूण: " +
        items.length +
        " प्रकार | " +
        totalQty +
        " नग | " +
        totalWt.toFixed(2) +
        " gm";
    else if (el) el.textContent = "";
  };

  window.getOrnamentItems = function (cid) {
    var tbody = document.getElementById((cid || containerId) + "_tbody");
    if (!tbody) return [];
    var items = [];
    Array.from(tbody.rows).forEach(function (tr) {
      var name = (tr.querySelector('[data-field="name"]').value || "").trim();
      var qty = tr.querySelector('[data-field="qty"]').value;
      var weight = tr.querySelector('[data-field="weight"]').value;
      if (name)
        items.push({
          name: name,
          qty: parseFloat(qty) || 1,
          weight: parseFloat(weight) || 0,
        });
    });
    return items;
  };

  // Add first empty row automatically
  window._ornAddRow(containerId);
}

function generateTemplatePDF(txArr, data) {
  // If both "Saving - Deposit Slip" and "Saving Deposit" are present, keep only "Saving Deposit"
  // to avoid the slip rendering twice (both call the same savingDepositSlipPage function).
  let dedupedArr = txArr;
  if (
    txArr.includes("Saving Deposit") &&
    txArr.includes("Saving - Deposit Slip")
  ) {
    dedupedArr = txArr.filter((tx) => tx !== "Saving - Deposit Slip");
  }
  // Also deduplicate any repeated identical page types to prevent double-rendering
  const seen = new Set();
  dedupedArr = dedupedArr.filter((tx) => {
    if (seen.has(tx)) return false;
    seen.add(tx);
    return true;
  });
  // "Slips - Loan" (the gold-loan voucher page) now appends its own blank
  // page right after itself, so any separate trailing "Blank Page" entries
  // in the print set would just add unwanted blank pages at the very end.
  if (dedupedArr.includes("Slips - Loan")) {
    dedupedArr = dedupedArr.filter((tx) => tx !== "Blank Page");
  }
  const pages = dedupedArr.map((tx) => buildHTMLPage(tx, data)).join("");
  const html = wrapHTML(pages, data.customer_name || "record");
  _printInNewTab(html);
}

function _printInNewTab(html) {
  // Use the in-app PDF sheet overlay if available (stays within dashboard,
  // mobile-friendly, close button returns to app without tab switching).
  if (typeof window.openPDFSheet === "function") {
    window.openPDFSheet("html", html, "Receipt");
    return;
  }
  // Fallback: open in new tab (desktop browsers without the sheet injected)
  const win = window.open("", "_blank");
  if (!win) {
    if (typeof toast === "function") toast("⚠️ Allow popups to print", "warn");
    return;
  }
  win.document.write(html);
  win.document.close();
  setTimeout(function () {
    win.focus();
    win.print();
    win.onafterprint = function () {
      win.close();
    };
  }, 800);
}

function wrapHTML(body, name) {
  return `<!DOCTYPE html>
<html lang="mr">
<head>
<meta charset="UTF-8">
<title>JJU — ${name}</title>
<style>
/* BUG FIX: no @page rule existed anywhere in this stylesheet, so Chrome fell
   back to its own default print margins on every page. Every page class
   below (.page, .spage, .rpage, .spage-blank) assumes a full 297mm of usable
   height with zero margin allowance — the missing @page rule silently ate
   into that space, causing borderline/full-height content (most visibly
   .spage-blank, which is exactly 297mm tall) to spill a sliver onto a
   phantom extra page. Confirmed via direct headless-Chrome render: this one
   rule took a single "Blank Page" entry from rendering as 2 physical pages
   down to the intended 1, with no other changes needed. */
@page { size: A4; margin: 10mm; }
* { margin:0; padding:0; box-sizing:border-box; }
/* System Devanagari stack — no network fetch needed, renders instantly */
body { font-family:'Noto Sans Devanagari','Mangal','Kokila','Arial Unicode MS',Arial,sans-serif; background:#ddd; color:#000; font-size:10pt; }

/* PAGE */
.page { background:#fff; width:210mm; min-height:297mm; margin:0 auto; padding:0;
        box-shadow:0 2px 14px rgba(0,0,0,.25); page-break-after:always; overflow:visible; height:auto; }

/* ORG HEADER */
.ohdr { text-align:center; padding:2px 10px 3px; border-bottom:2.5px solid #000; }
.ohdr-name { font-family:'Noto Serif Devanagari','Kokila','Mangal',serif; font-size:13pt; font-weight:700; line-height:1.35; }

/* FORM TITLE */
.ftitle { text-align:center; font-family:'Noto Serif Devanagari','Kokila','Mangal',serif;
          font-size:11.5pt; font-weight:700; padding:5px 8px 4px; border-bottom:2px solid #000; background:#fafafa; }

/* ════ INFO TABLE ════
   Fixed 6-col layout matching reference PDF exactly
   col%: 17 | 25 | 13 | 21 | 12 | 12  */
.it { width:100%; border-collapse:collapse; table-layout:fixed; font-size:10pt; }
.it td { border:2px solid #000; padding:5px 8px; vertical-align:middle; overflow-wrap:break-word; line-height:1.5; color:#000; font-weight:700; }
.it .lbl { background:#e0e0e0; font-weight:800; color:#000; font-size:9pt; border-right:2px solid #000; }
.it .val { font-weight:800; font-size:10pt; color:#000; }
.it .vbig { font-weight:900; font-size:12pt; }

/* BODY PARAGRAPH */
.bp { padding:5px 12px; font-size:9pt; line-height:1.7; text-align:justify; color:#000; font-weight:600; }
.bp.yl { background:#fffbee; border-top:1px solid #e5d98a; }
.bp.gr { background:#f9f9f9; border-top:1px dashed #bbb; }

/* VACHANCHITHI */
.vach { border:1.5px solid #000; border-radius:3px; margin:4px 12px; padding:7px 12px; font-size:9pt; line-height:1.8; background:#fff; color:#000; font-weight:600; }
.vach-t { text-align:center; font-weight:700; font-size:10.5pt; padding-bottom:4px; margin-bottom:5px;
          border-bottom:1px solid #bbb; font-family:'Noto Serif Devanagari','Kokila','Mangal',serif; }

/* RULES */
.rules { border-top:2px solid #000; padding:5px 14px 5px; }
.rules-t { text-align:center; font-weight:700; font-size:9.5pt; margin-bottom:4px;
           font-family:'Noto Serif Devanagari','Kokila','Mangal',serif; padding-bottom:3px; border-bottom:1px solid #000; }
.rule { font-size:7.5pt; line-height:1.55; padding:1px 0 1px 12px; text-indent:-12px; border-bottom:1px dotted #ccc; color:#000; font-weight:600; }
.rule::before { content:"* "; font-weight:700; }

/* RECEIPT SECTION */
.receipt { border-top:1.5px solid #000; padding:5px 14px 6px; font-size:8.5pt; line-height:1.75; color:#000; font-weight:600; }

/* DASHED DIVIDER */
.hrdash { border:none; border-top:1.5px dashed #000; margin:0; }

/* ORNAMENT PHOTO */
.orn-box { border-top:1.5px solid #000; padding:8px 14px; text-align:center; }
.orn-box .olbl { font-size:9pt; font-weight:700; text-align:left; margin-bottom:6px; }
.orn-box img { max-width:140mm; max-height:60mm; border:1.5px solid #555; border-radius:4px; display:block; margin:0 auto; object-fit:contain; }

/* CUSTOMER NAME STAMP (replaces signature line) */
.nm-stamp { display:inline-block; font-weight:800; font-size:10pt; border-bottom:1.5px solid #000;
            padding:0 10px 1px; min-width:80px; text-align:center; color:#000; }

/* ════ SLIP PAGE ════ */
.spage { background:#fff; width:210mm; margin:0 auto; padding:4px 8px;
         box-shadow:0 2px 14px rgba(0,0,0,.25); page-break-after:always; break-after:always; }
/* Blank page after slips/receipts that must not print on reverse side */
.spage-blank { background:#fff; width:210mm; min-height:297mm; margin:0 auto;
               box-shadow:0 2px 14px rgba(0,0,0,.25); display:block; page-break-after:avoid; break-after:avoid; }
.sblock { border:2px solid #000; border-radius:3px; overflow:hidden; margin-bottom:0; }
/* ════ RECEIPT PAGE ════ */
.rpage { background:#fff; width:210mm; margin:0 auto; padding:0 6mm;
         box-sizing:border-box; box-shadow:0 2px 14px rgba(0,0,0,.25); page-break-before:always; page-break-after:always; }

/* Slip org header */
.sohdr { text-align:center; padding:5px 8px 4px; border-bottom:1.5px solid #000; background:#f0f0f0; }
.sohdr-name { font-family:'Noto Serif Devanagari','Kokila','Mangal',serif; font-size:10.5pt; font-weight:800; line-height:1.3; color:#000; }

/* Slip title bar */
.stbar { display:flex; justify-content:space-between; align-items:center;
         padding:3px 10px; border-bottom:1px solid #000; background:#e0e0e0; font-size:9.5pt; font-weight:800; color:#000; }
.stbar .scode { font-size:10pt; font-weight:900; color:#000; }

/* Slip scroll table */
.sst { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9pt; border-top:1px solid #000; }
.sst th { border:1px solid #000; padding:3px 7px; background:#d0d0d0; font-weight:800; font-size:8.5pt; text-align:left; color:#000; }
.sst td { border:1px solid #000; padding:3px 7px; font-weight:800; color:#000; }

/* Slip content table */
.sct { width:100%; border-collapse:collapse; font-size:9.5pt; border-top:1px solid #ddd; }
.sct td { padding:5px 12px; border-bottom:1px solid #ccc; vertical-align:middle; color:#000; font-weight:700; }
.sct tr:last-child td { border-bottom:none; }
.sct .sl { font-weight:800; color:#000; width:40%; font-size:9pt; }
.sct .sv { font-weight:700; }
/* Compact 4-col tabular slip layout */
.compact-slip th { padding:4px 8px; font-size:9pt; font-weight:800; border:1px solid #000; vertical-align:middle; color:#000; }
.compact-slip td { padding:4px 8px; font-size:9.5pt; border:1px solid #000; vertical-align:middle; color:#000; font-weight:700; }
.compact-slip { border-top:none; }

/* Slip body text */
.sbody { padding:5px 12px 7px; font-size:9.5pt; line-height:1.75; color:#000; font-weight:700; }

/* Slip footer */
.sftr { display:flex; justify-content:space-between; align-items:flex-end;
        padding:5px 14px 7px; border-top:1.5px solid #000; font-size:8.5pt; color:#000; font-weight:800; }
.sftr .si { text-align:center; color:#000; font-weight:800; }
.sftr .si-name { font-weight:900; font-size:9pt; border-top:1.5px solid #000; padding-top:3px; margin-top:6px; min-width:50mm; display:block; color:#000; }

/* Dashed separator between slips */
.sdiv { border:none; border-top:2.5px dashed #555; margin:8px 0; }

@media print {
  body { background:none; }
  .page, .spage, .rpage, .spage-blank { margin:0; box-shadow:none; width:100%; }
  /* Compensate fixed 297mm heights for the @page margin above, or the extra
     20mm (10mm top + 10mm bottom) spills each of these onto a phantom
     second page — the same failure mode noted in the @page bug-fix note. */
  .page, .spage-blank { min-height: calc(297mm - 20mm); }
  .no-print { display:none; }
  .mis-slip-page { margin:0 !important; padding:4mm 6mm !important; page-break-after:avoid !important; page-break-inside:avoid !important; }
}
</style>
<script>document.addEventListener('DOMContentLoaded',function(){window.print();});</script>
</head>
<body>
<div class="no-print" style="background:#1a5c2a;color:#fff;padding:10px 18px;text-align:center;font-size:11pt;font-weight:700;position:sticky;top:0;z-index:99">
  🖨️ Printing automatically &nbsp;|&nbsp;
  <button onclick="window.print()" style="background:#fff;color:#1a5c2a;border:none;border-radius:6px;padding:5px 18px;cursor:pointer;font-weight:800;font-size:10pt;margin-left:8px">🖨️ Print / Save PDF</button>
</div>
${body}
</body></html>`;
}

// ─── Helpers ─────────────────────────────────────────────────
function fv(val, fallback) {
  fallback = fallback === undefined ? "—" : fallback;
  var v = (val || "").toString().trim();
  return v || fallback;
}
function fmtDate(d) {
  if (!d || d === "—") return d;
  try {
    var o = new Date(d);
    if (isNaN(o.getTime())) return d;
    var days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    var mons = [
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
    ];
    return (
      days[o.getDay()] +
      ", " +
      String(o.getDate()).padStart(2, "0") +
      "-" +
      mons[o.getMonth()] +
      "-" +
      o.getFullYear()
    );
  } catch (e) {
    return d;
  }
}
// ── Signature line: "Rohit ............. (customer name) ............."
function sigLine(nm, label) {
  // label param kept for API compatibility but no longer shown
  return (
    '<div style="display:inline-flex;flex-direction:column;align-items:center;min-width:60mm;text-align:center">' +
    '<span style="font-weight:800;font-size:10pt">' +
    nm +
    " .................</span>" +
    "</div>"
  );
}
// Full-width signature row (right-aligned applicant sig, left blank line)
function sigRow(nm, label, leftLabel) {
  leftLabel = leftLabel || "";
  return (
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:8px 20px 8px">' +
    '<div style="text-align:center;min-width:55mm">' +
    (leftLabel
      ? '<div style="border-bottom:1px solid #000;height:18px;margin-bottom:4px"></div><div style="font-size:9pt">' +
        leftLabel +
        "</div>"
      : "") +
    "</div>" +
    '<div style="text-align:center">' +
    sigLine(nm) +
    "</div>" +
    "</div>"
  );
}
// Compact photo grid — shows all available photos (shorter to fit on page)
// imgW / imgH: optional CSS size strings (default "65mm" / "85mm")
function photoGrid(photos, imgW, imgH) {
  var valid = photos.filter(function (p) {
    return p && p.src;
  });
  if (!valid.length) return "";
  var w = imgW || "65mm";
  var h = imgH || "85mm";
  var items = valid
    .map(function (p) {
      return (
        '<div style="text-align:center;flex:0 0 auto">' +
        '<img src="' +
        p.src +
        '" style="width:' +
        w +
        ";height:" +
        h +
        ';object-fit:cover;border:1px solid #888;border-radius:3px;display:block">' +
        '<div style="font-size:7.5pt;color:#444;margin-top:2px">' +
        p.label +
        "</div>" +
        "</div>"
      );
    })
    .join("");
  return (
    '<div style="border-top:1.5px solid #000;padding:4px 12px 5px">' +
    '<div style="font-size:9pt;font-weight:700;margin-bottom:4px">📷 Documents / Photos</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
    items +
    "</div>" +
    "</div>"
  );
}
// customer name stamp — kept for Gold Loan vachanchithi internal use
function nmStamp(nm) {
  return '<span class="nm-stamp">' + nm + "</span>";
}

// Declaration line added at bottom of all forms and slips
function declLine() {
  return (
    '<div style="border-top:1px dashed #bbb;margin:4px 10px 2px;padding:3px 4px 2px">' +
    '<span style="font-size:7pt;color:#555;line-height:1.4;">' +
    "संपूर्ण माहिती ऑनलाईन पद्धतीने माझ्या समोर भरली असून ती मला माझ्या मातृभाषेत वाचून व समजावून सांगण्यात आली आहे. " +
    "या फॉर्मवर भरलेली सर्व माहिती मला समजली असून ती बरोबर असल्याची खात्री करून मी सही करत आहे." +
    "</span></div>"
  );
}

// ═══════════════════════════════════════════════════════
//  INT RECEIVED ON GOLD LOAN — ACCOUNT VOUCHER
//  Shows all closed GL cases in tabular format
// ═══════════════════════════════════════════════════════
function glIntVoucherPage(closedLoans, dtFmt) {
  var intRows = closedLoans || [];

  // Step 1: Build creditMap and debitMap indexed by scroll_no — mirrors GAS logic
  var creditMap = {};
  var debitMap = {};

  intRows.forEach(function (r) {
    var txType = (r.tx_type || r.txType || "").trim();
    var scrollNo = String(r.scroll_no || "").trim();
    var name = (r.name || "—").trim();
    var accNo = (r.acc_no || "").trim();
    var amount = parseFloat(r.amount) || 0;
    var loanDate = r.loan_date || "";
    if (txType === "Credit") {
      creditMap[scrollNo] = {
        scrollNo: scrollNo,
        name: name,
        amount: amount,
        accNo: "83-1",
        loanDate: loanDate,
      };
    } else if (txType === "Debit") {
      debitMap[scrollNo] = {
        scrollNo: scrollNo,
        name: name,
        amount: amount,
        accNo: accNo || "03",
        loanDate: loanDate,
      };
    }
  });

  // Step 2: Match + include unmatched
  var creditData = [],
    debitData = [];
  var matchedScrollNos = new Set();
  Object.keys(creditMap).forEach(function (scrollNo) {
    if (debitMap[scrollNo]) {
      creditMap[scrollNo].loanAccNo = debitMap[scrollNo].accNo;
      debitMap[scrollNo].loanAccNo = debitMap[scrollNo].accNo;
      creditData.push(creditMap[scrollNo]);
      debitData.push(debitMap[scrollNo]);
      matchedScrollNos.add(scrollNo);
    }
  });
  Object.keys(creditMap).forEach(function (s) {
    if (!matchedScrollNos.has(s)) creditData.push(creditMap[s]);
  });
  Object.keys(debitMap).forEach(function (s) {
    if (!matchedScrollNos.has(s)) debitData.push(debitMap[s]);
  });

  var totalCr = creditData.reduce(function (s, r) {
    return s + r.amount;
  }, 0);
  var totalDb = debitData.reduce(function (s, r) {
    return s + r.amount;
  }, 0);

  return _intVoucherOnePage(
    creditData,
    totalCr,
    true,
    "Credit Voucher by 12 % Int",
    "Interest Received On Gold Loan TRF",
    "83-1",
    debitData,
    totalDb,
    false,
    "Debit Voucher by 12 % Int",
    "Gold Loan TRF",
    "03",
    dtFmt,
  );
}

// ─── Shared helper: two voucher blocks (Credit + Debit), compact ────────────
// Bordered card per block (Credit, then Debit), sized to its actual content
// — no forced full-A4-height container, matching the compact Covering
// Vouchers redesign (see buildVoucherBlock above). If one side has many
// rows and won't fit on one page, it overflows to the next via normal
// block layout (each block itself stays intact — page-break-inside:avoid).
function _intVoucherOnePage(
  creditData,
  totalCr,
  crUseFixed,
  crTitle,
  crDesc,
  crAccCode,
  debitData,
  totalDb,
  dbUseFixed,
  dbTitle,
  dbDesc,
  dbAccCode,
  dtFmt,
) {
  var hdr =
    "** जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव जामोद र.नं. १०६७ **";

  function fmtRs(n) {
    return (
      "₹" +
      Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })
    );
  }

  function mkRows(rows, useFixed) {
    return rows
      .map(function (r, i) {
        return (
          '<tr style="' +
          (i % 2 === 0 ? "background:#fff" : "background:#f5f5f5") +
          '">' +
          '<td style="border:1px solid #ccc;padding:2px 5px;text-align:center;font-size:7.3pt">' +
          (r.scrollNo || i + 1) +
          "</td>" +
          '<td style="border:1px solid #ccc;padding:2px 5px;font-size:7.3pt;font-weight:700">' +
          (r.name || "—") +
          "</td>" +
          '<td style="border:1px solid #ccc;padding:2px 5px;font-size:7.3pt;text-align:right">' +
          fmtRs(r.amount) +
          "</td>" +
          '<td style="border:1px solid #ccc;padding:2px 5px;font-size:7.3pt;text-align:center">' +
          (useFixed ? r.accNo : r.loanAccNo || r.accNo) +
          "</td>" +
          '<td style="border:1px solid #ccc;padding:2px 5px;font-size:7.3pt;text-align:center">' +
          (r.loanDate || "—") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function mkTable(rows, total, useFixed) {
    return (
      '<table style="width:100%;border-collapse:collapse;font-size:7.3pt;margin-bottom:1mm">' +
      '<tr style="background:#1a3a5c;color:#fff">' +
      '<th style="border:1px solid #000;padding:2px 5px;width:8%;text-align:center">Scroll No</th>' +
      '<th style="border:1px solid #000;padding:2px 5px;width:38%;text-align:left">Name</th>' +
      '<th style="border:1px solid #000;padding:2px 5px;width:15%;text-align:right">Int Amt</th>' +
      '<th style="border:1px solid #000;padding:2px 5px;width:18%;text-align:center">Acc No</th>' +
      '<th style="border:1px solid #000;padding:2px 5px;width:21%;text-align:center">Loan Date</th>' +
      "</tr>" +
      (mkRows(rows, useFixed) ||
        '<tr><td colspan="5" style="border:1px solid #ccc;padding:5px;text-align:center;color:#aaa;font-size:7.3pt">No entries</td></tr>') +
      '<tr style="background:#fffde7;font-weight:800">' +
      '<td colspan="2" style="border:1px solid #999;padding:2px 6px;text-align:right;font-size:7.3pt">Total Amount:</td>' +
      '<td style="border:1px solid #999;padding:2px 5px;text-align:right;font-size:7.3pt">' +
      fmtRs(total) +
      "</td>" +
      '<td colspan="2" style="border:1px solid #999;padding:2px 5px;font-size:6.8pt;color:#555">(' +
      numberToWords(total) +
      ")</td>" +
      "</tr>" +
      "</table>"
    );
  }

  function sigBlock() {
    return (
      '<div style="display:flex;justify-content:space-between;font-size:7pt;margin-top:2mm;border-top:1px dashed #888;padding-top:1.5mm">' +
      '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:10px;min-width:45mm;margin-bottom:2px"></div><div>लेखापाल / खातेपाल</div></div>' +
      '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:10px;min-width:45mm;margin-bottom:2px"></div><div>व्यवस्थापक / अधिकारी</div></div>' +
      "</div>"
    );
  }

  function voucherBlock(title, desc, accCode, rows, total, useFixed, bgTitle) {
    return (
      '<div style="border:1px solid #999;border-radius:2px;padding:1.5mm 2.5mm 1mm;page-break-inside:avoid;break-inside:avoid;margin-bottom:2.5mm">' +
      '<div style="text-align:center;font-weight:800;font-size:7.3pt;border-bottom:1px solid #000;padding-bottom:0.5mm;margin-bottom:0.5mm">' +
      hdr +
      "</div>" +
      '<div style="text-align:center;font-size:7pt;margin-bottom:1.5mm;color:#333">Date - ' +
      (dtFmt || "—") +
      "</div>" +
      '<div style="font-size:7.3pt;font-weight:700;margin-bottom:1.5mm;padding:1.5px 4px;background:' +
      bgTitle +
      '">' +
      "<strong>" +
      title +
      "</strong> - <strong>" +
      desc +
      "</strong> &nbsp;&nbsp; Acc Code - <strong>" +
      accCode +
      "</strong>" +
      "</div>" +
      mkTable(rows, total, useFixed) +
      sigBlock() +
      "</div>"
    );
  }

  // Compact, natural-height layout — matches the Covering Vouchers redesign
  // (see buildVoucherBlock above): the old version wrapped this in
  // class="page" (width:210mm; min-height:297mm — see wrapHTML()'s
  // stylesheet), which reserved a full A4 sheet of height regardless of how
  // little content there was, leaving a large blank void below a couple of
  // short tables. This wrapper only takes up what the content actually
  // needs, same as the covering vouchers directly above it in the merged
  // Bank Closing PDF.
  return (
    '<div style="width:210mm;max-width:100%;margin:0 auto;padding:4mm 8mm;box-sizing:border-box;background:#fff;font-size:8pt">' +
    voucherBlock(
      crTitle,
      crDesc,
      crAccCode,
      creditData,
      totalCr,
      crUseFixed,
      "#e8f5e9",
    ) +
    voucherBlock(
      dbTitle,
      dbDesc,
      dbAccCode,
      debitData,
      totalDb,
      dbUseFixed,
      "#fff3e0",
    ) +
    "</div>"
  );
}

// ─── FD-OD Interest Voucher (Acc 277-1 Credit / Acc 17 Debit) ───────────────
function fdodIntVoucherPage(intRows, dtFmt) {
  intRows = intRows || [];

  var creditMap = {},
    debitMap = {};

  intRows.forEach(function (r) {
    var txType = (r.tx_type || r.txType || "").trim();
    var scrollNo = String(r.scroll_no || "").trim();
    var name = (r.name || "—").trim();
    var accNo = (r.acc_no || "").trim();
    var amount = parseFloat(r.amount) || 0;
    var loanDate = r.loan_date || "";
    if (txType === "Credit") {
      creditMap[scrollNo] = {
        scrollNo: scrollNo,
        name: name,
        amount: amount,
        accNo: "277-1",
        loanDate: loanDate,
      };
    } else if (txType === "Debit") {
      debitMap[scrollNo] = {
        scrollNo: scrollNo,
        name: name,
        amount: amount,
        accNo: accNo || "17",
        loanDate: loanDate,
      };
    }
  });

  // Match by scroll_no (like the GL-83 voucher) but ALSO include any
  // unmatched Credit/Debit rows on their own side — a standalone Closing -
  // OD interest entry (only a Credit row, no paired Debit row on the same
  // scroll_no) must still show up on the voucher instead of silently
  // disappearing because it never found a match. Mirrors glIntVoucherPage().
  var creditData = [],
    debitData = [];
  var matchedScrollNos = new Set();
  Object.keys(creditMap).forEach(function (scrollNo) {
    if (debitMap[scrollNo]) {
      creditMap[scrollNo].loanAccNo = debitMap[scrollNo].accNo;
      debitMap[scrollNo].loanAccNo = debitMap[scrollNo].accNo;
      creditData.push(creditMap[scrollNo]);
      debitData.push(debitMap[scrollNo]);
      matchedScrollNos.add(scrollNo);
    }
  });
  Object.keys(creditMap).forEach(function (s) {
    if (!matchedScrollNos.has(s)) creditData.push(creditMap[s]);
  });
  Object.keys(debitMap).forEach(function (s) {
    if (!matchedScrollNos.has(s)) debitData.push(debitMap[s]);
  });

  var totalCr = creditData.reduce(function (s, r) {
    return s + r.amount;
  }, 0);
  var totalDb = debitData.reduce(function (s, r) {
    return s + r.amount;
  }, 0);

  return _intVoucherOnePage(
    creditData,
    totalCr,
    true,
    "Credit Voucher",
    "Int Received On FD-OD TRF",
    "277-1",
    debitData,
    totalDb,
    false,
    "Debit Voucher",
    "FD OD TRF",
    "17",
    dtFmt,
  );
}

// ─── Bank TRF Vouchers — ALL transactions in two grouped tables (Credit + Debit)
// on ONE page. Each transaction is a row; UPI/mode info in the Scroll No column.
// If entries exceed one page they auto-overflow; no wasted blank space.
// ─── Bank TRF Vouchers — ONE voucher per transaction (matches the society's
// paper voucher book: full letterhead + a single-row table + signature block,
// repeated per transaction, separated by a dashed rule). Credit vouchers are
// printed as a block, then Debit vouchers, mirroring how the Ledger's Bank
// TRF tab already groups them (see renderLedgerBankTRF in app.js).
function bankTRFVoucherPage(bankRows, dtFmt, extraHtml) {
  bankRows = bankRows || [];

  if (!bankRows.length) {
    return '<div class="page"><p style="text-align:center;padding:20mm;color:#aaa">No Bank TRF entries found</p></div>';
  }

  var hdr =
    "** जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव जामोद र.नं. १०६७ **";

  function fmtRs(n) {
    return (
      "₹" +
      Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })
    );
  }

  var creditRows = bankRows.filter(function (r) {
    return (r.tx_type || "").trim() === "Credit";
  });
  var debitRows = bankRows.filter(function (r) {
    return (r.tx_type || "").trim() === "Debit";
  });

  // Reference on the voucher line — UPI RRN for online transfers, cheque no
  // for cheque payments, blank when neither is recorded (mirrors the "PRN /
  // Cheque No" logic the grouped-table layout used to show as its own column).
  function refText(r) {
    if (r.upi_rrn) return "UPI RRN " + r.upi_rrn;
    if (r.cheque_no) return "Cheque No " + r.cheque_no;
    return "";
  }

  function mkVoucher(r, i, dcLabel) {
    var accType = (r.acc_type || r.task || "").trim();
    var name = r.name || "";
    var accNo = r.acc_no || "";
    var amount = parseFloat(r.amount) || 0;
    var scrollNo = r.scroll_no || String(i + 1);
    // Task #5: rows now include Cash-mode bank entries alongside Transfer —
    // label each voucher with its own row's mode instead of a hardcoded
    // "Transfer" (rows built elsewhere with no .mode, e.g. RTGS/synthetic
    // intRows, keep the prior "Transfer" wording).
    var modeLabel = r.mode || "Transfer";

    return (
      '<div style="page-break-inside:avoid;border-top:1.5px dashed #666;padding-top:8px;margin-top:8px">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px">' +
      '<div style="font-weight:800;font-size:10pt">' +
      hdr +
      "</div>" +
      '<div style="font-size:9pt;white-space:nowrap">Date - ' +
      (dtFmt || "—") +
      "</div>" +
      "</div>" +
      '<div style="font-size:9.5pt;margin:2px 0 6px">Voucher for Bank Transactions - ' +
      modeLabel +
      " (<strong>" +
      dcLabel +
      "</strong>)(* UPI Id- " +
      refText(r) +
      ")</div>" +
      '<table style="width:100%;border-collapse:collapse;font-size:9pt">' +
      "<tr>" +
      '<th style="border:1px solid #000;padding:4px 8px;width:12%;text-align:left;font-weight:700">Scroll No</th>' +
      '<th style="border:1px solid #000;padding:4px 8px;width:30%;text-align:left;font-weight:700">Name</th>' +
      '<th style="border:1px solid #000;padding:4px 8px;width:28%;text-align:left;font-weight:700">Acc Type</th>' +
      '<th style="border:1px solid #000;padding:4px 8px;width:15%;text-align:left;font-weight:700">Acc No</th>' +
      '<th style="border:1px solid #000;padding:4px 8px;width:15%;text-align:left;font-weight:700">Amount</th>' +
      "</tr>" +
      "<tr>" +
      '<td style="border:1px solid #000;padding:4px 8px">' +
      scrollNo +
      "</td>" +
      '<td style="border:1px solid #000;padding:4px 8px">' +
      name +
      "</td>" +
      '<td style="border:1px solid #000;padding:4px 8px">' +
      accType +
      "</td>" +
      '<td style="border:1px solid #000;padding:4px 8px">' +
      accNo +
      "</td>" +
      '<td style="border:1px solid #000;padding:4px 8px">' +
      fmtRs(amount) +
      "</td>" +
      "</tr>" +
      "</table>" +
      '<div style="font-size:9.5pt;margin:8px 0">Total Amount: <strong>' +
      fmtRs(amount) +
      "</strong> (" +
      numberToWords(amount) +
      ")</div>" +
      '<div style="display:flex;justify-content:space-between;padding:14px 20px 4px">' +
      '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:14px;min-width:55mm;margin-bottom:3px"></div><div style="font-size:8.5pt">लेखापाल / खातेपाल</div></div>' +
      '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:14px;min-width:55mm;margin-bottom:3px"></div><div style="font-size:8.5pt">व्यवस्थापक / अधिकारी</div></div>' +
      "</div>" +
      "</div>"
    );
  }

  var vouchersHtml =
    creditRows
      .map(function (r, i) {
        return mkVoucher(r, i, "Credit");
      })
      .join("") +
    debitRows
      .map(function (r, i) {
        return mkVoucher(r, i, "Debit");
      })
      .join("");

  return (
    '<div class="page" style="padding:8mm 12mm;box-sizing:border-box">' +
    vouchersHtml +
    '<div style="border-top:1.5px dashed #666;margin-top:8px"></div>' +
    (extraHtml || "") +
    "</div>"
  );
}

// Saving Acc Transfer voucher — one member's saving account debited, a
// different member's saving account credited, in a single transfer. Modeled
// on bankTRFVoucherPage() above, but shows both legs together in one voucher
// block (a transfer is one transaction, not a batch of independent rows the
// way Bank TRF vouchers are — so there's no per-row loop here).
function savingAccTransferVoucherPage(rows, dtFmt) {
  rows = rows || [];
  if (!rows.length) {
    return '<div class="page"><p style="text-align:center;padding:20mm;color:#aaa">No Saving Acc Transfer entries found</p></div>';
  }

  var hdr =
    "** जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव जामोद र.नं. १०६७ **";

  function fmtRs(n) {
    return (
      "₹" +
      Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })
    );
  }

  var debitRow =
    rows.filter(function (r) {
      return (r.tx_type || "").trim() === "Debit";
    })[0] || {};
  var creditRow =
    rows.filter(function (r) {
      return (r.tx_type || "").trim() === "Credit";
    })[0] || {};

  var amount = parseFloat(debitRow.amount || creditRow.amount) || 0;
  var scrollNo = debitRow.scroll_no || creditRow.scroll_no || "";

  function acctCell(label, r) {
    return (
      '<td style="border:1px solid #000;padding:6px 8px;vertical-align:top;width:50%">' +
      '<div style="font-size:7.8pt;color:#555;margin-bottom:2px">' +
      label +
      "</div>" +
      '<div style="font-weight:700">' +
      (r.name || "") +
      "</div>" +
      "<div>Acc No: " +
      (r.acc_no || "") +
      "</div>" +
      (r.balance_after != null && r.balance_after !== ""
        ? "<div>Balance After: " + fmtRs(r.balance_after) + "</div>"
        : "") +
      "</td>"
    );
  }

  return (
    '<div class="page" style="padding:8mm 12mm;box-sizing:border-box">' +
    '<div style="page-break-inside:avoid;border-top:1.5px dashed #666;padding-top:8px;margin-top:8px">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px">' +
    '<div style="font-weight:800;font-size:10pt">' +
    hdr +
    "</div>" +
    '<div style="font-size:9pt;white-space:nowrap">Date - ' +
    (dtFmt || "—") +
    "</div>" +
    "</div>" +
    '<div style="font-size:9.5pt;margin:2px 0 6px">Saving Account Transfer Voucher' +
    (scrollNo ? " (Ref/Scroll No: " + scrollNo + ")" : "") +
    "</div>" +
    '<table style="width:100%;border-collapse:collapse;font-size:9pt">' +
    "<tr>" +
    acctCell("FROM (Debit)", debitRow) +
    acctCell("TO (Credit)", creditRow) +
    "</tr>" +
    "</table>" +
    '<div style="font-size:9.5pt;margin:8px 0">Transfer Amount: <strong>' +
    fmtRs(amount) +
    "</strong> (" +
    numberToWords(amount) +
    ")</div>" +
    '<div style="display:flex;justify-content:space-between;padding:14px 20px 4px">' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:14px;min-width:55mm;margin-bottom:3px"></div><div style="font-size:8.5pt">लेखापाल / खातेपाल</div></div>' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:14px;min-width:55mm;margin-bottom:3px"></div><div style="font-size:8.5pt">व्यवस्थापक / अधिकारी</div></div>' +
    "</div>" +
    "</div>" +
    "</div>"
  );
}

// Helper: number to words for voucher totals — rupees, plus paise when the
// amount has a fractional part (e.g. 23.60 → "Twenty Three and Sixty
// Paisa"). Previously this floored to whole rupees and silently dropped any
// paise, so a total like ₹23.60 printed as just "Twenty Three" in words —
// inconsistent with the numeral shown right next to it.
function numberToWords(n) {
  n = Number(n) || 0;
  var rupees = Math.floor(n);
  var paise = Math.round((n - rupees) * 100);
  if (paise >= 100) {
    rupees += 1;
    paise -= 100;
  }
  if (rupees === 0 && paise === 0) return "Zero";

  var ones = [
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
  var tens = [
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
  function hw(num) {
    if (num < 20) return ones[num];
    if (num < 100)
      return (
        tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "")
      );
    if (num < 1000)
      return (
        ones[Math.floor(num / 100)] +
        " Hundred" +
        (num % 100 ? " " + hw(num % 100) : "")
      );
    if (num < 100000)
      return (
        hw(Math.floor(num / 1000)) +
        " Thousand" +
        (num % 1000 ? " " + hw(num % 1000) : "")
      );
    if (num < 10000000)
      return (
        hw(Math.floor(num / 100000)) +
        " Lakh" +
        (num % 100000 ? " " + hw(num % 100000) : "")
      );
    return (
      hw(Math.floor(num / 10000000)) +
      " Crore" +
      (num % 10000000 ? " " + hw(num % 10000000) : "")
    );
  }

  var parts = [];
  if (rupees > 0) parts.push(hw(rupees));
  if (paise > 0) parts.push(hw(paise) + " Paisa");
  return parts.join(" and ");
}

// ─── Dispatch ────────────────────────────────────────────────
function buildHTMLPage(txType, data) {
  var nm = fv(data.customer_name);
  // Truncate address to just the town/village name.
  // Strips everything from the first dot, TAL, DIST, PIN, or comma onward.
  var addr = (function (raw) {
    if (!raw || raw === "—") return raw || "—";
    var town = raw
      .replace(/\s*\bTAL\s*:?.*$/i, "") // remove TAL : ... onwards
      .replace(/\s*\bDIST\s*:?.*$/i, "") // remove DIST : ... onwards
      .replace(/\s*\bPIN\s*:?.*$/i, "") // remove PIN : ... onwards
      .replace(/\s*\bDISTRICT\s*:?.*$/i, "")
      .replace(/\s*\bTALUKA\s*:?.*$/i, "")
      .split(/[.,]/)[0] // take segment before first dot or comma
      .trim();
    return town || raw.trim();
  })(fv(data.address));
  var dtFmt = fmtDate(fv(data.date));
  var mob = fv(data.mobile);
  var occ = fv(data.occupation);
  var aadh = fv(data.aadhar);
  var cid = fv(data.customer_id);
  var savAcc = fv(data.saving_acc_no);
  var shrAcc = fv(data.share_acc_no);
  var lnAcc = fv(data.loan_acc_no);
  var fdAcc = fv(data.fd_acc_no);
  var fdPv = fv(data.fd_parvati_no);
  var pan = fv(data.pan);
  var dob = fv(data.dob);
  var nom = fv(data.nominee_name);
  var nomRel = fv(data.nominee_relation);
  var ref = fv(data.referral);
  var lnAmt = fv(data.loan_amount);
  var lnWrd = fv(data.loan_amount_words);
  var fdAmt = fv(data.fd_amount);
  var fdWrd = fv(data.fd_amount_words);
  var fdPrd = fv(data.fd_period);
  var fdRate = fv(data.fd_interest_rate);
  var fdMat = fv(data.fd_maturity_date);
  var fdMatAmt = fv(data.fd_maturity_amount);
  var fdMatWrd = fv(data.fd_maturity_words);
  var ornWt = fv(data.ornament_weight);
  var ornQty = fv(data.ornament_qty);
  var goldOrn = fv(data.gold_ornaments);
  var silvOrn = fv(data.silver_ornaments);
  // New per-item ornament list: data.ornament_items = [{name, qty, weight}, ...]
  var ornItems =
    data.ornament_items &&
    Array.isArray(data.ornament_items) &&
    data.ornament_items.length
      ? data.ornament_items.filter(function (r) {
          return r.name && r.name.trim();
        })
      : null;
  // Compute totals from items if available
  if (ornItems && ornItems.length) {
    var _totalQty = 0,
      _totalWt = 0,
      _goldNames = [],
      _silvNames = [];
    ornItems.forEach(function (r) {
      _totalQty += parseInt(r.qty) || 0;
      _totalWt +=
        r.weight !== null && r.weight !== undefined
          ? parseFloat(r.weight) || 0
          : 0;
      var nm_lower = (r.name || "").toLowerCase();
      if (nm_lower.indexOf("silver") !== -1 || nm_lower.indexOf("चांदी") !== -1)
        _silvNames.push(r.name);
      else _goldNames.push(r.name);
    });
    if (data.ornament_qty == null)
      ornQty = _totalQty > 0 ? String(_totalQty) : ornQty;
    if (data.ornament_weight == null)
      ornWt = _totalWt != null ? String(_totalWt) : ornWt;
    if (!data.gold_ornaments) goldOrn = _goldNames.join(", ") || goldOrn;
    if (!data.silver_ornaments) silvOrn = _silvNames.join(", ") || silvOrn;
  }
  var metal = fv(data.metal_type, "Gold");
  var comments = fv(data.comments);
  var misAccNo = fv(data.mis_acc_no);
  var misMonth = fv(data.mis_month_select);
  var intAmt = fv(data.interest_amount);
  var intWrd = fv(data.interest_amount_words);
  var depAmt = fv(data.deposit_amount); // saving deposit/withdrawal amount
  var depWrd = fv(data.deposit_amount_words);
  var savBal = data.saving_balance != null ? String(data.saving_balance) : null;
  var bankName = data.bank_acc_name ? String(data.bank_acc_name).trim() : "";
  var photoOrn = data.photo_ornament || null;
  var photoCust = data.photo_customer || null;
  var photoAF = data.photo_aadhar_front || null;
  var photoAB = data.photo_aadhar_back || null;
  var photoPan = data.photo_pan || null;
  var photoFd = data.photo_fd || null; // FD receipt photo (FD-OD forms)

  // Build compact photo array for non-gold forms
  var docPhotos = [
    { src: photoCust, label: "Customer Photo" },
    { src: photoAF, label: "Aadhar Front" },
    { src: photoAB, label: "Aadhar Back" },
    { src: photoPan, label: "PAN Card" },
    { src: photoFd, label: "FD Photo" },
  ];

  if (txType === "Int Recv GL Voucher")
    return glIntVoucherPage(data._closedLoans || [], dtFmt);

  if (txType === "Int Recv FDOD Voucher")
    return fdodIntVoucherPage(data._closedLoans || [], dtFmt);

  if (txType === "Bank TRF Voucher")
    return bankTRFVoucherPage(data._bankRows || [], dtFmt);
  if (txType === "Saving Acc Transfer")
    return savingAccTransferVoucherPage(data._transferRows || [], dtFmt);

  if (txType === "Gold Loan")
    return goldLoanPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      shrAcc,
      lnAcc,
      pan,
      nom,
      nomRel,
      lnAmt,
      lnWrd,
      ornWt,
      ornQty,
      goldOrn,
      silvOrn,
      metal,
      comments,
      photoOrn,
      null,
      ornItems,
    );
  if (txType === "Slips - Loan")
    return loanSlipPage(
      nm,
      dtFmt,
      lnAmt,
      lnWrd,
      lnAcc,
      savAcc,
      photoCust,
      ornItems,
      ornWt,
      ornQty,
      goldOrn,
      silvOrn,
    );
  if (txType === "Slips - FD-OD")
    return odLoanSlipPage(
      nm,
      dtFmt,
      lnAmt,
      lnWrd,
      lnAcc,
      savAcc,
      fdAcc,
      fdPv,
      fdAmt,
      fdWrd,
    );
  if (txType === "Gold Receipt")
    return goldReceiptPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      lnAcc,
      lnAmt,
      lnWrd,
      ornWt,
      ornQty,
      goldOrn,
      silvOrn,
      metal,
      ornItems,
    );
  if (txType === "Sadasya")
    return sadasya_FormPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      shrAcc,
      pan,
      dob,
      occ,
      nom,
      nomRel,
      ref,
      comments,
      docPhotos,
    );
  if (txType === "Sadasya - Slips")
    return sadasya_SlipsPage(nm, dtFmt, savAcc, shrAcc);
  if (txType === "Naammatr Sabhasad Account")
    return naammatr_FormPage(nm, addr, dtFmt, dob, shrAcc, ref, docPhotos);
  if (txType === "Naammatr Sabhasad - Slips")
    return naammatr_SlipsPage(nm, dtFmt, savAcc, shrAcc);
  if (txType === "Saving Account")
    return savingAccount_FormPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      shrAcc,
      pan,
      dob,
      nom,
      nomRel,
      ref,
      comments,
      docPhotos,
    );
  if (txType === "Saving - Deposit Slip") {
    // For new saving account opening, saving_balance is the opening deposit amount
    var _sdAmt = depAmt || fdAmt || lnAmt;
    var _sdWrd = depWrd;
    var _sdBal = savBal; // track whether we consumed savBal as the amount
    if (!_sdAmt && savBal) {
      var _sdBalNum = parseFloat(String(savBal).replace(/,/g, "")) || 0;
      if (_sdBalNum > 0) {
        _sdAmt = _sdBalNum.toLocaleString("en-IN");
        if (!_sdWrd) _sdWrd = numberToWords(_sdBalNum);
        _sdBal = null; // savBal was consumed as the deposit amount — don't pass it again
      }
    }
    return savingDepositSlipPage(
      nm,
      dtFmt,
      savAcc,
      _sdAmt,
      _sdWrd,
      bankName,
      _sdBal,
    );
  }
  if (txType === "Saving - Withdrawal Slip")
    return savingWithdrawalSlipPage(
      nm,
      dtFmt,
      savAcc,
      depAmt || fdAmt || lnAmt,
      depWrd,
      bankName,
      savBal,
    );
  if (txType === "Saving Deposit")
    return savingDepositSlipPage(
      nm,
      dtFmt,
      savAcc,
      depAmt || fdAmt || lnAmt,
      depWrd,
      bankName,
      savBal,
    );
  if (txType === "Saving Withdrawal")
    return savingWithdrawalSlipPage(
      nm,
      dtFmt,
      savAcc,
      depAmt || fdAmt || lnAmt,
      depWrd,
      bankName,
      savBal,
    );
  if (txType === "Fixed Deposit" || txType === "New FD")
    return fd_FormPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      shrAcc,
      fdAcc,
      fdPv,
      pan,
      dob,
      nom,
      nomRel,
      ref,
      fdAmt,
      fdWrd,
      fdPrd,
      fdRate,
      fdMat,
      fdMatAmt,
      fdMatWrd,
      comments,
      docPhotos,
    );
  // MIS FD opening form — same layout, uses mis_acc_no as the FD acc, different title
  if (txType === "Fixed Deposit - MIS")
    return fd_FormPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      shrAcc,
      misAccNo && misAccNo !== "—" ? misAccNo : "290-",
      fdPv,
      pan,
      dob,
      nom,
      nomRel,
      ref,
      fdAmt,
      fdWrd,
      fdPrd,
      fdRate,
      fdMat,
      fdMatAmt,
      fdMatWrd,
      comments,
      docPhotos,
    );
  if (txType === "FD - Slips")
    return fd_SlipsPage(nm, dtFmt, savAcc, fdAcc, fdPv, fdAmt, fdWrd);
  // MIS FD opening slips — uses mis_acc_no as the account number
  if (txType === "FD - Slips - MIS")
    return fd_SlipsPage(
      nm,
      dtFmt,
      savAcc,
      misAccNo && misAccNo !== "—" ? misAccNo : "290-",
      fdPv,
      fdAmt,
      fdWrd,
    );
  if (txType === "Form 60-61") return form6061Page(nm, addr, dtFmt);
  if (txType === "Blank Page") return '<div class="spage-blank"></div>';
  if (txType === "OD Loan" || txType === "New FD-OD Loan")
    return od_FormPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      fdAcc,
      fdPv,
      lnAcc,
      pan,
      dob,
      nom,
      nomRel,
      lnAmt,
      lnWrd,
      fdAmt,
      fdWrd,
      fdMat,
      comments,
      docPhotos,
    );
  if (txType === "Closing - Loan")
    return loanClosing_FormPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      shrAcc,
      lnAcc,
      pan,
      nom,
      nomRel,
      lnAmt,
      lnWrd,
      goldOrn,
      silvOrn,
      ornWt,
      comments,
      photoOrn,
      ornItems,
    );
  if (txType === "Closing - FD")
    return fdClosing_FormPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      shrAcc,
      fdAcc,
      fdPv,
      pan,
      nom,
      nomRel,
      fdAmt,
      fdWrd,
      fdPrd,
      fdMat,
      fdMatAmt,
      fdMatWrd,
      comments,
      docPhotos,
    );
  if (txType === "Closing - FD - Slips")
    return fdClosingSlips_Page(
      nm,
      dtFmt,
      savAcc,
      fdAcc,
      fdMatAmt,
      fdMatWrd,
      fdAmt,
      fdWrd,
    );
  if (txType === "Closing - Saving Account")
    return savingClosing_FormPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      shrAcc,
      pan,
      comments,
      docPhotos,
    );

  if (txType === "Closing - OD")
    return odClosing_FormPage(
      nm,
      addr,
      dtFmt,
      mob,
      aadh,
      cid,
      savAcc,
      shrAcc,
      fdAcc,
      fdPv,
      lnAcc,
      pan,
      nom,
      nomRel,
      lnAmt,
      lnWrd,
      fdAmt,
      fdWrd,
      fdMat,
      comments,
      docPhotos,
    );

  // MIS Interest: only slips, no form page
  if (txType === "MIS Interest") return "";
  if (txType === "MIS Interest - Slips")
    return misInterestSlipsPage(
      nm,
      dtFmt,
      savAcc,
      misAccNo,
      fdAmt,
      fdWrd,
      fdPrd,
      fdRate,
      fdMat,
      intAmt,
      intWrd,
      misMonth,
    );

  // RTGS — clean Debit/Credit/BankCharges voucher format
  if (txType === "RTGS") {
    var rtgsFrom2 = fv(data.rtgs_from_acc);
    var rtgsTo2 = fv(data.rtgs_to_acc);
    var rtgsAmt2 = parseFloat(fv(data.expense_amount)) || 0;
    var rtgsChg2 = parseFloat(fv(data.rtgs_bank_charges)) || 0;
    var rtgsUpi2 = fv(data.upi_rrn) || fv(data.cheque_no) || "";
    var BANK_ACC_MAP2 = {
      "Buldhana Urban Bank - Current Acc (015002100000260)": "945-2",
      "Bank of Maha - FD-OD (60494510691)": "946-2",
      "Bank of Maha - Current Acc (60438097699)": "288-1",
      "THE N.U. BANK Current Acc (003002100000926)": "926-2",
      "Rajarshi Shahu Curr (03202007000046)": "960-2",
      "The Sahyog Urban Curr Acc (8001173)": "952-2",
      "SBI Current Acc (43227989097)": "953-1",
    };
    var rtgsRows = [
      {
        tx_type: "Debit",
        acc_type: rtgsFrom2,
        acc_no: BANK_ACC_MAP2[rtgsFrom2] || "—",
        name: rtgsFrom2,
        amount: rtgsAmt2,
        scroll_no: "",
        upi_rrn: rtgsUpi2,
      },
      {
        tx_type: "Credit",
        acc_type: rtgsTo2,
        acc_no: BANK_ACC_MAP2[rtgsTo2] || "—",
        name: rtgsTo2,
        amount: rtgsAmt2,
        scroll_no: "",
        upi_rrn: rtgsUpi2,
      },
    ];
    if (rtgsChg2 > 0) {
      rtgsRows.push({
        tx_type: "Debit",
        acc_type: "Bank Charges",
        acc_no: "101-1",
        name: "Bank Charges TRF",
        amount: rtgsChg2,
        scroll_no: "",
        upi_rrn: "",
      });
    }
    return bankTRFVoucherPage(rtgsRows, dtFmt);
  }

  // Internal bank transactions → clean Debit/Credit voucher (same as RTGS)
  var internalBankTypes = [
    "Bank Charges",
    "Other Bank - Cash Withdrawal",
    "Other Bank - Cash Deposit",
    "TDS",
    "Interest Received on FD from Other Bank",
  ];
  if (internalBankTypes.includes(txType)) {
    var expAmt3 = parseFloat(fv(data.expense_amount)) || 0;
    var bankNm3 = fv(data.bank_acc_name);
    var expAcc3 = fv(data.expense_acc_no);
    var upiRrn3 = fv(data.upi_rrn) || fv(data.cheque_no) || "";
    var BANK_ACC_MAP3 = {
      "Buldhana Urban Bank - Current Acc (015002100000260)": "945-2",
      "Bank of Maha - FD-OD (60494510691)": "946-2",
      "Bank of Maha - Current Acc (60438097699)": "288-1",
      "THE N.U. BANK Current Acc (003002100000926)": "926-2",
      "Rajarshi Shahu Curr (03202007000046)": "960-2",
      "The Sahyog Urban Curr Acc (8001173)": "952-2",
      "SBI Current Acc (43227989097)": "953-1",
    };
    var intRows = [];
    if (txType === "Bank Charges") {
      intRows = [
        {
          tx_type: "Credit",
          acc_type: bankNm3 || "Bank TRF",
          acc_no: BANK_ACC_MAP3[bankNm3] || expAcc3 || "—",
          name: bankNm3 || "Bank Account",
          amount: expAmt3,
          scroll_no: "",
          upi_rrn: upiRrn3,
        },
        {
          tx_type: "Debit",
          acc_type: "Bank Charges",
          acc_no: "101-1",
          name: "Bank Charges TRF",
          amount: expAmt3,
          scroll_no: "",
          upi_rrn: "",
        },
      ];
    } else if (txType === "Other Bank - Cash Withdrawal") {
      // Single row only — the separate "Bank Cash" placeholder row (using
      // whatever acc no the user manually typed) was removed per user
      // request; only the resolved bank-account entry prints now.
      intRows = bankNm3
        ? [
            {
              tx_type: "Credit",
              acc_type: bankNm3 + " - Deposit",
              acc_no: BANK_ACC_MAP3[bankNm3] || "—",
              name: bankNm3,
              amount: expAmt3,
              scroll_no: "",
              upi_rrn: upiRrn3,
            },
          ]
        : [];
    } else if (txType === "Other Bank - Cash Deposit") {
      // Single row only — see "Other Bank - Cash Withdrawal" above.
      intRows = bankNm3
        ? [
            {
              tx_type: "Debit",
              acc_type: bankNm3 + " - Withdrawal",
              acc_no: BANK_ACC_MAP3[bankNm3] || "—",
              name: bankNm3,
              amount: expAmt3,
              scroll_no: "",
              upi_rrn: upiRrn3,
            },
          ]
        : [];
    } else if (txType === "TDS") {
      intRows = [
        {
          tx_type: "Debit",
          acc_type: "Advance TDS",
          acc_no: "936-1",
          name: "Advance Cutting For TDS",
          amount: expAmt3,
          scroll_no: "",
          upi_rrn: upiRrn3,
        },
        {
          tx_type: "Credit",
          acc_type: "Advance TDS",
          acc_no: BANK_ACC_MAP3[bankNm3] || expAcc3 || "—",
          name: bankNm3 || "Bank TDS",
          amount: expAmt3,
          scroll_no: "",
          upi_rrn: "",
        },
      ];
    } else if (txType === "Interest Received on FD from Other Bank") {
      var fdAcc3 = fv(data.fd_acc_no);
      intRows = [
        {
          tx_type: "Credit",
          acc_type: "Int Received FD",
          acc_no: fdAcc3 || "00103046000003",
          name: "Interest Received on FD - TRF",
          amount: expAmt3,
          scroll_no: "",
          upi_rrn: upiRrn3,
        },
        {
          tx_type: "Debit",
          acc_type: "Bank TRF",
          acc_no: BANK_ACC_MAP3[bankNm3] || expAcc3 || "—",
          name: bankNm3 || "Bank Account",
          amount: expAmt3,
          scroll_no: "",
          upi_rrn: "",
        },
      ];
    }
    // Tapasani (gold/silver valuation inspector's certificate) — appended
    // twice, on the same page below the voucher, for the two Other Bank
    // cash transaction types only. Confirmed to fit one printed A4 page
    // with typical data; very long names/account strings could push it
    // onto a second page.
    var tapasaniAfterTypes = ["Other Bank - Cash Withdrawal", "Other Bank - Cash Deposit"];
    var extraHtml = tapasaniAfterTypes.includes(txType)
      ? '<div style="border-top:1.5px dashed #666;margin:8px 0"></div>' +
        mkCertificate() +
        '<div style="border-top:1.5px dashed #666;margin:8px 0"></div>' +
        mkCertificate()
      : "";
    return bankTRFVoucherPage(intRows, dtFmt, extraHtml);
  }

  // Customer-facing bank transactions (saving account involved) → 3-slip format
  var custBankTypes = [
    "Payment Received - Online",
    "Payment Transfer - Online",
  ];
  if (custBankTypes.includes(txType)) {
    var expAmt2 = fv(data.expense_amount);
    var expWrd2 = fv(data.expense_amount_words);
    var expAcc2 = fv(data.expense_acc_no);
    var bankNm2 = fv(data.bank_acc_name);
    var upiRrn2 = fv(data.upi_rrn);
    var chqNo2 = fv(data.cheque_no);
    return bankTransactionVoucherPage(
      txType,
      nm,
      dtFmt,
      savAcc,
      bankNm2,
      expAcc2,
      expAmt2,
      expWrd2,
      upiRrn2,
      chqNo2,
      comments,
      "",
      "",
      "",
    );
  }

  if (txType === "Employee Salary") {
    var salAmt = fv(data.expense_amount);
    var salWrd = fv(data.expense_amount_words);
    var salMon = fv(data.salary_month_select, "");
    return employeeSalaryPage(
      nm,
      dtFmt,
      savAcc,
      salAmt,
      salWrd,
      salMon,
      comments,
    );
  }

  return genericPage(
    txType,
    data,
    nm,
    addr,
    dtFmt,
    savAcc,
    shrAcc,
    lnAcc,
    fdAcc,
    fdPv,
    pan,
    dob,
    nom,
    nomRel,
    ref,
    lnAmt,
    lnWrd,
    fdAmt,
    fdWrd,
    fdPrd,
    fdRate,
    fdMat,
    fdMatAmt,
    fdMatWrd,
    ornWt,
    goldOrn,
    silvOrn,
    metal,
    comments,
    cid,
    aadh,
    mob,
  );
}

// Blank pages after slips/receipts are appended to prevent printing on reverse side.

// ═══════════════════════════════════════════════════════
//  GOLD LOAN PAGE
// ═══════════════════════════════════════════════════════
function goldLoanPage(
  nm,
  addr,
  dtFmt,
  mob,
  aadh,
  cid,
  savAcc,
  shrAcc,
  lnAcc,
  pan,
  nom,
  nomRel,
  lnAmt,
  lnWrd,
  ornWt,
  ornQty,
  goldOrn,
  silvOrn,
  metal,
  comments,
  photoOrn,
  docPhotos,
  ornItems,
) {
  var sabNo = cid !== "—" ? "#" + cid : "—";

  // ── 6-column info table (fixed layout) ──
  // Widths: 17% | 25% | 13% | 21% | 12% | 12%
  // Rows match reference PDF exactly:
  // 1: पूर्ण नाव [val colspan3] | कर्ज खाते क्र. | val
  // 2: पत्ता [val colspan3]     | बचत खाते क्र.  | val
  // 3: कर्ज दि. [val colspan3] | सभासद क्र.     | val
  // 4: आधार कार्ड | val | शेअर खाते क्र. | val [colspan3]
  // 5: कर्ज रक्कम | val(words) | कर्ज रक्कम | val(Rs.) [colspan3]
  // 6: पॅन कार्ड | val | मो.न. | val | वारसदाराचे नाव | val+नाते
  var infoTbl =
    '<table class="it" style="margin:0">' +
    '<colgroup><col style="width:17%"><col style="width:25%"><col style="width:13%"><col style="width:21%"><col style="width:12%"><col style="width:12%"></colgroup>' +
    "<tr>" +
    '<td class="lbl">पूर्ण नाव</td>' +
    '<td class="vbig" colspan="3">' +
    nm +
    "</td>" +
    '<td class="lbl">कर्ज खाते क्र.</td>' +
    '<td class="vbig">' +
    lnAcc +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td class="lbl">पत्ता</td>' +
    '<td class="val" colspan="3">' +
    addr +
    "</td>" +
    '<td class="lbl">बचत खाते क्र.</td>' +
    '<td class="vbig">' +
    savAcc +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td class="lbl">कर्ज दि.</td>' +
    '<td class="vbig" colspan="3">' +
    dtFmt +
    "</td>" +
    '<td class="lbl">सभासद क्र.</td>' +
    '<td class="val">' +
    sabNo +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td class="lbl">आधार कार्ड</td>' +
    '<td class="val">' +
    aadh +
    "</td>" +
    '<td class="lbl" style="font-size:8.5pt">वारसदाराचे नाव</td>' +
    '<td class="val" colspan="3">' +
    nom +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td class="lbl">पॅन कार्ड</td>' +
    '<td class="val">' +
    pan +
    "</td>" +
    '<td class="lbl">मो.न.</td>' +
    '<td class="val">' +
    mob +
    "</td>" +
    '<td class="lbl" style="font-size:8pt">शेअर खाते क्र.</td>' +
    '<td class="val" style="font-size:8.5pt">' +
    shrAcc +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td class="lbl" style="white-space:nowrap">कर्ज रक्कम (Rs.)</td>' +
    '<td class="val" colspan="5" style="font-weight:800">रू. ' +
    lnAmt +
    ' /- <span style="font-weight:400;font-size:9pt">( अक्षरी रू. ' +
    lnWrd +
    " )</span></td>" +
    "</tr>" +
    "</table>";

  // ── Request Letter ──
  var reqLetter =
    '<div class="bp yl" style="padding:3px 10px;font-size:8pt;line-height:1.5">' +
    "प्रति,<br>" +
    "व्यवस्थापक , जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसायटी लि., जळगाव जामोद<br><br>" +
    "महोदय, मी खालील सही करणार आपणाकडे खालील दिलेल्या तपशिलाप्रमाणे माझ्या मालकीचे सोने/ चांदी , सोन्या - चांदी चे दागीने, चिजवस्तू आपणाकडे " +
    "तारण ठेवत आहे. त्याच्या तारणावर मला <strong>रू." +
    lnAmt +
    "/- (अक्षरी रू. " +
    lnWrd +
    ")</strong> कर्ज द्यावे ही विनंती. माझे वार्षिक उत्पन्न " +
    "रुपये______ इतके आहे. सदर रक्कम_______ कामाकरीता पाहीजे आहे. कर्जाची परतफेड मी दरमहा रू……….... प्रमाणे करेल. कर्ज प्रकारणात तारण देत " +
    "असलेले सोने, चांदी, सोनेचांदीचे दागिने / चिजवस्तू पूर्णपणे माझ्या मालकीचे आहेत. भविष्यात त्याबाबत कोणताही वाद उपस्थित झाल्यास त्यास मी वैयक्तिक " +
    "त्याचप्रमाणे माझी मालमत्ता माझे इस्टेट वारस जबाबदार राहील. ह्या कर्ज योजनेबाबत आपल्या संस्थेला लागू असलेले नियम व अटी, शर्ती बाबत मी वाचून " +
    "समजून घेतल्या असून त्या मला मान्य आहेत. ह्या मध्ये संस्थेचे सचालक मंडळाच्या शासनाच्या धोरणामुळे वेळोवेळी होणारे बदल मला मान्य राहतील. व " +
    "माझेवर व माझ्या ईस्टेट वारसास लागू राहतील. मी हे शपथेवर नमुद करतो, वर नमुद केलेल्या सोने, चांदी व सोनेचांदी चे आभूषण , चिजवस्तू ह्या माझे " +
    "वैयक्तिक मालकीचे आहेत ते स्त्रीधन नाही. प्रस्तुत कर्ज प्रकरणामध्ये नमुद केलेली कोणतीही माहिती व वस्तस्थिती नमुद केल्याप्रमाणे नसल्यास मी फौजदारी " +
    "कायद्याप्रमाणे कारवाईस पात्र राहील." +
    '<div style="text-align:right;margin-top:12mm">' +
    sigLine(nm, "कर्जदाराची सही") +
    "</div>" +
    "</div>";

  // ── Approval section ──
  var approval =
    '<div class="bp gr" style="padding:3px 10px;font-size:8pt;line-height:1.5">' +
    "श्री/श्रीमती <strong>" +
    nm +
    "</strong> याना मागील तपशिलाप्रमाणे सोने/चांदी च्या बाजारभाव किंमत /- इतकी " +
    "असून त्यावर 85 टक्के प्रमाणे तारण कर्ज रक्कम रूपये <strong>" +
    lnAmt +
    "/- मंजूर करण्यात येत आहे</strong>. " +
    "ते संचालक मंडळाच्या दि.&nbsp;&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;/2026 सभेतील ठराव क्र……......नुसार कर्ज प्रकरण मंजूर/कायम करण्यात येत आहे." +
    '<div style="display:flex;justify-content:space-between;margin-top:5px">' +
    '<div>परिचय करून देणाऱ्याचे नाव व पत्ता<br><span style="display:inline-block;border-bottom:1px solid #000;min-width:130px;height:16px">&nbsp;</span></div>' +
    '<div style="text-align:center">सही<br><span style="display:inline-block;border-bottom:1px solid #000;min-width:80px;height:16px">&nbsp;</span></div>' +
    '<div style="text-align:right">प्राधिकृत अधिकारी…..…………………………</div>' +
    "</div>" +
    "</div>";

  // ── Vachanchithi ──
  var vach =
    '<div class="vach" style="margin:2px 8px;padding:3px 10px;font-size:8pt;line-height:1.5">' +
    '<div class="vach-t" style="font-size:9pt;padding-bottom:1px;margin-bottom:2px">* वचनचिठ्ठी *</div>' +
    "मी <strong>" +
    nm +
    "</strong> , 'जळगाव जामोद अर्बन को-ऑप क्रेडीट सोसा मर्या जळगाव (जा) यास<br>" +
    "अगर ती लिहून देईल त्यास मी कर्ज घेतलेली रक्कम <strong>Rs. " +
    lnAmt +
    " /-</strong><br>" +
    "अक्षरी रू.<strong>" +
    lnWrd +
    "</strong>&nbsp;&nbsp; द.सा.द.शे. रू.………… प्रमाणे दरमहा व्याज आकारणी<br>" +
    "पध्दतीनुसार माझेकडे मागणी केली जाईल त्यावेळी व त्या ठिकाणी परत करण्याचे वचन देतो." +
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<strong>कर्जदाराची सही........................</strong>" +
    "</div>";

  // ── Full Rules (from reference document) ──
  var rules =
    '<div class="rules" style="padding:2px 10px 2px">' +
    '<div class="rules-t" style="font-size:8pt;margin-bottom:1px;padding-bottom:1px">* सोने किंवा चांदी चे तारणावर दिल्या जाणाऱ्या कर्ज बाबत चे नियम *</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">सोने किंवा चांदीचे तारणावर कर्ज घेणारा इसम या संस्थेचा कायम, मानद किंवा नाममात्र सभासद असावा.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">हे कर्ज जास्तीत जास्त १२ महिने मुदतीचे राहील. प्रत्येक खात्याला स्टेशनरी चार्जेस संस्थेच्या नियमाप्रमाणे लागु असतील.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">या कर्ज साठी तारण ठेवण्याच्या सोने किंवा चांदीच्या वस्तु, दागिनेची शुद्धता किंमत व वजन संस्थेने नेमलेल्या अधिकृत सराफाकडून किंवा संस्थेचे अधिकारी ला मान्य झाल्यानंतरच कर्ज मंजुर करण्यात येईल.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">सराफाने ठरवून दिलेल्या किंमतीच्या संस्थेचे निश्चित केलेल्या टक्केवारीप्रमाणे कर्ज कर्जदारास दिले जाईल. परंतु असे कर्ज कमीत कमीत रुपये ५००/- व जास्तीत जास्त संस्थेच्या नियमानुसार असावे.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">तारण वस्तुची शुद्धता ठरविण्याबाबत सराफास द्यावयाची फी संस्थेच्या नियमाप्रमाणे देणे आवश्यक आहे.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">कर्ज परतफेडीच्या मुदतीत कर्जदाराचे कर्जचे पूर्णपणे व्याजासह फेड करुन तारण दिलेल्या वस्तु सोडवून घेतल्या पाहिजे. मुदतीपूर्वी कर्जफेड न केल्यास कर्जदारास १५ दिवसाची रजिस्टर्ड नोटीस द्वारे याबाबत जाणीव करुन दिली जाईल. तरी देखील कर्जदाराने परतफेड न केल्यास तारण सोने, सोन्याचे किंवा चांदीचे दागिने जाहीर लिलावाने किंवा अधिकृत परवानाधारक सराफास सोने बाजारात विक्री करण्यात येईल. अशा रितीने विक्री करून आलेली रक्कम मुदत व्याज यापेक्षा कमी असल्यास उरलेली रक्कम सभासदाकडून वसुल करण्यात येईल व ही कमी रक्कम भरण्याची जबाबदारी सभासदाची राहील. कर्जदार सभासदाच्या पत्त्यामध्ये व मोबाईल नंबरमध्ये बदल झाल्यास तो कळविण्याची जबाबदारी कर्जदाराची राहील. असे न केल्यास व त्यामुळे पत्रव्यवहार अपूर्ण राहिल्यास त्यासाठी संस्था जबाबदार राहणार नाही.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">मौल्यवान तारण वस्तुची अधिकृत किंमत, वजन व त्याची प्रत तारणावर दिलेले कर्ज वगैरे दर्शविणारे रजिस्टर ठेवले जाईल.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">कर्जदराला या कर्जबाबत संस्थेकडे डिमाड प्रोमिसरी नोट लिहून द्यावी लागेल. कर्जफेडीनंतर कर्जदारास माल ताब्यात मिळ्याबात पोच पावती यादी लागेल.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">तारण द्यावयाचे सोने, चांदी किंवा सोन्या-चांदीचे दागिने एकापेक्षा जास्त व्यक्तीचे, मालकीचे असल्यास तसा उल्लेख कर्जदारास अर्जत करावा लागेल व अर्ज वर हक्कदार व्यक्तीच्या सह्या घ्याव्या लागतील. माल परत करताना तो कोणास द्यावा याचाही अर्जत खुलासा करावा लागेल.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">कर्ज मंजुर करण्याचे अधिकार अध्यक्ष / डायरेक्टर / व व्यवस्थापक / प्राधिकृत अधिकारी यास राहील. या कर्जस अंतिम मंजुरी संचालक मंडळाची राहील.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">तारण वस्तु सोडविण्यापूर्वी अर्जदाराचा मृत्यु झाल्यास संस्था कर्जदाराकडून येणे असलेली रक्कम व्याजासह व खर्च सह वारसदाराकडून वसुल करेल.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">कर्जदारास कर्ज मागणी अर्जत नामनिर्देशित व्यक्तीचे नाव नमुद करावे लागेल. म्हणजे संस्था घेणे असलेली कर्जची रकम व्याजासह वसुल करुन तारण ठेवलेल्या वस्तु कायदेशीर वारसदार अथवा प्रतिनिधीस परत करता येतील. अशावेळी आवश्यकतेनुसार कायदेशीर दस्ताची पूर्तता करुन घ्यावी लागेल.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">कोणत्याही इसमास कर्ज नाकारण्यात तसेच या नियमात फेरबदल करण्याचा अधिकार संस्थेला राहील.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">सदरहू व्यवहाराबाबत कोणताही वाद झाल्यास अथवा थकीत वसुल पात्र रकमेकरिता किंवा उर्वरित बाकी कर्ज रकमेकरीता संस्थेच्या कायदेस अधीन राहुन सर्व अधिकार संस्थेस राहतील.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">संस्थेकडे जे दागिने गहाण ठेवले जातील त्या दागिन्याच्या पाकिटावर कर्जदाराची संस्थेच्या व्यवस्थापकाची सही व सिल राहील. त्याबाबत वाद उपस्थित करण्याचा अधिकार कर्जदारास राहणार नाही.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">सोनेचांदी तारण वस्तु सील केलेले पाकीटअंतर्गत तपासणीच्या दृष्टीने आवश्यक वाटल्यास संस्थेचे अधिकारी तज्ञ याचे समक्ष सील / पाकीट फोडून तपासणी केली जाईल व त्याच सहिने पुन्हा रितसर सील केले जातील यास माझी / आमची काही हरकत नाही व त्याबाबत कर्जदारास वाद उपस्थित करण्याचा अधिकार राहणार नाही.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">कोणत्या कारणाने कर्ज तारण ठेवलेल्या दागिण्याबाबत कर्जदार याने दिलेल्या माहिती अथवा दागिण्याच्या मुदतेबाबत केलेले विधाने ही वस्तुस्थितीप्रमाणे नसल्यास कर्जदार हे फौजदारी कायद्यांतर्गत कारवाईस पात्र राहतील.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0">कर्ज वर रू….. द.सा.द.शे. प्रमाणे व्याज आकारले जाईल. सभासदास हे कर्ज दरमहा व्याज जमा न केल्यास ते कर्ज खाती नावे टाकले जाईल.</div>' +
    '<div class="rule" style="font-size:7.5pt;line-height:1.4;padding:1px 0;border-bottom:none">वरील सर्व नियम मी वाचून, समजुन घेतले असून ते मला व माझ्या वारसास मान्य आहेत व राहतील.</div>' +
    '<div style="text-align:right;margin-top:12mm;padding-right:4px;font-size:9pt">' +
    sigLine(nm, "कर्जदाराची सही") +
    "</div>" +
    "</div>";

  // ── Receipt / Ornament return section ──
  var receipt =
    '<div class="receipt" style="padding:2px 10px 3px;font-size:8pt;line-height:1.5">' +
    '<hr style="border:none;border-top:1.5px dashed #000;margin-bottom:4px">' +
    "मी <strong>" +
    nm +
    "</strong> पावती लिहून देतो की, मी/आम्ही संस्थेमध्ये सोन्याचे दागिने गहाण ठेवले व कर्ज प्रकरणात मालाचा " +
    "तपशील ह्यामध्ये नमुद केलेले ते मला/आम्हाला परत मिळाले, मालाचे लावलेले सिल माझे/आमचे समोर उघडले. कोणत्याच प्रकारची तक्रार राहिलेली नाही." +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:5px">' +
    "<span>प्राधिकृत अधिकारी..……………………………</span>" +
    '<span style="text-align:center;display:inline-block;margin-top:12mm">' +
    sigLine(nm, "कर्जदाराची सही") +
    "</span>" +
    "</div>" +
    "</div>";

  // Single continuous page — force page break after so slips always start on a new page
  var page =
    '<div class="page" style="overflow:visible;height:auto;padding-left:6mm;padding-top:0;padding-bottom:0;margin-top:0;page-break-after:always;break-after:always">' +
    '<div class="ohdr" style="padding:4px 8px 3px"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>' +
    '<div class="ftitle" style="padding:3px 8px 3px">– सोने / चांदी तारण कर्ज मागणीचा अर्ज –</div>' +
    infoTbl +
    reqLetter +
    '<hr class="hrdash">' +
    approval +
    '<hr class="hrdash">' +
    vach +
    rules +
    receipt;

  // Build ornament table rows for gold loan form
  var glOrnRows = "";
  var glTotalQty = 0,
    glTotalWt = 0;
  if (ornItems && ornItems.length) {
    ornItems.forEach(function (item, i) {
      var q = parseInt(item.qty) || 0;
      var w =
        item.weight !== null && item.weight !== undefined
          ? parseFloat(item.weight)
          : null;
      glTotalQty += q;
      glTotalWt += w !== null && !isNaN(w) ? w : 0;
      glOrnRows +=
        "<tr>" +
        '<td style="border:1px solid #ccc;padding:3px 6px;text-align:center;font-size:8pt">' +
        (i + 1) +
        "</td>" +
        '<td style="border:1px solid #ccc;padding:3px 6px;font-size:8pt">' +
        item.name +
        "</td>" +
        '<td style="border:1px solid #ccc;padding:3px 6px;text-align:center;font-size:8pt">' +
        (q || "—") +
        "</td>" +
        '<td style="border:1px solid #ccc;padding:3px 6px;text-align:center;font-size:8pt">' +
        (w ? w + " gm" : "—") +
        "</td>" +
        "</tr>";
    });
  } else {
    var glOrnList = [];
    if (goldOrn)
      goldOrn.split(",").forEach(function (s) {
        s = s.trim();
        if (s) glOrnList.push(s);
      });
    if (silvOrn)
      silvOrn.split(",").forEach(function (s) {
        s = s.trim();
        if (s) glOrnList.push(s);
      });
    glTotalQty = parseInt(ornQty) || 0;
    glTotalWt = parseFloat(ornWt) || 0;
    glOrnList.forEach(function (name, i) {
      glOrnRows +=
        "<tr>" +
        '<td style="border:1px solid #ccc;padding:3px 6px;text-align:center;font-size:8pt">' +
        (i + 1) +
        "</td>" +
        '<td style="border:1px solid #ccc;padding:3px 6px;font-size:8pt">' +
        name +
        "</td>" +
        '<td style="border:1px solid #ccc;padding:3px 6px;text-align:center;font-size:8pt">' +
        (i === 0 && ornQty ? ornQty : "—") +
        "</td>" +
        '<td style="border:1px solid #ccc;padding:3px 6px;text-align:center;font-size:8pt">' +
        (i === 0 && ornWt ? ornWt + " gm" : "—") +
        "</td>" +
        "</tr>";
    });
  }
  var glOrnTable =
    '<table style="width:100%;border-collapse:collapse;font-size:8pt">' +
    '<tr style="background:#1a3a5c;color:#fff">' +
    '<th style="border:1px solid #000;padding:4px 6px;text-align:center;width:8%">#</th>' +
    '<th style="border:1px solid #000;padding:4px 6px;text-align:left">दागिन्याचे नाव / Ornament Name</th>' +
    '<th style="border:1px solid #000;padding:4px 6px;text-align:center;width:18%">नग / Qty</th>' +
    '<th style="border:1px solid #000;padding:4px 6px;text-align:center;width:22%">वजन / Weight</th>' +
    "</tr>" +
    (glOrnRows ||
      '<tr><td colspan="4" style="border:1px solid #ccc;padding:6px;text-align:center;color:#aaa;font-size:8pt">—</td></tr>') +
    '<tr style="background:#fef9e7;font-weight:800">' +
    '<td colspan="2" style="border:1px solid #999;padding:3px 6px;font-size:8pt;text-align:right">एकूण / Total</td>' +
    '<td style="border:1px solid #999;padding:3px 6px;text-align:center">' +
    (glTotalQty || ornQty || "—") +
    "</td>" +
    '<td style="border:1px solid #999;padding:3px 6px;text-align:center">' +
    (glTotalWt ? glTotalWt + " gm" : ornWt ? ornWt + " gm" : "—") +
    "</td>" +
    "</tr>" +
    "</table>";

  // Combined ornament section: photo left + table right (always shown)
  var ornSection =
    '<div style="border-top:1.5px solid #000;padding:4px 10px">' +
    '<div style="font-size:8.5pt;font-weight:700;color:#1a3a5c;margin-bottom:4px">📷 दागिन्यांचा फोटो व तपशील / Ornament Photo & Details</div>' +
    '<div style="display:flex;gap:8px;align-items:flex-start">' +
    '<div style="flex:0 0 auto;width:80mm;min-height:92mm;border:1.5px solid #555;border-radius:4px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f8f8f8">' +
    (photoOrn
      ? '<img src="' +
        photoOrn +
        '" style="width:100%;height:92mm;object-fit:contain">'
      : '<div style="text-align:center;color:#bbb;font-size:9pt"><div style="font-size:18pt;margin-bottom:4px">📷</div><div>Ornament Photo</div></div>') +
    "</div>" +
    '<div style="flex:1;min-width:0">' +
    glOrnTable +
    "</div>" +
    "</div>" +
    "</div>";

  if (docPhotos && docPhotos.some((p) => p && p.src)) {
    // Compact photo grid — keep docs on same page as gold loan form
    var glValidPhotos = docPhotos.filter(function (p) {
      return p && p.src;
    });
    var glPhotoItems = glValidPhotos
      .map(function (p) {
        return (
          '<div style="text-align:center;flex:0 0 auto">' +
          '<img src="' +
          p.src +
          '" style="width:22mm;height:24mm;object-fit:cover;border:1px solid #888;border-radius:3px;display:block">' +
          '<div style="font-size:7pt;color:#444;margin-top:2px">' +
          p.label +
          "</div></div>"
        );
      })
      .join("");
    page +=
      '<div style="border-top:1.5px solid #000;padding:3px 12px 4px">' +
      '<div style="font-size:8.5pt;font-weight:700;margin-bottom:3px">📷 Documents / Photos</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px">' +
      glPhotoItems +
      "</div></div>";
  }

  page += ornSection;
  page += declLine();
  page += "</div>";
  return page;
}

// ═══════════════════════════════════════════════════════
//  LOAN SLIP PAGE — 3 tabular slips on one page
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
//  OD LOAN SLIP PAGE — 3 slips, same layout as gold loan slips
//  Slip 1: OD-DB-TRF        (पैसे काढण्याचा फॉर्म)
//  Slip 2: SAV-CR-TRF       (बचत ठेव जमा फॉर्म)
//  Slip 3: OD-FORM-FEE-CR-CASH (स्टेशनरी फि)
// ═══════════════════════════════════════════════════════
function odLoanSlipPage(
  nm,
  dtFmt,
  lnAmt,
  lnWrd,
  lnAcc,
  savAcc,
  fdAcc,
  fdPv,
  fdAmt,
  fdWrd,
) {
  function orgHdr() {
    return '<div style="padding:6px 10px 4px;border-bottom:1.5px solid #000"><div style="font-family:\'Noto Serif Devanagari\',serif;font-size:12pt;font-weight:700;color:#000;line-height:1.3">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.<span style="font-size:9.5pt;color:#000">मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</span></div></div>';
  }
  function titleBar(leftText, code) {
    return (
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 8px;border-bottom:1px solid #000;font-size:8.5pt;font-weight:700;color:#000"><span>' +
      leftText +
      '</span><span style="font-weight:800;font-size:9pt;color:#000">( ' +
      code +
      " )</span></div>"
    );
  }
  function scrollTbl(col3Label, col3Val, dcLabel) {
    var th =
      "border:1px solid #000;padding:2px 5px;font-weight:800;text-align:left;font-size:8pt;background:#fff";
    var td =
      "border:1px solid #000;padding:2px 5px;font-weight:800;font-size:8.5pt";
    return (
      '<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:9pt;border-top:1px solid #000"><tr><th style="' +
      th +
      ';width:13%">Scroll No</th><th style="' +
      th +
      ';width:20%">कर्ज खाते क्र.</th><th style="' +
      th +
      ';width:20%">' +
      col3Label +
      '</th><th style="' +
      th +
      '">तारीख</th><th style="' +
      th +
      ';width:13%">' +
      dcLabel +
      '</th></tr><tr><td style="' +
      td +
      '">&nbsp;</td><td style="' +
      td +
      '">' +
      lnAcc +
      '</td><td style="' +
      td +
      '">' +
      col3Val +
      '</td><td style="' +
      td +
      '">' +
      dtFmt +
      '</td><td style="' +
      td +
      '">&nbsp;</td></tr></table>'
    );
  }
  function sigFooter3() {
    return (
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:2px 10px 3px;border-top:1px solid #ddd;font-size:8pt"><div style="text-align:center"><div style="border-top:1.5px solid #000;padding-top:3px;margin-top:15px;min-width:55mm">रोखपाल/खातेपाल / व्यवस्थापक/अधिकारी</div></div><div style="text-align:center"><div style="border-top:1.5px solid #000;padding-top:3px;margin-top:15px;min-width:45mm;font-weight:800;font-size:8.5pt">' +
      nm +
      "</div></div></div>"
    );
  }

  // FD detail row shown inside slip 1 body
  var fdRow =
    '<table style="width:100%;border-collapse:collapse;font-size:9.5pt;margin-top:4px">' +
    "<tr>" +
    '<td style="border:1px solid #ccc;padding:4px 8px;font-weight:700;background:#f0f7ff;width:26%">मुदत ठेव खाते क्र.</td>' +
    '<td style="border:1px solid #ccc;padding:4px 8px;font-weight:800">' +
    (fdAcc || "—") +
    (fdPv ? " &nbsp;/&nbsp; पर्वती: " + fdPv : "") +
    "</td>" +
    '<td style="border:1px solid #ccc;padding:4px 8px;font-weight:700;background:#f0f7ff;width:20%">FD रक्कम</td>' +
    '<td style="border:1px solid #ccc;padding:4px 8px;font-weight:800">रू. ' +
    (fdAmt || "—") +
    " /-</td>" +
    "</tr></table>";

  // SLIP 1 — OD-DB-TRF
  var slip1Body =
    '<div style="padding:3px 10px 2px;font-size:9pt;line-height:1.6">' +
    "श्री / श्रीमती <strong>" +
    nm +
    "</strong> यास अगर<br>" +
    "घेऊन येणाऱ्यास ……………………………………कर्ज रक्कम रू....... <strong>" +
    lnAmt +
    " /-</strong><br>" +
    "<strong>(अक्षरी " +
    lnWrd +
    " )</strong> देण्याचे करावे.<br>" +
    "खातेदाराचे नाव <strong>" +
    nm +
    "</strong>" +
    "</div>" +
    '<div style="text-align:right;padding:0 12px 3px;font-size:8.5pt;font-weight:800">' +
    nm +
    " ………</div>";
  var slip1 =
    '<div class="sblock">' +
    orgHdr() +
    titleBar("** पैसे काढण्याचा फॉर्म **", "OD - DB - TRF") +
    scrollTbl("बचत खाते क्र.", savAcc, "Debit") +
    slip1Body +
    "</div>";

  // SLIP 2 — SAV-CR-TRF
  var lbl2 =
    "background:#e8f0ff;font-weight:600;text-align:center;border:1px solid #000;padding:4px 8px;font-size:8.5pt;vertical-align:middle";
  var val2 =
    "font-weight:800;border:1px solid #000;padding:4px 8px;font-size:9.5pt;vertical-align:middle";
  var slip2Table =
    '<table style="width:100%;border-collapse:collapse;font-size:9.5pt">' +
    '<tr><td style="' +
    lbl2 +
    ';width:38%">खातेदाराचे नाव</td><td style="' +
    val2 +
    '">' +
    nm +
    "</td></tr>" +
    '<tr><td style="' +
    lbl2 +
    '">कर्ज रक्कम</td><td style="' +
    val2 +
    '">रू. ' +
    lnAmt +
    ' /- <span style="font-size:9pt;font-weight:600">( अक्षरी रू. ' +
    lnWrd +
    " )</span></td></tr>" +
    "</table>";
  var slip2 =
    '<div class="sblock">' +
    orgHdr() +
    titleBar(
      "प्रवेश फि / स्टेशनरी / लघुबचत / मुदती / <u>बचत ठेव</u> / सभासद ठेव",
      "SAV - CR - TRF",
    ) +
    scrollTbl("बचत खाते क्र.", savAcc, "Credit") +
    slip2Table +
    sigFooter3() +
    "</div>";

  // SLIP 3 — OD-FORM-FEE-CR-CASH
  var slip3ScrollTbl =
    '<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:9pt;border-top:1px solid #000">' +
    "<tr>" +
    '<th style="width:13%;border:1px solid #000;padding:2px 5px;font-weight:700;text-align:left">Scroll No</th>' +
    '<th style="width:20%;border:1px solid #000;padding:2px 5px;font-weight:700;text-align:left">कर्ज खाते क्र.</th>' +
    '<th style="width:20%;border:1px solid #000;padding:2px 5px;font-weight:700;text-align:left">खाते क्र.</th>' +
    '<th style="border:1px solid #000;padding:2px 5px;font-weight:700;text-align:left">तारीख</th>' +
    '<th style="width:12%;border:1px solid #000;padding:2px 5px;font-weight:800;text-align:left">Credit</th>' +
    "</tr><tr>" +
    '<td style="border:1px solid #000;padding:2px 5px">&nbsp;</td>' +
    '<td style="border:1px solid #000;padding:2px 5px;font-weight:800">' +
    lnAcc +
    "</td>" +
    '<td style="border:1px solid #000;padding:2px 5px;font-weight:800">935 / 1</td>' +
    '<td style="border:1px solid #000;padding:2px 5px;font-weight:800">' +
    dtFmt +
    "</td>" +
    '<td style="border:1px solid #000;padding:2px 5px">&nbsp;</td>' +
    "</tr></table>";
  var slip3Table =
    '<table style="width:100%;border-collapse:collapse;font-size:9.5pt;border-top:1px solid #090808ff">' +
    '<tr><td style="border:1px solid #000;padding:3px 8px;font-weight:700;width:30%;background:#f8f8f8">खातेदाराचे नाव</td>' +
    '<td style="border:1px solid #000;padding:3px 8px;font-weight:800;font-size:10pt" colspan="2">' +
    nm +
    "</td></tr>" +
    '<tr><td style="border:1px solid #000;padding:3px 8px;font-weight:700;background:#f8f8f8">स्टेशनरी फि</td>' +
    '<td style="border:1px solid #000;padding:3px 8px;font-weight:800">रू. 50 /-</td>' +
    '<td style="border:1px solid #000;padding:3px 8px;font-weight:700">( अक्षरी पन्नास फक्त )</td></tr>' +
    "</table>";
  var slip3 =
    '<div class="sblock">' +
    orgHdr() +
    titleBar(
      "प्रवेश फि / <u>स्टेशनरी</u> / लघुबचत / मुदती / बचत ठेव / सभासद ठेव",
      "OD - FORM FEE - CR - CASH",
    ) +
    slip3ScrollTbl +
    slip3Table +
    sigFooter3() +
    "</div>";

  // SLIP 4 — SAV-DB (saving withdrawal slip, same structure as gold loan)
  var slip4 =
    '<div class="sblock" style="page-break-inside:avoid;margin-bottom:0;border:1.5px solid #000">' +
    '<div style="border-bottom:1.5px solid #000;padding:3px 7px">' +
    '<span style="font-size:9.5pt;font-weight:900;color:#b80000">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसायटी मर्यादित</span>' +
    '<span style="font-size:8.5pt;font-weight:900;color:#000"> जळगाव (जा.) जि.बुलढाणा र.नं.१०६७</span>' +
    "</div>" +
    '<div style="border-bottom:1px solid #000;padding:2px 7px;display:flex;justify-content:space-between;align-items:center">' +
    '<span style="font-size:9pt;font-weight:900">पैसे काढावयाचे चलन / नकद आहर्ता पर्ची</span>' +
    '<span style="font-size:8pt;font-weight:700;white-space:nowrap">दिनांक : <strong>' +
    dtFmt +
    "</strong></span>" +
    "</div>" +
    // BUG FIX: the "please pay Rs. ___" / "in words ___" writing lines had
    // only a bare underline with no room above it to actually write digits —
    // added top padding + a taller box so there is real writing space.
    '<div style="padding:6px 7px 4px;border-bottom:1px solid #000">' +
    '<div style="font-size:8.5pt;margin-bottom:6px;display:flex;align-items:baseline;gap:3px">' +
    '<span style="white-space:nowrap">कृपया, मला वा धारकाला रू.</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;display:inline-block;min-height:14px">&nbsp;</span>' +
    "</div>" +
    '<div style="font-size:8.5pt;display:flex;align-items:baseline;gap:3px">' +
    '<span style="white-space:nowrap">वाहक/स्वतः को रू.</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;display:inline-block;min-height:14px">&nbsp;</span>' +
    "</div>" +
    "</div>" +
    '<div style="border-bottom:1px solid #000;padding:4px 7px;display:flex;align-items:center;gap:10px">' +
    '<span style="font-size:8pt;font-weight:800;white-space:nowrap">कर्ज खाते क्र.</span>' +
    '<span style="font-size:9pt;font-weight:900;letter-spacing:0.5px">' +
    lnAcc +
    "</span>" +
    '<span style="font-size:8pt;font-weight:800;white-space:nowrap;margin-left:6px">बचत खाते क्र.</span>' +
    '<span style="font-size:9pt;font-weight:900;letter-spacing:0.5px">' +
    savAcc +
    "</span>" +
    '<span style="font-size:8pt;font-weight:800;margin-left:auto;white-space:nowrap">ला नावे टाकून रोख द्यावेत.</span>' +
    '<span style="font-size:7.5pt;font-weight:800;border:1.5px solid #000;padding:1px 6px;white-space:nowrap;align-self:flex-start">Debit</span>' +
    "</div>" +
    '<div style="display:flex;align-items:stretch;border-bottom:1px solid #000">' +
    '<div style="flex:1;padding:4px 7px;border-right:1px solid #000">' +
    '<div style="font-size:7pt;color:#555;margin-bottom:1px">खातेदाराचे नाव</div>' +
    '<div style="font-size:9.5pt;font-weight:900">' +
    nm +
    "</div>" +
    "</div>" +
    // Widened + heightened so there is real room to write the amount by hand.
    '<div style="min-width:40mm;min-height:11mm;display:flex;align-items:center;justify-content:center;gap:3px;padding:4px 7px">' +
    '<span style="font-size:13pt;font-weight:900;color:#1a1a6e">₹</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;display:inline-block;min-height:16px;font-size:9.5pt;font-weight:900">&nbsp;</span>' +
    '<span style="font-size:9.5pt;font-weight:900">/-</span>' +
    "</div>" +
    "</div>" +
    // Notes denomination breakdown — teller fills in count/amount by hand
    // per note value at payout time.
    (function () {
      var DENOMS = [2000, 500, 200, 100, 50, 20, 10];
      var headCells =
        '<td style="border:1px solid #000;padding:1px 2px;font-size:6.3pt;font-weight:800;text-align:left;background:#f2f2f2">₹ /नग</td>' +
        DENOMS.map(function (d) {
          return (
            '<td style="border:1px solid #000;padding:1px 2px;font-size:6.3pt;font-weight:800;text-align:center;background:#f2f2f2">' +
            d +
            "</td>"
          );
        }).join("") +
        '<td style="border:1px solid #000;padding:1px 2px;font-size:6pt;font-weight:800;text-align:center;background:#f2f2f2">सुटे</td>' +
        '<td style="border:1px solid #000;padding:1px 2px;font-size:6.3pt;font-weight:900;text-align:center;background:#f2f2f2">एकूण</td>';
      var countCells =
        '<td style="border:1px solid #000;padding:0 2px;font-size:6.3pt;font-weight:700">नग</td>' +
        DENOMS.map(function () {
          return '<td style="border:1px solid #000;padding:2px 2px;text-align:center;font-size:7pt">&nbsp;</td>';
        }).join("") +
        '<td style="border:1px solid #000;padding:2px 2px;text-align:center;font-size:7pt">&nbsp;</td>' +
        '<td style="border:1px solid #000;padding:2px 2px;text-align:center;font-size:7pt">&nbsp;</td>';
      var amtCells =
        '<td style="border:1px solid #000;padding:0 2px;font-size:6.3pt;font-weight:700">रक्कम</td>' +
        DENOMS.map(function () {
          return '<td style="border:1px solid #000;padding:2px 2px;text-align:center;font-size:7pt">&nbsp;</td>';
        }).join("") +
        '<td style="border:1px solid #000;padding:2px 2px;text-align:center;font-size:7pt">&nbsp;</td>' +
        '<td style="border:1px solid #000;padding:2px 2px;text-align:center;font-size:7pt;font-weight:900">' +
        (lnAmt ? "₹" + lnAmt : "") +
        "</td>";
      return (
        '<div style="padding:2px 7px 3px;border-bottom:1px solid #000">' +
        '<div style="font-size:6.5pt;font-weight:800;margin-bottom:1px">नोट मोजणी (Notes Denomination)</div>' +
        '<table style="width:100%;border-collapse:collapse">' +
        "<tr>" + headCells + "</tr>" +
        "<tr>" + countCells + "</tr>" +
        "<tr>" + amtCells + "</tr>" +
        "</table>" +
        "</div>"
      );
    })() +
    '<div style="display:flex;padding:4px 7px 5px">' +
    '<div style="flex:1;border-right:1px solid #000;padding-right:7px">' +
    '<div style="border-top:1px solid #000;margin-top:6mm;padding-top:2px;font-size:7pt;font-weight:700;text-align:center">खातेदाराची स्वाक्षरी</div>' +
    "</div>" +
    '<div style="flex:1;padding-left:7px">' +
    '<div style="border-top:1px solid #000;margin-top:6mm;padding-top:2px;font-size:7pt;font-weight:700;text-align:center">पासकर्ता अधिकारी / निरीक्षक / कर्मचारी</div>' +
    "</div>" +
    "</div>" +
    "</div>";

  // BUG FIX: this used to render at transform:scale(0.9) to guarantee the
  // 4 slips fit on one page. Measured via headless-Chrome render (with the
  // notes-denomination table + wider amount-writing space added to slip 4
  // below): the 4 slips at FULL size total ~231mm tall, comfortably inside
  // the ~277mm printable A4 height (297mm - 20mm margins) — so the scale
  // hack is no longer needed and was only making the text smaller than
  // intended. Rendering at 100% still reliably produces exactly 1 page.
  return (
    '<div class="spage" style="page-break-inside:avoid;break-inside:avoid">' +
    slip1 +
    '<div class="sdiv" style="margin:4px 0"></div>' +
    slip2 +
    '<div class="sdiv" style="margin:4px 0"></div>' +
    slip3 +
    '<div class="sdiv" style="margin:4px 0"></div>' +
    slip4 +
    declLine() +
    "</div>"
  );
}

function _goldLoanSlipsPage(
  nm,
  dtFmt,
  lnAmt,
  lnWrd,
  lnAcc,
  savAcc,
  photoCust,
  ornItems,
  ornWt,
  ornQty,
  goldOrn,
  silvOrn,
) {
  function orgHdr() {
    return '<div style="padding:5px 10px 3px;border-bottom:1.5px solid #000"><div style="font-family:\'Noto Serif Devanagari\',serif;font-size:14.5pt;font-weight:700;color:#8b0000;line-height:1.3">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.<span style="font-size:12pt;color:#000">मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</span></div></div>';
  }
  function titleBar(leftText, code) {
    return (
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 8px;border-bottom:1px solid #000;font-size:11pt;font-weight:700"><span>' +
      leftText +
      '</span><span style="font-weight:800;font-size:11.5pt">( ' +
      code +
      " )</span></div>"
    );
  }
  function scrollTbl(col3Label, col3Val, dcLabel) {
    var th =
      "border:1px solid #000;padding:2px 5px;font-weight:800;text-align:left;font-size:10.5pt;background:#fff";
    var td =
      "border:1px solid #000;padding:2px 5px;font-weight:800;font-size:11pt";
    return (
      '<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:11pt;border-top:1px solid #000"><tr><th style="' +
      th +
      ';width:13%">Scroll No</th><th style="' +
      th +
      ';width:20%">कर्ज खाते क्र.</th><th style="' +
      th +
      ';width:20%">' +
      col3Label +
      '</th><th style="' +
      th +
      '">तारीख</th><th style="' +
      th +
      ';width:13%">' +
      dcLabel +
      '</th></tr><tr><td style="' +
      td +
      '">&nbsp;</td><td style="' +
      td +
      '">' +
      lnAcc +
      '</td><td style="' +
      td +
      '">' +
      col3Val +
      '</td><td style="' +
      td +
      '">' +
      dtFmt +
      '</td><td style="' +
      td +
      '">&nbsp;</td></tr></table>'
    );
  }
  function sigFooter3() {
    return (
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:2px 10px 3px;border-top:1px solid #ddd;font-size:10pt"><div style="text-align:center"><div style="border-top:1.5px solid #000;padding-top:3px;margin-top:28px;min-width:55mm">रोखपाल/खातेपाल / व्यवस्थापक/अधिकारी</div></div><div style="text-align:center"><div style="border-top:1.5px solid #000;padding-top:3px;margin-top:28px;min-width:45mm;font-weight:800;font-size:10.5pt">' +
      nm +
      "</div></div></div>"
    );
  }

  // SLIP 1: GL-DB-TRF
  var slip1Body =
    '<div style="padding:3px 10px 2px;font-size:11pt;line-height:1.45;position:relative"><div style="position:absolute;top:4px;right:10px;width:12mm;height:14mm;border:1.5px solid #aaa;background:#f0f0f0;display:flex;align-items:center;justify-content:center"><span style="font-size:8pt;color:#aaa">Photo</span></div><div style="margin-right:16mm">श्री / श्रीमती <strong>' +
    nm +
    "</strong> यास अगर<br>घेऊन येणाऱ्यास ……………………………………कर्ज रक्कम रू. <strong>" +
    lnAmt +
    " /-</strong><br><strong>(अक्षरी " +
    lnWrd +
    " )</strong> देण्याचे करावे.<br>खातेदाराचे नाव <strong>" +
    nm +
    '</strong></div></div>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:2px 10px 3px;border-top:1px solid #ddd;font-size:10pt">' +
    '<div style="text-align:center"><div style="border-top:1.5px solid #000;padding-top:3px;margin-top:28px;min-width:55mm">रोखपाल/खातेपाल / व्यवस्थापक/अधिकारी</div></div>' +
    '<div style="text-align:center"><div style="border-top:1.5px solid #000;padding-top:3px;margin-top:28px;min-width:45mm;font-weight:800;font-size:10.5pt">' +
    nm +
    "</div></div>" +
    "</div>";
  var slip1 =
    '<div class="sblock">' +
    orgHdr() +
    titleBar("** पैसे काढण्याचा फॉर्म **", "GL - DB - TRF") +
    scrollTbl("बचत खाते क्र.", savAcc, "Debit") +
    slip1Body +
    "</div>";

  // SLIP 2: SAV-CR-TRF
  var lbl2 =
    "background:#e8f8f0;font-weight:600;text-align:center;border:1px solid #000;padding:4px 8px;font-size:10.5pt;vertical-align:middle";
  var val2 =
    "font-weight:800;border:1px solid #000;padding:4px 8px;font-size:11.5pt;vertical-align:middle";
  var slip2Table =
    '<table style="width:100%;border-collapse:collapse;font-size:11.5pt"><tr><td style="' +
    lbl2 +
    ';width:38%">खातेदाराचे नाव</td><td style="' +
    val2 +
    '">' +
    nm +
    '</td></tr><tr><td style="' +
    lbl2 +
    '">कर्ज रक्कम</td><td style="' +
    val2 +
    '">रू. ' +
    lnAmt +
    ' /- <span style="font-size:11pt;font-weight:600">( अक्षरी रू. ' +
    lnWrd +
    " )</span></td></tr></table>";
  var slip2 =
    '<div class="sblock">' +
    orgHdr() +
    titleBar(
      "प्रवेश फि / स्टेशनरी / लघुबचत / मुदती / <u>बचत ठेव</u> / सभासद ठेव",
      "SAV - CR - TRF",
    ) +
    scrollTbl("बचत खाते क्र.", savAcc, "Credit") +
    slip2Table +
    sigFooter3() +
    "</div>";

  // SLIP 3: GL-FORM-FEE-CR-CASH
  var slip3ScrollTbl =
    '<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:11pt;border-top:1px solid #000"><tr><th style="width:13%;border:1px solid #000;padding:2px 5px;font-weight:700;text-align:left">Scroll No</th><th style="width:20%;border:1px solid #000;padding:2px 5px;font-weight:700;text-align:left">कर्ज खाते क्र.</th><th style="width:20%;border:1px solid #000;padding:2px 5px;font-weight:700;text-align:left">खाते क्र.</th><th style="border:1px solid #000;padding:2px 5px;font-weight:700;text-align:left">तारीख</th><th style="width:12%;border:1px solid #000;padding:4px 7px;font-weight:800;text-align:left">Credit</th></tr><tr><td style="border:1px solid #000;padding:2px 5px">&nbsp;</td><td style="border:1px solid #000;padding:2px 5px;font-weight:800">' +
    lnAcc +
    '</td><td style="border:1px solid #000;padding:2px 5px;font-weight:800">935 / 1</td><td style="border:1px solid #000;padding:2px 5px;font-weight:800">' +
    dtFmt +
    '</td><td style="border:1px solid #000;padding:2px 5px">&nbsp;</td></tr></table>';
  var slip3Table =
    '<table style="width:100%;border-collapse:collapse;font-size:11.5pt;border-top:1px solid #ddd"><tr><td style="border:1px solid #000;padding:3px 8px;font-weight:700;width:30%;background:#f8f8f8">खातेदाराचे नाव</td><td style="border:1px solid #000;padding:3px 8px;font-weight:800;font-size:12pt" colspan="2">' +
    nm +
    '</td></tr><tr><td style="border:1px solid #000;padding:3px 8px;font-weight:700;background:#f8f8f8">स्टेशनरी फि</td><td style="border:1px solid #000;padding:3px 8px;font-weight:800">रू. 50 /-</td><td style="border:1px solid #000;padding:3px 8px;font-weight:700">( अक्षरी पन्नास फक्त )</td></tr></table>';
  // Notes denomination table on the left, same placement/style as slip 4
  // below (_jjuDenomTable — one row per denomination) — this is a cash
  // ("CR - CASH") slip, so the teller needs somewhere to tally the notes
  // handed in, same as every other cash slip in the app. Total pre-filled at
  // ₹50 since the stationery fee is a fixed amount (unlike slip 4's blank
  // total, whose amount is handwritten).
  var slip3DenomLeft =
    '<div style="min-width:40mm;padding:4px 0 4px 8px">' +
    _jjuDenomTable("#e8f8f0", "₹ 50") +
    "</div>";
  var slip3 =
    '<div class="sblock">' +
    orgHdr() +
    titleBar(
      "प्रवेश फि / <u>स्टेशनरी</u> / लघुबचत / मुदती / बचत ठेव / सभासद ठेव",
      "GL - FORM FEE - CR - CASH",
    ) +
    slip3ScrollTbl +
    '<div style="display:flex;align-items:flex-start;gap:0">' +
    slip3DenomLeft +
    '<div style="flex:1;min-width:0">' +
    slip3Table +
    "</div>" +
    "</div>" +
    sigFooter3() +
    "</div>";

  // SLIP 4: SAV-DB — "पैसे काढण्याचा फॉर्म" (matches physical JJU stationery slip; amount left
  // blank for handwriting since this slip covers general cash withdrawal, not a fixed loan amount)
  function slip4Hdr() {
    return (
      '<div style="padding:5px 10px 3px;border-bottom:1.5px solid #000;display:flex;align-items:flex-start;gap:10px">' +
      '<div style="text-align:center;line-height:1;flex-shrink:0">' +
      '<div style="font-size:23pt;font-weight:900;color:#000;font-family:Georgia,serif;letter-spacing:-0.5px">JJU</div>' +
      '<div style="font-size:7.5pt;font-weight:600;color:#333;margin-top:1px;white-space:nowrap">नातं विश्वासाचं</div>' +
      "</div>" +
      '<div style="flex:1">' +
      '<div style="font-family:\'Noto Serif Devanagari\',serif;font-size:14pt;font-weight:700;color:#000;line-height:1.3">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसायटी</div>' +
      '<div style="font-size:11pt;font-weight:700;color:#000;line-height:1.25">मर्यादित जळगांव (जा.) जि.बुलढाणा र.नं.१०६७, शाखा : (जळगांव जा.)</div>' +
      "</div>" +
      "</div>" +
      '<div style="text-align:center;padding:4px 8px 5px;border-bottom:1px solid #000">' +
      '<span style="font-size:15pt;font-weight:900">पैसे काढण्याचा फॉर्म</span>' +
      "</div>"
    );
  }
  var slip4Body =
    // Row: Scroll No. ___  |  बचत खाते क्र. [savAcc]  (BUG FIX: was mislabeled
    // "ठेव बुक अ. नं." — this field is the savings account number, not a
    // deposit-passbook number; relabeled to match the term used everywhere
    // else in the app, e.g. scrollTbl()'s "बचत खाते क्र." column above)
    '<div style="display:flex;padding:6px 10px 3px;gap:14px">' +
    '<div style="flex:1;display:flex;align-items:baseline;gap:4px">' +
    '<span style="font-size:11.5pt;font-weight:700;white-space:nowrap">Scroll No.</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;display:inline-block">&nbsp;</span>' +
    "</div>" +
    '<div style="flex:1;display:flex;align-items:baseline;gap:4px">' +
    '<span style="font-size:11.5pt;font-weight:700;white-space:nowrap">बचत खाते क्र.</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;padding:0 3px;font-size:12.5pt;font-weight:800;display:inline-block">' +
    savAcc +
    "</span>" +
    "</div>" +
    "</div>" +
    // Row: कर्ज खाते क्र. [lnAcc]  |  दिनांक [dtFmt]  (BUG FIX: label was the
    // generic "खाते क्र." — this is the loan account number, so it now reads
    // "कर्ज खाते क्र." like every other slip on this page; kept directly
    // before the दिनांक line, same row, as it already was)
    '<div style="display:flex;padding:3px 10px;gap:14px">' +
    '<div style="flex:1;display:flex;align-items:baseline;gap:4px">' +
    '<span style="font-size:11.5pt;font-weight:700;white-space:nowrap">कर्ज खाते क्र.</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;padding:0 3px;font-size:12.5pt;font-weight:800;display:inline-block">' +
    lnAcc +
    "</span>" +
    "</div>" +
    '<div style="flex:1;display:flex;align-items:baseline;gap:4px">' +
    '<span style="font-size:11.5pt;font-weight:700;white-space:nowrap">दिनांक</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;padding:0 3px;font-size:12.5pt;font-weight:800;display:inline-block">' +
    dtFmt +
    "</span>" +
    "</div>" +
    "</div>" +
    // Row: श्री / श्रीमती [nm] यांस अगर घेऊन
    '<div style="display:flex;align-items:baseline;gap:4px;padding:3px 10px">' +
    '<span style="font-size:11.5pt;font-weight:700;white-space:nowrap">श्री / श्रीमती</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;padding:0 3px;font-size:12.5pt;font-weight:800;display:inline-block">' +
    nm +
    "</span>" +
    '<span style="font-size:11.5pt;font-weight:700;white-space:nowrap">यांस अगर घेऊन</span>' +
    "</div>" +
    // Row: येणारास ___  |  [₹ box — enlarged for handwriting, left blank]
    '<div style="display:flex;align-items:center;gap:10px;padding:4px 10px">' +
    '<div style="flex:1;display:flex;align-items:baseline;gap:4px">' +
    '<span style="font-size:11.5pt;font-weight:700;white-space:nowrap">येणारास</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;display:inline-block">&nbsp;</span>' +
    "</div>" +
    '<div style="border:1.5px solid #000;padding:6px 18px;display:flex;align-items:center;gap:5px;min-width:55mm">' +
    '<span style="font-size:16pt;font-weight:900">₹</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;display:inline-block">&nbsp;</span>' +
    "</div>" +
    "</div>" +
    // Row: रक्कम रूपये (अक्षरी) ___ (blank, for handwriting) ... देण्याचे करावे.
    '<div style="padding:3px 10px">' +
    '<div style="display:flex;align-items:baseline;gap:4px;margin-bottom:3px">' +
    '<span style="font-size:11.5pt;font-weight:700;white-space:nowrap">रक्कम रूपये (अक्षरी)</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;display:inline-block">&nbsp;</span>' +
    "</div>" +
    '<div style="display:flex;align-items:baseline;gap:4px">' +
    '<span style="border-bottom:1px solid #000;flex:1;display:inline-block">&nbsp;</span>' +
    '<span style="font-size:11.5pt;font-weight:700;white-space:nowrap">देण्याचे करावे.</span>' +
    "</div>" +
    "</div>" +
    // Row: खातेदाराचे नांव [nm]  |  signature space / खातेदाराची सही
    '<div style="display:flex;align-items:flex-end;justify-content:space-between;padding:6px 10px 7px;gap:14px">' +
    '<div style="flex:1;display:flex;align-items:baseline;gap:4px">' +
    '<span style="font-size:11.5pt;font-weight:700;white-space:nowrap">खातेदाराचे नांव</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;padding:0 3px;font-size:12.5pt;font-weight:800;display:inline-block">' +
    nm +
    "</span>" +
    "</div>" +
    '<div style="text-align:center;min-width:45mm">' +
    '<div style="border-top:1px solid #000;margin-top:28px;padding-top:3px;font-size:10pt;font-weight:700">खातेदाराची सही</div>' +
    "</div>" +
    "</div>";
  // Cash denomination table on the left of the slip, for the teller to tally
  // the notes/coins handed out (reuses the same _jjuDenomTable() helper the
  // saving deposit/withdrawal slips use, so styling matches app-wide; total
  // left blank since this form's amount is also handwritten).
  var slip4DenomLeft =
    '<div style="min-width:40mm;padding:7px 0 7px 10px">' +
    _jjuDenomTable("#fde0e8", "") +
    "</div>";
  var slip4 =
    '<div class="sblock">' +
    slip4Hdr() +
    '<div style="display:flex;align-items:flex-start;gap:0">' +
    slip4DenomLeft +
    '<div style="flex:1;min-width:0">' +
    slip4Body +
    "</div>" +
    "</div>" +
    "</div>";

  // BUG FIX: this used to be `transform:scale(0.80)` (with width:125% to
  // compensate for the visual shrink). That looked safe by every DOM
  // measurement (getBoundingClientRect() on the scaled box measured well
  // under the 277mm printable-height budget) but was still spilling the
  // last slip's tail + the declaration line onto a second page in real
  // production printing (confirmed against a real customer's data: name
  // "DILIP THAPSING SASTYA", loan 30700). Root cause: CSS `transform` only
  // changes how an element is PAINTED -- it does not shrink the box's
  // actual layout height, which is what the print engine's page-break
  // calculation uses. So Chrome was still paginating against the full,
  // un-scaled ~336mm-tall content, breaking mid-way through it, while a
  // post-transform measurement only ever saw the (irrelevant, for
  // pagination purposes) visually-shrunk ~269mm.
  // `zoom` (unlike `transform`) genuinely resizes the box in the layout --
  // confirmed by generating a real PDF (Chromium's print pipeline, the same
  // one window.print() drives) and counting pages: transform:scale gave 3
  // pages (slips split across 2 + the intentional trailing blank page),
  // zoom gives the correct 2 (all 4 slips on page 1, blank page 2), for
  // both a normal case and a stress case (very long name, 6-figure amount
  // in words, "RAMESHCHANDRA VYANKATRAO DESHMUKH PATIL" / "Nine Lakh
  // Eighty Seven Thousand Six Hundred Fifty Only"). No width compensation
  // needed -- zoom scales the box's own width along with everything else,
  // so the plain 210mm from the .spage class already renders correctly.
  return (
    '<div class="spage" style="page-break-inside:avoid;break-inside:avoid;zoom:0.80">' +
    slip1 +
    '<div class="sdiv" style="margin:4px 0"></div>' +
    slip2 +
    '<div class="sdiv" style="margin:4px 0"></div>' +
    slip3 +
    '<div class="sdiv" style="margin:4px 0"></div>' +
    slip4 +
    declLine() +
    "</div>" +
    // Blank page directly after the voucher/slips page so this page's
    // content never prints on the reverse side of the next page.
    '<div class="spage-blank"></div>'
  );
}

// ── loanSlipPage: alias for _goldLoanSlipsPage (called by buildHTMLPage for "Slips - Loan") ──
function loanSlipPage(
  nm,
  dtFmt,
  lnAmt,
  lnWrd,
  lnAcc,
  savAcc,
  photoCust,
  ornItems,
  ornWt,
  ornQty,
  goldOrn,
  silvOrn,
) {
  return _goldLoanSlipsPage(
    nm,
    dtFmt,
    lnAmt,
    lnWrd,
    lnAcc,
    savAcc,
    photoCust,
    ornItems,
    ornWt,
    ornQty,
    goldOrn,
    silvOrn,
  );
}

// ═══════════════════════════════════════════════════════
//  GOLD RECEIPT PAGE — 3 copies (Bank / Customer / Office)
// ═══════════════════════════════════════════════════════
function goldReceiptPage(
  nm,
  addr,
  dtFmt,
  mob,
  aadh,
  cid,
  savAcc,
  lnAcc,
  lnAmt,
  lnWrd,
  ornWt,
  ornQty,
  goldOrn,
  silvOrn,
  metal,
  ornItems,
) {
  var totalQty = 0,
    totalWt = 0;
  var itemRows;
  if (ornItems && ornItems.length) {
    itemRows = ornItems
      .map(function (item, i) {
        var q = parseInt(item.qty) || 0;
        var w =
          item.weight !== null && item.weight !== undefined
            ? parseFloat(item.weight)
            : null;
        totalQty += q;
        if (w !== null && !isNaN(w)) totalWt += w;
        return (
          '<tr><td style="border:1px solid #ccc;padding:2px 4px;text-align:center;font-size:8.5pt;color:#000;font-weight:700">' +
          (i + 1) +
          '</td><td style="border:1px solid #ccc;padding:2px 4px;font-size:8.5pt;color:#000;font-weight:700">' +
          item.name +
          '</td><td style="border:1px solid #ccc;padding:2px 4px;text-align:center;font-size:8.5pt;color:#000;font-weight:700">' +
          (q || "—") +
          '</td><td style="border:1px solid #ccc;padding:2px 4px;text-align:center;font-size:8.5pt;color:#000;font-weight:700">' +
          (w !== null && !isNaN(w) ? w + " gm" : "—") +
          "</td></tr>"
        );
      })
      .join("");
  } else {
    var ornList = [];
    if (goldOrn)
      goldOrn.split(",").forEach(function (s) {
        s = s.trim();
        if (s) ornList.push({ name: s });
      });
    if (silvOrn)
      silvOrn.split(",").forEach(function (s) {
        s = s.trim();
        if (s) ornList.push({ name: s });
      });
    if (!ornList.length) ornList.push({ name: "—" });
    totalQty = parseInt(ornQty) || 0;
    totalWt = parseFloat(ornWt) || 0;
    itemRows = ornList
      .map(function (item, i) {
        return (
          '<tr><td style="border:1px solid #ccc;padding:2px 4px;text-align:center;font-size:8.5pt;color:#000;font-weight:700">' +
          (i + 1) +
          '</td><td style="border:1px solid #ccc;padding:2px 4px;font-size:8.5pt;color:#000;font-weight:700">' +
          item.name +
          '</td><td style="border:1px solid #ccc;padding:2px 4px;text-align:center;font-size:8.5pt;color:#000;font-weight:700">' +
          (i === 0 && ornQty ? ornQty : "") +
          '</td><td style="border:1px solid #ccc;padding:2px 4px;text-align:center;font-size:8.5pt;color:#000;font-weight:700">' +
          (i === 0 && ornWt ? ornWt + " gm" : "") +
          "</td></tr>"
        );
      })
      .join("");
  }
  var totRow =
    '<tr style="background:#e8e8e8;font-weight:900"><td colspan="2" style="border:1px solid #ccc;padding:2px 4px;text-align:right;font-size:8.5pt;color:#000">एकूण / Total</td><td style="border:1px solid #ccc;padding:2px 4px;text-align:center;font-size:8.5pt;color:#000">' +
    (totalQty || ornQty || "") +
    '</td><td style="border:1px solid #ccc;padding:2px 4px;text-align:center;font-size:8.5pt;color:#000">' +
    (totalWt ? totalWt + " gm" : ornWt ? ornWt + " gm" : "") +
    "</td></tr>";
  var lnAmtFmt =
    lnAmt && lnAmt !== "—"
      ? "रू. " + lnAmt + " /- ( अक्षरी रू. " + lnWrd + " )"
      : "—";

  function makeReceipt(copyLabel) {
    var sigRow =
      "<tr>" +
      '<td colspan="2" style="border:1px solid #ccc;padding:18px 10px 5px;vertical-align:bottom;text-align:left;"><div style="border-top:1px dashed #aaa;padding-top:4px;font-size:8.5pt;font-weight:400;color:#444;">' +
      nm +
      "</div></td>" +
      '<td colspan="2" style="border:1px solid #ccc;padding:18px 10px 5px;vertical-align:bottom;text-align:center;"><div style="border-top:1px dashed #aaa;padding-top:4px;font-size:9pt;font-weight:900;color:#000;">प्राधिकृत अधिकारी</div></td>' +
      "</tr>";
    return (
      '<div style="border:1px solid #bbb;margin-bottom:0;page-break-inside:avoid;break-inside:avoid;">' +
      '<div style="background:#000;color:#fff;padding:3px 7px;display:flex;justify-content:space-between;align-items:center;"><div style="font-size:9pt;font-weight:800;line-height:1.25;color:#fff;">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. <span style="font-size:7.5pt;font-weight:500;">जळगाव (जा.) जि. बुलढाणा र.नं.१०६७</span></div><div style="background:#fff;color:#000;font-size:8pt;font-weight:800;padding:1px 7px;border-radius:2px;white-space:nowrap;">' +
      copyLabel +
      "</div></div>" +
      '<div style="border-bottom:1px solid #ccc;border-top:1px solid #ccc;text-align:center;padding:2px 6px;font-size:9.5pt;font-weight:800;color:#000;">सोने / चांदी तारण कर्ज पावती &nbsp;<span style="font-size:8pt;font-weight:600;color:#000;">Gold / Silver Loan Receipt</span></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #ccc;">' +
      '<div style="padding:3px 7px;border-right:1px solid #ccc;"><div style="display:flex;gap:3px;margin-bottom:2px;font-size:8.5pt;line-height:1.3;color:#000;"><span style="font-weight:700;min-width:76px;flex-shrink:0;">कर्जदाराचे नाव</span><span style="font-weight:800;">' +
      nm +
      '</span></div><div style="display:flex;gap:3px;margin-bottom:2px;font-size:8.5pt;line-height:1.3;color:#000;"><span style="font-weight:700;min-width:76px;flex-shrink:0;">पत्ता</span><span style="font-weight:700;">' +
      addr +
      '</span></div><div style="display:flex;gap:3px;margin-bottom:2px;font-size:8.5pt;line-height:1.3;color:#000;"><span style="font-weight:700;min-width:76px;flex-shrink:0;">मोबाईल</span><span style="font-weight:700;">' +
      mob +
      '</span></div><div style="display:flex;gap:3px;margin-bottom:2px;font-size:8.5pt;line-height:1.3;color:#000;"><span style="font-weight:700;min-width:76px;flex-shrink:0;">आधार क्र.</span><span style="font-weight:700;">' +
      aadh +
      "</span></div></div>" +
      '<div style="padding:3px 7px;"><div style="display:flex;gap:3px;margin-bottom:2px;font-size:8.5pt;line-height:1.3;color:#000;"><span style="font-weight:700;min-width:76px;flex-shrink:0;">कर्ज खाते क्र.</span><span style="font-weight:800;">' +
      lnAcc +
      '</span></div><div style="display:flex;gap:3px;margin-bottom:2px;font-size:8.5pt;line-height:1.3;color:#000;"><span style="font-weight:700;min-width:76px;flex-shrink:0;">बचत खाते क्र.</span><span style="font-weight:800;">' +
      savAcc +
      '</span></div><div style="display:flex;gap:3px;margin-bottom:2px;font-size:8.5pt;line-height:1.3;color:#000;"><span style="font-weight:700;min-width:76px;flex-shrink:0;">तारीख</span><span style="font-weight:700;">' +
      dtFmt +
      '</span></div><div style="display:flex;gap:3px;margin-bottom:2px;font-size:8.5pt;line-height:1.3;color:#000;"><span style="font-weight:700;min-width:76px;flex-shrink:0;">कर्ज रक्कम</span><span style="font-weight:800;">' +
      lnAmtFmt +
      "</span></div></div>" +
      "</div>" +
      '<div style="padding:2px 6px 3px;"><table style="width:100%;border-collapse:collapse;"><thead><tr><th style="background:#555;color:#fff;border:1px solid #ccc;padding:2px 4px;text-align:center;width:5%;font-size:8pt;">#</th><th style="background:#555;color:#fff;border:1px solid #ccc;padding:2px 4px;text-align:left;width:53%;font-size:8pt;">दागिन्याचे नाव / Ornament Name</th><th style="background:#555;color:#fff;border:1px solid #ccc;padding:2px 4px;text-align:center;width:18%;font-size:8pt;">नग / Qty</th><th style="background:#555;color:#fff;border:1px solid #ccc;padding:2px 4px;text-align:center;width:24%;font-size:8pt;">वजन / Weight</th></tr></thead><tbody>' +
      itemRows +
      "</tbody>" +
      totRow +
      sigRow +
      "</table></div>" +
      "</div>"
    );
  }

  var cutLine =
    '<div style="border:none;border-top:2px dashed #000;margin:2.5mm 0;"></div>';
  return (
    '<div class="rpage" style="overflow:visible;height:auto;min-height:unset;padding-top:0;margin-top:0">' +
    makeReceipt("🏦 Bank Copy") +
    cutLine +
    makeReceipt("👤 Customer Copy") +
    cutLine +
    makeReceipt("📁 Office Copy") +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
function genericPage(
  txType,
  data,
  nm,
  addr,
  dtFmt,
  savAcc,
  shrAcc,
  lnAcc,
  fdAcc,
  fdPv,
  pan,
  dob,
  nom,
  nomRel,
  ref,
  lnAmt,
  lnWrd,
  fdAmt,
  fdWrd,
  fdPrd,
  fdRate,
  fdMat,
  fdMatAmt,
  fdMatWrd,
  ornWt,
  goldOrn,
  silvOrn,
  metal,
  comments,
  cid,
  aadh,
  mob,
) {
  var TITLES = {
    "Closing - Loan": "-- सोने/चांदी तारण कर्ज बंद करण्याबाबत अर्ज --",
    "Fixed Deposit": "-- मुदत ठेव खाते उघडण्याचा फॉर्म --",
    "Fixed Deposit - MIS":
      "-- MIS मुदत ठेव खाते उघडण्याचा फॉर्म (मासिक व्याज) --",
    "FD - Slips": "** मुदत ठेव — पैसे काढण्याचा / जमा फॉर्म **",
    "FD - Slips - MIS": "** MIS मुदत ठेव — पैसे काढण्याचा / जमा फॉर्म **",
    "Closing - FD": "-- मुदत ठेव रक्कम परत मिळण्याबाबत अर्ज --",
    "Closing - FD - Slips": "** FD बंद — पैसे काढण्याचा फॉर्म **",
    "Saving Account": "-- दै. लघुबचत / बचत खाते उघडण्याचा फॉर्म --",
    Sadasya: "– सदस्य होण्यासाठी करावयाचा अर्ज [नियम १९ (१)] –",
    "Sadasya - Slips": "** सदस्य — पैसे काढण्याचा / जमा फॉर्म **",
    "OD Loan": "-- मुदत ठेव तारण कर्ज अर्ज (OD Loan) --",
    "Slips - OD": "** OD Loan — पैसे काढण्याचा / जमा फॉर्म **",
    "Closing - OD": "-- OD Loan बंद करण्याबाबत अर्ज --",
    "Current Account": "-- चालू खाते उघडण्याचा फॉर्म --",
    "Current - Slips": "** चालू खाते — पैसे काढण्याचा / जमा फॉर्म **",
    "Shares Account": "-- शेअर / सभासद खाते उघडण्याचा फॉर्म --",
    "Shares - Transfer": "-- शेअर हस्तांतरण अर्ज --",
    "Naammatr Sabhasad Account":
      "-- नाममात्र सभासद होण्यासाठी करावयाचा अर्ज --",
    "Naammatr Sabhasad - Slips": "** नाममात्र सभासद — पैसे काढण्याचा फॉर्म **",
  };

  function row2(lbl, val) {
    if (!val || val === "—") return "";
    return (
      '<tr><td class="lbl" style="width:35%">' +
      lbl +
      '</td><td class="val">' +
      val +
      "</td></tr>"
    );
  }

  var tbl =
    '<table class="it" style="margin:0"><colgroup><col style="width:35%"><col style="width:65%"></colgroup>' +
    row2("पूर्ण नाव / Name", nm) +
    row2("पत्ता / Address", addr) +
    row2("दिनांक / Date", dtFmt) +
    row2("आधार / Aadhar", aadh) +
    row2("मो.न. / Mobile", mob) +
    (savAcc !== "—" ? row2("बचत खाते / Saving Acc", savAcc) : "") +
    (shrAcc !== "—" ? row2("शेअर खाते / Share Acc", shrAcc) : "") +
    (lnAcc !== "—" ? row2("कर्ज खाते / Loan Acc", lnAcc) : "") +
    (fdAcc !== "—" ? row2("FD खाते / FD Acc", fdAcc) : "") +
    (fdPv !== "—" ? row2("FD पावती / FD Parvati", fdPv) : "") +
    (lnAmt !== "—"
      ? row2("कर्ज रक्कम / Loan Amount", "रू. " + lnAmt + "/- (" + lnWrd + ")")
      : "") +
    (fdAmt !== "—"
      ? row2("FD रक्कम / FD Amount", "रू. " + fdAmt + "/- (" + fdWrd + ")")
      : "") +
    (nom !== "—"
      ? row2(
          "वारसदार / Nominee",
          nom + (nomRel !== "—" ? " (" + nomRel + ")" : ""),
        )
      : "") +
    "</table>";

  var body =
    '<div class="page">' +
    '<div class="ohdr"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>' +
    '<div class="ftitle">' +
    (TITLES[txType] || txType) +
    "</div>" +
    tbl;

  if (comments && comments !== "—") {
    body += '<div class="bp"><strong>शेरा:</strong> ' + comments + "</div>";
  }

  body +=
    '<div style="display:flex;justify-content:space-between;padding:18px 20px 12px;border-top:1px solid #000;margin-top:auto">' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:55mm;margin-bottom:4px"></div><div style="font-size:9pt">' +
    nm +
    "</div></div>" +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:55mm;margin-bottom:4px"></div><div style="font-size:9pt">प्राधिकृत अधिकारी</div></div>' +
    "</div>" +
    "</div>";

  return body;
}

// ═══════════════════════════════════════════════════════
//  SADASYA FORM PAGE  (सदस्य होण्यासाठी करावयाचा अर्ज)
// ═══════════════════════════════════════════════════════
function sadasya_FormPage(
  nm,
  addr,
  dtFmt,
  mob,
  aadh,
  cid,
  savAcc,
  shrAcc,
  pan,
  dob,
  occ,
  nom,
  nomRel,
  ref,
  comments,
  docPhotos,
) {
  var orgHdr =
    '<div class="ohdr"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';

  var ftitle =
    '<div class="ftitle">– सदस्य होण्यासाठी करावयाचा अर्ज [नियम १९ (१)] –</div>';

  // Date + salutation line
  var intro =
    '<div class="bp" style="font-size:8.5pt;line-height:1.4">मा. अध्यक्ष साहेब, &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; प्राप्तीची दि. : <strong>' +
    dtFmt +
    "</strong><br>" +
    "जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव (जा.)<br>" +
    "<br>महोदय,<br>" +
    "&nbsp;&nbsp;&nbsp;&nbsp;मी खालील सही करणार श्री / सौ / श्रीमती <strong>" +
    nm +
    "</strong> हल्लीचा पता: <strong>" +
    addr +
    "</strong> ता. जळगाव जामोद जी. बुलढाणा. आपले संस्थेचे सदस्य होण्याकरीता हा अर्ज करीत आहे. माझ्या संबंधी खालील प्रमाणे तपशिलवार माहिती मी देत आहे." +
    "</div>";

  // 6-column info table matching Word doc layout
  var itbl =
    '<table class="it"><colgroup>' +
    '<col style="width:14%"><col style="width:22%"><col style="width:15%"><col style="width:17%"><col style="width:15%"><col style="width:17%">' +
    "</colgroup>" +
    "<tr>" +
    '<td class="lbl">पूर्ण नाव</td><td class="val vbig" colspan="1">' +
    nm +
    "</td>" +
    '<td class="lbl">शेअर खाते क्र.</td><td class="val vbig">' +
    shrAcc +
    "</td>" +
    '<td class="lbl">बचत ठेव खाते क्र.</td><td class="val vbig">' +
    savAcc +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td class="lbl">पत्ता</td><td class="val" colspan="1">' +
    addr +
    " ह.मु.जळगाव जामोद तालुका</td>" +
    '<td class="lbl">मो.न.</td><td class="val">' +
    mob +
    "</td>" +
    '<td class="lbl">सभासद क्र.</td><td class="val">' +
    cid +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td class="lbl">पॅन कार्ड</td><td class="val">' +
    pan +
    "</td>" +
    '<td class="lbl">प्रवेश फी ची रक्कम</td><td class="val">रू. 50 /-</td>' +
    '<td class="lbl">आधार कार्ड</td><td class="val">' +
    aadh +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td class="lbl">जन्म तारीख</td><td class="val">' +
    dob +
    "</td>" +
    '<td class="lbl">माझे राष्ट्रीयत्व</td><td class="val">भारतीय</td>' +
    '<td class="lbl">व्यवसाय</td><td class="val">' +
    (occ || "शेती") +
    "</td>" +
    "</tr>" +
    "<tr>" +
    '<td class="lbl">सदस्यत्वाचा प्रकार</td><td class="val">सामान्य सभासद</td>' +
    '<td class="lbl">भागांचे खरेदीबद्दल भरलेली रक्कम</td><td class="val" colspan="3">रु. 500 /-</td>' +
    "</tr>" +
    "</table>";

  // Items 1-5
  var items =
    '<div class="bp" style="font-size:8.5pt;line-height:1.4">' +
    "१) मालक अगर कुळ या नात्याने धारण केलेल्या स्थावर जिंदगीचा तपशिल: .................................................................................................................................................................<br>" +
    "२) संस्थेकडे जास्तीत जास्त रक्कम कर्ज घेण्याची मी इच्छीतो रू.: ......................................................................................................................<br>" +
    "३) दुसऱ्या सहकारी संस्थेचा / संस्थाचा सदस्य असल्यास त्याबद्दलचा व संस्थेचे / संस्थांचा किती कर्ज देणे अगर थकले आहे (तसेच असल्यास) या माहिती चा तपशिल: .....................................................<br>" +
    "४) संस्थेचे उपविधी अन्वये लागणारी इतर माहिती: .............................................................................................<br>" +
    "५) संस्थेच्या अर्जदाराच्या कुटुंबातील (महाराष्ट्र सहकारी संस्था अधिनियम कलम क्र.६ मध्ये 'कुटुंब' या शब्दाच्या केलेल्या अर्थानुसार) हल्ली संस्थेत सदस्य असणाऱ्या इसमांची नावे." +
    "</div>";

  // Declaration paragraph
  var decl =
    '<div class="bp" style="font-size:8.5pt;line-height:1.4">' +
    "मी <strong>" +
    nm +
    "</strong> प्रतिज्ञेवर असे जाहीर करतो की, आपल्या संस्थेचे उपविधी व अधिनियम मी वाचले असून संस्थेशी होणाऱ्या माझ्या व्यवहारासंबंधीच्या अशा सर्व बाबतीत त्या उपविधीला अनुसरून मी या अर्जाद्वारे कबुली देत आहे. मी प्रतिज्ञेवर असे जाहीर करतो की, वर दिलेली माहिती माझे उत्तम माहिती प्रमाणे खरी व बिनचुक अशी आहे. मी माझ्या नावे होणाऱ्या शेअर्स बावत खालीलप्रमाणे वारस नेमून देत आहे." +
    "</div>";

  // Nominee table
  var nomTbl =
    '<table class="it" style="margin:4px 14px;width:calc(100% - 28px)"><colgroup><col style="width:5%"><col style="width:20%"><col style="width:35%"><col style="width:20%"><col style="width:20%"></colgroup>' +
    '<tr><td class="lbl">अ.क्र.</td><td class="lbl">वारसदाराचे नाव</td><td class="val"><strong>' +
    nom +
    '</strong></td><td class="lbl">वारसदाराचे नाते</td><td class="val"><strong>' +
    nomRel +
    "</strong></td></tr>" +
    "</table>";

  // Guarantees section
  var guarnt =
    '<div class="bp" style="font-size:8.5pt;line-height:1.4">' +
    "वरील प्रमाणे नेमून दिलेल्या वारसांची नोंद आपल्या दफ्तरी करण्यात यावी.<br>" +
    "मी अशी हमी देतो की,<br>" +
    "&nbsp;&nbsp;• मी धारण केलेली स्थावर व जगम जिंदगी, माझे कुटुंबातील आपले संस्थेचे सदस्य, इत्यादींची उपविधी अन्वये लागणारी माहिती पुरवीन<br>" +
    "&nbsp;&nbsp;• आपली संस्था मला आदेश देईल त्याप्रमाणे कोणतही प्रतिज्ञापत्र, रोखा, करार अगर इतर दस्ताऐवज मी करून देईन<br>" +
    "७) मी एकापेक्षा अधिक पतपेढ्याचा सदस्य आहे / झाली आहे. त्या पक्षपद्र्यांचे नाव खाली देण्यात आले आहे.<br>" +
    "&nbsp;&nbsp;१) ............................................................................बँक म..............................................<br>" +
    "&nbsp;&nbsp;२) .............................................................................संस्था म............................................<br>" +
    "&nbsp;&nbsp;३) नागरी सहकारी पतपेढी म......................................................................................................" +
    "</div>";

  // Maharashtra law declaration
  var mhdecl =
    '<div class="bp" style="font-size:8.5pt;line-height:1.4">' +
    "महाराष्ट्र सहकारी संस्था नियम १९६१ मधील नियम ४५ अन्वये आवश्यक असल्याप्रमाणे मी या द्वारे असे जाहीर करतो की मी केवळ जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसायटी मर्या. जळगाव (जा.) कडूनच कर्ज घेईल. वर नमदू केलेली पूर्ण माहिती मी <strong>" +
    nm +
    "</strong>, वाचली असून ती बरोबर आहे.<br>" +
    "दि. : <strong>" +
    dtFmt +
    "</strong><br>" +
    "साक्षीदाराचे नाव: <strong>" +
    ref +
    "</strong>" +
    "</div>";

  // Signature row
  var sadasya_sigRow =
    '<div style="display:flex;justify-content:space-between;padding:10px 20px 8px;border-top:1px solid #000">' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:55mm;margin-bottom:4px"></div><div style="font-size:9pt">साक्षीदाराची सही</div></div>' +
    '<div style="text-align:center">' +
    sigLine(nm, "अर्जदाराची सही") +
    "</div>" +
    "</div>";

  // Special notes
  var notes =
    '<div class="bp" style="font-size:8.5pt;background:#fafafa;border-top:1px dashed #bbb">' +
    "<strong>* विशेष सूचना *</strong><br>" +
    "१) अर्जदार हा एखाद्या संस्थेचा प्रतिनिधी असेल तर अर्जावर सही करणारा इसम हा संस्थेचा आहे काय हे अर्जात नमूद करावे. या अर्जावर सही करण्यास त्याला अधिकृत करणाऱ्या त्या संस्थेच्या समितीच्या ठरावाची प्रत अर्जासोबत जोडावी.<br>" +
    "२) अर्जदार हा एखादा एक व्यक्ती संस्था (कार्पोरेट बॉडी) असेल तर त्या एक व्यक्तीभूत संस्थेतर्फे अर्जावर सही करणाऱ्या इसमाचा दर्जा (हुद्दा) दर्शविला पाहिजे. तसेच त्या संस्थेतर्फे या अर्जावर सही करणाऱ्या इसमास अधिकृत करणाऱ्या वस्ताऐवजांची निगडित कागद पत्रांची (डॉक्युमेंट) प्रत या अर्जासोबत जोडली पाहिजे.<br><br>" +
    "समितीच्या ता.......................................च्या सभेत ठराव क्र............... ने मंजूर / नामंजूर" +
    "</div>";

  // Footer
  var ftFooter =
    '<div style="display:flex;justify-content:space-between;padding:8px 20px 10px;border-top:1px solid #000">' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:55mm;margin-bottom:4px"></div><div style="font-size:9pt">कार्यकारी संचालक / व्यवस्थापक</div></div>' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:55mm;margin-bottom:4px"></div><div style="font-size:9pt">अध्यक्ष</div></div>' +
    "</div>" +
    '<div class="bp" style="text-align:center;font-size:8.5pt;border-top:1px solid #ccc">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसायटी मर्यादित जळगाव (जा.) जि. बुलढाणा र.नं. १०६७, शाखा-जळगाव जा.</div>';

  return (
    '<div class="page" style="padding-top:0;margin-top:0">' +
    orgHdr +
    ftitle +
    intro +
    itbl +
    items +
    decl +
    nomTbl +
    guarnt +
    mhdecl +
    sadasya_sigRow +
    notes +
    ftFooter +
    (docPhotos &&
    docPhotos.filter(function (p) {
      return p && p.src;
    }).length
      ? '<div style="border-top:1.5px solid #000;padding:6px 12px 8px">' +
        '<div style="font-size:9pt;font-weight:700;margin-bottom:6px">📷 Documents / Photos</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
        docPhotos
          .filter(function (p) {
            return p && p.src;
          })
          .map(function (p) {
            var isCust = p.label === "Customer Photo";
            var w = isCust ? "28mm" : "38mm";
            var h = isCust ? "35mm" : "45mm";
            return (
              '<div style="text-align:center;flex:0 0 auto">' +
              '<img src="' +
              p.src +
              '" style="width:' +
              w +
              ";height:" +
              h +
              ';object-fit:cover;border:1.5px solid #888;border-radius:3px;display:block">' +
              '<div style="font-size:8pt;color:#444;margin-top:3px">' +
              p.label +
              "</div>" +
              "</div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    declLine() +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  SADASYA SLIPS PAGE  (3 slips: SAV-DB, SHR-CR, FORM FEE-CR)
// ═══════════════════════════════════════════════════════
function sadasya_SlipsPage(nm, dtFmt, savAcc, shrAcc) {
  function orgHdr() {
    return '<div class="sohdr"><div class="sohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  }

  function scrollTbl(shrNo, savNo, date) {
    return (
      '<table class="sst"><tr>' +
      '<th style="width:18%">Scroll No</th>' +
      '<th style="width:22%">सभासद खाते क्र.</th>' +
      '<th style="width:22%">बचत खाते क्र.</th>' +
      '<th style="width:25%">तारीख</th>' +
      '<th style="width:13%">Debit/Credit</th>' +
      "</tr><tr>" +
      "<td></td>" +
      "<td><strong>" +
      shrNo +
      "</strong></td>" +
      "<td><strong>" +
      savNo +
      "</strong></td>" +
      "<td><strong>" +
      date +
      "</strong></td>" +
      "<td></td>" +
      "</tr></table>"
    );
  }

  // Slip 1: SAV-DB-TRF — Debit ₹550 from saving
  var slip1 =
    '<div class="sblock">' +
    orgHdr() +
    '<div class="stbar"><span>पैसे काढण्याचा फॉर्म</span><span class="scode">SAV - DB - TRF</span></div>' +
    scrollTbl(shrAcc, savAcc, dtFmt) +
    '<table class="sct compact-slip">' +
    '<tr><th class="sl" style="background:#f0f4ff;width:38%">खातेदाराचे नाव</th><td class="sv" style="font-size:11pt;font-weight:800" colspan="3">' +
    nm +
    "</td></tr>" +
    '<tr><th class="sl" style="background:#f0f4ff">रक्कम</th><td class="sv" colspan="3"><strong>रक्कम रू. 550 /-</strong> <span style="font-size:9pt;font-weight:600">(अक्षरी रू. पाचशे पन्नास फक्त)</span></td></tr>' +
    '<tr><th class="sl" style="background:#f0f4ff;font-size:8.5pt">Transfer</th><td class="sv" colspan="3" style="font-size:8.5pt;color:#000">Saving Account → Shares Account</td></tr>' +
    "</table>" +
    '<div class="sftr">' +
    '<div class="si"><span class="si-name">रोखपाल/व्यवस्थापक/अधिकारी</span></div>' +
    '<div class="si"><span class="si-name">' +
    nm +
    '</span><span style="font-size:8pt">खातेदाराची सही</span></div>' +
    "</div>" +
    "</div>";

  // Slip 2: SHR-CR-TRF — Credit ₹500 to Share Account (सभासद ठेव)
  var slip2 =
    '<div class="sblock">' +
    orgHdr() +
    '<div class="stbar"><span>प्रवेश फि / स्टेशनरी / लघुबचत / मुदती / बचत ठेव / <u>सभासद ठेव</u> / नाममात्र फि</span><span class="scode">SHR - CR - TRF</span></div>' +
    scrollTbl(shrAcc, savAcc, dtFmt) +
    '<table class="sct compact-slip">' +
    '<tr><th class="sl" style="background:#f0fff4;width:38%">खातेदाराचे नाव</th><td class="sv" style="font-size:11pt;font-weight:800" colspan="3">' +
    nm +
    "</td></tr>" +
    '<tr><th class="sl" style="background:#f0fff4">सभासद ठेव</th><td class="sv" colspan="3"><strong>रक्कम रू. 500 /-</strong> <span style="font-size:9pt;font-weight:600">(अक्षरी रू. पाचशे फक्त)</span></td></tr>' +
    "</table>" +
    '<div class="sftr">' +
    '<div class="si"><span class="si-name">रोखपाल/व्यवस्थापक/अधिकारी</span></div>' +
    '<div class="si"><span class="si-name">' +
    nm +
    '</span><span style="font-size:8pt">खातेदाराची सही</span></div>' +
    "</div>" +
    "</div>";

  // Slip 3: FORM FEE-CR-TRF — Credit ₹50 form fee (account 129/1)
  var slip3 =
    '<div class="sblock">' +
    orgHdr() +
    '<div class="stbar"><span>प्रवेश फि / <u>स्टेशनरी</u> / लघुबचत / मुदती / बचत ठेव / सभासद ठेव / नाममात्र फि</span><span class="scode">FORM FEE - CR - TRF</span></div>' +
    scrollTbl(shrAcc, savAcc, dtFmt) +
    '<table class="sct compact-slip">' +
    '<tr><th class="sl" style="background:#fffbf0;width:38%">खातेदाराचे नाव</th><td class="sv" style="font-size:11pt;font-weight:800" colspan="3">' +
    nm +
    "</td></tr>" +
    '<tr><th class="sl" style="background:#fffbf0">सभासद फॉर्म फी</th><td class="sv" colspan="3"><strong>रक्कम रू. 50 /-</strong> <span style="font-size:9pt;font-weight:600">(अक्षरी रू. पन्नास फक्त)</span></td></tr>' +
    '<tr><th class="sl" style="background:#fffbf0">फॉर्म फी खाते क्र.</th><td class="sv" colspan="3"><strong>129 / 1</strong></td></tr>' +
    "</table>" +
    '<div class="sftr">' +
    '<div class="si"><span class="si-name">रोखपाल/व्यवस्थापक/अधिकारी</span></div>' +
    '<div class="si"><span class="si-name">' +
    nm +
    '</span><span style="font-size:8pt">खातेदाराची सही</span></div>' +
    "</div>" +
    "</div>";

  return (
    '<div class="spage">' +
    slip1 +
    '<hr class="sdiv">' +
    slip2 +
    '<hr class="sdiv">' +
    slip3 +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  NAAMMATR SABHASAD FORM PAGE
//  (नाममात्र सभासद होण्यासाठी करावयाचा अर्ज)
// ═══════════════════════════════════════════════════════
function naammatr_FormPage(nm, addr, dtFmt, dob, shrAcc, ref, docPhotos) {
  var orgHdr =
    '<div class="ohdr"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  var ftitle =
    '<div class="ftitle">-- नाममात्र सभासद होण्यासाठी करावयाचा अर्ज --</div>';

  // Header: date + नाममात्र सभासद क्र.
  var hdrRow =
    '<div style="display:flex;justify-content:space-between;padding:6px 16px 4px;border-bottom:1px solid #ddd;font-size:9.5pt">' +
    "<span>प्रति, &nbsp;&nbsp;&nbsp; दि. : <strong>" +
    dtFmt +
    "</strong></span>" +
    "<span>नाममात्र सभासद क्र. : <strong>" +
    shrAcc +
    "</strong></span>" +
    "</div>";

  // Salutation + applicant line
  var salut =
    '<div class="bp">' +
    "मे. अध्यक्ष / उपाध्यक्ष / सरव्यवस्थापक<br>" +
    "जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव (जा.)<br><br>" +
    "श्री. / श्रीमती / <strong>" +
    nm +
    "</strong>, वय / जन्म तारीख : <strong>" +
    dob +
    "</strong>, रा. <strong>" +
    addr +
    "</strong> ता. जळगाव जामोद" +
    "</div>";

  // Main request paragraph
  var reqPara =
    '<div class="bp yl">' +
    "&nbsp;&nbsp;&nbsp;&nbsp;मी आपले संस्थेचा नाममात्र सभासद होण्याकरिता हा अर्ज करित आहे. संस्थेचे सर्व नियम वाचले असून ते मला मान्य आहेत. नियमाप्रमाणे प्रवेश फी रुपये शंभर फक्त (रू. <strong>100 /-</strong>) भरली आहे. तरी मला नाममात्र सभासद करुन घेण्याची विनंती आहे. वर नमूद केलेली पूर्ण माहिती मी <strong>" +
    nm +
    "</strong>, वाचली असून ती बरोबर आहे." +
    "</div>";

  // Applicant signature
  var sigAppl =
    '<div style="display:flex;justify-content:flex-end;padding:6px 20px 10px;border-bottom:1.5px dashed #aaa">' +
    '<div style="text-align:center">' +
    sigLine(nm, "अर्जदाराची सही") +
    "</div>" +
    "</div>";

  // Referral paragraph
  var refPara =
    '<div class="bp gr">' +
    "&nbsp;&nbsp;&nbsp;&nbsp;मी <strong>" +
    ref +
    "</strong>, असून अर्जदार हे माझ्या पूर्ण परिचयाचे असून ते या संस्थेचे नाममात्र सभासद होण्यास पात्र आहेत. <strong>" +
    nm +
    "</strong>ला नाममात्र सभासद करुन घेण्यात यावे. करीता मी शिफारस करीत आहे. तरी मान्यता मिळावी." +
    "</div>";

  // Date + officer signature row
  var officerRow =
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:8px 20px 10px;border-bottom:1.5px dashed #aaa">' +
    '<div style="font-size:9.5pt">दि. : <strong>' +
    dtFmt +
    "</strong></div>" +
    '<div style="text-align:center">' +
    '<div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div>' +
    '<div style="font-size:9pt">लिपीक/अधिकारी</div>' +
    "</div>" +
    "</div>";

  // Report to committee section
  var reportSection =
    '<div style="padding:6px 16px 4px;border-bottom:1px solid #ddd">' +
    "<div style=\"text-align:center;font-weight:700;font-size:10pt;padding-bottom:4px;font-family:'Noto Serif Devanagari','Kokila','Mangal',serif\">** मे अध्यक्ष/व्यवस्थापक समिती कडे रिपोर्ट सादर **</div>" +
    '<div class="bp" style="padding-top:4px">' +
    "नियमाप्रमाणे प्रवेश फी रू <strong>100 /-</strong> जमा केले असून दि. <strong>" +
    dtFmt +
    "</strong> रोजी अर्जदारास नाममात्र सभासद करुन घेण्यात आले आहे तरी मान्यता मिळावी." +
    "</div>" +
    "</div>";

  // Authority signature
  var authSig =
    '<div style="display:flex;justify-content:flex-end;padding:8px 20px 10px;border-bottom:1.5px dashed #aaa">' +
    '<div style="text-align:center">' +
    '<div style="border-bottom:1px solid #000;height:18px;min-width:55mm;margin-bottom:4px"></div>' +
    '<div style="font-size:9pt">अधिकाऱ्याची सही</div>' +
    "</div>" +
    "</div>";

  // Committee resolution
  var committee =
    '<div class="bp">' +
    "कार्यकारी मंडळ सभा दि. : &nbsp;&nbsp;/&nbsp;&nbsp;/&nbsp;&nbsp;२०&nbsp;&nbsp;&nbsp;&nbsp; ठराव क्र. &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ने नोंद घेतली." +
    "</div>";

  // Chairman signature
  var chairSig =
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:8px 20px 12px">' +
    '<div style="font-size:9.5pt">दि. : &nbsp;&nbsp;/&nbsp;&nbsp;/&nbsp;&nbsp;२०</div>' +
    '<div style="text-align:center">' +
    '<div style="border-bottom:1px solid #000;height:18px;min-width:55mm;margin-bottom:4px"></div>' +
    '<div style="font-size:9pt">अध्यक्ष / उपाध्यक्ष</div>' +
    "</div>" +
    "</div>";

  return (
    '<div class="page">' +
    orgHdr +
    ftitle +
    hdrRow +
    salut +
    reqPara +
    sigAppl +
    refPara +
    officerRow +
    reportSection +
    authSig +
    committee +
    chairSig +
    photoGrid(docPhotos || []) +
    declLine() +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  NAAMMATR SABHASAD SLIPS PAGE
//  (2 slips: SAV-DB-TRF ₹100 + NOM FEE-CR-TRF ₹100)
// ═══════════════════════════════════════════════════════
function naammatr_SlipsPage(nm, dtFmt, savAcc, shrAcc) {
  function orgHdr() {
    return '<div class="sohdr"><div class="sohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  }

  function scrollTbl(nomAccLabel, shrNo, savNo, date, debitCredit) {
    return (
      '<table class="sst"><tr>' +
      '<th style="width:15%">Scroll No</th>' +
      '<th style="width:22%">' +
      nomAccLabel +
      "</th>" +
      '<th style="width:22%">बचत खाते क्र.</th>' +
      '<th style="width:28%">तारीख</th>' +
      '<th style="width:13%">' +
      debitCredit +
      "</th>" +
      "</tr><tr>" +
      "<td></td>" +
      "<td><strong>" +
      shrNo +
      "</strong></td>" +
      "<td><strong>" +
      savNo +
      "</strong></td>" +
      "<td><strong>" +
      date +
      "</strong></td>" +
      "<td></td>" +
      "</tr></table>"
    );
  }

  // Slip 1: SAV-DB-TRF — ₹100 debit from saving → nominal member account
  var slip1 =
    '<div class="sblock" style="page-break-inside:avoid;margin-bottom:4px">' +
    orgHdr() +
    '<div class="stbar"><span>पैसे काढण्याचा फॉर्म</span><span class="scode">SAV - DB - TRF</span></div>' +
    scrollTbl("नाममात्र खाते क्र.", shrAcc, savAcc, dtFmt, "Debit") +
    '<table class="sct compact-slip">' +
    '<tr><th class="sl" style="background:#f0f4ff;width:38%">खातेदाराचे नाव</th><td class="sv" style="font-size:10pt;font-weight:800" colspan="3">' +
    nm +
    "</td></tr>" +
    '<tr><th class="sl" style="background:#f0f4ff">रक्कम</th><td class="sv"><strong>रू. 100 /-</strong></td><th class="sl" style="background:#f0f4ff;width:22%">अक्षरी</th><td class="sv">शंभर फक्त</td></tr>' +
    '<tr><th class="sl" style="background:#f0f4ff">बचत खाते क्र.</th><td class="sv"><strong>' +
    savAcc +
    '</strong></td><th class="sl" style="background:#f0f4ff">नाममात्र खाते क्र.</th><td class="sv"><strong>' +
    shrAcc +
    "</strong></td></tr>" +
    "</table>" +
    '<div class="sftr" style="margin-top:3px">' +
    '<div class="si"><span class="si-name" style="font-size:7pt">रोखपाल/व्यवस्थापक</span></div>' +
    '<div class="si"><span class="si-name" style="font-size:7pt">' +
    nm +
    "</span></div>" +
    "</div>" +
    "</div>";

  // Slip 2: NOM FEE-CR-TRF — ₹100 credit nominal member fee
  var slip2 =
    '<div class="sblock" style="page-break-inside:avoid;margin-bottom:4px">' +
    orgHdr() +
    '<div class="stbar"><span>प्रवेश फि / नाममात्र सदस्य फि</span><span class="scode">NOM FEE - CR</span></div>' +
    scrollTbl("नाममात्र खाते क्र.", shrAcc, savAcc, dtFmt, "Credit") +
    '<table class="sct compact-slip">' +
    '<tr><th class="sl" style="background:#f0fff4;width:38%">खातेदाराचे नाव</th><td class="sv" style="font-size:10pt;font-weight:800" colspan="3">' +
    nm +
    "</td></tr>" +
    '<tr><th class="sl" style="background:#f0fff4">नाममात्र सदस्य फि</th><td class="sv"><strong>रू. 100 /-</strong></td><th class="sl" style="background:#f0fff4;width:22%">अक्षरी</th><td class="sv">शंभर फक्त</td></tr>' +
    "</table>" +
    '<div class="sftr" style="margin-top:3px">' +
    '<div class="si"><span class="si-name" style="font-size:7pt">रोखपाल/व्यवस्थापक</span></div>' +
    '<div class="si"><span class="si-name" style="font-size:7pt">' +
    nm +
    "</span></div>" +
    "</div>" +
    "</div>";

  // Slip 3: SAV-DEPOSIT — restyled to closely match the Cash Deposit
  // Saving Slip (savingDepositSlipPage's mkBankSlip): same bordered layout,
  // title + badge header, denom table beside a free-form name/amount panel,
  // and the same signature-footer treatment.
  var slip3 =
    '<div class="sblock" style="border:1px solid #333;padding:6px 10px;margin-bottom:4px;page-break-inside:avoid">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #1a1a6e;padding-bottom:3px;margin-bottom:6px">' +
    '<div style="font-size:9.5pt;font-weight:900;color:#1a1a6e">नाममात्र खाते जमा / हस्तांतरण पर्ची' +
    '&nbsp;<span style="font-size:7.5pt;font-weight:400;color:#555">जळगाव जामोद अर्बन को-ऑप. क्रेडीट सोसा. मर्या.</span>' +
    "</div>" +
    '<div style="display:flex;gap:5px;align-items:center;font-size:8pt;white-space:nowrap">' +
    '<span style="border:1px solid #333;padding:1px 6px"><strong>नाममात्र खाते क्र.</strong> ' +
    shrAcc +
    "</span>" +
    '<span style="border:1px solid #333;padding:1px 6px"><strong>बचत खाते क्र.</strong> ' +
    savAcc +
    "</span>" +
    '<span style="border:1px solid #333;padding:1px 6px"><strong>दि.</strong> ' +
    dtFmt +
    "</span>" +
    "</div>" +
    "</div>" +
    '<div style="display:flex;align-items:flex-start;gap:0">' +
    '<div style="min-width:46mm">' +
    _jjuDenomTable("#e8f5e9", "") +
    "</div>" +
    '<div style="padding-left:8px;flex:1;font-size:9pt">' +
    '<div style="font-size:8.5pt;font-weight:700;margin-bottom:1px">खातेदाराचे नाव :</div>' +
    '<div style="border-bottom:1px solid #000;margin-bottom:1px;padding-bottom:1px;font-weight:800;font-size:10pt">&nbsp;' +
    nm +
    "</div>" +
    '<div style="font-size:7pt;color:#555;margin-bottom:4px">खातेदाराचे संपूर्ण नांव</div>' +
    '<div style="margin-bottom:4px"><div style="border:1px solid #333;padding:6px 10px;font-size:14pt;font-weight:900;display:inline-block;min-width:44mm">रू. ..................../-</div></div>' +
    '<div style="font-size:7.5pt;color:#555;margin-bottom:1px">अक्षरी रुपये :</div>' +
    '<div style="border-bottom:1px solid #000;margin-bottom:4px;font-style:italic;font-size:8.5pt">&nbsp;................................</div>' +
    '<div style="font-size:7.5pt;color:#444;line-height:1.3;margin-bottom:4px">वरील रक्कम नाममात्र खात्यातून वर्ग करून सदर बचत खात्यात जमा करून घेण्यात यावी.</div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:4px">' +
    '<div style="font-size:7.5pt;color:#333;border-top:1px solid #000;padding-top:2px;margin-top:12mm;min-width:50mm;text-align:center">रोखपाल/व्यवस्थापक/अधिकारी</div>' +
    '<div style="font-size:7.5pt;color:#333;border-top:1px solid #000;padding-top:2px;margin-top:12mm;min-width:44mm;text-align:center">' +
    nm +
    " / सही</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>";

  // Force page break after so anything printed after these slips
  // (e.g. a combined Saving Account page in "New Naammatr Sabhasad")
  // always starts on a new page — same defensive pattern used in goldLoanPage().
  return (
    '<div class="spage" style="page-break-after:always;break-after:always">' +
    slip1 +
    slip2 +
    slip3 +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  SAVING ACCOUNT FORM PAGE
//  (दै. लघुबचत / बचत खाते उघडण्याचा फॉर्म)
// ═══════════════════════════════════════════════════════
function savingAccount_FormPage(
  nm,
  addr,
  dtFmt,
  mob,
  aadh,
  cid,
  savAcc,
  shrAcc,
  pan,
  dob,
  nom,
  nomRel,
  ref,
  comments,
  docPhotos,
) {
  var orgHdr =
    '<div class="ohdr"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  var ftitle =
    '<div class="ftitle">-- दै. लघुबचत/बचत खाते उघडण्याचा फॉर्म --</div>';

  // Intro
  var intro =
    '<div class="bp">' +
    "प्रति, शाखा व्यवस्थापक साहेब, &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; दि. : <strong>" +
    dtFmt +
    "</strong><br><br>" +
    "महोदय, मी आपणास विनंती करतो की, आपल्या संस्थेत श्री./सौ. <strong>" +
    nm +
    "</strong> या नावाने लघु बचत/बचत खाते उघडण्याची कृपा करावी. मी/आम्ही आज रोजी रू........(अक्षरी रु ......................) सोबत दिले आहेत. माझी सही/ आमच्या सह्या खालील प्रमाणे दिल्या आहेत. मी / आम्ही आपल्या खात्यातून पैसे काढण्याचा अधिकार मला/आमचे पैकी एकास किंवा संयुक्त मिळून राहील. अशा प्रकारच्या खात्यासंबंधीचे संस्थेचे हल्लीचे नियम व पुढे होणारे नियम मला/आम्हाला मान्य आहेत तसेच संस्थेच्या ठेवीचे व्याज दराच्या नियमामध्ये वेळोवेळी झालेले/होणारे बदल व संस्थेच्या उपविधीचे नियम मला/आम्हाला बंधनकारक आहेत. या ठेवीची मुदत संपत असल्याबद्दल मला/आम्हाला सुचना देण्याची आवश्यकता नाही. सदर ठेवीच्या रक्कमेची देय तारखेस मागणी न केल्यास नंतरच्या कालावधीचे व्याज संस्थेच्या नियमाप्रमाणे राहील ते मला / आम्हाला मान्य राहील." +
    "</div>";

  // 4-column info table matching Word doc
  var itbl =
    '<table class="it"><colgroup>' +
    '<col style="width:14%"><col style="width:36%"><col style="width:15%"><col style="width:35%">' +
    "</colgroup>" +
    "<tr>" +
    '<td class="lbl">पूर्ण नाव</td><td class="val vbig">' +
    nm +
    "</td>" +
    '<td class="lbl">बचत खाते क्र.</td><td class="val vbig">' +
    savAcc +
    "</td>" +
    "</tr><tr>" +
    '<td class="lbl">पत्ता</td><td class="val">' +
    addr +
    " ह.मु.जळगाव जामोद तालुका</td>" +
    '<td class="lbl">शेअर खाते क्र.</td><td class="val">' +
    shrAcc +
    "</td>" +
    "</tr><tr>" +
    '<td class="lbl">मो.न.</td><td class="val">' +
    mob +
    "</td>" +
    '<td class="lbl">सभासद क्र.</td><td class="val">' +
    cid +
    "</td>" +
    "</tr><tr>" +
    '<td class="lbl">आधार कार्ड</td><td class="val">' +
    aadh +
    "</td>" +
    '<td class="lbl">पॅन कार्ड</td><td class="val">' +
    pan +
    "</td>" +
    "</tr>" +
    "</table>";

  // Interest notice
  var intNote =
    '<div class="bp" style="font-size:9pt">' +
    "* व्याजाबाबत सुचना :- माझे / आमचे एकत्रित बचत खाते क्र. <strong>" +
    savAcc +
    "</strong> मध्ये तिमाही, सहामाही वार्षिक होणारे व्याजाची रक्कम जमा करावी. तसेच अज्ञान व्यक्तीचे नावाने केलेल्या गुंतवणूकीबद्दलचे पूर्ण व्यवहार करण्याचे अधिकार अज्ञान पालनकर्ता म्हणून मला / आम्हाला राहतील." +
    "</div>";

  // Referral row
  var refRow =
    '<table class="it" style="margin:4px 14px;width:calc(100% - 28px)"><colgroup><col style="width:25%"><col style="width:60%"><col style="width:15%"></colgroup>' +
    "<tr>" +
    '<td class="lbl">परिचय करून देणाऱ्याचे नाव व पत्ता</td>' +
    '<td class="val">' +
    ref +
    "</td>" +
    '<td style="text-align:center;font-size:9pt">सही</td>' +
    "</tr>" +
    "</table>";

  // Declaration + signature
  var declSig =
    '<div class="bp" style="font-size:9.5pt">' +
    "वर नमूद केलेली पूर्ण माहिती मी <strong>" +
    nm +
    "</strong>, वाचली असून ती बरोबर आहे." +
    "</div>" +
    '<div style="display:flex;justify-content:flex-end;padding:6px 20px 8px;border-bottom:1px dashed #aaa">' +
    '<div style="text-align:center">' +
    sigLine(nm, "अर्जदाराची सही") +
    "</div>" +
    "</div>";

  // Nominee row
  var nomRow =
    '<div class="bp" style="font-size:9pt">* सदर खाते माझे वारसदारास लागू / मान्य राहील.</div>' +
    '<table class="it" style="margin:4px 14px;width:calc(100% - 28px)"><colgroup><col style="width:20%"><col style="width:30%"><col style="width:20%"><col style="width:30%"></colgroup>' +
    "<tr>" +
    '<td class="lbl">वारसदाराचे नाव</td><td class="val"><strong>' +
    nom +
    "</strong></td>" +
    '<td class="lbl">वारसदाराचे नाते</td><td class="val"><strong>' +
    nomRel +
    "</strong></td>" +
    "</tr>" +
    "</table>";

  // Specimen signatures (3 boxes)
  var specSig =
    '<div class="bp" style="font-size:9pt;margin-bottom:2px">* अर्जदाराच्या / खातेदाराच्या सहीचा नमुना :</div>' +
    '<div style="display:flex;justify-content:space-between;padding:4px 14px 8px;gap:8px">' +
    '<div style="flex:1;text-align:center;border:1px solid #bbb;min-height:28px;padding:4px 0 2px"><div style="border-bottom:1px solid #000;height:22px;margin:0 8px"></div><div style="font-size:8pt;color:#555">सही १</div></div>' +
    '<div style="flex:1;text-align:center;border:1px solid #bbb;min-height:28px;padding:4px 0 2px"><div style="border-bottom:1px solid #000;height:22px;margin:0 8px"></div><div style="font-size:8pt;color:#555">सही २</div></div>' +
    '<div style="flex:1;text-align:center;border:1px solid #bbb;min-height:28px;padding:4px 0 2px"><div style="border-bottom:1px solid #000;height:22px;margin:0 8px"></div><div style="font-size:8pt;color:#555">सही ३</div></div>' +
    "</div>";

  // Instructions + staff signatures
  var instFooter =
    '<div class="bp" style="font-size:8.5pt;background:#fafafa;border-top:1px dashed #bbb">' +
    "* ठेव खाते चालविणे बाबत सुचना :<br>" +
    "* सर्व माहीती माझ्या समक्ष लिहीली व सह्या केल्या आहेत." +
    "</div>" +
    '<div style="display:flex;justify-content:space-between;padding:8px 20px 10px;border-top:1px solid #000">' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div><div style="font-size:9pt">लिपीक</div></div>' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div><div style="font-size:9pt">शाखा व्यवस्थापक / अधिकारी</div></div>' +
    "</div>" +
    '<div class="bp" style="font-size:8pt;border-top:1px solid #eee">' +
    "फॉर्म सोबत घ्यावयाची कागदपत्रे :- १) ओळख पत्र, २) रहिवाशी दाखला, ३) पासपोर्ट फोटो २, (४) पॅन कार्ड नसल्यास फॉर्म नं. ६० किंवा ६१ भरून घ्यावे." +
    "</div>";

  // Compact photo grid — smaller thumbnails so photos stay on page 1
  function savPhotoGrid(photos) {
    var valid = (photos || []).filter(function (p) {
      return p && p.src;
    });
    if (!valid.length) return "";
    var items = valid
      .map(function (p) {
        return (
          '<div style="text-align:center;flex:0 0 auto">' +
          '<img src="' +
          p.src +
          '" style="width:56mm;height:60mm;object-fit:cover;border:1px solid #888;border-radius:3px;display:block">' +
          '<div style="font-size:7pt;color:#444;margin-top:2px">' +
          p.label +
          "</div></div>"
        );
      })
      .join("");
    return (
      '<div style="border-top:1.5px solid #000;padding:3px 12px 4px">' +
      '<div style="font-size:8.5pt;font-weight:700;margin-bottom:3px">📷 Documents / Photos</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px">' +
      items +
      "</div></div>"
    );
  }

  return (
    '<div class="page" style="page-break-after:always;break-after:always">' +
    orgHdr +
    ftitle +
    intro +
    itbl +
    intNote +
    refRow +
    declSig +
    nomRow +
    specSig +
    instFooter +
    savPhotoGrid(docPhotos || []) +
    declLine() +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  FIXED DEPOSIT FORM PAGE
//  (मुदत ठेव / दै. लघुबचत खाते उघडण्याचा फॉर्म)
// ═══════════════════════════════════════════════════════
function fd_FormPage(
  nm,
  addr,
  dtFmt,
  mob,
  aadh,
  cid,
  savAcc,
  shrAcc,
  fdAcc,
  fdPv,
  pan,
  dob,
  nom,
  nomRel,
  ref,
  fdAmt,
  fdWrd,
  fdPrd,
  fdRate,
  fdMat,
  fdMatAmt,
  fdMatWrd,
  comments,
  docPhotos,
) {
  var orgHdr =
    '<div class="ohdr"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  var isMisFdForm = fdAcc && String(fdAcc).startsWith("290");
  var ftitle = isMisFdForm
    ? '<div class="ftitle">-- MIS मुदत ठेव खाते उघडण्याचा फॉर्म (मासिक व्याज — ९%) --</div>'
    : '<div class="ftitle">-- मुदत ठेव / दै. लघुबचत खाते उघडण्याचा फॉर्म --</div>';

  var intro =
    '<div class="bp">' +
    "प्रति, शाखा व्यवस्थापक साहेब, &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ठेव प्राप्तीची दि. : <strong>" +
    dtFmt +
    "</strong><br><br>" +
    "महोदय, मी आपणास विनंती करतो की, आपल्या संस्थेत श्री./सौ. <strong>" +
    nm +
    "</strong> या नावाने लघु बचत/बचत/मुदत ठेव खाते उघडण्याची कृपा करावी. माझी सही/ आमच्या सह्या खालील प्रमाणे दिल्या आहेत. मी / आम्ही आपल्या खात्यातून पैसे काढण्याचा अधिकार मला/आमचे पैकी एकास किंवा संयुक्त मिळून राहील. अशा प्रकारच्या खात्यासंबंधीचे संस्थेचे हल्लीचे नियम व पुढे होणारे नियम मला/आम्हाला मान्य आहेत तसेच संस्थेच्या ठेवीचे व्याज दराच्या नियमांमध्ये वेळोवेळी झालेले/होणारे बदल व संस्थेच्या उपविधीचे नियम मला/आम्हाला बंधनकारक आहेत. या ठेवीची मुदत संपत असल्याबद्दल मला/आम्हाला सुचना देण्याची आवश्यकता नाही. सदर ठेवीच्या रक्कमेची देय तारखेस मागणी न केल्यास नंतरच्या कालावधीचे व्याज संस्थेच्या नियमाप्रमाणे राहील ते मला / आम्हाला मान्य राहील." +
    "</div>";

  // 8-row, 4-col info table matching the Word doc
  var itbl =
    '<table class="it"><colgroup>' +
    '<col style="width:13%"><col style="width:37%"><col style="width:16%"><col style="width:34%">' +
    "</colgroup>" +
    '<tr><td class="lbl">पूर्ण नाव</td><td class="val vbig">' +
    nm +
    '</td><td class="lbl">शेअर खाते क्र.</td><td class="val vbig">' +
    shrAcc +
    "</td></tr>" +
    '<tr><td class="lbl">पत्ता</td><td class="val">' +
    addr +
    '</td><td class="lbl">बचत खाते क्र.</td><td class="val vbig">' +
    savAcc +
    "</td></tr>" +
    '<tr><td class="lbl">मो.न.</td><td class="val">' +
    mob +
    '</td><td class="lbl">सभासद क्र.</td><td class="val">' +
    cid +
    "</td></tr>" +
    '<tr><td class="lbl">पॅन कार्ड</td><td class="val">' +
    pan +
    '</td><td class="lbl">ठेव खाते क्र.</td><td class="val vbig">' +
    fdAcc +
    "</td></tr>" +
    '<tr><td class="lbl">आधार कार्ड</td><td class="val">' +
    aadh +
    '</td><td class="lbl">ठेवीची मुदत</td><td class="val"><strong>' +
    fdPrd +
    " महिने</strong></td></tr>" +
    '<tr><td class="lbl">ठेवीची रक्कम</td><td class="val vbig">रू. ' +
    fdAmt +
    '</td><td class="lbl">मुदत अंती रक्कम</td><td class="val vbig">रू. ' +
    fdMatAmt +
    "</td></tr>" +
    '<tr><td class="lbl">ठेवीची रक्कम अक्षरी</td><td class="val">' +
    fdWrd +
    '</td><td class="lbl">मुदत अंती रक्कम अक्षरी</td><td class="val">' +
    fdMatWrd +
    "</td></tr>" +
    '<tr><td class="lbl">ठेवीचे व्याज दर</td><td class="val"><strong>' +
    fdRate +
    '%</strong></td><td class="lbl">ठेवीची मुदत दि.</td><td class="val"><strong>' +
    fmtDate(fdMat) +
    "</strong></td></tr>" +
    "</table>";

  var intNote =
    '<div class="bp" style="font-size:9pt">' +
    "व्याजाबाबत सुचना :- माझे आमचे संयुक्त बचत खाते क्र. <strong>" +
    savAcc +
    "</strong> मध्ये तिमाही, सहामाही वार्षिक होणारे व्याजाची रक्कम जमा करावी. तसेच अज्ञान व्यक्तीचे नावाने केलेल्या गुंतवणूकीबद्दलचे पूर्ण व्यवहार करण्याचे अधिकार अज्ञान पालनकर्ता म्हणून मला / आम्हाला राहतील. सदर खाते माझे वारसदारास बंधनकारक राहील." +
    "</div>";

  var nomRow =
    '<table class="it" style="margin:4px 14px;width:calc(100% - 28px)"><colgroup><col style="width:20%"><col style="width:30%"><col style="width:20%"><col style="width:30%"></colgroup>' +
    '<tr><td class="lbl">वारसदाराचे नाव</td><td class="val"><strong>' +
    nom +
    '</strong></td><td class="lbl">वारसदाराचे नाते</td><td class="val"><strong>' +
    nomRel +
    "</strong></td></tr>" +
    "</table>";

  var pavti =
    '<div class="bp" style="font-size:9pt">' +
    "मुदत ठेव पावती क्र.: <strong>" +
    fdPv +
    "</strong>. वर नमूद केलेली पूर्ण माहिती मी <strong>" +
    nm +
    "</strong>, वाचली असून ती बरोबर आहे.<br>" +
    "* ठेव खाते चालविणे बाबत सुचना :" +
    "</div>";

  var sigBlock =
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:8px 20px 8px;border-top:1px solid #000">' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div><div style="font-size:9pt">लिपीक</div></div>' +
    '<div style="text-align:center">' +
    sigLine(nm, "अर्जदाराची सही") +
    "</div>" +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div><div style="font-size:9pt">शाखा व्यवस्थापक/अधिकारी</div></div>' +
    "</div>";

  var footer =
    '<div class="bp" style="font-size:8pt;border-top:1px solid #eee">' +
    "** सर्व माहीती माझ्या समक्ष लिहीली व सह्या केल्या आहेत.<br>" +
    "फॉर्म सोबत घ्यावयाची कागदपत्रे :- १) ओळख पत्र, २) रहिवाशी दाखला, ३) पासपोर्ट फोटो २, (४) पॅन कार्ड नसल्यास फॉर्म नं. ६० किंवा ६१ भरून घ्यावे." +
    "</div>";

  return (
    '<div class="page" style="padding-left:8mm">' +
    orgHdr +
    ftitle +
    intro +
    itbl +
    intNote +
    nomRow +
    pavti +
    sigBlock +
    footer +
    photoGrid(docPhotos || [], "65mm", "85mm") +
    declLine() +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  FORM NO. 60 + 61
// ═══════════════════════════════════════════════════════
function form6061Page(nm, addr, dtFmt) {
  var U =
    "border-bottom:1px solid #000;display:inline-block;padding-bottom:1px";
  function instrList() {
    return (
      '<div style="font-size:7.5pt;margin-top:0.5mm"><strong>Instructions:</strong> Documents which can be produced in support of the address are:' +
      '<div style="margin-top:0.5mm;line-height:1.5">' +
      "a) Ration card &nbsp;&nbsp; b) Passport &nbsp;&nbsp; c) Driving licence &nbsp;&nbsp; d) Identity card issued by any institution<br>" +
      "e) Copy of electricity bill or telephone bill showing residential address<br>" +
      "f) Any document issued by Central/State Govt or local bodies showing address<br>" +
      "g) Any other documentary evidence in support of address." +
      "</div></div>"
    );
  }
  function verifyBlock() {
    return (
      '<div style="margin-top:0.5mm">' +
      '<div style="font-weight:700;text-align:center;margin-bottom:1mm">Verification</div>' +
      '<div style="line-height:1.6">I, <span style="' +
      U +
      ';min-width:80mm">&nbsp;<strong>' +
      (nm || "") +
      "</strong></span> " +
      "do hereby declare that what is stated above is true to the best of my knowledge and belief.</div>" +
      '<div style="margin:1mm 0">Verified today, the <span style="' +
      U +
      ';min-width:18mm">&nbsp;</span> day of <span style="' +
      U +
      ';min-width:30mm">&nbsp;</span>.</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:2mm">' +
      '<div>Place: <span style="' +
      U +
      ';min-width:40mm">&nbsp;</span></div>' +
      '<div style="text-align:center"><div style="border-bottom:1.5px solid #000;min-width:50mm;height:12px;margin-bottom:2px"></div>' +
      '<div style="font-size:7.5pt;font-weight:700">Signature of the declarant</div></div>' +
      "</div></div>"
    );
  }
  var form60 =
    '<div style="font-family:Arial,sans-serif;font-size:8pt;color:#000;border:1px solid #000;padding:1mm 4mm;margin-bottom:0">' +
    '<div style="text-align:center;font-weight:900;font-size:9.5pt">FORM No. 60</div>' +
    '<div style="text-align:center;font-size:7pt">[See second proviso to rule 114B]</div>' +
    '<div style="text-align:center;font-weight:700;font-size:7.5pt;margin:0.5mm 0 1mm;line-height:1.3">Form of declaration to be filed by a person who does not have a permanent account number<br>and who enters into any transaction specified in rule 114 B</div>' +
    '<div style="line-height:1.6;font-size:8pt">' +
    '1.&nbsp; Full name and address &nbsp;<span style="' +
    U +
    ';min-width:70mm">&nbsp;<strong>' +
    (nm || "") +
    (addr ? ", " + addr : "") +
    "</strong></span><br>" +
    '2.&nbsp; Particulars of transaction &nbsp;<span style="' +
    U +
    ';min-width:90mm">&nbsp;</span><br>' +
    '3.&nbsp; Amount of the transaction &nbsp;<span style="' +
    U +
    ';min-width:80mm">&nbsp;</span><br>' +
    "4.&nbsp; Are you assessed to tax? &nbsp; Yes / No<br>" +
    '5.&nbsp; If yes, &nbsp; i) Ward/Circle/Range &nbsp;<span style="' +
    U +
    ';min-width:30mm">&nbsp;</span> &nbsp; ii) Reasons for no PAN &nbsp;<span style="' +
    U +
    ';min-width:40mm">&nbsp;</span><br>' +
    "6.&nbsp; Details of documents in support of address<br>" +
    "</div>" +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin:1mm 0">' +
    '<div>Date: <span style="' +
    U +
    ';min-width:38mm">&nbsp;' +
    dtFmt +
    '</span><br><br>Place: <span style="' +
    U +
    ';min-width:38mm">&nbsp;</span></div>' +
    '<div style="text-align:center"><div style="border-bottom:1.5px solid #000;min-width:50mm;height:12px;margin-bottom:2px"></div><div style="font-size:7.5pt;font-weight:700">Signature of the declarant</div></div>' +
    "</div>" +
    verifyBlock() +
    instrList() +
    "</div>";
  var form61 =
    '<div style="font-family:Arial,sans-serif;font-size:8pt;color:#000;border:1px solid #000;padding:1mm 4mm">' +
    '<div style="text-align:center;font-weight:900;font-size:9.5pt">FORM No. 61</div>' +
    '<div style="text-align:center;font-size:7pt">[See proviso to clause (a) of rule 114 C(1)]</div>' +
    '<div style="text-align:center;font-weight:700;font-size:7.5pt;margin:0.5mm 0 1mm;line-height:1.3">Form of declaration to be filed by a person who has agricultural income and is not in receipt of<br>any other income chargeable to income-tax in respect of specified in rule 114 B</div>' +
    '<div style="line-height:1.6;font-size:8pt">' +
    '1.&nbsp; Full name and address &nbsp;<span style="' +
    U +
    ';min-width:70mm">&nbsp;<strong>' +
    (nm || "") +
    (addr ? ", " + addr : "") +
    "</strong></span><br>" +
    '2.&nbsp; Particulars of transaction &nbsp;<span style="' +
    U +
    ';min-width:90mm">&nbsp;</span><br>' +
    "3.&nbsp; Details of documents in support of address &nbsp; Yes / No<br>" +
    "</div>" +
    '<div style="margin:1mm 0;font-size:8pt">I hereby declare that my source of income is from agriculture and I am not required to pay income tax on any other income if any.</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin:1mm 0">' +
    '<div>Date: <span style="' +
    U +
    ';min-width:38mm">&nbsp;' +
    dtFmt +
    '</span><br><br>Place: <span style="' +
    U +
    ';min-width:38mm">&nbsp;</span></div>' +
    '<div style="text-align:center"><div style="border-bottom:1.5px solid #000;min-width:50mm;height:12px;margin-bottom:2px"></div><div style="font-size:7.5pt;font-weight:700">Signature of the declarant</div></div>' +
    "</div>" +
    verifyBlock() +
    instrList() +
    "</div>";
  return (
    '<div style="background:#fff;width:210mm;height:auto;margin:0 auto;padding:3mm 5mm;' +
    'box-sizing:border-box;box-shadow:0 2px 14px rgba(0,0,0,.25);' +
    'page-break-before:always;break-before:always;' +
    'page-break-after:always;break-after:always;page-break-inside:avoid;break-inside:avoid">' +
    form60 +
    '<div style="margin-top:1.5mm"></div>' +
    form61 +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  FD SLIPS PAGE  (2 slips: SAV-DB-TRF + FD-CR-TRF)
// ═══════════════════════════════════════════════════════
function fd_SlipsPage(nm, dtFmt, savAcc, fdAcc, fdPv, fdAmt, fdWrd) {
  function orgHdr() {
    return '<div class="sohdr"><div class="sohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  }

  function scrollTbl(col2Label, col2Val, col3Label, col3Val, dcLabel) {
    return (
      '<table class="sst"><tr>' +
      '<th style="width:15%">Scroll No</th>' +
      '<th style="width:22%">' +
      col2Label +
      "</th>" +
      '<th style="width:22%">' +
      col3Label +
      "</th>" +
      '<th style="width:28%">तारीख</th>' +
      '<th style="width:13%">' +
      dcLabel +
      "</th>" +
      "</tr><tr>" +
      "<td></td>" +
      "<td><strong>" +
      col2Val +
      "</strong></td>" +
      "<td><strong>" +
      col3Val +
      "</strong></td>" +
      "<td><strong>" +
      dtFmt +
      "</strong></td>" +
      "<td></td>" +
      "</tr></table>"
    );
  }

  // Slip 1: SAV-DB-TRF — debit saving → FD account
  var slip1 =
    '<div class="sblock">' +
    orgHdr() +
    '<div class="stbar"><span>** पैसे काढण्याचा फॉर्म **</span><span class="scode">SAV - DB - TRF &nbsp; Debit</span></div>' +
    scrollTbl("मुदत ठेव खाते क्र.", fdAcc, "बचत खाते क्र.", savAcc, "Debit") +
    '<table class="sct compact-slip">' +
    '<tr><th class="sl" style="background:#f0f4ff;width:38%">खातेदाराचे नाव</th><td class="sv" style="font-size:11pt;font-weight:800" colspan="3">' +
    nm +
    "</td></tr>" +
    '<tr><th class="sl" style="background:#f0f4ff">रक्कम</th>' +
    '<td class="sv" colspan="3"><strong>रक्कम रू. ' +
    fdAmt +
    ' /-</strong> <span style="font-size:9pt;font-weight:600">(अक्षरी रू. ' +
    fdWrd +
    ")</span></td>" +
    "</tr>" +
    '<tr><th class="sl" style="background:#f0f4ff;font-size:8.5pt">Transfer</th><td class="sv" colspan="3" style="font-size:8.5pt;color:#555">Saving Account → Fixed Deposit Account</td></tr>' +
    "</table>" +
    '<div class="sftr">' +
    '<div class="si"><span class="si-name">रोखपाल/व्यवस्थापक/अधिकारी</span></div>' +
    '<div class="si"><span class="si-name">' +
    nm +
    '</span><span style="font-size:8pt">खातेदाराची सही</span></div>' +
    "</div>" +
    "</div>";

  // Slip 2: FD-CR-TRF — credit to FD
  var slip2 =
    '<div class="sblock">' +
    orgHdr() +
    '<div class="stbar"><span>प्रवेश फि / स्टेशनरी / लघुबचत / <u>मुदत ठेव</u> / बचत ठेव / सभासद ठेव / नाममात्र सदस्य फि</span><span class="scode">FD - CR - TRF &nbsp; Credit</span></div>' +
    scrollTbl("मुदत ठेव खाते क्र.", fdAcc, "खाते क्र.", savAcc, "Credit") +
    '<table class="sct compact-slip">' +
    '<tr><th class="sl" style="background:#f0fff4;width:38%">खातेदाराचे नाव</th><td class="sv" style="font-size:11pt;font-weight:800" colspan="3">' +
    nm +
    "</td></tr>" +
    '<tr><th class="sl" style="background:#f0fff4">रक्कम</th>' +
    '<td class="sv" colspan="3"><strong>रक्कम रू. ' +
    fdAmt +
    ' /-</strong> <span style="font-size:9pt;font-weight:600">(अक्षरी रू. ' +
    fdWrd +
    ")</span></td>" +
    "</tr>" +
    "</table>" +
    '<div class="sftr">' +
    '<div class="si"><span class="si-name">रोखपाल/व्यवस्थापक/अधिकारी</span></div>' +
    '<div class="si"><span class="si-name">' +
    nm +
    '</span><span style="font-size:8pt">खातेदाराची सही</span></div>' +
    "</div>" +
    "</div>";

  // Slip 3: SAV-CR — saving deposit slip (customer hands over cash). Redesigned
  // compact: info chips instead of a bordered 2-row scroll table, a tight
  // 3-column denom table (no 2000/1000 rows — discontinued; merged rupee/paise
  // into one column) instead of the wider shared 4-column one, and slimmer
  // row padding throughout — the previous version was needlessly bulky.
  function slip3DenomCompact() {
    var B = "1px solid #999";
    var notes = [500, 200, 100, 50, 20, 10, 5];
    var rows = notes
      .map(function (n) {
        return (
          '<tr><td style="padding:1px 3px;border:' + B + ';text-align:center;font-size:7pt">' +
          n +
          ' X</td><td style="padding:1px 3px;border:' + B + ';min-width:8mm">&nbsp;</td>' +
          '<td style="padding:1px 3px;border:' + B + ';min-width:11mm">&nbsp;</td></tr>'
        );
      })
      .join("");
    rows +=
      '<tr><td style="padding:1px 3px;border:' + B + ';font-size:6.5pt">सिक्के</td>' +
      '<td style="padding:1px 3px;border:' + B + '">&nbsp;</td><td style="padding:1px 3px;border:' + B + '">&nbsp;</td></tr>';
    rows +=
      '<tr style="background:#ffe9a8;font-weight:700"><td style="padding:1px 3px;border:' + B + ';font-size:7pt">एकूण</td>' +
      '<td style="padding:1px 3px;border:' + B + '">&nbsp;</td><td style="padding:1px 3px;border:' + B + '">&nbsp;</td></tr>';
    return (
      '<table style="border-collapse:collapse;font-size:7pt;width:100%">' +
      '<tr style="background:#555;color:#fff"><th style="padding:1px 3px;border:' + B + '">नोट</th>' +
      '<th style="padding:1px 3px;border:' + B + '">नग</th><th style="padding:1px 3px;border:' + B + '">रक्कम</th></tr>' +
      rows +
      "</table>"
    );
  }
  var slip3 =
    '<div class="sblock">' +
    orgHdr() +
    '<div class="stbar" style="padding:2px 8px"><span style="font-size:8pt">प्रवेश फि / स्टेशनरी / लघुबचत / मुदत ठेव / <u>बचत ठेव</u> / सभासद ठेव / नाममात्र सदस्य फि</span><span class="scode">SAV - CR &nbsp; Credit</span></div>' +
    // Compact info-chip line — replaces the old bordered 2-row scroll table
    '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:3px 7px;border-bottom:1px solid #ccc;font-size:7.5pt">' +
    '<span style="border:1px solid #999;border-radius:2px;padding:1px 5px">Scroll No.</span>' +
    '<span style="border:1px solid #999;border-radius:2px;padding:1px 5px"><strong>बचत खाते क्र.</strong> ' +
    savAcc +
    '</span>' +
    '<span style="border:1px solid #999;border-radius:2px;padding:1px 5px"><strong>मुदत ठेव खाते क्र.</strong> ' +
    fdAcc +
    '</span>' +
    '<span style="border:1px solid #999;border-radius:2px;padding:1px 5px"><strong>तारीख</strong> ' +
    dtFmt +
    '</span>' +
    '<span style="margin-left:auto;font-weight:800;font-size:7.5pt;border:1px solid #000;padding:1px 6px">Credit</span>' +
    "</div>" +
    // Body: compact denom table (left) + name/amount/transfer/signatures (right)
    '<div style="display:flex;align-items:flex-start;gap:0;padding:3px 6px">' +
    '<div style="min-width:28mm;padding-right:6px">' +
    slip3DenomCompact() +
    "</div>" +
    '<div style="flex:1;min-width:0;padding-left:6px;border-left:1px solid #ddd;font-size:8.5pt">' +
    '<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px">' +
    '<span style="font-weight:800;white-space:nowrap">खातेदाराचे नाव :</span>' +
    '<span style="font-weight:900;font-size:10pt">' +
    nm +
    "</span>" +
    "</div>" +
    '<div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:5px;margin-bottom:4px;font-weight:800">' +
    "<span>रू.</span>" +
    '<span style="border-bottom:1px solid #000;display:inline-block;min-width:22mm">&nbsp;</span>' +
    "<span>/- ( अक्षरी रू.</span>" +
    '<span style="border-bottom:1px solid #000;display:inline-block;flex:1;min-width:32mm;font-weight:600;font-size:8pt">&nbsp;</span>' +
    "<span>)</span>" +
    "</div>" +
    '<div style="font-size:7.5pt;color:#555;margin-bottom:6px"><strong style="color:#333">जमा प्रकार :</strong> रोख — खातेदाराकडून स्वीकारले / Cash received from account holder</div>' +
    '<div style="display:flex;justify-content:space-between;gap:10px">' +
    '<span style="font-size:7.5pt;font-weight:700;border-top:1px solid #000;padding-top:2px;margin-top:7mm;min-width:40mm;text-align:center">रोखपाल/व्यवस्थापक/अधिकारी</span>' +
    '<span style="font-size:7.5pt;font-weight:700;border-top:1px solid #000;padding-top:2px;margin-top:7mm;min-width:36mm;text-align:center">' +
    nm +
    "<br>खातेदाराची सही</span>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>";

  return (
    '<div class="spage">' +
    slip1 +
    '<hr class="sdiv">' +
    slip2 +
    '<hr class="sdiv">' +
    slip3 +
    declLine() +
    "</div>" +
    '<div class="spage-blank"></div>'
  );
}
//  (मुदत ठेव तारण कर्ज अर्ज)
// ═══════════════════════════════════════════════════════
function od_FormPage(
  nm,
  addr,
  dtFmt,
  mob,
  aadh,
  cid,
  savAcc,
  fdAcc,
  fdPv,
  lnAcc,
  pan,
  dob,
  nom,
  nomRel,
  lnAmt,
  lnWrd,
  fdAmt,
  fdWrd,
  fdMat,
  comments,
  docPhotos,
) {
  var orgHdr =
    '<div class="ohdr"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  var ftitle = '<div class="ftitle">-- मुदत ठेव तारण कर्ज अर्ज --</div>';

  var hdrLine =
    '<div class="bp">मा. अध्यक्ष, &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; प्राप्तीची दि. : <strong>' +
    dtFmt +
    "</strong><br>" +
    "जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७<br><br>" +
    "मी अर्जदार <strong>" +
    nm +
    "</strong> खालील स्वाक्षरी करणार विनंती करतो की, खाली वर्णन केल्याप्रमाणे मुदत ठेवीचे / पावतीचे तारणावर रु. <strong>" +
    (function (a) {
      var v = parseFloat(a) || 0;
      return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(2);
    })(lnAmt) +
    "/-</strong> ( अक्षरी रू. " +
    lnWrd +
    " ) कर्ज मंजूर करण्याची कृपा करावी. याबाबत अस्तित्वात असणारे नियम व भविष्यात संचालक मंडळ तथा कायद्यातील तरतुदीप्रमाणे बदल होणारे नियम मला व माझे इस्टेटीस व वारसदारास बंधनकारक राहतील. सदरहू पावती आपल्या संस्थेच्या नावाने तबदील करून देण्यास तयार आहोत." +
    "</div>";

  // 8-row info table
  // Format amount: no trailing .00 for whole numbers
  function fmtAmtPlain(n) {
    var v = parseFloat(n) || 0;
    return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(2);
  }

  var itbl =
    '<table class="it"><colgroup>' +
    '<col style="width:13%"><col style="width:37%"><col style="width:16%"><col style="width:34%">' +
    "</colgroup>" +
    '<tr><td class="lbl">पूर्ण नाव</td><td class="val vbig">' +
    nm +
    '</td><td class="lbl">कर्ज खाते क्र.</td><td class="val vbig">' +
    lnAcc +
    "</td></tr>" +
    '<tr><td class="lbl">पत्ता</td><td class="val">' +
    addr +
    '</td><td class="lbl">बचत खाते क्र.</td><td class="val vbig">' +
    savAcc +
    "</td></tr>" +
    '<tr><td class="lbl">मो.न.</td><td class="val">' +
    mob +
    '</td><td class="lbl">सभासद क्र.</td><td class="val">' +
    cid +
    "</td></tr>" +
    '<tr><td class="lbl">पॅन कार्ड</td><td class="val">' +
    pan +
    '</td><td class="lbl">ठेव खाते क्र.</td><td class="val vbig">' +
    fdAcc +
    "</td></tr>" +
    '<tr><td class="lbl">आधार कार्ड</td><td class="val">' +
    aadh +
    '</td><td class="lbl">पावती क्र.</td><td class="val vbig">' +
    fdPv +
    "</td></tr>" +
    '<tr><td class="lbl">ठेवीची रक्कम</td><td class="val">रू. <strong>' +
    fmtAmtPlain(fdAmt) +
    '</strong> /- <span style="font-size:9pt;font-weight:500">( अक्षरी रू. ' +
    fdWrd +
    " )</span>" +
    '</td><td class="lbl">कर्ज रक्कम</td><td class="val">रू. <strong>' +
    fmtAmtPlain(lnAmt) +
    '</strong> /- <span style="font-size:9pt;font-weight:500">( अक्षरी रू. ' +
    lnWrd +
    " )</span>" +
    "</td></tr>" +
    '<tr><td class="lbl">वारसदाराचे नाव</td><td class="val"><strong>' +
    nom +
    '</strong></td><td class="lbl">वारसदाराचे नाते</td><td class="val"><strong>' +
    nomRel +
    "</strong></td></tr>" +
    "</table>";

  // Declaration (घोषणापत्र)
  var ghoshna =
    '<div class="bp yl">' +
    '<div style="text-align:center;font-weight:700;font-size:10pt;padding-bottom:4px">** घोषणापत्र **</div>' +
    "मी / आम्ही घोषित करतो, मुदती ठेव पावती तारणावरील कर्ज नियम वाचले, ते मला / आम्हाला मान्य असून आमचेवर बंधनकारक आहेत. कायद्यामध्ये किंवा शासनाच्या धोरणामध्ये वेळोवेळी झालेल्या बदलामुळे संस्थेने कोणतेही निर्णय घेतल्यास ते मला मान्य राहील. मी खालील सही करणार मुदत ठेव पावती पत्राद्वारे निवेदन करतो की, आज रोजी मी वरील वर्णन केल्याप्रमाणे मुदत ठेव पावती संस्थेस तारण देत आहे. संबंधित वर्णन केल्याप्रमाणे रोखे, पावती माझे स्वतःचे मालकीची असून त्यात कोणत्याही प्रकारचा बोझा नाही. याबाबत काही वाद झाल्यास त्याला मी सर्वस्वी जबाबदार राहील. सदर मुदत ठेव पावती ही माझी स्वकष्टार्जित रकमेमधून घेतली असून, सदर मुदत ठेव पावती ही तारण देऊन कर्ज घेण्याचा मला संपूर्ण अधिकार असून त्यावर कोणत्याही प्रकारचा प्रत्यक्ष व अप्रत्यक्ष निर्बंध नाही. कळावे," +
    '<div style="text-align:right;margin-top:6px">' +
    sigLine(nm, "कर्जदाराची सही") +
    "</div>" +
    "</div>";

  // Vachanchithi — inline style matching gold loan (no border box)
  var vach =
    '<div class="vach" style="margin:2px 8px;padding:3px 10px;font-size:8pt;line-height:1.5;border:none;background:transparent">' +
    '<div class="vach-t" style="font-size:9pt;padding-bottom:1px;margin-bottom:2px">* वचनचिठ्ठी *</div>' +
    "मुदत ठेव पावती क्र. - <strong>" +
    fdPv +
    "</strong> &nbsp;&nbsp; दि. <strong>" +
    dtFmt +
    "</strong><br>" +
    "मी <strong>" +
    nm +
    "</strong>, 'जळगाव जामोद अर्बन को-ऑप क्रेडीट सोसा मर्या जळगाव (जा) र.नं.१०६७ यास<br>" +
    "अगर ती लिहून देईल त्यास आज तारखेपासून कर्ज घेतलेली रक्कम <strong>Rs. " +
    lnAmt +
    "/-</strong><br>" +
    "अक्षरी रू.<strong>" +
    lnWrd +
    "</strong> &nbsp; द.सा.द.शे. रूपये ....... टक्के प्रमाणे माझेकडे मागणी केली जाईल त्यावेळी व त्या ठिकाणी परत करण्याचे वचन देतो." +
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<strong>कर्जदाराची सही........................</strong>" +
    "</div>";

  // Adhikar Patra
  var adhikar =
    '<div class="bp gr">' +
    '<div style="text-align:center;font-weight:700;font-size:10pt;padding-bottom:4px">** अधिकार पत्र **</div>' +
    "मी खालील सही करणार, जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७ यास अधिकार पत्र लिहून देतो की, मी आपल्या संस्थेकडून मुदती ठेवी पावती चे तारणावर आपल्याकडून रु.<strong>" +
    lnAmt +
    "/-</strong> (अक्षरी <strong>" +
    lnWrd +
    "</strong>) कर्ज घेतले असून तारण पा.क्र.<strong>" +
    fdPv +
    "</strong> ची मुदत दि.<strong>" +
    fdMat +
    "</strong> ला संपते. वरील मुदतीचे आत मी घेतलेल्या कर्जावर व्याजासह परतफेड करू न शकल्यास माझेकडील संपूर्ण कर्ज व व्याज मुदती ठेवीतून मुदत संपताच वटवून घेण्यास माझी कोणतीही हरकत राहणार नाही. अशा वेळी माझा व माझे इस्टेट वारसदाराचा सदर ठेवींवर कोणताही हक्क राहणार नाही. त्यास अनुसरून मी हे अधिकारपत्र आपणास देत आहे. सदर कर्जाच्या संपूर्ण रकमेची परतफेड होईपावतो सदरचे अधिकारपत्र रद्द करण्याचा अथवा अधिकार इतरत्र हस्तांतरित करण्याचा मला कोणताही अधिकार राहणार नाही." +
    '<div style="text-align:right;margin-top:6px">' +
    sigLine(nm, "कर्जदाराची सही") +
    "</div>" +
    "</div>";

  // Office report
  var officeRpt =
    '<div style="border-top:1.5px solid #000;padding:6px 14px">' +
    "<div style=\"text-align:center;font-weight:700;font-size:10pt;padding-bottom:4px;font-family:'Noto Serif Devanagari','Kokila','Mangal',serif\">** कार्यालयीन अहवाल **</div>" +
    '<div class="bp" style="padding-top:4px">' +
    "श्री / श्रीमती <strong>" +
    nm +
    "</strong> संस्थेकडे त्यांच्या मुदती ठेव पावती क्र. <strong>" +
    fdPv +
    "</strong> ठेव रु. <strong>" +
    fdAmt +
    "</strong> चे तारणावर रु. <strong>" +
    lnAmt +
    "/-</strong> मागणी केले आहे. पावतीचे विक्रय मूल्याचे रु. ______________ रक्कमेच्या ______% प्रमाणे रु.<strong>" +
    lnAmt +
    "/-</strong> करिता ______% व्याजदराने मंजुरीसाठी शिफारस करण्यात येत आहे. मंजूर कर्ज रक्कम - रु. <strong>" +
    lnAmt +
    "/-</strong>" +
    "</div>" +
    '<div style="text-align:right;padding:8px 20px 8px">' +
    '<div style="border-bottom:1px solid #000;height:18px;min-width:70mm;margin-bottom:4px;margin-left:auto"></div>' +
    '<div style="font-size:9pt">अध्यक्ष / कार्यकारी संचालक / अधिकारी</div>' +
    "</div>" +
    "</div>";

  // Compact photo grid sized to stay on page 1
  function odPhotoGrid(photos) {
    var valid = (photos || []).filter(function (p) {
      return p && p.src;
    });
    if (!valid.length) return "";
    var items = valid
      .map(function (p) {
        var isCust = p.label === "Customer Photo";
        var isFd = p.label === "FD Photo";
        var w = isFd ? "58mm" : isCust ? "32mm" : "46mm";
        var h = isFd ? "70mm" : isCust ? "40mm" : "54mm";
        return (
          '<div style="text-align:center;flex:0 0 auto">' +
          '<img src="' +
          p.src +
          '" style="width:' +
          w +
          ";height:" +
          h +
          ';object-fit:cover;border:1px solid #888;border-radius:3px;display:block">' +
          '<div style="font-size:7pt;color:#444;margin-top:2px">' +
          p.label +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    return (
      '<div style="border-top:1.5px solid #000;padding:3px 12px 4px">' +
      '<div style="font-size:8.5pt;font-weight:700;margin-bottom:3px">📷 Documents / Photos</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px">' +
      items +
      "</div>" +
      "</div>"
    );
  }

  return (
    '<div class="page">' +
    orgHdr +
    ftitle +
    hdrLine +
    itbl +
    ghoshna +
    '<hr class="hrdash">' +
    vach +
    '<hr class="hrdash">' +
    adhikar +
    '<hr class="hrdash">' +
    officeRpt +
    odPhotoGrid(docPhotos || []) +
    declLine() +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  FD-OD LOAN CLOSING FORM  (OD Loan बंद करण्याबाबत अर्ज)
//  Mirrors loanClosing_FormPage / fdClosing_FormPage style
// ═══════════════════════════════════════════════════════
function odClosing_FormPage(
  nm,
  addr,
  dtFmt,
  mob,
  aadh,
  cid,
  savAcc,
  shrAcc,
  fdAcc,
  fdPv,
  lnAcc,
  pan,
  nom,
  nomRel,
  lnAmt,
  lnWrd,
  fdAmt,
  fdWrd,
  fdMat,
  comments,
  docPhotos,
) {
  var orgHdr =
    '<div class="ohdr"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  var ftitle = '<div class="ftitle">-- OD Loan बंद करण्याबाबत अर्ज --</div>';

  // Intro paragraph
  var intro =
    '<div class="bp">' +
    "प्रति, शाखा व्यवस्थापक साहेब, &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; अर्ज दि. : <strong>" +
    dtFmt +
    "</strong><br><br>" +
    "महोदय, मी <strong>" +
    nm +
    "</strong> आपणास विनंती करतो की, आपल्या संस्थेमध्ये माझ्या मुदत ठेव पावतीच्या तारणावर घेतलेले OD कर्ज (खाते क्र. <strong>" +
    lnAcc +
    "</strong>) मी आज दि. <strong>" +
    dtFmt +
    "</strong> रोजी संपूर्ण व्याजासह परतफेड केले आहे. सदर कर्ज बंद करण्यात यावे व माझी मुदत ठेव पावती क्र. <strong>" +
    fdPv +
    "</strong> मला परत मिळावी, ही नम्र विनंती. संस्थेचे सर्व नियम व अटी मला मान्य असून, भविष्यात कोणतीही तक्रार / दावा राहणार नाही." +
    "</div>";

  // 4-col info table
  var itbl =
    '<table class="it"><colgroup>' +
    '<col style="width:14%"><col style="width:36%"><col style="width:16%"><col style="width:34%">' +
    "</colgroup>" +
    '<tr><td class="lbl">पूर्ण नाव</td><td class="val vbig">' +
    nm +
    '</td><td class="lbl">कर्ज खाते क्र.</td><td class="val vbig">' +
    lnAcc +
    "</td></tr>" +
    '<tr><td class="lbl">पत्ता</td><td class="val">' +
    addr +
    '</td><td class="lbl">बचत खाते क्र.</td><td class="val vbig">' +
    savAcc +
    "</td></tr>" +
    '<tr><td class="lbl">मो.न.</td><td class="val">' +
    mob +
    '</td><td class="lbl">सभासद क्र.</td><td class="val">' +
    cid +
    "</td></tr>" +
    '<tr><td class="lbl">आधार कार्ड</td><td class="val">' +
    aadh +
    '</td><td class="lbl">ठेव खाते क्र.</td><td class="val vbig">' +
    fdAcc +
    "</td></tr>" +
    '<tr><td class="lbl">पॅन कार्ड</td><td class="val">' +
    pan +
    '</td><td class="lbl">पावती क्र.</td><td class="val vbig">' +
    fdPv +
    "</td></tr>" +
    '<tr><td class="lbl">ठेवीची रक्कम</td><td class="val">रू. <strong>' +
    fdAmt +
    '</strong> /- &nbsp;<span style="font-size:9pt;font-weight:500">( ' +
    fdWrd +
    " )</span></td>" +
    '<td class="lbl">OD कर्ज रक्कम</td><td class="val">रू. <strong>' +
    lnAmt +
    '</strong> /- &nbsp;<span style="font-size:9pt;font-weight:500">( ' +
    lnWrd +
    " )</span></td></tr>" +
    '<tr><td class="lbl">ठेव मुदत दि.</td><td class="val"><strong>' +
    (fdMat || "—") +
    "</strong></td>" +
    '<td class="lbl">शेअर खाते क्र.</td><td class="val vbig">' +
    (shrAcc || "—") +
    "</td></tr>" +
    '<tr><td class="lbl">वारसदाराचे नाव</td><td class="val"><strong>' +
    (nom || "—") +
    "</strong></td>" +
    '<td class="lbl">वारसदाराचे नाते</td><td class="val"><strong>' +
    (nomRel || "—") +
    "</strong></td></tr>" +
    (comments && comments !== "—"
      ? '<tr><td class="lbl">शेरा / Notes</td><td class="val" colspan="3">' +
        comments +
        "</td></tr>"
      : "") +
    "</table>";

  // Settlement statement
  var stmt =
    '<div class="bp" style="font-size:9pt">' +
    "* <strong>कर्ज परतफेड तपशील:</strong> वरील नमूद OD कर्ज खाते क्र. <strong>" +
    lnAcc +
    "</strong> वर दि. <strong>" +
    dtFmt +
    "</strong> रोजी देय मुद्दल रक्कम रू. <strong>" +
    lnAmt +
    " /-</strong> ( अक्षरी रू. " +
    lnWrd +
    " ) व त्यावरील व्याज रक्कम रू. .......................... /- (अक्षरी रू. ...............................................) मिळून एकूण रक्कम रू. ............................... /- ( अक्षरी रू. ....................................................फक्त ) माझ्या बचत खाते क्र. <strong>" +
    savAcc +
    "</strong> मधून / रोख स्वरूपात भरण केली असून कर्ज खाते पूर्णपणे बंद करण्यात यावे." +
    "</div>";

  // TDS / NPA declaration
  var decl =
    '<div class="bp yl" style="font-size:9pt">' +
    "मी, खाली सही करणार/करणारी, <strong>" +
    nm +
    "</strong>, सभासद क्र. <strong>" +
    cid +
    "</strong>, घोषणा करतो/करते की, संस्थेकडून घेतलेले OD कर्ज व त्यावरील सर्व व्याज आज अदा केले असून यापुढे कोणतीही थकबाकी नाही. सदर मुदत ठेव पावती क्र. <strong>" +
    fdPv +
    "</strong> कर्जमुक्त असल्याचे प्रमाणित करावे व पावती मला परत मिळावी. भविष्यात कोणत्याही आयकर / शासकीय चौकशीची सर्व जबाबदारी माझी राहील." +
    "</div>";

  // Signature block
  var sigBlock =
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:10px 20px 12px;border-top:1px solid #ccc">' +
    '<div style="font-size:9pt">दि. : <strong>' +
    dtFmt +
    "</strong></div>" +
    "<div>" +
    sigLine(nm, "अर्जदाराची सही") +
    "</div>" +
    "</div>";

  // Office use section
  var officeUse =
    '<div style="border-top:1.5px dashed #000;padding:6px 14px 4px">' +
    '<div style="font-size:9pt;font-weight:700;color:#1a3a5c;margin-bottom:4px">** कार्यालयीन नोंद (Office Use Only) **</div>' +
    '<table class="it"><colgroup><col style="width:25%"><col style="width:25%"><col style="width:25%"><col style="width:25%"></colgroup>' +
    '<tr><td class="lbl">OD कर्ज परतफेड दि.</td><td class="val">' +
    dtFmt +
    "</td>" +
    '<td class="lbl">परतफेड रक्कम (रू.)</td><td class="val">रू. ............................... /-</td></tr>' +
    '<tr><td class="lbl">व्याज रक्कम (रू.)</td><td class="val">रू. ............................... /-</td>' +
    '<td class="lbl">एकूण वसुली (रू.)</td><td class="val">रू. ............................... /-</td></tr>' +
    "</table>" +
    '<div style="display:flex;justify-content:space-between;padding:8px 0 4px">' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div><div style="font-size:9pt">लिपीक</div></div>' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div><div style="font-size:9pt">शाखा व्यवस्थापक / अधिकारी</div></div>' +
    "</div>" +
    '<div class="bp" style="font-size:8pt;border-top:1px solid #eee">फॉर्म सोबत घ्यावयाची कागदपत्रे :- १) मुदत ठेव पावतीची मूळ प्रत &nbsp; २) OD कर्ज पासबुक &nbsp; ३) आधार कार्ड झेरॉक्स.</div>' +
    "</div>";

  return (
    '<div class="page">' +
    orgHdr +
    ftitle +
    intro +
    itbl +
    stmt +
    decl +
    sigBlock +
    officeUse +
    // Shrunk from the shared photoGrid() default (65mm x 85mm) on this
    // closing form specifically, per user request.
    photoGrid(docPhotos || [], "50mm", "65mm") +
    declLine() +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  LOAN CLOSING FORM  (सोने/चांदी तारण कर्ज बंद)
//  Photo: ornament only (no doc photos)
// ═══════════════════════════════════════════════════════
function loanClosing_FormPage(
  nm,
  addr,
  dtFmt,
  mob,
  aadh,
  cid,
  savAcc,
  shrAcc,
  lnAcc,
  pan,
  nom,
  nomRel,
  lnAmt,
  lnWrd,
  goldOrn,
  silvOrn,
  ornWt,
  comments,
  photoOrn,
  ornItems,
) {
  var orgHdr =
    '<div class="ohdr" style="padding:4px 10px 3px"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  var ftitle =
    '<div class="ftitle" style="padding:3px 8px">-- सोने / चांदी तारण कर्ज बंद करण्याबाबत अर्ज / डिलिव्हरी ऑर्डर --</div>';

  // Compact intro paragraph
  var intro =
    '<div style="padding:4px 12px;font-size:8pt;line-height:1.55;color:#000;font-weight:600;text-align:justify">' +
    "प्रति, शाखा व्यवस्थापक साहेब, &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; अर्ज दि. : <strong>" +
    dtFmt +
    "</strong><br>" +
    "मी <strong>" +
    nm +
    "</strong>, सोने/चांदी तारण कर्जाची संपूर्ण थकबाकी अदा करून कर्ज परतफेड केली आहे. तारण दागिन्यांचा ताबा मला परत मिळाला असून ते पूर्णतः योग्य स्थितीत असल्याची खात्री केली आहे. भविष्यात कोणताही दावा/तक्रार राहणार नाही." +
    "</div>";

  // Compact 8-row info table — reduce padding
  var itbl =
    '<table class="it" style="margin:0;font-size:8.5pt"><colgroup>' +
    '<col style="width:14%"><col style="width:36%"><col style="width:14%"><col style="width:36%">' +
    "</colgroup>" +
    '<tr><td class="lbl" style="padding:3px 6px">पूर्ण नाव</td><td class="val vbig" style="padding:3px 6px">' +
    nm +
    '</td><td class="lbl" style="padding:3px 6px">कर्ज खाते क्र.</td><td class="val vbig" style="padding:3px 6px">' +
    lnAcc +
    "</td></tr>" +
    '<tr><td class="lbl" style="padding:3px 6px">पत्ता</td><td class="val" style="padding:3px 6px">' +
    addr +
    '</td><td class="lbl" style="padding:3px 6px">बचत खाते क्र.</td><td class="val vbig" style="padding:3px 6px">' +
    savAcc +
    "</td></tr>" +
    '<tr><td class="lbl" style="padding:3px 6px">कर्ज समाप्ती दि.</td><td class="val vbig" style="padding:3px 6px">' +
    dtFmt +
    '</td><td class="lbl" style="padding:3px 6px">सभासद क्र.</td><td class="val" style="padding:3px 6px">' +
    cid +
    "</td></tr>" +
    '<tr><td class="lbl" style="padding:3px 6px">आधार कार्ड</td><td class="val" style="padding:3px 6px">' +
    aadh +
    '</td><td class="lbl" style="padding:3px 6px">शेअर खाते क्र.</td><td class="val" style="padding:3px 6px">' +
    shrAcc +
    "</td></tr>" +
    '<tr><td class="lbl" style="padding:3px 6px">कर्ज रक्कम</td><td class="val" style="padding:3px 6px">' +
    lnWrd +
    '</td><td class="lbl" style="padding:3px 6px">कर्ज रक्कम (रू.)</td><td class="val vbig" style="padding:3px 6px">' +
    lnAmt +
    " /-</td></tr>" +
    '<tr><td class="lbl" style="padding:3px 6px">पॅन कार्ड</td><td class="val" style="padding:3px 6px">' +
    pan +
    '</td><td class="lbl" style="padding:3px 6px">मो.न.</td><td class="val" style="padding:3px 6px">' +
    mob +
    "</td></tr>" +
    "</table>";

  // Compact receipt
  var receipt =
    '<div style="border-top:1.5px dashed #000;padding:4px 12px 5px">' +
    '<div style="font-size:8pt;line-height:1.5;color:#000;font-weight:600">' +
    "मी <strong>" +
    nm +
    "</strong> पावती लिहून देतो की, सोन्याचे दागिने गहाण ठेवले व ते मला/आम्हाला परत मिळाले. सिल माझ्यासमोर उघडले. कोणतीही तक्रार नाही." +
    "</div>" +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:6px 6px 2px">' +
    '<div style="text-align:center"><div style="border-bottom:1.5px solid #000;height:16px;min-width:55mm;margin-bottom:3px"></div><div style="font-size:8.5pt;font-weight:800;color:#000">प्राधिकृत अधिकारी</div></div>' +
    '<div style="text-align:center"><div style="border-bottom:1.5px solid #000;height:16px;min-width:55mm;margin-bottom:3px"></div><div style="font-size:8.5pt;font-weight:800;color:#000">कर्जदाराची सही — ' +
    nm +
    "</div></div>" +
    "</div>" +
    "</div>";

  // Build compact ornament rows
  var clOrnRows = "";
  var clTotalQty = 0,
    clTotalWt = 0;
  if (ornItems && ornItems.length) {
    ornItems.forEach(function (item, i) {
      var q = parseInt(item.qty) || 0;
      var w =
        item.weight !== null && item.weight !== undefined
          ? parseFloat(item.weight)
          : null;
      clTotalQty += q;
      if (w !== null && !isNaN(w)) clTotalWt += w;
      clOrnRows +=
        "<tr>" +
        '<td style="border:1px solid #000;padding:2px 5px;text-align:center;font-size:8pt;color:#000;font-weight:700">' +
        (i + 1) +
        "</td>" +
        '<td style="border:1px solid #000;padding:2px 5px;font-size:8pt;color:#000;font-weight:700">' +
        item.name +
        "</td>" +
        '<td style="border:1px solid #000;padding:2px 5px;text-align:center;font-size:8pt;color:#000;font-weight:700">' +
        (q || "—") +
        "</td>" +
        '<td style="border:1px solid #000;padding:2px 5px;text-align:center;font-size:8pt;color:#000;font-weight:700">' +
        (w !== null && !isNaN(w) ? w + " gm" : "—") +
        "</td>" +
        "</tr>";
    });
  } else {
    var clOrnList = [];
    if (goldOrn)
      goldOrn.split(",").forEach(function (s) {
        s = s.trim();
        if (s) clOrnList.push(s);
      });
    if (silvOrn)
      silvOrn.split(",").forEach(function (s) {
        s = s.trim();
        if (s) clOrnList.push(s);
      });
    if (!clOrnList.length && ornWt) clOrnList.push("सोने/चांदी दागिने");
    clTotalWt = parseFloat(ornWt) || 0;
    clOrnList.forEach(function (name, i) {
      clOrnRows +=
        "<tr>" +
        '<td style="border:1px solid #000;padding:2px 5px;text-align:center;font-size:8pt;color:#000;font-weight:700">' +
        (i + 1) +
        "</td>" +
        '<td style="border:1px solid #000;padding:2px 5px;font-size:8pt;color:#000;font-weight:700">' +
        name +
        "</td>" +
        '<td style="border:1px solid #000;padding:2px 5px;text-align:center;font-size:8pt;color:#000;font-weight:700">—</td>' +
        '<td style="border:1px solid #000;padding:2px 5px;text-align:center;font-size:8pt;color:#000;font-weight:700">' +
        (i === 0 && ornWt ? ornWt + " gm" : "—") +
        "</td>" +
        "</tr>";
    });
  }

  var clOrnTable =
    '<table style="width:100%;border-collapse:collapse;font-size:8pt">' +
    '<tr style="background:#000;color:#fff">' +
    '<th style="border:1px solid #000;padding:2px 5px;text-align:center;width:8%">#</th>' +
    '<th style="border:1px solid #000;padding:2px 5px;text-align:left">दागिन्याचे नाव / Ornament Name</th>' +
    '<th style="border:1px solid #000;padding:2px 5px;text-align:center;width:18%">नग / Qty</th>' +
    '<th style="border:1px solid #000;padding:2px 5px;text-align:center;width:22%">वजन / Weight</th>' +
    "</tr>" +
    (clOrnRows ||
      '<tr><td colspan="4" style="border:1px solid #000;padding:4px;text-align:center;color:#000;font-size:8pt">—</td></tr>') +
    '<tr style="background:#e0e0e0;font-weight:900;color:#000">' +
    '<td colspan="2" style="border:1px solid #000;padding:2px 5px;font-size:8pt;text-align:right">एकूण / Total</td>' +
    '<td style="border:1px solid #000;padding:2px 5px;text-align:center">' +
    (clTotalQty || "—") +
    "</td>" +
    '<td style="border:1px solid #000;padding:2px 5px;text-align:center">' +
    (clTotalWt ? clTotalWt + " gm" : ornWt ? ornWt + " gm" : "—") +
    "</td>" +
    "</tr>" +
    "</table>";

  // Photo + ornament table side-by-side, compact heights
  var photoSection =
    '<div style="border-top:1.5px solid #000;padding:4px 12px 4px">' +
    '<div style="font-size:8pt;font-weight:800;color:#000;margin-bottom:3px">📷 दागिन्यांचा फोटो व तपशील / Ornament Photo & Details</div>' +
    '<div style="display:flex;gap:8px;align-items:flex-start">' +
    '<div style="flex:0 0 52%;width:52%;border:1.5px solid #000;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f0f0f0;min-height:55mm;max-height:65mm">' +
    (photoOrn
      ? '<img src="' +
        photoOrn +
        '" style="width:100%;max-height:65mm;object-fit:contain">'
      : '<div style="text-align:center;color:#888;font-size:8pt;padding:8px"><div style="font-size:18pt;margin-bottom:2px">📷</div><div>Ornament Photo</div></div>') +
    "</div>" +
    '<div style="flex:1;min-width:0">' +
    clOrnTable +
    "</div>" +
    "</div>" +
    "</div>";

  // ── Single Loan Closing Slip (blank amount, same structure as saving deposit slip) ──
  var loanSlip =
    '<div style="border-top:1.5px dashed #000;padding:2px 10px 2px">' +
    '<div style="border:1px solid #333;padding:3px 8px;page-break-inside:avoid">' +
    '<div style="font-size:6.5pt;font-weight:700;color:#8B1A1A;text-align:right;margin-bottom:1px">— बँक प्रत —</div>' +
    // Top header: title left | acc+scroll right
    '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #1a1a6e;padding-bottom:2px;margin-bottom:3px">' +
    "<div>" +
    '<div style="font-size:8.5pt;font-weight:900;color:#1a1a6e">तारण कर्ज खाते जमा / कर्ज बंद पावती</div>' +
    '<div style="font-size:7pt;color:#555;margin-top:0">🏦 जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव (जा.)</div>' +
    "</div>" +
    '<div style="text-align:right">' +
    '<table style="border-collapse:collapse;font-size:7.5pt">' +
    '<tr><td style="padding:2px 6px;border:1px solid #333;font-weight:700;white-space:nowrap">कर्ज खाते क्र.&nbsp;<span style="font-weight:400;font-size:8pt">' +
    lnAcc +
    "</span></td></tr>" +
    '<tr><td style="padding:2px 6px;border:1px solid #333;font-weight:700">स्क्रोल क्र.</td></tr>' +
    '<tr><td style="padding:4px 6px;border:1px solid #333">&nbsp;</td></tr>' +
    "</table>" +
    "</div>" +
    "</div>" +
    // Body: denom table left | counterfoil right
    '<div style="display:flex;align-items:flex-start;gap:0">' +
    // Denomination table (left)
    '<div style="min-width:52mm">' +
    _jjuDenomTable("#d4edda", "") +
    "</div>" +
    // Counterfoil (right)
    '<div style="padding-left:8px;flex:1;font-size:8.5pt">' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">' +
    '<span style="font-weight:700;white-space:nowrap">दिनांक :</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;min-width:36mm;display:inline-block;padding-bottom:1px">&nbsp;' +
    dtFmt +
    "</span>" +
    "</div>" +
    '<div style="margin-bottom:2px;font-weight:700">खात्यात जमा केले / नाव :</div>' +
    '<div style="border-bottom:1px solid #000;margin-bottom:1px;padding-bottom:2px;font-weight:800;font-size:9.5pt">&nbsp;' +
    nm +
    "</div>" +
    '<div style="font-size:7pt;color:#555;margin-bottom:5px">खातेदाराचे संपूर्ण नांव</div>' +
    '<div style="display:flex;align-items:baseline;gap:4px;margin-bottom:6px">' +
    '<span style="border-bottom:1px solid #000;flex:1;min-width:40mm;display:inline-block;font-family:monospace;font-weight:700">&nbsp;</span>' +
    '<span style="white-space:nowrap;font-size:8pt">च्या कर्ज खात्यामध्ये जमा केले.</span>' +
    "</div>" +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">' +
    '<div style="border:1px solid #333;padding:4px 8px;font-size:10.5pt;font-weight:900;min-width:38mm">रू. &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; /-</div>' +
    "</div>" +
    '<div style="font-size:7.5pt;color:#555;margin-bottom:1px">अक्षरी रुपये :</div>' +
    '<div style="border-bottom:1px solid #000;margin-bottom:4px;min-width:76mm;font-style:italic">&nbsp;</div>' +
    '<div style="margin-bottom:3px"></div>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:4px;padding-top:3px">' +
    '<div style="text-align:center"><div style="font-size:7.5pt;color:#333;border-top:1.5px solid #000;padding-top:3px;margin-top:8mm;min-width:55mm;text-align:center">रोखपाल/खातेपाल &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; व्यवस्थापक/अधिकारी</div></div>' +
    '<div style="text-align:center"><div style="font-size:8pt;font-weight:600;color:#333;border-top:1.5px solid #000;padding-top:3px;margin-top:8mm;min-width:46mm;text-align:center">' +
    nm +
    " / पैसे भरणाऱ्याची सही</div></div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>";

  var html =
    '<div class="page" style="padding-left:6mm;min-height:unset;height:auto;overflow:hidden;page-break-after:avoid;break-after:avoid">' +
    orgHdr +
    ftitle +
    intro +
    itbl +
    receipt +
    photoSection +
    loanSlip +
    declLine() +
    "</div>";

  return html;
}

// ═══════════════════════════════════════════════════════
//  FD CLOSING FORM  (मुदत ठेव रक्कम परत मिळण्याबाबत अर्ज)
// ═══════════════════════════════════════════════════════
function fdClosing_FormPage(
  nm,
  addr,
  dtFmt,
  mob,
  aadh,
  cid,
  savAcc,
  shrAcc,
  fdAcc,
  fdPv,
  pan,
  nom,
  nomRel,
  fdAmt,
  fdWrd,
  fdPrd,
  fdMat,
  fdMatAmt,
  fdMatWrd,
  comments,
  docPhotos,
) {
  var orgHdr =
    '<div class="ohdr"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  var ftitle =
    '<div class="ftitle">-- मुदत ठेव रक्कम परत मिळण्याबाबत अर्ज --</div>';

  var intro =
    '<div class="bp">' +
    "प्रति, शाखा व्यवस्थापक साहेब, &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; अर्ज दि. : <strong>" +
    dtFmt +
    "</strong><br><br>" +
    "महोदय, मी <strong>" +
    nm +
    "</strong> आपणास विनंती करतो की, आपल्या संस्थेत माझ्या नावावर असलेली मुदत ठेव परत मिळावी. खालील खात्याचा तपशील देण्यात येत आहे. ठेव पूर्णत्वास आली असून, व्याजासह ठेव रक्कम माझ्या खात्यात जमा करावी / रोख स्वरूपात मिळावी, ही नम्र विनंती. मात्र, जर सदर ठेव मुदतपूर्व (Premature) परत मागितली गेली, तर संस्थेच्या नियमांनुसार व्याज रक्कमेत तदनुसार कपात करण्यात येईल व ते मला मान्य राहील. मी माझी ठेव खाते पावती संस्थेकडे सुपूर्त करत आहे. संस्थेचे सर्व नियम व अटी मला मान्य असून, पुढील कोणतीही शिल्लक नसल्याचे मला समजते." +
    "</div>";

  var itbl =
    '<table class="it"><colgroup>' +
    '<col style="width:14%"><col style="width:36%"><col style="width:16%"><col style="width:34%">' +
    "</colgroup>" +
    '<tr><td class="lbl">पूर्ण नाव</td><td class="val vbig">' +
    nm +
    '</td><td class="lbl">शेअर खाते क्र.</td><td class="val vbig">' +
    shrAcc +
    "</td></tr>" +
    '<tr><td class="lbl">पत्ता</td><td class="val">' +
    addr +
    '</td><td class="lbl">बचत खाते क्र.</td><td class="val vbig">' +
    savAcc +
    "</td></tr>" +
    '<tr><td class="lbl">मो.न.</td><td class="val">' +
    mob +
    '</td><td class="lbl">सभासद क्र.</td><td class="val">' +
    cid +
    "</td></tr>" +
    '<tr><td class="lbl">पॅन कार्ड</td><td class="val">' +
    pan +
    '</td><td class="lbl">ठेव खाते क्र.</td><td class="val vbig">' +
    fdAcc +
    "</td></tr>" +
    '<tr><td class="lbl">आधार कार्ड</td><td class="val">' +
    aadh +
    '</td><td class="lbl">ठेवीची मुदत</td><td class="val"><strong>' +
    fdPrd +
    " महिने</strong></td></tr>" +
    '<tr><td class="lbl">ठेवीची रक्कम</td><td class="val vbig">रू. ' +
    fdAmt +
    '</td><td class="lbl">ठेवीची मुदत दि.</td><td class="val"><strong>' +
    fdMat +
    "</strong></td></tr>" +
    '<tr><td class="lbl">ठेवीची रक्कम अक्षरी</td><td class="val">' +
    fdWrd +
    '</td><td class="lbl">मुदत ठेव पावती क्र.</td><td class="val vbig">' +
    fdPv +
    "</td></tr>" +
    '<tr><td class="lbl">वारसदाराचे नाव</td><td class="val"><strong>' +
    nom +
    '</strong></td><td class="lbl">वारसदाराचे नाते</td><td class="val"><strong>' +
    nomRel +
    "</strong></td></tr>" +
    "</table>";

  // Payment mode checkboxes
  var payMode =
    '<div class="bp" style="font-size:9pt">' +
    "* <strong>रक्कम मिळविण्याची पद्धत:</strong> &nbsp;" +
    "☐ रोख &nbsp;&nbsp; ☐ बचत खात्यात जमा (खाते क्र. <strong>" +
    savAcc +
    "</strong>) &nbsp;&nbsp; ☐ RTGS / UPI" +
    "</div>";

  // TDS declaration
  var tdsDecl =
    '<div class="bp" style="font-size:9pt;background:#fffbee;border-top:1px solid #e5d98a">' +
    "मी, खाली स्वाक्षरी करणारा/करणारी, <strong>" +
    nm +
    "</strong>, सभासद क्र. <strong>" +
    cid +
    "</strong>, आपल्या संस्थेत माझ्या नावे असलेल्या मुदत ठेव खात्यावर मिळणाऱ्या व्याज रकमेवर कायद्यानुसार कर (TDS) वजावट होऊ शकते, याची पूर्ण जाणीव आहे. तरी मी संस्थेला विनंती करतो की, सदर व्याज रकमेवर TDS वजावट करू नये आणि संपूर्ण व्याज रक्कम माझ्या <strong>" +
    savAcc +
    "</strong> या बचत खात्यात जमा करावी. माझ्या या निवेदनानुसार भविष्यात उत्पन्न कर विभागाकडून याबाबत चौकशी झाल्यास त्याची सर्व जबाबदारी माझी राहील." +
    "</div>";

  // Final amount statement (blank fill-in lines)
  var finalStmt =
    '<div class="bp" style="font-size:9pt">' +
    "* <strong>व्याज व अंतिम रक्कम प्राप्ती बाबत निवेदन:</strong> वरील नमूद केल्याप्रमाणे, माझ्या मुदत ठेव खात्यावर दि. <strong>" +
    dtFmt +
    "</strong> रोजी देय व्याज रक्कम रू. .......................... /- (अक्षरी रू. ....................... ......................................) इतकी असून, ती रक्कम मला संस्थेच्या नियमाप्रमाणे मान्य आहे. मला संस्थेकडून पूर्ण रक्कम रू. ............................... /- (अक्षरी रू. ....................... ..............................................फक्त) इतकी प्राप्त झाली असून संस्थेचे नियम मला मान्य आहेत. माझी संस्थेकडे कोणतीही तक्रार नाही." +
    "</div>";

  // Date + signature
  var sigBlock =
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:8px 20px 10px;border-top:1px solid #ccc">' +
    '<div style="font-size:9pt">दि. : <strong>' +
    dtFmt +
    "</strong></div>" +
    "<div>" +
    sigLine(nm, "अर्जदाराची सही") +
    "</div>" +
    "</div>";

  // Renewal info (blank)
  var renewal =
    '<div style="border-top:1.5px dashed #aaa;padding:6px 14px 4px">' +
    '<div style="font-size:9pt;font-weight:700;margin-bottom:4px">** सर्व माहीती माझ्या समक्ष लिहीली व सह्या केल्या आहेत. संस्थेने व्याजासह पूर्ण मुदत ठेव देय रक्कम खातेदाराच्या <strong>' +
    savAcc +
    "</strong> या बचत खात्यात जमा केली आहे.</div>" +
    '<div style="font-size:9pt;font-weight:700;color:#333;margin:6px 0 3px">नवीन मुदत ठेव (Renewal FD) ची माहिती (जर लागू असेल):</div>' +
    '<table class="it"><colgroup><col style="width:25%"><col style="width:25%"><col style="width:25%"><col style="width:25%"></colgroup>' +
    '<tr><td class="lbl">ठेवीची रक्कम</td><td class="val">रू. ........................... /-</td><td class="lbl">ठेव सुरु होण्याची दिनांक</td><td class="val">' +
    dtFmt +
    "</td></tr>" +
    '<tr><td class="lbl">नवीन ठेव खाते क्र.</td><td class="val"></td><td class="lbl">नवीन ठेव पावती क्र.</td><td class="val"></td></tr>' +
    "</table>" +
    "</div>";

  var footer =
    '<div style="display:flex;justify-content:space-between;padding:8px 20px 8px;border-top:1px solid #000">' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div><div style="font-size:9pt">लिपीक</div></div>' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div><div style="font-size:9pt">शाखा व्यवस्थापक/अधिकारी</div></div>' +
    "</div>" +
    '<div class="bp" style="font-size:8pt;border-top:1px solid #eee">फॉर्म सोबत घ्यावयाची कागदपत्रे :- १) ठेव पावतीची मूळ प्रत.</div>';

  return (
    '<div class="page">' +
    orgHdr +
    ftitle +
    intro +
    itbl +
    payMode +
    tdsDecl +
    finalStmt +
    sigBlock +
    renewal +
    footer +
    photoGrid(docPhotos || []) +
    declLine() +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  FD CLOSING SLIPS  (3 slips: FD-DB-TRF + SAV-CR-TRF + FD INT)
// ═══════════════════════════════════════════════════════
function fdClosingSlips_Page(
  nm,
  dtFmt,
  savAcc,
  fdAcc,
  fdMatAmt,
  fdMatWrd,
  fdAmt,
  fdWrd,
) {
  function orgHdr() {
    return '<div class="sohdr"><div class="sohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  }

  function scrollTbl2(c2l, c2v, c3l, c3v, dc) {
    return (
      '<table class="sst"><tr>' +
      '<th style="width:14%">Scroll No</th><th style="width:22%">' +
      c2l +
      "</th>" +
      '<th style="width:22%">' +
      c3l +
      '</th><th style="width:29%">तारीख</th>' +
      '<th style="width:13%">' +
      dc +
      "</th>" +
      "</tr><tr>" +
      "<td></td><td><strong>" +
      c2v +
      "</strong></td><td><strong>" +
      c3v +
      "</strong></td>" +
      "<td><strong>" +
      dtFmt +
      "</strong></td><td></td>" +
      "</tr></table>"
    );
  }

  // Slip 1: FD-DB-TRF — Debit from FD account → Saving
  var slip1 =
    '<div class="sblock">' +
    orgHdr() +
    '<div class="stbar"><span>** मुदत ठेव — पैसे काढण्याचा फॉर्म **</span><span class="scode">FD - DB - TRF &nbsp; Debit</span></div>' +
    scrollTbl2("मुदत ठेव खाते क्र.", fdAcc, "बचत खाते क्र.", savAcc, "Debit") +
    '<table class="sct compact-slip">' +
    '<tr><th class="sl" style="background:#f0f4ff;width:38%">खातेदाराचे नाव</th><td class="sv" style="font-size:11pt;font-weight:800" colspan="3">' +
    nm +
    "</td></tr>" +
    '<tr><th class="sl" style="background:#f0f4ff">FD रक्कम</th><td class="sv"><strong>रू. ' +
    fdAmt +
    ' /-</strong></td><th class="sl" style="background:#f0f4ff;width:22%">अक्षरी</th><td class="sv">' +
    fdWrd +
    "</td></tr>" +
    '<tr><th class="sl" style="background:#f0f4ff;font-size:8.5pt">Transfer</th><td class="sv" colspan="3" style="font-size:8.5pt;color:#555">FD Account → Saving Account</td></tr>' +
    "</table>" +
    '<div class="sftr">' +
    '<div class="si"><span class="si-name">लेखापाल / व्यवस्थापक</span></div>' +
    '<div class="si"><span class="si-name">' +
    nm +
    " — खातेदाराची सही</span></div>" +
    "</div>" +
    "</div>";

  // Slip 2: SAV-CR-TRF — Credit maturity amount to Saving (बचत ठेव underlined)
  var slip2 =
    '<div class="sblock">' +
    orgHdr() +
    '<div class="stbar"><span>मुदत ठेव / <u>बचत ठेव</u> जमा फॉर्म</span><span class="scode">SAV - CR - TRF &nbsp; Credit</span></div>' +
    scrollTbl2("मुदत ठेव खाते क्र.", fdAcc, "बचत खाते क्र.", savAcc, "Credit") +
    '<table class="sct compact-slip">' +
    '<tr><th class="sl" style="background:#f0fff4;width:38%">खातेदाराचे नाव</th><td class="sv" style="font-size:11pt;font-weight:800" colspan="3">' +
    nm +
    "</td></tr>" +
    '<tr><th class="sl" style="background:#f0fff4">FD Maturity रक्कम</th><td class="sv"><strong>रू. .................. /-</strong></td><th class="sl" style="background:#f0fff4;width:22%">अक्षरी</th><td class="sv">रू. .......................................</td></tr>' +
    "</table>" +
    '<div class="sftr">' +
    '<div class="si"><span class="si-name">लेखापाल / व्यवस्थापक</span></div>' +
    '<div class="si"><span class="si-name">' +
    nm +
    " — खातेदाराची सही</span></div>" +
    "</div>" +
    "</div>";

  // Slip 3: FD INT-DB-TRF — Interest paid from 163-1
  var slip3 =
    '<div class="sblock">' +
    orgHdr() +
    '<div class="stbar"><span>** FD व्याज प्रदान (163-1) **</span><span class="scode">FD INT - DB - TRF &nbsp; Debit</span></div>' +
    '<table class="sst"><tr>' +
    '<th style="width:14%">Scroll No</th><th style="width:22%">व्याज खाते क्र.</th>' +
    '<th style="width:22%">मुदत ठेव खाते क्र.</th><th style="width:29%">तारीख</th>' +
    '<th style="width:13%">Debit</th>' +
    "</tr><tr>" +
    "<td></td><td><strong>163-1</strong></td><td><strong>" +
    fdAcc +
    "</strong></td>" +
    "<td><strong>" +
    dtFmt +
    "</strong></td><td></td>" +
    "</tr></table>" +
    '<div class="sbody" style="font-size:9pt;line-height:1.5">' +
    "163-1 → बचत खाते <strong>" +
    savAcc +
    "</strong> &nbsp;|&nbsp; श्री/श्रीमती <strong>" +
    nm +
    "</strong><br>" +
    "व्याजाचे ....% प्रमाणे रु. .................. /- अक्षरी रू. ..............................." +
    "</div>" +
    '<div class="sftr">' +
    '<div class="si"><span class="si-name">लेखापाल / लिपिक</span></div>' +
    '<div class="si"><span class="si-name">व्यवस्थापक / अधिकारी</span></div>' +
    "</div>" +
    "</div>";

  // Slip 4: FD INT PROV-DB-TRF — Provisional interest from 194-1
  var slip4 =
    '<div class="sblock">' +
    orgHdr() +
    '<div class="stbar"><span>** FD तात्पुरते व्याज (194-1) **</span><span class="scode">FD INT PROV - DB - TRF &nbsp; Debit</span></div>' +
    '<table class="sst"><tr>' +
    '<th style="width:14%">Scroll No</th><th style="width:22%">खाते क्र.</th>' +
    '<th style="width:22%">बचत खाते क्र.</th><th style="width:29%">तारीख</th>' +
    '<th style="width:13%">Debit</th>' +
    "</tr><tr>" +
    "<td></td><td><strong>194-1</strong></td><td><strong>" +
    savAcc +
    "</strong></td>" +
    "<td><strong>" +
    dtFmt +
    "</strong></td><td></td>" +
    "</tr></table>" +
    '<div class="sbody" style="font-size:9pt;line-height:1.5">' +
    "194-1 → FD खाते <strong>" +
    fdAcc +
    "</strong> &nbsp;|&nbsp; श्री/श्रीमती <strong>" +
    nm +
    "</strong><br>" +
    "Provisional व्याजाचे ....% प्रमाणे रु. _____________ /- अक्षरी रू. ..." +
    "</div>" +
    '<div class="sftr">' +
    '<div class="si"><span class="si-name">लेखापाल / लिपिक</span></div>' +
    '<div class="si"><span class="si-name">व्यवस्थापक / अधिकारी</span></div>' +
    "</div>" +
    "</div>";

  return (
    '<div class="spage">' +
    slip1 +
    '<hr class="sdiv">' +
    slip2 +
    '<hr class="sdiv">' +
    slip3 +
    '<hr class="sdiv">' +
    slip4 +
    declLine() +
    "</div>" +
    '<div class="spage-blank"></div>'
  );
}

// ═══════════════════════════════════════════════════════
//  SAVING ACCOUNT CLOSING FORM  (बचत खाते बंद अर्ज)
// ═══════════════════════════════════════════════════════
function savingClosing_FormPage(
  nm,
  addr,
  dtFmt,
  mob,
  aadh,
  cid,
  savAcc,
  shrAcc,
  pan,
  comments,
  docPhotos,
) {
  var orgHdr =
    '<div class="ohdr"><div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  var ftitle = '<div class="ftitle">-- बचत खाते बंद अर्ज --</div>';

  var intro =
    '<div class="bp">' +
    "प्रति, शाखा व्यवस्थापक साहेब, &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; दि. : <strong>" +
    dtFmt +
    "</strong><br><br>" +
    "महोदय, मी/आम्ही, श्री./सौ. <strong>" +
    nm +
    "</strong>, आपल्या संस्थेत माझ्या नावाने असलेले लघु बचत/बचत खाते क्र. <strong>" +
    savAcc +
    "</strong> हे खाते बंद करण्याची विनंती करीत आहे. खाते उघडतानाचे सर्व नियम, अटी, व्याजदरातील बदल व संस्थेचे उपविधी मला/आम्हाला पूर्णपणे मान्य होते. खाते बंद करताना कोणतीही शिल्लक रक्कम राहणार नाही, याची मला खात्री आहे." +
    "</div>";

  var itbl =
    '<table class="it"><colgroup>' +
    '<col style="width:14%"><col style="width:36%"><col style="width:16%"><col style="width:34%">' +
    "</colgroup>" +
    '<tr><td class="lbl">पूर्ण नाव</td><td class="val vbig">' +
    nm +
    '</td><td class="lbl">बचत खाते क्र.</td><td class="val vbig">' +
    savAcc +
    "</td></tr>" +
    '<tr><td class="lbl">पत्ता</td><td class="val">' +
    addr +
    ' ह.मु.जळगाव जामोद तालुका</td><td class="lbl">शेअर खाते क्र.</td><td class="val">' +
    shrAcc +
    "</td></tr>" +
    '<tr><td class="lbl">मो.न.</td><td class="val">' +
    mob +
    '</td><td class="lbl">सभासद क्र.</td><td class="val">' +
    cid +
    "</td></tr>" +
    '<tr><td class="lbl">आधार कार्ड</td><td class="val">' +
    aadh +
    '</td><td class="lbl">पॅन कार्ड</td><td class="val">' +
    pan +
    "</td></tr>" +
    "</table>";

  // Declaration line + first signature
  var decl1 =
    '<div class="bp" style="font-size:9.5pt">' +
    "वर नमूद केलेली पूर्ण माहिती मी <strong>" +
    nm +
    "</strong>, वाचली असून ती बरोबर आहे." +
    "</div>" +
    '<div style="display:flex;justify-content:flex-end;padding:4px 20px 8px;border-bottom:1px dashed #aaa">' +
    "<div>" +
    sigLine(nm, "अर्जदाराची सही") +
    "</div>" +
    "</div>";

  // Closure reasons checklist
  var reasons =
    '<div class="bp" style="font-size:9pt">' +
    "<strong>बचत खाते बंद करण्याचे कारण (Reason for Closing the Account):</strong><br>" +
    "(✓ करा योग्य पर्याय)<br>" +
    "☐ आवश्यकतेनुसार निधी काढणे &nbsp;&nbsp; ☐ दुसऱ्या बँकेत खाते उघडले &nbsp;&nbsp; ☐ संस्थेशी असमाधानी<br>" +
    "☐ खाते न वापरणे (Inactivity) &nbsp;&nbsp; ☐ इतर: ________________________________________" +
    "</div>";

  // Closure instructions
  var notes =
    '<div class="bp" style="font-size:9pt;background:#fafafa;border-top:1px dashed #bbb">' +
    "<strong>खाते बंद करताना सूचना:</strong><br>" +
    "1. <strong>स्टेशनरी शुल्क वजावट:</strong> खाते बंद करताना अंतिम शिल्लक रकमेवरून ₹ ........../- इतकी रक्कम स्टेशनरी शुल्क म्हणून वजवण्यात येईल.<br>" +
    "2. <strong>पासबुक परत द्या:</strong> ☐ पासबुक मूळ प्रत परत दिली आहे. &nbsp; ☐ पासबुक हरवले/मिळाले नाही.<br>" +
    "3. <strong>शिल्लक रक्कम जमा करण्याचे माध्यम:</strong> ☐ रोख &nbsp;&nbsp; ☐ खात्यात वळवणे: Acc No: ________________________" +
    "</div>";

  // Final amount + second signature
  var finalAmt =
    '<div class="bp" style="font-size:9pt">' +
    "मी खाली सही करणारा/करणारी, माझ्या खात्यावर दिनांक <strong>" +
    dtFmt +
    "</strong> रोजी शिल्लक रक्कम <strong>₹..................../-</strong> (अक्षरी: ₹ ..... ...............................) इतकी असल्याचे मान्य करतो/करते. ही रक्कम मला संस्थेच्या नियमाप्रमाणे स्वीकार्य आहे. संस्थेने मला खात्यावरील संपूर्ण शिल्लक व व्याज रक्कम दिलेली असून, मला संस्थेकडे कोणतीही तक्रार नाही." +
    "</div>" +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:6px 20px 8px;border-top:1px solid #ccc">' +
    '<div style="font-size:9pt">दि. : <strong>' +
    dtFmt +
    "</strong></div>" +
    "<div>" +
    sigLine(nm, "अर्जदाराची सही") +
    "</div>" +
    "</div>";

  // Deduction detail
  var deduction =
    '<div class="bp" style="font-size:9pt;border-top:1px dashed #bbb">' +
    "<strong>वजावट तपशील:</strong><br>" +
    "• वजवलेली स्टेशनरी फी: ₹ ___________________________<br>" +
    "• शिल्लक रक्कम: ₹ ___________________________<br>" +
    "• अंतिम देय रक्कम: ₹ ___________________________ (अक्षरी: ₹ .......................................................................)" +
    "</div>";

  var footer =
    '<div style="display:flex;justify-content:space-between;padding:8px 20px 8px;border-top:1px solid #000">' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div><div style="font-size:9pt">लिपीक</div></div>' +
    '<div style="text-align:center"><div style="border-bottom:1px solid #000;height:18px;min-width:50mm;margin-bottom:4px"></div><div style="font-size:9pt">शाखा व्यवस्थापक / अधिकारी</div></div>' +
    "</div>" +
    '<div class="bp" style="font-size:8pt;border-top:1px solid #eee">फॉर्म सोबत घ्यावयाची कागदपत्रे :- १) आधार कार्ड / पॅन कार्ड छायांकित प्रती, २) पासबुकची मूळ प्रत (अथवा हरवले असल्याची लेखी माहिती)</div>';

  return (
    '<div class="page">' +
    orgHdr +
    ftitle +
    intro +
    itbl +
    decl1 +
    reasons +
    notes +
    finalAmt +
    deduction +
    footer +
    photoGrid(docPhotos || []) +
    declLine() +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  SHARED SLIP HELPERS
// ═══════════════════════════════════════════════════════
function _jjuSlipLogo() {
  return (
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
    '<div style="font-size:26pt;font-weight:900;color:#b8860b;line-height:1;font-family:Georgia,serif;letter-spacing:-1px">JJU</div>' +
    '<div style="line-height:1.25">' +
    '<div style="font-size:10.5pt;font-weight:900;color:#1a1a6e">जळगाव जामोद अर्बन</div>' +
    '<div style="font-size:10.5pt;font-weight:900;color:#1a1a6e">को-ऑप क्रेडीट सोसा.मर्या. जळगाव (जा.)र.नं.१०६७</div>' +
    "</div>" +
    "</div>"
  );
}

function _jjuDenomTable(accentBg, totalStr) {
  var B = "1px solid #333";
  var notes = [500, 200, 100, 50, 20, 10, 5]; // 2000 & 1000 notes discontinued/out of circulation
  var rows = "";
  notes.forEach(function (n) {
    rows +=
      "<tr>" +
      '<td style="padding:2px 4px;border:' +
      B +
      ';text-align:center;font-size:8pt">' +
      n +
      " X</td>" +
      '<td style="padding:2px 4px;border:' +
      B +
      ';min-width:12mm">&nbsp;</td>' +
      '<td style="padding:2px 4px;border:' +
      B +
      ';min-width:12mm">&nbsp;</td>' +
      '<td style="padding:2px 4px;border:' +
      B +
      ';min-width:7mm">&nbsp;</td>' +
      "</tr>";
  });
  rows +=
    "<tr>" +
    '<td style="padding:2px 4px;border:' +
    B +
    ';font-size:7.5pt">सिक्का शिक्के</td>' +
    '<td style="padding:2px 4px;border:' +
    B +
    '">&nbsp;</td>' +
    '<td style="padding:2px 4px;border:' +
    B +
    '">&nbsp;</td>' +
    '<td style="padding:2px 4px;border:' +
    B +
    '">&nbsp;</td>' +
    "</tr>";
  rows +=
    '<tr style="background:' +
    accentBg +
    ';font-weight:700">' +
    '<td style="padding:2px 4px;border:' +
    B +
    ';font-size:8pt">एकूण/कुल</td>' +
    '<td style="padding:2px 4px;border:' +
    B +
    '">&nbsp;</td>' +
    '<td style="padding:2px 4px;border:' +
    B +
    ';font-weight:800">' +
    (totalStr || "&nbsp;") +
    "</td>" +
    '<td style="padding:2px 4px;border:' +
    B +
    '">&nbsp;</td>' +
    "</tr>";
  return (
    '<table style="border-collapse:collapse;font-size:8pt;width:100%">' +
    '<tr style="background:#1a1a6e;color:#fff">' +
    '<th style="padding:2px 4px;border:' +
    B +
    ';text-align:center">मूल्यांकन</th>' +
    '<th style="padding:2px 4px;border:' +
    B +
    ';text-align:center">संख्या</th>' +
    '<th style="padding:2px 4px;border:' +
    B +
    ';text-align:center">रू.</th>' +
    '<th style="padding:2px 4px;border:' +
    B +
    ';text-align:center">पै.</th>' +
    "</tr>" +
    rows +
    "</table>"
  );
}

// builds one deposit/withdrawal slip panel (bank copy or customer copy)
// mode: 'deposit' | 'withdrawal'  copy: 'bank' | 'customer'
function _jjuSlipPanel(
  mode,
  copy,
  nm,
  dtFmt,
  savAcc,
  amtStr,
  wrdStr,
  bankName,
  balStr,
) {
  var B = "1px solid #333";
  var isDeposit = mode === "deposit";
  var isCust = copy === "customer";
  var accentBg = isDeposit ? "#d4edda" : "#fde0e8";
  var accentClr = isDeposit ? "#155724" : "#721c24";
  var titleText = isDeposit
    ? "बचत खाते जमा / जमा पावती / जमा पर्ची"
    : "बचत खाते काढणे / पैसे काढण्याची पावती";
  var copyLabel = isCust
    ? '<div style="font-size:7pt;font-weight:700;color:' +
      accentClr +
      ';text-align:right;margin-bottom:1px">— ग्राहक प्रत —</div>'
    : '<div style="font-size:7pt;font-weight:700;color:' +
      accentClr +
      ';text-align:right;margin-bottom:1px">— बँक प्रत —</div>';
  var outerBorder = isCust
    ? "border:2px dashed " + accentClr + ";border-radius:6px;"
    : "border:1px solid #333;";

  // ── TOP HEADER: compact one-liner — title+subtitle left | acc+scroll+date inline right ──
  var topHeader =
    '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #1a1a6e;padding-bottom:3px;margin-bottom:6px">' +
    '<div style="font-size:9.5pt;font-weight:900;color:#1a1a6e">' +
    titleText +
    '&nbsp;<span style="font-size:7.5pt;font-weight:400;color:#555">जळगाव जामोद अर्बन को-ऑप. क्रेडीट सोसा. मर्या.</span>' +
    "</div>" +
    '<div style="display:flex;gap:5px;align-items:center;font-size:8pt;white-space:nowrap">' +
    '<span style="border:1px solid #333;padding:1px 6px"><strong>खाते क्र.</strong> ' +
    savAcc +
    "</span>" +
    '<span style="border:1px solid #333;padding:1px 6px"><strong>स्क्रोल क्र.</strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>' +
    '<span style="border:1px solid #333;padding:1px 6px"><strong>दि.</strong> ' +
    dtFmt +
    "</span>" +
    "</div>" +
    "</div>";

  // ── RIGHT COUNTERFOIL — compact, date removed (now in header) ──────────
  var counterfoil =
    '<div style="padding-left:8px;flex:1;font-size:9pt">' +
    // Name
    '<div style="font-size:8.5pt;font-weight:700;margin-bottom:1px">' +
    (isDeposit ? "खात्यात जमा केले / नाव :" : "खात्यातून काढले / नाव :") +
    "</div>" +
    '<div style="border-bottom:1px solid #000;margin-bottom:1px;padding-bottom:1px;font-weight:800;font-size:10pt">&nbsp;' +
    nm +
    "</div>" +
    '<div style="font-size:7pt;color:#555;margin-bottom:4px">खातेदाराचे संपूर्ण नांव</div>' +
    '<div style="display:flex;align-items:baseline;gap:4px;margin-bottom:5px">' +
    '<span style="border-bottom:1px solid #000;flex:1;display:inline-block">&nbsp;</span>' +
    '<span style="white-space:nowrap;font-size:8pt">' +
    (isDeposit ? "च्या खात्यामध्ये जमा केले." : "च्या खात्यामधून काढले.") +
    "</span>" +
    "</div>" +
    // Amount
    '<div style="margin-bottom:3px">' +
    '<div style="border:' +
    B +
    ';padding:3px 8px;font-size:11pt;font-weight:900;display:inline-block;min-width:38mm">रू. &nbsp;' +
    amtStr +
    " /-</div>" +
    "</div>" +
    // Words
    '<div style="font-size:7.5pt;color:#555;margin-bottom:1px">अक्षरी रुपये :</div>' +
    '<div style="border-bottom:1px solid #000;margin-bottom:4px;font-style:italic;font-size:8.5pt">&nbsp;' +
    wrdStr +
    "</div>" +
    // Balance row
    (balStr && amtStr && balStr !== "—" && amtStr !== "—"
      ? (function () {
          var balNum = parseFloat(balStr.replace(/,/g, "")) || 0;
          var amtNum2 = parseFloat(amtStr.replace(/,/g, "")) || 0;
          if (isNaN(balNum) || isNaN(amtNum2))
            return '<div style="margin-bottom:4px"></div>';
          var resultNum = isDeposit ? balNum + amtNum2 : balNum - amtNum2;
          var resultStr = resultNum.toLocaleString("en-IN");
          var formula = isDeposit
            ? "₹\u00a0" +
              balStr +
              "\u00a0/-\u00a0+\u00a0₹\u00a0" +
              amtStr +
              '\u00a0/-\u00a0=\u00a0<strong style="font-size:9.5pt;color:#155724">₹\u00a0' +
              resultStr +
              "\u00a0/-</strong>"
            : "₹\u00a0" +
              balStr +
              "\u00a0/-\u00a0−\u00a0₹\u00a0" +
              amtStr +
              '\u00a0/-\u00a0=\u00a0<strong style="font-size:9.5pt;color:#721c24">₹\u00a0' +
              resultStr +
              "\u00a0/-</strong>";
          var label = isDeposit ? "एकूण शिल्लक :" : "उर्वरित शिल्लक :";
          return (
            '<div style="background:' +
            (isDeposit ? "#eafaf1" : "#fdf2f4") +
            ";border:1px solid " +
            (isDeposit ? "#a3d9b1" : "#f0b8c2") +
            ';border-radius:3px;padding:3px 8px;margin-bottom:4px;font-size:8pt">' +
            '<span style="color:#555;font-weight:700">' +
            label +
            "</span>&nbsp;" +
            formula +
            "</div>"
          );
        })()
      : '<div style="margin-bottom:4px"></div>') +
    // Signatures
    '<div style="display:flex;justify-content:space-between;margin-top:4px">' +
    '<div style="font-size:7.5pt;color:#333;border-top:1px solid #000;padding-top:2px;margin-top:12mm;min-width:50mm;text-align:center">रोखपाल/खातेपाल &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; व्यवस्थापक/अधिकारी</div>' +
    '<div style="font-size:7.5pt;color:#333;border-top:1px solid #000;padding-top:2px;margin-top:12mm;min-width:44mm;text-align:center">' +
    nm +
    " / सही</div>" +
    "</div>" +
    "</div>";

  var denomLeft =
    '<div style="min-width:46mm">' +
    _jjuDenomTable(accentBg, amtStr) +
    "</div>";

  return (
    '<div style="' +
    outerBorder +
    'padding:6px 10px;margin-bottom:6px;page-break-inside:avoid">' +
    copyLabel +
    topHeader +
    '<div style="display:flex;align-items:flex-start;gap:0">' +
    denomLeft +
    counterfoil +
    "</div>" +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  SAVING DEPOSIT SLIP PAGE  (बचत खाते जमा)
//  Bank copy + Customer copy
// ═══════════════════════════════════════════════════════
function savingDepositSlipPage(
  nm,
  dtFmt,
  savAcc,
  amt,
  wrd,
  bankName,
  savBal,
  singleCopy,
) {
  var amtNum = parseFloat(amt) || 0;
  var amtStr = amtNum > 0 ? amtNum.toLocaleString("en-IN") : "";
  var wrdStr = wrd || "";

  // savBal is the BEFORE balance (the value in the form field at submit time,
  // captured before processTransaction runs). The correct formula is:
  // beforeBal + depositAmt = afterBal — computed directly here.
  var beforeBalNum =
    savBal && savBal !== "—"
      ? parseFloat(String(savBal).replace(/,/g, "")) || 0
      : null;
  var afterBalNum =
    beforeBalNum != null && amtNum > 0
      ? beforeBalNum + amtNum
      : beforeBalNum != null
        ? beforeBalNum
        : null;
  // balStr = before balance (for formula display). afterBalStr = result shown on slip.
  var balStr =
    beforeBalNum != null && beforeBalNum >= 0
      ? beforeBalNum.toLocaleString("en-IN")
      : "";
  var afterBalStr =
    afterBalNum != null ? afterBalNum.toLocaleString("en-IN") : "";

  // Use savBal as the deposit amount if amt is blank (new saving account flow)
  // Clear balStr so the balance row is hidden — there is no prior balance to add to
  if (!amtStr && afterBalStr) {
    amtStr = afterBalStr;
    balStr = "";
    afterBalStr = "";
    var balNum2 = parseFloat(amtStr.replace(/,/g, "")) || 0;
    if (!wrdStr && balNum2 > 0) wrdStr = numberToWords(balNum2);
  }

  // Bank copy slip (always shown)
  function mkBankSlip() {
    return (
      '<div style="border:1px solid #333;padding:6px 10px;margin-bottom:6px;page-break-inside:avoid">' +
      '<div style="font-size:7pt;font-weight:700;color:#155724;text-align:right;margin-bottom:1px">— बँक प्रत —</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #1a1a6e;padding-bottom:3px;margin-bottom:6px">' +
      '<div style="font-size:9.5pt;font-weight:900;color:#1a1a6e">बचत खाते जमा / जमा पावती / जमा पर्ची' +
      '&nbsp;<span style="font-size:7.5pt;font-weight:400;color:#555">जळगाव जामोद अर्बन को-ऑप. क्रेडीट सोसा. मर्या.</span>' +
      "</div>" +
      '<div style="display:flex;gap:5px;align-items:center;font-size:8pt;white-space:nowrap">' +
      '<span style="border:1px solid #333;padding:1px 6px"><strong>खाते क्र.</strong> ' +
      savAcc +
      "</span>" +
      '<span style="border:1px solid #333;padding:1px 6px"><strong>स्क्रोल क्र.</strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>' +
      '<span style="border:1px solid #333;padding:1px 6px"><strong>दि.</strong> ' +
      dtFmt +
      "</span>" +
      "</div>" +
      "</div>" +
      '<div style="display:flex;align-items:flex-start;gap:0">' +
      '<div style="min-width:46mm">' +
      _jjuDenomTable("#d4edda", amtStr) +
      "</div>" +
      '<div style="padding-left:8px;flex:1;font-size:9pt">' +
      '<div style="font-size:8.5pt;font-weight:700;margin-bottom:1px">खात्यात जमा केले / नाव :</div>' +
      '<div style="border-bottom:1px solid #000;margin-bottom:1px;padding-bottom:1px;font-weight:800;font-size:10pt">&nbsp;' +
      nm +
      "</div>" +
      '<div style="font-size:7pt;color:#555;margin-bottom:4px">खातेदाराचे संपूर्ण नांव</div>' +
      '<div style="display:flex;align-items:baseline;gap:4px;margin-bottom:5px"><span style="border-bottom:1px solid #000;flex:1;display:inline-block">&nbsp;</span><span style="white-space:nowrap;font-size:8pt">च्या खात्यामध्ये जमा केले.</span></div>' +
      '<div style="margin-bottom:3px"><div style="border:1px solid #333;padding:3px 8px;font-size:11pt;font-weight:900;display:inline-block;min-width:38mm">रू. &nbsp;' +
      amtStr +
      " /-</div></div>" +
      '<div style="font-size:7.5pt;color:#555;margin-bottom:1px">अक्षरी रुपये :</div>' +
      '<div style="border-bottom:1px solid #000;margin-bottom:4px;font-style:italic;font-size:8.5pt">&nbsp;' +
      wrdStr +
      "</div>" +
      (balStr && amtStr && afterBalStr
        ? (function () {
            return (
              '<div style="background:#eafaf1;border:1px solid #a3d9b1;border-radius:3px;padding:3px 8px;margin-bottom:4px;font-size:8pt">' +
              '<span style="color:#555;font-weight:700">एकूण शिल्लक :</span>&nbsp;' +
              "₹\u00a0" +
              balStr +
              "\u00a0/-\u00a0+\u00a0₹\u00a0" +
              amtStr +
              '\u00a0/-\u00a0=\u00a0<strong style="font-size:9.5pt;color:#155724">₹\u00a0' +
              afterBalStr +
              "\u00a0/-</strong>" +
              "</div>"
            );
          })()
        : '<div style="margin-bottom:4px"></div>') +
      '<div style="display:flex;justify-content:space-between;margin-top:4px">' +
      '<div style="font-size:7.5pt;color:#333;border-top:1px solid #000;padding-top:2px;margin-top:12mm;min-width:50mm;text-align:center">रोखपाल/खातेपाल &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; व्यवस्थापक/अधिकारी</div>' +
      '<div style="font-size:7.5pt;color:#333;border-top:1px solid #000;padding-top:2px;margin-top:12mm;min-width:44mm;text-align:center">' +
      nm +
      " / सही</div>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  // Compact customer copy — short form with just the essentials
  function mkCustomerReceipt() {
    var newBal = afterBalStr || "";
    return (
      '<div style="border:2px dashed #155724;border-radius:5px;padding:5px 8px;margin-bottom:6px;page-break-inside:avoid">' +
      '<div style="font-size:7pt;font-weight:700;color:#155724;text-align:right;margin-bottom:1px">— ग्राहक प्रत (Customer Copy) —</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #1a1a6e;padding-bottom:2px;margin-bottom:4px">' +
      "<div>" +
      '<div style="font-size:9pt;font-weight:900;color:#1a1a6e">बचत जमा पावती / Saving Deposit Receipt</div>' +
      '<div style="font-size:7pt;color:#555">जळगाव जामोद अर्बन को-ऑप. क्रेडीट सोसा. मर्या.</div>' +
      "</div>" +
      '<div style="text-align:right;font-size:7.5pt;white-space:nowrap">' +
      "<div><strong>खाते क्र. :</strong> " +
      savAcc +
      "</div>" +
      "<div><strong>दिनांक :</strong> " +
      dtFmt +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div style="display:flex;align-items:center;gap:8px">' +
      '<div style="font-size:8pt;white-space:nowrap"><strong>नाव :</strong> ' +
      nm +
      "</div>" +
      '<div style="display:flex;gap:6px;flex:1">' +
      '<div style="background:#d4edda;border:1px solid #a3d9b1;border-radius:3px;padding:2px 6px;text-align:center;flex:1">' +
      '<div style="font-size:6.5pt;color:#555">जमा रक्कम / Deposited</div>' +
      '<div style="font-size:10pt;font-weight:900;color:#155724">₹ ' +
      amtStr +
      " /-</div>" +
      "</div>" +
      (newBal
        ? '<div style="background:#eafaf1;border:1px solid #a3d9b1;border-radius:3px;padding:2px 6px;text-align:center;flex:1">' +
          '<div style="font-size:6.5pt;color:#555">एकूण शिल्लक / New Balance</div>' +
          '<div style="font-size:10pt;font-weight:900;color:#1a5276">₹ ' +
          newBal +
          " /-</div>" +
          "</div>"
        : "") +
      "</div>" +
      "</div>" +
      (wrdStr
        ? '<div style="font-size:7pt;color:#444;font-style:italic;margin-top:2px">अक्षरी : ' +
          wrdStr +
          " Only</div>"
        : "") +
      '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:7pt;color:#555">' +
      '<div style="border-top:1px solid #999;padding-top:2px;min-width:36mm;text-align:center">रोखपाल / Cashier</div>' +
      '<div style="border-top:1px solid #999;padding-top:2px;min-width:36mm;text-align:center">' +
      nm +
      " / सही</div>" +
      "</div>" +
      "</div>"
    );
  }

  // singleCopy=true → only 1 bank slip (used for new saving account opening)
  // singleCopy=false/undefined → bank copy + customer receipt (standard deposit)
  return (
    '<div class="spage">' +
    mkBankSlip() +
    '<hr class="sdiv">' +
    mkCustomerReceipt() +
    '<hr class="sdiv">' +
    mkCertificate() +
    declLine() +
    "</div>"
  );
}

function mkCertificate() {
  var rows = "";
  for (var i = 1; i <= 7; i++) {
    rows +=
      '<tr style="height:22px"><td style="border:1px solid #000;padding:2px 4px;text-align:center;font-size:9pt;font-weight:700">' +
      i +
      '</td><td style="border:1px solid #000;padding:2px 4px"></td><td style="border:1px solid #000;padding:2px 4px"></td><td style="border:1px solid #000;padding:2px 4px"></td><td style="border:1px solid #000;padding:2px 4px"></td><td style="border:1px solid #000;padding:2px 4px"></td><td style="border:1px solid #000;padding:2px 4px"></td><td style="border:1px solid #000;padding:2px 4px"></td></tr>';
  }
  return (
    "<div style=\"padding:6px 8px;font-family:'Noto Sans Devanagari','Mangal',Arial,sans-serif;font-size:9pt;color:#000\">" +
    '<div style="text-align:center;font-size:14pt;font-weight:900;margin-bottom:6px">तपासनीसाचे प्रमाणपत्र</div>' +
    '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
    "<span>मे. शाखाधिकारी साहेब</span>" +
    "<span>दिनांक :&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; /&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; /2024</span>" +
    "</div>" +
    '<div style="margin-bottom:4px">व्यवस्थापक , जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div>' +
    '<div style="display:flex;gap:16px;margin-bottom:5px">' +
    '<span><strong>कर्जदाराचे नाव</strong><span style="display:inline-block;border-bottom:1px solid #000;min-width:130mm;">&nbsp;</span></span>' +
    '<span style="white-space:nowrap"><strong>कर्ज खाते क्र.</strong><span style="display:inline-block;border-bottom:1px solid #000;min-width:40mm;">&nbsp;</span></span>' +
    "</div>" +
    '<div style="margin-bottom:6px;font-size:8.5pt">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;मी अर्जदाराचे सोने चांदीचे दागिने संस्थेच्या  नियमास अनुसरून तपासले आहेत मी खालीलप्रमाणे प्रमाणपत्र देत आहे.</div>' +
    '<div style="text-align:center;font-size:10pt;font-weight:900;margin-bottom:5px">*** मालाचा तपशिल ***</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:8pt;margin-bottom:12px">' +
    "<thead>" +
    '<tr style="background:#f0f0f0">' +
    '<th style="border:1px solid #000;padding:3px 4px;width:5%;text-align:center">अ.क्र.</th>' +
    '<th style="border:1px solid #000;padding:3px 4px;width:28%;text-align:center">गहाण ठेवावयाच्या मालाचे वर्णन</th>' +
    '<th style="border:1px solid #000;padding:3px 4px;width:8%;text-align:center">निशाणी</th>' +
    '<th style="border:1px solid #000;padding:3px 4px;width:8%;text-align:center">शुद्धता</th>' +
    '<th style="border:1px solid #000;padding:3px 4px;width:13%;text-align:center">एकुण वजन</th>' +
    '<th style="border:1px solid #000;padding:3px 4px;width:13%;text-align:center">वजन अंदाजे</th>' +
    '<th style="border:1px solid #000;padding:3px 4px;width:13%;text-align:center">दर - १ग्रॅ / १०ग्रॅ</th>' +
    '<th style="border:1px solid #000;padding:3px 4px;width:12%;text-align:center">एकुण किंमत</th>' +
    "</tr>" +
    "</thead>" +
    "<tbody>" +
    rows +
    '<tr style="background:#f0f0f0;height:22px"><td style="border:1px solid #000;padding:2px 4px;text-align:center;font-size:8.5pt;font-weight:900">एकुण</td><td style="border:1px solid #000;padding:2px 4px" colspan="7"></td></tr>' +
    "</tbody>" +
    "</table>" +
    '<div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:4px">' +
    '<div style="text-align:center;min-width:55mm"><div style="border-top:1px solid #000;padding-top:3px;font-size:8pt">व्यवस्थापक / प्राधिकृत अधिकारी</div></div>' +
    '<div style="text-align:center;min-width:55mm"><div style="border-top:1px solid #000;padding-top:3px;font-size:8pt">सोनाराची सही</div></div>' +
    '<div style="text-align:center;min-width:55mm"><div style="border-top:1px solid #000;padding-top:3px;font-size:8pt">कर्जदाराची सही</div></div>' +
    "</div>" +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  SAVING WITHDRAWAL SLIP PAGE  (बचत खाते काढणे)
//  Bank copy + Customer copy
// ═══════════════════════════════════════════════════════
// "तपासनीसाचे प्रमाणपत्र" (Gold/silver appraisal certificate) — a separate
// stationery slip that accompanies a saving-withdrawal cash payout when
// items are held as informal collateral. All fields (date, borrower name,
// account no.) are left blank for hand-filling, matching the paper form
// this mirrors — only the org name/branch header is fixed print.
function _tapasaniSlip() {
  var B = "1px solid #000";
  var th =
    "border:" +
    B +
    ";padding:3px 3px;font-weight:800;text-align:center;font-size:7.3pt;background:#f2f2f2;vertical-align:middle";
  var td = "border:" + B + ";padding:6px 3px;font-size:8pt;text-align:center";

  var headCols = [
    "अ.क्र.",
    "गहाण ठेवावयाच्या मालाचे वर्णन",
    "निशाणी",
    "शुद्धता",
    "एकुण वजन",
    "वजन अंदाजे",
    "दर - रु./१०ग्रॅ",
    "एकुण किमत",
  ];
  var headRow =
    "<tr>" +
    headCols
      .map(function (c) {
        return '<th style="' + th + '">' + c + "</th>";
      })
      .join("") +
    "</tr>";

  var bodyRows = "";
  for (var i = 1; i <= 7; i++) {
    bodyRows +=
      "<tr>" +
      '<td style="' + td + '">' + i + "</td>" +
      '<td style="' + td + '">&nbsp;</td>' +
      '<td style="' + td + '">&nbsp;</td>' +
      '<td style="' + td + '">&nbsp;</td>' +
      '<td style="' + td + '">&nbsp;</td>' +
      '<td style="' + td + '">&nbsp;</td>' +
      '<td style="' + td + '">&nbsp;</td>' +
      '<td style="' + td + '">&nbsp;</td>' +
      "</tr>";
  }
  bodyRows +=
    '<tr style="background:#f7f7f7;font-weight:800">' +
    '<td style="' + td + '" colspan="2">एकुण</td>' +
    '<td style="' + td + '">&nbsp;</td>' +
    '<td style="' + td + '">&nbsp;</td>' +
    '<td style="' + td + '">&nbsp;</td>' +
    '<td style="' + td + '">&nbsp;</td>' +
    '<td style="' + td + '">&nbsp;</td>' +
    '<td style="' + td + '">&nbsp;</td>' +
    "</tr>";

  return (
    '<div class="sblock" style="padding:6px 10px">' +
    '<div style="text-align:center;font-size:13pt;font-weight:800;margin-bottom:4px">तपासनीसाचे प्रमाणपत्र</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:9pt;font-weight:700">' +
    "<span>मे. शाखाधिकारी साहेब</span>" +
    '<span>दिनांक : &nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;/20&nbsp;&nbsp;</span>' +
    "</div>" +
    '<div style="font-size:8.5pt;font-weight:700;margin:2px 0 6px">व्यवस्थापक , जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा. मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div>' +
    '<div style="display:flex;align-items:baseline;gap:4px;font-size:9pt;font-weight:700;margin-bottom:6px">' +
    '<span style="white-space:nowrap">कर्जदाराचे नाव</span>' +
    '<span style="border-bottom:1px solid #000;flex:2;padding:0 4px;font-weight:800">&nbsp;</span>' +
    '<span style="white-space:nowrap;margin-left:10px">कर्ज खाते क्र.</span>' +
    '<span style="border-bottom:1px solid #000;flex:1;padding:0 4px;font-weight:800">&nbsp;</span>' +
    "</div>" +
    '<div style="font-size:8.3pt;line-height:1.4;margin-bottom:4px">मी अर्जदाराचे सोने चांदीचे दागिने संस्थेच्या नियमास अनुसरून तपासले आहेत मी खालीलप्रमाणे प्रमाणपत्र देत आहे.</div>' +
    '<div style="text-align:center;font-size:9.5pt;font-weight:800;margin:4px 0">*** मालाचा तपशिल ***</div>' +
    '<table style="width:100%;border-collapse:collapse">' +
    headRow +
    bodyRows +
    "</table>" +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:6px 4px 2px;font-size:7.8pt;font-weight:700;margin-top:6px">' +
    '<div style="text-align:center"><div style="border-top:1px solid #000;margin-top:22px;padding-top:2px;min-width:44mm">व्यवस्थापक / प्राधिकृत अधिकारी</div></div>' +
    '<div style="text-align:center"><div style="border-top:1px solid #000;margin-top:22px;padding-top:2px;min-width:38mm">सोनाराची सही</div></div>' +
    '<div style="text-align:center"><div style="border-top:1px solid #000;margin-top:22px;padding-top:2px;min-width:38mm">कर्जदाराची सही</div></div>' +
    "</div>" +
    "</div>"
  );
}

function savingWithdrawalSlipPage(
  nm,
  dtFmt,
  savAcc,
  amt,
  wrd,
  bankName,
  savBal,
) {
  var amtNum = parseFloat(amt) || 0;
  var amtStr = amtNum > 0 ? amtNum.toLocaleString("en-IN") : "";
  var wrdStr = wrd || "";

  // savBal is the BEFORE balance (see the matching comment in
  // savingDepositSlipPage) — before - amt = after, computed here.
  var beforeBalNum =
    savBal && savBal !== "—"
      ? parseFloat(String(savBal).replace(/,/g, "")) || 0
      : null;
  var afterBalNum =
    beforeBalNum != null && amtNum > 0
      ? beforeBalNum - amtNum
      : beforeBalNum != null
        ? beforeBalNum
        : null;
  var afterBalStr =
    afterBalNum != null
      ? (afterBalNum < 0 ? "-" : "") +
        Math.abs(afterBalNum).toLocaleString("en-IN")
      : "";
  // Amount-in-words for उर्वरित शिल्लक, handling a negative (overdrawn)
  // balance — numberToWords() alone doesn't handle negative numbers.
  var afterBalWords =
    afterBalNum != null
      ? afterBalNum < 0
        ? "Minus " + numberToWords(Math.abs(afterBalNum))
        : numberToWords(afterBalNum)
      : "";

  // ── Compact BOM-style Marathi withdrawal slip ──────────────────────────────
  function mkSlip() {
    return (
      '<div style="border:2px solid #000;page-break-inside:avoid">' +
      // Header: full society name continuous + Debit badge in the slip's
      // upper-right corner
      '<div style="border-bottom:2px solid #000;padding:4px 8px;position:relative">' +
      '<span style="font-size:10.5pt;font-weight:900;color:#b80000">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसायटी मर्यादित</span>' +
      '<span style="font-size:9.5pt;font-weight:900;color:#000"> जळगाव (जा.) जि.बुलढाणा र.नं.१०६७</span>' +
      '<span style="position:absolute;top:3px;right:6px;font-size:8pt;font-weight:800;border:1.5px solid #000;padding:1px 7px;white-space:nowrap;background:#fff">Debit</span>' +
      "</div>" +
      // Slip title + date on same row
      '<div style="border-bottom:1.5px solid #000;padding:3px 8px;display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-size:10pt;font-weight:900">पैसे काढावयाचे चलन / नकद आहर्ता पर्ची</span>' +
      '<span style="font-size:8.5pt;font-weight:700;white-space:nowrap">दिनांक : <strong>' +
      dtFmt +
      "</strong></span>" +
      "</div>" +
      // ── Restructured body: notes-denomination table spans the full left
      // column (matches the app's other cash slips — Gold Loan slip 3/4 —
      // and drops ₹2000 automatically since _jjuDenomTable() already
      // excludes it); everything else stacked in a right column.
      '<div style="display:flex;align-items:stretch;gap:0">' +
      '<div style="min-width:38mm;padding:6px 0 6px 8px;border-right:1.5px solid #000">' +
      _jjuDenomTable("#dbeeff", amtStr ? "₹" + amtStr : "") +
      "</div>" +
      '<div style="flex:1;min-width:0;display:flex;flex-direction:column">' +
      // Pay lines
      '<div style="padding:5px 8px 4px;border-bottom:1px solid #999">' +
      '<div style="font-size:9pt;margin-bottom:4px;display:flex;align-items:baseline;gap:4px">' +
      '<span style="white-space:nowrap">कृपया, मला वा धारकाला रू.</span>' +
      '<span style="border-bottom:1px solid #000;flex:1;display:inline-block">&nbsp;' +
      (amtStr ? amtStr + " /-" : "") +
      "</span>" +
      "</div>" +
      '<div style="font-size:9pt;display:flex;align-items:baseline;gap:4px">' +
      '<span style="white-space:nowrap">वाहक/स्वतः को रू.</span>' +
      '<span style="border-bottom:1px solid #000;flex:1;display:inline-block">&nbsp;' +
      (wrdStr ? wrdStr + " फक्त" : "") +
      "</span>" +
      "</div>" +
      "</div>" +
      // Acc no row (Debit badge moved to the header's top-right corner above)
      '<div style="border-bottom:1px solid #999;padding:5px 8px;display:flex;align-items:center;gap:12px">' +
      '<span style="font-size:8.5pt;font-weight:800;white-space:nowrap">बचत खाते क्र.</span>' +
      '<span style="font-size:10pt;font-weight:900;letter-spacing:0.5px">' +
      savAcc +
      "</span>" +
      '<span style="font-size:8.5pt;font-weight:800;margin-left:auto;white-space:nowrap">ला नावे टाकून रोख द्यावेत.</span>' +
      "</div>" +
      // Name + Amount
      '<div style="display:flex;align-items:stretch;border-bottom:1px solid #999">' +
      '<div style="flex:1;padding:5px 8px;border-right:1px solid #999">' +
      '<div style="font-size:7.5pt;color:#555;margin-bottom:1px">खातेदाराचे नाव</div>' +
      '<div style="font-size:10.5pt;font-weight:900">' +
      nm +
      "</div>" +
      "</div>" +
      '<div style="min-width:32mm;display:flex;align-items:center;justify-content:center;gap:4px;padding:5px 8px">' +
      '<span style="font-size:15pt;font-weight:900;color:#1a1a6e">₹</span>' +
      '<span style="font-size:10pt;font-weight:900">' +
      (amtStr ? amtStr + " /-" : "") +
      "</span>" +
      "</div>" +
      "</div>" +
      // Remaining balance + amount in words
      (afterBalStr
        ? '<div style="padding:5px 8px;border-bottom:1px solid #999">' +
          '<div style="font-size:8.5pt;font-weight:800;margin-bottom:3px">उर्वरित शिल्लक : Rs. ' +
          afterBalStr +
          " /-</div>" +
          '<div style="font-size:7.8pt;font-weight:700;line-height:1.35">( अक्षरी रु. - ' +
          afterBalWords +
          " फक्त )</div>" +
          "</div>"
        : "") +
      // Signature row — खातेदाराची स्वाक्षरी moved to the right with the
      // customer's name
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:8px 8px 6px;margin-top:auto;gap:10px">' +
      '<div style="flex:1">' +
      '<div style="border-top:1px solid #000;margin-top:9mm;padding-top:2px;font-size:7.3pt;font-weight:700;text-align:center">पासकर्ता अधिकारी / निरीक्षक / कर्मचारी</div>' +
      "</div>" +
      '<div style="flex:1;text-align:right">' +
      '<div style="border-top:1px solid #000;margin-top:9mm;padding-top:2px;font-size:7.3pt;font-weight:700;text-align:right">खातेदाराची स्वाक्षरी - ' +
      nm +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  return (
    '<div class="spage" style="page-break-inside:avoid">' +
    mkSlip() +
    '<div class="sdiv" style="margin:6px 0;border-top:1px dashed #999"></div>' +
    _tapasaniSlip() +
    declLine() +
    "</div>" +
    '<div class="spage-blank"></div>'
  );
}

// ═══════════════════════════════════════════════════════
//  BANK TRANSACTION VOUCHER PAGE
//  Generates: 1) Saving Deposit Slip  2) Saving Withdrawal Slip  3) Bank Voucher
// ═══════════════════════════════════════════════════════
function bankTransactionVoucherPage(
  txType,
  nm,
  dtFmt,
  savAcc,
  bankAccName,
  expAccNo,
  expAmt,
  expWrd,
  upiRrn,
  chequeNo,
  comments,
  rtgsFrom,
  rtgsTo,
  rtgsCharges,
) {
  var amtNum = parseFloat(expAmt) || 0;
  var amtStr = amtNum > 0 ? amtNum.toLocaleString("en-IN") : "__________";
  var wrdStr = expWrd || "______________________";
  var upiStr = upiRrn
    ? "UPI RRN: " + upiRrn
    : chequeNo
      ? "Cheque No: " + chequeNo
      : "";

  var TXLABELS = {
    "Payment Received - Online": {
      title: "Payment Received - Online",
      dc: "Credit",
      code: "BANK - CR - TRF",
    },
    "Payment Transfer - Online": {
      title: "Payment Transfer - Online",
      dc: "Debit",
      code: "BANK - DB - TRF",
    },
    RTGS: { title: "RTGS Transfer", dc: "Debit", code: "RTGS - DB - TRF" },
    "Bank Charges": {
      title: "Bank Charges",
      dc: "Debit",
      code: "BANK CHG - DB - TRF",
    },
    "Other Bank - Cash Withdrawal": {
      title: "Other Bank Cash Withdrawal",
      dc: "Debit",
      code: "OTHER BANK - DB",
    },
    "Other Bank - Cash Deposit": {
      title: "Other Bank Cash Deposit",
      dc: "Credit",
      code: "OTHER BANK - CR",
    },
    TDS: { title: "TDS", dc: "Debit", code: "TDS - DB - TRF" },
    "Interest Received on FD from Other Bank": {
      title: "Interest Received on FD",
      dc: "Credit",
      code: "INT FD - CR - TRF",
    },
  };
  var lbl = TXLABELS[txType] || {
    title: txType,
    dc: "Credit",
    code: "BANK - TRF",
  };
  var isCredit = lbl.dc === "Credit";

  function orgHdr() {
    return '<div class="sohdr"><div class="sohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div></div>';
  }

  // ── Helper: compact notes table used inside each slip ─────────────────────
  function mkNotesRow(label) {
    return (
      '<table style="width:100%;border-collapse:collapse;font-size:8pt;margin-top:0;border-top:1px solid #ccc">' +
      '<tr style="background:#e8f4fd">' +
      '<th colspan="4" style="border:1px solid #bbb;padding:3px 8px;font-size:8pt;font-weight:800;color:#1a3a5c;text-align:left">📋 ' +
      label +
      "</th>" +
      "</tr>" +
      '<tr style="background:#f0f0f0">' +
      '<th style="border:1px solid #bbb;padding:2px 6px;width:25%;text-align:left">तपशील / Particulars</th>' +
      '<th style="border:1px solid #bbb;padding:2px 6px;width:25%;text-align:left">खाते क्र. / Acc No</th>' +
      '<th style="border:1px solid #bbb;padding:2px 6px;width:25%;text-align:left">दिनांक / Date</th>' +
      '<th style="border:1px solid #bbb;padding:2px 6px;width:25%;text-align:right">रक्कम / Amount (₹)</th>' +
      "</tr>" +
      "<tr>" +
      '<td style="border:1px solid #ccc;padding:2px 6px;font-weight:700">बचत जमा / Saving Deposit</td>' +
      '<td style="border:1px solid #ccc;padding:2px 6px;font-weight:700">' +
      savAcc +
      "</td>" +
      '<td style="border:1px solid #ccc;padding:2px 6px;font-weight:700">' +
      dtFmt +
      "</td>" +
      '<td style="border:1px solid #ccc;padding:2px 6px;font-weight:800;text-align:right">₹ ' +
      amtStr +
      " /-</td>" +
      "</tr>" +
      '<tr style="background:#fffde7">' +
      '<td colspan="3" style="border:1px solid #bbb;padding:2px 8px;font-weight:800;text-align:right">एकूण / Total :</td>' +
      '<td style="border:1px solid #bbb;padding:2px 6px;font-weight:900;text-align:right;color:#1a3a5c">₹ ' +
      amtStr +
      " /-</td>" +
      "</tr>" +
      (wrdStr
        ? '<tr><td colspan="4" style="border:1px solid #ccc;padding:2px 8px;font-size:7.5pt;color:#444;font-style:italic">अक्षरी / In Words: ' +
          wrdStr +
          " Only</td></tr>"
        : "") +
      "</table>"
    );
  }

  function mkSlipBlock(isCustomer) {
    var copyLabel = isCustomer
      ? '<div style="font-size:7pt;font-weight:700;color:#155724;text-align:right;margin-bottom:2px">ग्राहक पावती / Customer Receipt</div>'
      : '<div style="font-size:7pt;font-weight:700;color:#1a3a5c;text-align:right;margin-bottom:2px">बँक प्रत / Bank Copy</div>';
    var borderStyle = isCustomer
      ? "border:2px solid #1a1a6e;"
      : "border:2px solid #000;";
    return (
      '<div style="' +
      borderStyle +
      'border-radius:3px;overflow:hidden;margin-bottom:0">' +
      '<div style="background:#1a1a6e;color:#fff;' +
      (isCustomer
        ? "display:flex;justify-content:space-between;align-items:center;"
        : "text-align:center;") +
      'font-size:8pt;font-weight:800;padding:3px 8px">' +
      (isCustomer
        ? '<span>जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</span><span style="background:#fff;color:#1a1a6e;padding:1px 7px;border-radius:3px;font-size:8pt">ग्राहक पावती / Customer Receipt</span>'
        : "जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७") +
      "</div>" +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 10px;border-bottom:1px solid #000;background:#e0e0e0;font-size:8pt;font-weight:800">' +
      "<span>प्रवेश फि / स्टेशनरी / लघुबचत / बचत ठेव / <u>बचत जमा</u> / सभासद ठेव / नाममात्र सदस्य फि</span>" +
      '<span style="font-size:9pt;font-weight:900">SAV - CR &nbsp; Credit</span>' +
      "</div>" +
      '<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.5pt;border-top:1px solid #000">' +
      '<tr style="background:#d0d0d0">' +
      '<th style="border:1px solid #000;padding:2px 6px;font-weight:800;width:15%">Scroll No</th>' +
      '<th style="border:1px solid #000;padding:2px 6px;font-weight:800;width:25%">बचत खाते क्र.</th>' +
      '<th style="border:1px solid #000;padding:2px 6px;font-weight:800;width:25%">खाते क्र.</th>' +
      '<th style="border:1px solid #000;padding:2px 6px;font-weight:800;width:22%">तारीख</th>' +
      '<th style="border:1px solid #000;padding:2px 6px;font-weight:800;width:13%">Credit</th>' +
      "</tr><tr>" +
      '<td style="border:1px solid #000;padding:2px 6px"></td>' +
      '<td style="border:1px solid #000;padding:2px 6px;font-weight:800">' +
      savAcc +
      "</td>" +
      '<td style="border:1px solid #000;padding:2px 6px;font-weight:800">43-1</td>' +
      '<td style="border:1px solid #000;padding:2px 6px;font-weight:800">' +
      dtFmt +
      "</td>" +
      '<td style="border:1px solid #000;padding:2px 6px;font-weight:800">' +
      amtStr +
      "</td>" +
      "</tr></table>" +
      '<table style="width:100%;border-collapse:collapse;font-size:9pt;border-top:1px solid #ddd">' +
      '<tr><th style="font-weight:800;color:#000;width:38%;padding:3px 10px;border:1px solid #000;background:#d4edda;text-align:left">खातेदाराचे नाव</th>' +
      '<td style="font-size:10.5pt;font-weight:800;padding:3px 10px;border:1px solid #000" colspan="3">' +
      nm +
      "</td></tr>" +
      '<tr><th style="font-weight:800;color:#000;padding:3px 10px;border:1px solid #000;background:#d4edda;text-align:left">रक्कम</th>' +
      '<td style="padding:3px 10px;border:1px solid #000;font-weight:700" colspan="3"><strong>रक्कम रू. ' +
      amtStr +
      " /-</strong>" +
      (wrdStr
        ? ' <span style="font-size:8.5pt;font-weight:600">(अक्षरी रू. ' +
          wrdStr +
          ")</span>"
        : "") +
      "</td></tr>" +
      "</table>" +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:4px 14px 5px;border-top:1.5px solid #000;font-size:8.5pt;font-weight:800">' +
      '<div style="text-align:center"><span style="font-weight:900;font-size:8.5pt;border-top:1.5px solid #000;padding-top:2px;margin-top:12px;min-width:50mm;display:block">रोखपाल/व्यवस्थापक/अधिकारी</span></div>' +
      '<div style="text-align:center"><span style="font-weight:900;font-size:8.5pt;border-top:1.5px solid #000;padding-top:2px;margin-top:12px;min-width:50mm;display:block">' +
      nm +
      '<br><span style="font-size:7.5pt;font-weight:600">खातेदाराची सही</span></span></div>' +
      "</div>" +
      "</div>"
    );
  }

  // ── Compact denom table (fits in small slip) ────────────────────────────────
  function miniDenom() {
    var notes = [500, 200, 100, 50, 20, 10, 5]; // 2000 & 1000 notes discontinued/out of circulation
    var rows = notes
      .map(function (n) {
        return (
          '<tr><td style="padding:1px 4px;border:1px solid #999;font-size:7pt;text-align:center">' +
          n +
          " X</td>" +
          '<td style="padding:1px 4px;border:1px solid #999;min-width:10mm">&nbsp;</td>' +
          '<td style="padding:1px 4px;border:1px solid #999;min-width:10mm">&nbsp;</td></tr>'
        );
      })
      .join("");
    rows +=
      '<tr><td style="padding:1px 4px;border:1px solid #999;font-size:7pt">सिक्के</td><td style="padding:1px 4px;border:1px solid #999">&nbsp;</td><td style="padding:1px 4px;border:1px solid #999">&nbsp;</td></tr>';
    rows +=
      '<tr style="background:#d4edda;font-weight:700"><td style="padding:2px 4px;border:1px solid #999;font-size:7pt">एकूण</td><td style="padding:2px 4px;border:1px solid #999">&nbsp;</td><td style="padding:2px 4px;border:1px solid #999;font-size:7.5pt;font-weight:800">' +
      amtStr +
      "</td></tr>";
    return (
      '<table style="border-collapse:collapse;font-size:7.5pt">' +
      '<tr style="background:#1a1a6e;color:#fff"><th style="padding:2px 4px;border:1px solid #999;font-size:7pt">मूल्य</th><th style="padding:2px 4px;border:1px solid #999;font-size:7pt">संख्या</th><th style="padding:2px 4px;border:1px solid #999;font-size:7pt">रू.</th></tr>' +
      rows +
      "</table>"
    );
  }

  // ── One compact slip block ───────────────────────────────────────────────────
  function compactSlip(copyLabel, borderColor, isRtgs) {
    var isCredit2 = lbl.dc === "Credit";
    var titleLine = isRtgs
      ? "RTGS Transfer — " + (isCredit2 ? "Credit" : "Debit")
      : isCredit2
        ? "बचत खाते जमा / जमा पावती"
        : "बचत खाते काढणे / पैसे काढण्याची पावती";
    var code = isRtgs
      ? lbl.code
      : isCredit2
        ? "SAV - CR  Credit"
        : "SAV - DB  Debit";
    var accLine = isRtgs
      ? (rtgsFrom ? "FROM: <strong>" + rtgsFrom + "</strong>" : "") +
        (rtgsTo
          ? "&nbsp;&nbsp;→&nbsp;&nbsp;TO: <strong>" + rtgsTo + "</strong>"
          : "")
      : (nm ? nm : "") +
        (savAcc && savAcc !== "—"
          ? " &nbsp;|&nbsp; खाते क्र: <strong>" + savAcc + "</strong>"
          : "");
    return (
      '<div style="border:1.5px solid ' +
      borderColor +
      ';border-radius:3px;overflow:hidden;font-size:8pt;page-break-inside:avoid">' +
      '<div style="background:#1a1a6e;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:2px 8px">' +
      '<span style="font-size:7.5pt;font-weight:800">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</span>' +
      '<span style="background:#fff;color:#1a1a6e;padding:1px 6px;border-radius:3px;font-size:7.5pt;font-weight:900;white-space:nowrap">' +
      copyLabel +
      "</span>" +
      "</div>" +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 8px;background:#e0e0e0;border-bottom:1px solid #aaa">' +
      '<span style="font-size:7.5pt;font-weight:800">' +
      titleLine +
      "</span>" +
      '<span style="font-size:8pt;font-weight:900">' +
      code +
      "</span>" +
      "</div>" +
      '<div style="display:flex;align-items:flex-start;gap:4px;padding:4px 6px">' +
      miniDenom() +
      '<div style="flex:1;padding-left:6px;font-size:8pt">' +
      '<div style="display:flex;gap:6px;margin-bottom:3px">' +
      '<span style="font-weight:700;white-space:nowrap">दिनांक:</span><span style="border-bottom:1px solid #000;flex:1">&nbsp;' +
      dtFmt +
      "</span>" +
      (savAcc && savAcc !== "—" && !isRtgs
        ? '&nbsp;&nbsp;<span style="font-weight:700;white-space:nowrap">खाते क्र:</span><span style="border-bottom:1px solid #000;min-width:22mm">&nbsp;' +
          savAcc +
          "</span>"
        : "") +
      "</div>" +
      (isRtgs
        ? '<div style="margin-bottom:2px;font-size:7.5pt">' +
          (rtgsFrom
            ? '<span style="font-weight:700">FROM:</span> <strong>' +
              rtgsFrom +
              "</strong><br>"
            : "") +
          (rtgsTo
            ? '<span style="font-weight:700">TO:</span> <strong>' +
              rtgsTo +
              "</strong>"
            : "") +
          (upiStr
            ? '<br><span style="font-weight:700">Ref:</span> ' + upiStr
            : "") +
          "</div>"
        : '<div style="font-weight:800;font-size:9pt;border-bottom:1px solid #000;margin-bottom:2px;padding-bottom:1px">&nbsp;' +
          nm +
          "</div>") +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
      '<div style="border:1px solid #333;padding:3px 8px;font-size:10pt;font-weight:900;min-width:30mm">रू. ' +
      amtStr +
      " /-</div>" +
      "</div>" +
      '<div style="font-size:7.5pt;font-style:italic;color:#444;margin-bottom:3px">' +
      wrdStr +
      "</div>" +
      (comments
        ? '<div style="font-size:7pt;color:#555">' + comments + "</div>"
        : "") +
      '<div style="display:flex;justify-content:space-between;padding-top:3px;margin-top:3px;border-top:1px solid #aaa">' +
      '<span style="font-size:7.5pt;border-top:1px solid #000;padding-top:2px;margin-top:10px;min-width:35mm;text-align:center;display:block">रोखपाल/व्यवस्थापक</span>' +
      '<span style="font-size:7.5pt;border-top:1px solid #000;padding-top:2px;margin-top:10px;min-width:35mm;text-align:center;display:block">' +
      (nm || "") +
      (isRtgs ? "" : " / सही") +
      "</span>" +
      "</div>" +
      "</div></div>" +
      "</div>"
    );
  }

  // ── Reference row (PRN / Cheque / UPI) ─────────────────────────────────────
  var refLabel = upiRrn ? "UPI / PRN No" : chequeNo ? "Cheque No" : "";
  var refValue = upiRrn || chequeNo || "";
  var purposeStr = comments && comments !== "—" ? comments : lbl.title;

  // ── All 2 slips on ONE page ─────────────────────────────────────────────────
  var isRtgs = txType === "RTGS";

  // Build a 2-slip layout: Debit slip + Credit slip
  // For Credit TX (Payment Received): Slip1 = Debit (Bank/FD-OD side), Slip2 = Credit (Saving Acc)
  // For Debit TX (Payment Transfer):  Slip1 = Debit (Saving Acc/Expense side), Slip2 = Credit (Bank/Expense)
  function twoSlip(
    slip1Label,
    slip1Bg,
    slip2Label,
    slip2Bg,
    slip1AccNo,
    slip2AccNo,
    slip1DC,
    slip2DC,
  ) {
    function oneSlip(copyLabel, headerBg, accNo, dcType, isBottom) {
      var dcColor = dcType === "Credit" ? "#1a5c2a" : "#7a1010";
      var dcBg = dcType === "Credit" ? "#e8f5e9" : "#fff3e0";
      var titleLine = isCredit
        ? "बचत खाते जमा / जमा पावती"
        : "बचत खाते काढणे / पैसे काढण्याची पावती";
      var codeStr = isCredit ? "SAV - CR  Credit" : "SAV - DB  Debit";
      return (
        '<div style="border:1.5px solid #000;border-radius:3px;overflow:hidden;font-size:8pt;page-break-inside:avoid">' +
        // Header bar
        '<div style="background:' +
        headerBg +
        ';color:#fff;display:flex;justify-content:space-between;align-items:center;padding:3px 10px">' +
        '<span style="font-size:7.5pt;font-weight:800">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</span>' +
        '<span style="background:#fff;color:' +
        headerBg +
        ';padding:1px 8px;border-radius:3px;font-size:8pt;font-weight:900;white-space:nowrap">' +
        copyLabel +
        "</span>" +
        "</div>" +
        // Sub-header: form type + code + debit/credit head (moved up into header area)
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 10px;background:#e0e0e0;border-bottom:1px solid #aaa">' +
        '<span style="font-size:7.5pt;font-weight:800">बचत खाते जमा / जमा पावती</span>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:8.5pt;font-weight:900">' +
        codeStr +
        "</span>" +
        '<span style="display:inline-block;background:' +
        dcBg +
        ";color:" +
        dcColor +
        ";border:1px solid " +
        dcColor +
        ';padding:0px 8px;border-radius:3px;font-size:7.5pt;font-weight:900">' +
        dcType +
        "</span>" +
        "</div>" +
        "</div>" +
        // Body: denom table left, fields right
        '<div style="display:flex;align-items:flex-start;gap:0;padding:4px 6px 0">' +
        miniDenom() +
        '<div style="flex:1;padding-left:8px;font-size:8pt">' +
        // Date + Account row
        '<div style="display:flex;gap:8px;margin-bottom:3px;align-items:baseline">' +
        '<span style="font-weight:700;white-space:nowrap">Scroll No:</span><span style="border-bottom:1px solid #000;min-width:16mm;padding-bottom:1px">&nbsp;</span>' +
        '&nbsp;&nbsp;<span style="font-weight:700;white-space:nowrap">दिनांक:</span><span style="border-bottom:1px solid #000;flex:1;padding-bottom:1px">&nbsp;' +
        dtFmt +
        "</span>" +
        (accNo && accNo !== "—"
          ? '&nbsp;&nbsp;<span style="font-weight:700;white-space:nowrap">खाते क्र.:</span><span style="border-bottom:1px solid #000;min-width:28mm;padding-bottom:1px">&nbsp;' +
            accNo +
            "</span>"
          : "") +
        "</div>" +
        // Name
        '<div style="font-weight:900;font-size:9.5pt;border-bottom:1px solid #000;margin-bottom:3px;padding-bottom:1px">&nbsp;' +
        nm +
        "</div>" +
        // Amount box
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">' +
        '<div style="border:1.5px solid #333;padding:3px 10px;font-size:11pt;font-weight:900;min-width:32mm;background:#fffde7">रू. ' +
        amtStr +
        " /-</div>" +
        '<span style="font-size:7.5pt;font-style:italic;color:#444">' +
        (expWrd ? "Akshari Rs. " + wrdStr : wrdStr) +
        "</span>" +
        "</div>" +
        // Purpose
        (purposeStr
          ? '<div style="font-size:7.5pt;color:#333;margin-bottom:2px"><span style="font-weight:800">उद्देश / Purpose:</span> ' +
            purposeStr +
            "</div>"
          : "") +
        // PRN / Cheque ref
        (refLabel && refValue
          ? '<div style="font-size:7.5pt;color:#1a3a5c;font-weight:800;background:#e8f4fd;border:1px solid #b0d8f5;border-radius:2px;padding:1px 6px;display:inline-block;margin-bottom:2px">🔖 ' +
            refLabel +
            ': <span style="font-size:8.5pt">' +
            refValue +
            "</span></div>"
          : "") +
        // Signature row
        '<div style="display:flex;justify-content:space-between;padding-top:10px;margin-top:8px;border-top:1px solid #bbb">' +
        '<span style="font-size:7.5pt;border-top:1px solid #000;padding-top:2px;margin-top:18px;min-width:38mm;text-align:center;display:block">रोखपाल/व्यवस्थापक</span>' +
        '<span style="font-size:7.5pt;border-top:1px solid #000;padding-top:2px;margin-top:18px;min-width:38mm;text-align:center;display:block">' +
        nm +
        " / सही</span>" +
        "</div>" +
        "</div></div>" +
        "</div>"
      );
    }

    return (
      '<div class="spage" style="padding:8px 10px">' +
      oneSlip(slip1Label, slip1Bg, slip1AccNo, slip1DC, false) +
      '<hr class="sdiv" style="margin:6px 0">' +
      oneSlip(slip2Label, slip2Bg, slip2AccNo, slip2DC, true) +
      '<hr class="sdiv" style="margin:6px 0">' +
      mkCertificate() +
      "</div>"
    );
  }

  if (isRtgs) {
    // RTGS: keep original 3-slip flow but reduce to 2 (debit + credit bank)
    return (
      '<div class="spage" style="padding:6px 10px">' +
      compactSlip("Debit — " + (rtgsFrom || "FROM"), "#000", true) +
      '<hr class="sdiv" style="margin:4px 0">' +
      compactSlip("Credit — " + (rtgsTo || "TO"), "#1a1a6e", true) +
      "</div>"
    );
  }

  if (isCredit) {
    // Payment Received (Credit): Slip1 = Debit (Bank FD-OD), Slip2 = Credit (Saving Acc)
    return twoSlip(
      "Debit — " + (bankAccName || "Bank TRF"),
      "#7a1010",
      "Credit — Saving Acc",
      "#1a1a6e",
      expAccNo || "—", // bank/FD-OD acc on debit slip
      savAcc, // saving acc on credit slip
      "Debit",
      "Credit",
    );
  } else {
    // Payment Transfer (Debit): Slip1 = Debit (Saving Acc), Slip2 = Credit (Bank/Expense)
    return twoSlip(
      "Debit — Saving Acc",
      "#7a1010",
      "Credit — " + (bankAccName || "Bank TRF"),
      "#1a1a6e",
      savAcc, // saving acc on debit slip
      expAccNo || "—", // bank/expense acc on credit slip
      "Debit",
      "Credit",
    );
  }
}

// ═══════════════════════════════════════════════════════
//  MIS INTEREST SLIPS PAGE
//  4 horizontal slips stacked on one A4 page
//  Matches sblock/spage style of other slip pages
// ═══════════════════════════════════════════════════════
function misInterestSlipsPage(
  nm,
  dtFmt,
  savAcc,
  misAccNo,
  fdAmt,
  fdWrd,
  fdPrd,
  fdRate,
  fdMat,
  intAmt,
  intWrd,
  misMonth,
) {
  var BANK =
    "जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७";
  var misAcc = misAccNo && misAccNo !== "—" ? misAccNo : "290-";
  var savingAcc = savAcc && savAcc !== "—" ? savAcc : "43-";
  var monthStr = misMonth && misMonth !== "—" ? misMonth : "";

  var intAmtNum = parseFloat(intAmt) || 0;
  var intAmtFmt =
    intAmtNum > 0
      ? intAmtNum.toLocaleString("en-IN", { minimumFractionDigits: 2 })
      : "__________";
  var intWrdStr =
    intWrd && intWrd !== "—"
      ? intWrd
      : intAmtNum > 0
        ? convertNumberToWords(intAmtNum)
        : "______________________";
  var dateStr = dtFmt && dtFmt !== "—" ? dtFmt : "________";
  var monthLabel = monthStr ? " [" + monthStr + "]" : "";

  // Compact styles inlined so they don't depend on sct/sftr spacings
  var T =
    'style="width:100%;border-collapse:collapse;font-size:8pt;table-layout:fixed"';
  var TH =
    'style="border:1px solid #ccc;padding:3px 6px;font-weight:600;background:';
  var TD = 'style="border:1px solid #ccc;padding:3px 6px;font-weight:700"';
  var TDc = 'style="border:1px solid #ccc;padding:3px 6px"';

  function slip(title, code, accType, accNo, dcLabel, bgColor) {
    return (
      '<div style="border:1.5px solid #000;margin-bottom:0">' +
      // Header
      "<div style=\"text-align:center;padding:2px 6px;border-bottom:1px solid #000;background:#fafafa;font-family:'Noto Serif Devanagari','Kokila','Mangal',serif;font-size:8.5pt;font-weight:700;line-height:1.2\">" +
      BANK +
      "</div>" +
      // Title bar
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 8px;border-bottom:1px solid #000;background:#eef8f0;font-size:8pt;font-weight:700">' +
      "<span>" +
      title +
      monthLabel +
      "</span>" +
      '<span style="font-size:8pt;font-weight:800;color:#0a4a1a">' +
      code +
      "</span>" +
      "</div>" +
      // Scroll row
      "<table " +
      T +
      "><tr>" +
      "<th " +
      TH +
      '#ececec;width:12%">Scroll No</th>' +
      "<th " +
      TH +
      '#ececec;width:32%">Acc Type</th>' +
      "<th " +
      TH +
      '#ececec;width:18%">Acc No</th>' +
      "<th " +
      TH +
      '#ececec;width:26%">Date</th>' +
      "<th " +
      TH +
      '#ececec;width:12%">' +
      dcLabel +
      "</th>" +
      "</tr><tr>" +
      "<td " +
      TDc +
      "></td>" +
      "<td " +
      TD +
      ">" +
      accType +
      "</td>" +
      "<td " +
      TD +
      ">" +
      accNo +
      "</td>" +
      "<td " +
      TD +
      ">" +
      dateStr +
      "</td>" +
      "<td " +
      TDc +
      "></td>" +
      "</tr></table>" +
      // Info rows
      "<table " +
      T +
      ">" +
      "<tr>" +
      "<th " +
      TH +
      bgColor +
      ';width:22%">खातेदाराचे नाव</th>' +
      "<td " +
      TDc +
      ' colspan="3" style="border:1px solid #ccc;padding:3px 6px;font-size:9pt;font-weight:800">' +
      nm +
      "</td>" +
      "</tr>" +
      "<tr>" +
      "<th " +
      TH +
      bgColor +
      '">रक्कम / Amount</th>' +
      "<td " +
      TDc +
      ' colspan="3" style="border:1px solid #ccc;padding:3px 6px"><strong>रू. ' +
      intAmtFmt +
      ' /-</strong> <span style="font-size:8pt">(' +
      intWrdStr +
      ")</span></td>" +
      "</tr>" +
      "</table>" +
      // Signature row
      '<div style="display:flex;justify-content:space-between;padding:4px 14px 5px;border-top:1px solid #ddd">' +
      '<div style="text-align:center;font-size:7.5pt">' +
      "लेखापाल / व्यवस्थापक / अधिकारी" +
      '<div style="border-top:1px solid #000;min-width:55mm;margin-top:10px;padding-top:2px">&nbsp;</div>' +
      "</div>" +
      '<div style="text-align:center">' +
      '<div style="border-top:1px solid #000;min-width:55mm;margin-top:10px;padding-top:2px;font-size:8.5pt;font-weight:800">' +
      nm +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  var SEP = '<div style="border-top:2px dashed #555;margin:4px 0"></div>';

  return (
    '<div style="background:#fff;width:210mm;margin:0 auto;padding:6mm 8mm;box-sizing:border-box;' +
    'page-break-after:avoid;page-break-inside:avoid">' +
    slip(
      "** व्याज प्रदान — MIS Special **",
      "MIS INT - DB - TRF · Debit",
      "Int Paid On MIS Special - TRF",
      "187-1",
      "Debit",
      "#fff3e0",
    ) +
    SEP +
    slip(
      "** MIS Special — जमा (Credit) **",
      "MIS TRF - CR - TRF · Credit",
      "MIS TRF",
      misAcc,
      "Credit",
      "#e8f5e9",
    ) +
    SEP +
    slip(
      "** MIS Special — नावे (Debit) **",
      "MIS TRF - DB - TRF · Debit",
      "MIS TRF",
      misAcc,
      "Debit",
      "#fff3e0",
    ) +
    SEP +
    slip(
      "बचत ठेव — Saving Acc Transfer",
      "SAV - CR - TRF · Credit",
      "Saving Acc TRF",
      savingAcc,
      "Credit",
      "#e8f5e9",
    ) +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════
//  EMPLOYEE SALARY VOUCHER PAGE
//  Full-page professional voucher with month/year field
// ═══════════════════════════════════════════════════════
function employeeSalaryPage(
  nm,
  dtFmt,
  savAcc,
  salAmt,
  salWrd,
  salMonth,
  comments,
) {
  var amtNum = parseFloat(salAmt) || 0;
  var amtFmt = amtNum > 0 ? amtNum.toLocaleString("en-IN") : salAmt;

  var monthRow =
    salMonth && salMonth !== "—"
      ? '<tr><td class="lbl">पगार महिना / Salary Month</td>' +
        '<td class="val vbig" style="color:#1a3a5c;letter-spacing:0.3px">' +
        salMonth +
        "</td></tr>"
      : '<tr><td class="lbl">पगार महिना / Salary Month</td><td class="val">__________</td></tr>';

  var amtRow =
    amtNum > 0
      ? 'रू. <span style="font-size:13pt;font-weight:900;color:#1a3a5c">₹ ' +
        amtFmt +
        " /-</span>"
      : "रू. " + (salAmt || "___________") + " /-";

  var infoTbl =
    '<table class="it" style="margin:0"><colgroup>' +
    '<col style="width:35%"><col style="width:65%">' +
    "</colgroup>" +
    '<tr><td class="lbl">पूर्ण नाव / Name</td><td class="val vbig">' +
    nm +
    "</td></tr>" +
    '<tr><td class="lbl">दिनांक / Date</td><td class="val">' +
    dtFmt +
    "</td></tr>" +
    monthRow +
    '<tr><td class="lbl">बचत खाते / Saving Acc</td><td class="val vbig">' +
    savAcc +
    "</td></tr>" +
    '<tr style="background:#eef8f0">' +
    '<td class="lbl" style="font-size:10pt;color:#1a3a5c">वेतन रक्कम / Salary Amount</td>' +
    '<td class="val" style="font-size:11pt;font-weight:900">' +
    amtRow +
    "</td>" +
    "</tr>" +
    '<tr><td class="lbl">अक्षरी / In Words</td><td class="val" style="font-style:italic">' +
    (salWrd || "___________") +
    "</td></tr>" +
    (comments && comments !== "—"
      ? '<tr><td class="lbl">शेरा / Notes</td><td class="val">' +
        comments +
        "</td></tr>"
      : "") +
    "</table>";

  // Declaration
  var decl =
    '<div class="bp yl" style="font-size:9.5pt;line-height:2">' +
    "हे प्रमाणपत्र देण्यात येते की, " +
    "<strong>" +
    nm +
    "</strong> यांना " +
    (salMonth && salMonth !== "—"
      ? "<strong>" + salMonth + "</strong> महिन्याचे"
      : "सदर महिन्याचे") +
    " वेतन रू. <strong>₹ " +
    amtFmt +
    " /- (अक्षरी: " +
    (salWrd || "___________") +
    ")</strong> " +
    "संस्थेच्या नियमानुसार त्यांच्या बचत खाते क्र. <strong>" +
    savAcc +
    "</strong> मध्ये जमा करण्यात आले आहे." +
    "<br><br>वरील वेतन रक्कम प्राप्त झाल्याबद्दल मी खालीलप्रमाणे सही करतो/करते." +
    "</div>";

  // Accounts entry section
  var acctEntry =
    '<div class="bp gr" style="font-size:9pt">' +
    "<strong>खाते प्रविष्टी / Journal Entry:</strong><br>" +
    "Dr &nbsp;&nbsp; वेतन व भत्ते खाते (Salary & Allowances A/c 102-1) &nbsp;&nbsp; ₹ " +
    amtFmt +
    " /-<br>" +
    "Cr &nbsp;&nbsp; बचत खाते (Saving A/c " +
    savAcc +
    ") &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ₹ " +
    amtFmt +
    " /-" +
    "</div>";

  // Rules
  var rules =
    '<div class="rules">' +
    '<div class="rules-t">* वेतन अदायगी नियम व अटी *</div>' +
    '<div class="rule">वेतन रक्कम कर्मचाऱ्याच्या बचत खात्यात जमा करण्यात येते.</div>' +
    '<div class="rule">वेतन प्रत्येक महिन्याच्या ठरलेल्या तारखेला अदा केले जाते. तारीख बदलण्याचा अधिकार व्यवस्थापनास राहील.</div>' +
    '<div class="rule">कर वजावट (TDS), भविष्य निर्वाह निधी (PF) आणि इतर वैधानिक कपाती नियमांनुसार लागू राहतील.</div>' +
    '<div class="rule">कर्मचाऱ्याने वेतन पावतीवर सही करणे बंधनकारक आहे. सही नसल्यास वेतन अदायगी अवैध मानण्यात येईल.</div>' +
    '<div class="rule" style="border-bottom:none">कोणत्याही वेतन विषयक तक्रारी लेखी स्वरूपात व्यवस्थापकांकडे सादर कराव्यात.</div>' +
    "</div>";

  // Signature row
  var sigBlock =
    '<div style="display:flex;justify-content:space-between;padding:18px 24px 14px;border-top:1.5px solid #000;margin-top:4px">' +
    '<div style="text-align:center">' +
    '<div style="border-bottom:1.5px solid #000;height:22px;min-width:60mm;margin-bottom:5px"></div>' +
    '<div style="font-size:9.5pt;font-weight:700">' +
    nm +
    "</div>" +
    '<div style="font-size:8pt;color:#555">कर्मचाऱ्याची सही / Employee Signature</div>' +
    "</div>" +
    '<div style="text-align:center">' +
    '<div style="border-bottom:1.5px solid #000;height:22px;min-width:60mm;margin-bottom:5px"></div>' +
    '<div style="font-size:9.5pt;font-weight:700">प्राधिकृत अधिकारी</div>' +
    '<div style="font-size:8pt;color:#555">Authorised Officer</div>' +
    "</div>" +
    "</div>";

  return (
    '<div class="page">' +
    '<div class="ohdr">' +
    '<div class="ohdr-name">जळगाव जामोद अर्बन को-ऑपरेटीव्ह क्रेडीट सोसा.मर्या. जळगाव (जा.)जि.बुलढाणा र.नं.१०६७</div>' +
    "</div>" +
    '<div class="ftitle">✦ Employee Salary Voucher — वेतन पावती ✦</div>' +
    infoTbl +
    decl +
    acctEntry +
    rules +
    sigBlock +
    "</div>"
  );
}

// ═══════════════════════════════════════════════════════════════
//  SAVINGS WITHDRAWAL SLIP
//  savingsWithdrawalSlipPage(data)
//
//  data fields:
//    member_name     — खातेदाराचे नाव
//    account_number  — बचत खाते क्र. (string, each char = one digit box)
//    amount          — रक्कम (number)
//    amount_words    — अक्षरी (string, Marathi)
//    date            — दिनांक (DD/MM/YYYY string)
//    remarks         — शेरा (optional)
// ═══════════════════════════════════════════════════════════════
function savingsWithdrawalSlipPage(data) {
  // ── Helpers ─────────────────────────────────────────────────
  var nm = fv(data.member_name, "");
  var accRaw = fv(data.account_number, "");
  var amt = data.amount ? Number(data.amount).toLocaleString("en-IN") : "";
  var words = fv(data.amount_words, "");
  var remarks = fv(data.remarks, "");
  var dateStr = fv(data.date, "");

  // ── Date boxes: split DD/MM/YYYY into individual chars ──────
  // Accept "DD/MM/YYYY" or "DD-MM-YYYY"; pad to 8 digits
  var dateParts = dateStr.replace(/-/g, "/").split("/");
  var dd = (dateParts[0] || "").padStart(2, " ");
  var mm = (dateParts[1] || "").padStart(2, " ");
  var yyyy = (dateParts[2] || "").padStart(4, " ");
  var dateChars = (dd + mm + yyyy).split(""); // 8 chars
  var dateSeps = [2, 4]; // insert '/' after index 1 and 3

  function dateBoxes() {
    var html = "";
    for (var i = 0; i < 8; i++) {
      if (i === 2 || i === 4)
        html +=
          '<span style="font-weight:900;font-size:8pt;padding:0 1px">/</span>';
      html +=
        '<div style="width:13px;height:15px;border:1px solid #000;display:inline-flex;align-items:center;' +
        'justify-content:center;font-size:6.5pt;font-weight:700;vertical-align:middle">' +
        (dateChars[i] || "") +
        "</div>";
    }
    return html;
  }

  // ── Account number digit boxes ───────────────────────────────
  // Show up to 12 boxes; each char of accRaw fills one box
  var accChars = accRaw.split("");
  while (accChars.length < 12) accChars.push("");
  function digitBoxes() {
    var html = "";
    for (var i = 0; i < 12; i++) {
      var borderLeft = i === 0 ? "1px solid #000" : "none";
      html +=
        '<div style="width:17px;height:19px;border:1px solid #000;border-left:' +
        borderLeft +
        ";" +
        "display:inline-flex;align-items:center;justify-content:center;" +
        'font-size:7.5pt;font-weight:700;vertical-align:middle">' +
        (accChars[i] || "") +
        "</div>";
    }
    return html;
  }

  // ── Build one slip ───────────────────────────────────────────
  function oneSlip() {
    return (
      '<div style="border:2px solid #000;width:100%;box-sizing:border-box;' +
      "font-family:'Noto Sans Devanagari','Mangal',Arial,sans-serif;font-size:8pt;color:#000;background:#fff\">" +
      // ── HEADER ──────────────────────────────────────────────
      '<div style="display:flex;align-items:stretch;border-bottom:2px solid #000;min-height:36px">' +
      '<div style="flex:1;padding:3px 8px;display:flex;flex-direction:column;justify-content:center;border-right:1.5px solid #000">' +
      '<div style="font-size:9pt;font-weight:900;line-height:1.25">' +
      "जळगाव जामोद अर्बन को-ऑप. क्रेडीट सोसायटी मर्या. जळगाव (जा.) जि.बुलढाणा" +
      "</div>" +
      '<div style="font-size:6pt;color:#444;margin-top:1px;line-height:1.3">' +
      "बँकेतून पैसे काढावयाच्या चलनाबरोबर खाते पुस्तिका आवश्यक आहे. कृपया मागे सही करावी. हे चलन म्हणजे चेक नव्हे. केवळ मूळ शाखेत वापरण्यासाठी." +
      "</div>" +
      "</div>" +
      '<div style="padding:2px 6px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:86px">' +
      '<div style="font-size:7pt;font-weight:800;margin-bottom:2px">दिनांक :</div>' +
      '<div style="display:flex;align-items:center;gap:1px">' +
      dateBoxes() +
      "</div>" +
      "</div>" +
      "</div>" +
      // ── TITLE ────────────────────────────────────────────────
      '<div style="text-align:center;border-bottom:2px solid #000;padding:2px 4px;font-size:9.5pt;font-weight:900;background:#efefef;' +
      "font-family:'Noto Serif Devanagari','Mangal',serif\">" +
      "✦ रोख उचल चलन — बचत खाते ✦" +
      "</div>" +
      // ── TABLE BODY ───────────────────────────────────────────
      '<table style="width:100%;border-collapse:collapse;font-size:8pt">' +
      // Row 1: कृपया मला वा धारकाला
      "<tr>" +
      '<td style="border:1px solid #000;padding:2px 5px;background:#d8d8d8;font-weight:800;font-size:7.5pt;white-space:nowrap;vertical-align:middle">' +
      "कृपया, मला वा धारकाला ₹" +
      "</td>" +
      '<td style="border:1px solid #000;padding:2px 5px;font-weight:700;font-style:italic;vertical-align:middle" colspan="2">' +
      words +
      "</td>" +
      '<td style="border:1px solid #000;padding:2px 5px;background:#d8d8d8;font-weight:800;font-size:7pt;text-align:right;vertical-align:middle;width:16%">' +
      "नावे टाकणे debiting" +
      "</td>" +
      "</tr>" +
      // Row 2: बचत खाते क्र.
      "<tr>" +
      '<td style="border:1px solid #000;padding:2px 5px;background:#d8d8d8;font-weight:800;font-size:7.5pt;white-space:nowrap;vertical-align:middle">' +
      "बचत खाते क्र." +
      "</td>" +
      '<td style="border:1px solid #000;padding:2px 5px;vertical-align:middle" colspan="2">' +
      '<div style="display:inline-flex;vertical-align:middle">' +
      digitBoxes() +
      "</div>" +
      "</td>" +
      '<td style="border:1px solid #000;padding:2px 5px;font-size:7pt;font-weight:700;text-align:center;background:#f5f5f5;vertical-align:middle">' +
      "ला नावे टाकून<br>रोख द्यावे" +
      "</td>" +
      "</tr>" +
      // Row 3: खातेदाराचे नाव + ₹ amount
      "<tr>" +
      '<td style="border:1px solid #000;padding:2px 5px;background:#d8d8d8;font-weight:800;font-size:7.5pt;white-space:nowrap;vertical-align:middle">' +
      "खातेदाराचे नाव" +
      "</td>" +
      '<td style="border:1px solid #000;padding:2px 5px;font-size:9.5pt;font-weight:900;vertical-align:middle" colspan="2">' +
      nm +
      "</td>" +
      '<td style="border:1px solid #000;padding:0;vertical-align:middle">' +
      '<div style="display:flex;height:100%;min-height:26px">' +
      '<div style="background:#111;color:#fff;font-size:13pt;font-weight:900;width:26px;display:flex;align-items:center;justify-content:center;flex-shrink:0">₹</div>' +
      '<div style="font-size:10.5pt;font-weight:900;padding:2px 7px;display:flex;align-items:center">' +
      amt +
      " /-</div>" +
      "</div>" +
      "</td>" +
      "</tr>" +
      // Row 4: शेरा
      "<tr>" +
      '<td style="border:1px solid #000;padding:2px 5px;background:#d8d8d8;font-weight:800;font-size:7.5pt;white-space:nowrap;vertical-align:middle">' +
      "शेरा" +
      "</td>" +
      '<td style="border:1px solid #000;padding:2px 5px;font-weight:700;vertical-align:middle" colspan="3">' +
      (remarks !== "—" ? remarks : "&nbsp;") +
      "</td>" +
      "</tr>" +
      "</table>" +
      // ── SIGNATURE ROW ────────────────────────────────────────
      '<div style="display:flex;border-top:1.5px solid #000;background:#fafafa;min-height:44px">' +
      // Left: खातेदाराची स्वाक्षरी + name + space
      '<div style="flex:1;display:flex;align-items:flex-end;border-right:1.5px solid #000;padding:4px 8px 4px;gap:6px">' +
      "<div>" +
      '<div style="font-size:6.5pt;font-weight:800;white-space:nowrap;line-height:1.4">खातेदाराची स्वाक्षरी</div>' +
      '<div style="font-size:7.5pt;font-weight:900;margin-top:2px">' +
      nm +
      "</div>" +
      "</div>" +
      '<div style="flex:1;border-bottom:1px solid #999;min-height:1px;margin-bottom:2px"></div>' +
      "</div>" +
      // Right: लेखापाल / अधिकारी + space
      '<div style="flex:1;display:flex;align-items:flex-end;padding:4px 8px 4px;gap:6px">' +
      '<div style="font-size:6.5pt;font-weight:800;white-space:nowrap;line-height:1.4">लेखापाल / अधिकारी</div>' +
      '<div style="flex:1;border-bottom:1px solid #999;min-height:1px;margin-bottom:2px"></div>' +
      "</div>" +
      "</div>" +
      "</div>" // end slip wrapper
    );
  }

  // ── Two slips per page (office + office — print 2x on one A4) ──
  return (
    '<div class="spage" style="padding:8px 10px">' +
    oneSlip() +
    '<hr class="sdiv" style="margin:8px 0">' +
    oneSlip() +
    "</div>"
  );
}
