'use strict';
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── Pure calculation functions (no DB needed) ─────────────────────────────

// Simple interest: I = P × R × T / 100
function simpleInterest(principal, ratePercent, days) {
  const interest = (principal * ratePercent * days) / (100 * 365);
  return { principal, rate: ratePercent, days, interest: round(interest), total: round(principal + interest) };
}

// Compound interest: A = P(1 + R/n)^(nT)
function compoundInterest(principal, ratePercent, months, compoundsPerYear = 4) {
  const r = ratePercent / 100;
  const t = months / 12;
  const n = compoundsPerYear;
  const amount   = principal * Math.pow(1 + r / n, n * t);
  const interest = amount - principal;
  return { principal, rate: ratePercent, months, compounds_per_year: n, interest: round(interest), total: round(amount) };
}

// FD maturity: compound quarterly (standard Indian bank practice)
function fdMaturity(principal, ratePercent, months) {
  return compoundInterest(principal, ratePercent, months, 4);
}

// Gold loan interest: simple, calculated daily.
// Gold loans also carry a handling/appraisal charge of ₹200 per ₹1,00,000
// of principal (rounded UP to the next slab — a loan of any size up to
// ₹1,00,000 is one slab), added on top of the plain interest. This charge
// is specific to gold loans (tied to the physical gold appraisal) — callers
// reusing this same simple-interest math for a different loan type (e.g.
// OD Loan, via the Account Search feature) pass applyLakhCharge=false.
function goldLoanInterest(principal, ratePercent, fromDate, toDate, applyLakhCharge) {
  const from = new Date(fromDate);
  const to   = toDate ? new Date(toDate) : new Date();
  // Both the disbursal day and the closing/calculation day are chargeable
  // days (bank convention), so the day count is inclusive of both ends —
  // e.g. 21-Jan to 09-Sep is 232 days, not 231.
  const days = Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24))) + 1;
  // Minimum billing period: a loan open for less than a month is still
  // charged a full month's interest (bank convention). `days` in the
  // response stays the TRUE elapsed day count (for display); only the
  // interest math below uses the floored "billed" day count.
  const billedDays = Math.max(days, 30);
  const base = simpleInterest(principal, ratePercent, billedDays);
  base.days = days;
  const toDateStr = to.toISOString().split('T')[0];

  if (!applyLakhCharge) {
    return { ...base, from_date: fromDate, to_date: toDateStr };
  }

  const lakhChargeAmount = Math.ceil(principal / 100000) * 200;
  const interestFinal    = round(base.interest + lakhChargeAmount);
  return {
    principal,
    rate: ratePercent,
    days,
    interest_before_charge: base.interest,
    lakh_charge_amount: lakhChargeAmount,
    interest: interestFinal,
    total: round(principal + interestFinal),
    from_date: fromDate,
    to_date: toDateStr,
  };
}

// EMI calculator: E = P × r × (1+r)^n / ((1+r)^n - 1)
function emiCalculator(principal, annualRatePercent, tenureMonths) {
  const r = (annualRatePercent / 100) / 12;
  if (r === 0) {
    const emi = principal / tenureMonths;
    return { principal, rate: annualRatePercent, tenure_months: tenureMonths, emi: round(emi), total_payment: round(emi * tenureMonths), total_interest: 0 };
  }
  const emi     = principal * r * Math.pow(1 + r, tenureMonths) / (Math.pow(1 + r, tenureMonths) - 1);
  const total   = emi * tenureMonths;
  const interest = total - principal;
  return { principal, rate: annualRatePercent, tenure_months: tenureMonths, emi: round(emi), total_payment: round(total), total_interest: round(interest) };
}

