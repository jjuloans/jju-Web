'use strict';
const pool = require('../db/pool');

// ── SMS provider abstraction ──────────────────────────────────────────────
// Supports: MSG91 (India, recommended), Twilio, or console mock
// Set SMS_PROVIDER=msg91|twilio|mock in .env

async function sendSMS(to, message) {
  const provider = process.env.SMS_PROVIDER || 'mock';

  if (provider === 'msg91') {
    return sendViaMSG91(to, message);
  } else if (provider === 'twilio') {
    return sendViaTwilio(to, message);
  } else {
    // mock / dev mode — just log
    console.log(`[SMS MOCK] To: ${to} | Message: ${message}`);
    return { ok: true, provider: 'mock' };
  }
}

// ── MSG91 (best for India, supports DLT templates) ────────────────────────
async function sendViaMSG91(to, message) {
  const authKey  = process.env.MSG91_AUTH_KEY;
  const senderId = process.env.MSG91_SENDER_ID || 'JJUBNK';
  const route    = process.env.MSG91_ROUTE    || '4'; // 4 = transactional

  if (!authKey) throw new Error('MSG91_AUTH_KEY not set in .env');

  // Normalize Indian mobile number
  const mobile = String(to).replace(/\D/g, '');
  const normalized = mobile.startsWith('91') ? mobile : `91${mobile}`;

  const resp = await fetch('https://api.msg91.com/api/v2/sendsms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: authKey },
    body: JSON.stringify({
      sender: senderId,
      route,
      country: '91',
      sms: [{ message, to: [normalized] }],
    }),
  });
  const data = await resp.json();
  if (data.type !== 'success') throw new Error(data.message || 'MSG91 error');
  return { ok: true, provider: 'msg91', response: data };
}

// ── Twilio ────────────────────────────────────────────────────────────────
async function sendViaTwilio(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) throw new Error('Twilio env vars not set');

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${credentials}` },
    body: new URLSearchParams({ To: to, From: from, Body: message }),
  });
  const data = await resp.json();
  if (data.error_code) throw new Error(data.error_message);
  return { ok: true, provider: 'twilio', sid: data.sid };
}

// ── Log SMS to DB ─────────────────────────────────────────────────────────
async function ensureSmsLogTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_log (
      id          SERIAL PRIMARY KEY,
      mobile      TEXT,
      message     TEXT,
      type        TEXT,
      record_id   INTEGER,
      status      TEXT DEFAULT 'sent',
      error       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
ensureSmsLogTable().catch(() => {});

async function sendAndLog(mobile, message, type = 'general', record_id = null) {
  let status = 'sent', error = null;
  try {
    await sendSMS(mobile, message);
  } catch (err) {
    status = 'failed'; error = err.message;
    console.error('[SMS] failed:', err.message);
  }
  await pool.query(
    `INSERT INTO sms_log (mobile, message, type, record_id, status, error) VALUES ($1,$2,$3,$4,$5,$6)`,
    [mobile, message, type, record_id, status, error]
  ).catch(() => {});
  return { ok: status === 'sent', error };
}

// ── Pre-built message templates ───────────────────────────────────────────
const templates = {
  loanOpened:   (name, accNo, amt)       => `Dear ${name}, your Gold Loan A/C ${accNo} of Rs.${amt} has been opened at JJU Bank. -JJUBNK`,
  loanClosed:   (name, accNo)            => `Dear ${name}, your Gold Loan A/C ${accNo} has been closed successfully. Thank you. -JJUBNK`,
  fdOpened:     (name, accNo, amt, date) => `Dear ${name}, FD A/C ${accNo} of Rs.${amt} opened. Maturity: ${date}. -JJUBNK`,
  fdMaturity:   (name, accNo, date)      => `Dear ${name}, your FD A/C ${accNo} matures on ${date}. Contact us to renew. -JJUBNK`,
  overdueAlert: (name, accNo, days)      => `Dear ${name}, your Gold Loan A/C ${accNo} is ${days} days old. Please visit JJU Bank. -JJUBNK`,
  otp:          (otp)                    => `Your JJU Bank OTP is ${otp}. Valid for 10 minutes. Do not share. -JJUBNK`,
};

module.exports = { sendSMS, sendAndLog, templates };

/*
── .env additions ────────────────────────────────────────────────────────────
  SMS_PROVIDER=msg91        # or twilio or mock
  MSG91_AUTH_KEY=your_key
  MSG91_SENDER_ID=JJUBNK
  # OR for Twilio:
  TWILIO_ACCOUNT_SID=ACxxx
  TWILIO_AUTH_TOKEN=xxx
  TWILIO_FROM_NUMBER=+1234567890

── USAGE IN A CONTROLLER ────────────────────────────────────────────────────
  const { sendAndLog, templates } = require('../features/sms/sms.service');

  // After creating a gold loan record:
  if (mobile) {
    await sendAndLog(mobile, templates.loanOpened(name, account_no, loan_amount), 'loan_opened', id);
  }
*/