// Amortization schedule
// BUG FIX: this had no r === 0 guard, unlike emiCalculator above. With a
// genuine 0% rate, Math.pow(1+0, n) - 1 === 0, so emi was 0/0 = NaN and
// every row in the schedule came back NaN. (Previously unreachable anyway
// because the route below rejected rate=0 outright — fixed below too.)
function amortizationSchedule(principal, annualRatePercent, tenureMonths) {
  const r   = (annualRatePercent / 100) / 12;
  const emi = r === 0
    ? principal / tenureMonths
    : principal * r * Math.pow(1 + r, tenureMonths) / (Math.pow(1 + r, tenureMonths) - 1);
  let balance = principal;
  const schedule = [];
  for (let m = 1; m <= tenureMonths; m++) {
    const interest  = balance * r;
    const principal_part = emi - interest;
    balance -= principal_part;
    schedule.push({
      month:          m,
      emi:            round(emi),
      principal_part: round(principal_part),
      interest_part:  round(interest),
      balance:        round(Math.max(0, balance)),
    });
  }
  return schedule;
}

function round(n) { return Math.round(n * 100) / 100; }

// BUG FIX: every route below used `if (!principal || !rate || !days)` etc.
// to check for required fields. In JavaScript `!0` is `true`, so a
// genuinely valid 0% interest rate (interest-free loan/scheme) was rejected
// as "required" before ever reaching the calculation — even though
// emiCalculator already has correct r===0 handling that this bug made
// unreachable. isMissing() only rejects values that are actually absent.
function isMissing(v) {
  return v === undefined || v === null || v === '';
}

// ── Routes ────────────────────────────────────────────────────────────────

// POST /api/interest/simple
// Body: { principal, rate, days }
router.post('/simple', (req, res) => {
  try {
    const { principal, rate, days } = req.body;
    if (isMissing(principal) || isMissing(rate) || isMissing(days)) {
      return res.status(400).json({ error: 'principal, rate, days required' });
    }
    res.json(simpleInterest(parseFloat(principal), parseFloat(rate), parseInt(days)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/interest/gold-loan
// Body: { principal, rate, from_date, to_date?, apply_gold_charge? }
// apply_gold_charge defaults to true — this endpoint is specifically for
// Gold Loan calculations, which include the ₹200-per-₹1,00,000-slab
// handling/appraisal charge. Pass apply_gold_charge:false when reusing this
// same simple-interest math for a non-gold rate (e.g. OD Loan).
router.post('/gold-loan', (req, res) => {
  try {
    const { principal, rate, from_date, to_date, apply_gold_charge } = req.body;
    if (isMissing(principal) || isMissing(rate) || isMissing(from_date)) {
      return res.status(400).json({ error: 'principal, rate, from_date required' });
    }
    const applyCharge = apply_gold_charge !== false;
    res.json(goldLoanInterest(parseFloat(principal), parseFloat(rate), from_date, to_date, applyCharge));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/interest/fd
// Body: { principal, rate, months }
router.post('/fd', (req, res) => {
  try {
    const { principal, rate, months } = req.body;
    if (isMissing(principal) || isMissing(rate) || isMissing(months)) {
      return res.status(400).json({ error: 'principal, rate, months required' });
    }
    res.json(fdMaturity(parseFloat(principal), parseFloat(rate), parseInt(months)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/interest/emi
// Body: { principal, rate, tenure_months }
router.post('/emi', (req, res) => {
  try {
    const { principal, rate, tenure_months } = req.body;
    if (isMissing(principal) || isMissing(rate) || isMissing(tenure_months)) {
      return res.status(400).json({ error: 'principal, rate, tenure_months required' });
    }
    res.json(emiCalculator(parseFloat(principal), parseFloat(rate), parseInt(tenure_months)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/interest/amortization
// Body: { principal, rate, tenure_months }
router.post('/amortization', (req, res) => {
  try {
    const { principal, rate, tenure_months } = req.body;
    if (isMissing(principal) || isMissing(rate) || isMissing(tenure_months)) {
      return res.status(400).json({ error: 'principal, rate, tenure_months required' });
    }
    const schedule = amortizationSchedule(parseFloat(principal), parseFloat(rate), parseInt(tenure_months));
    res.json({ schedule, summary: emiCalculator(parseFloat(principal), parseFloat(rate), parseInt(tenure_months)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
module.exports.simpleInterest  = simpleInterest;
module.exports.fdMaturity      = fdMaturity;
module.exports.goldLoanInterest = goldLoanInterest;
module.exports.emiCalculator   = emiCalculator;

/*
── ADD TO server.js ──────────────────────────────────────────────────────────
  app.use('/api/interest', require('./features/interest/interest.routes'));
*/
