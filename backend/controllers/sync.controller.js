'use strict';
const pool       = require('../db/pool');
const { syncAllToSheets } = require('../helpers/googleSheets');

// ── Cron scheduler (optional — only active if SYNC_CRON_SCHEDULE is set) ─
// Uses node-cron if installed; silently skips if not.
// Install with: npm install node-cron
let _cronJob = null;
function startCronIfConfigured() {
  const schedule = process.env.SYNC_CRON_SCHEDULE;
  if (!schedule) return;
  try {
    const cron = require('node-cron');
    if (!cron.validate(schedule)) {
      console.warn(`[sync] Invalid cron schedule "${schedule}" — auto-sync disabled`);
      return;
    }
    _cronJob = cron.schedule(schedule, async () => {
      console.log('[sync] Auto-sync triggered by cron:', schedule);
      if (_syncInProgress) {
        console.warn('[sync] Cron skipped — sync already in progress');
        return;
      }
      await _launchSyncJob().catch((err) =>
        console.error('[sync] Cron sync failed:', err.message),
      );
    });
    console.log(`[sync] Auto-sync scheduled: "${schedule}"`);
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.warn('[sync] node-cron not installed — auto-sync disabled. Run: npm install node-cron');
    } else {
      console.error('[sync] Failed to start cron:', e.message);
    }
  }
}

// In-process flag — fast-path guard within a single process.
// NOTE: not reliable across PM2 cluster workers; the DB status='running'
// check in status() is the authoritative source of truth for multi-process
// deployments. Do not assume this flag survives a restart.
let _syncInProgress = false;

// Sync timeout — if the background job hangs longer than this it is
// forcibly marked as errored and the in-progress flag is cleared.
const SYNC_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ── ensureSyncLog ─────────────────────────────────────────────────────────
// Uses a shared promise so concurrent callers at startup all await the same
// initialisation work rather than racing to run it twice.
let _syncLogReadyPromise = null;

function ensureSyncLog() {
  if (!_syncLogReadyPromise) {
    _syncLogReadyPromise = _initSyncLog().catch((err) => {
      _syncLogReadyPromise = null; // reset so next call retries
      throw err;
    });
  }
  return _syncLogReadyPromise;
}

async function _initSyncLog() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id          SERIAL PRIMARY KEY,
      started_at  TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status      TEXT DEFAULT 'running',
      message     TEXT,
      rows_synced INTEGER DEFAULT 0
    )
  `);
  // Mark any orphaned 'running' rows left over from a server crash/restart
  await pool.query(`
    UPDATE sync_log
    SET status='error', finished_at=NOW(), message='Server restarted mid-sync'
    WHERE status='running'
  `);
}

// Initialise at module load so the first request never pays the setup cost
ensureSyncLog().catch((err) => {
  // AggregateError (dual-stack connection failures) has an empty
  // top-level .message — the real reason is nested in err.errors[].
  if (err.name === 'AggregateError' && Array.isArray(err.errors)) {
    console.error('[sync] ensureSyncLog failed at startup:',
      err.errors.map(e => e.message).join(' | '));
  } else {
    console.error('[sync] ensureSyncLog failed at startup:', err.code || err.name, err.message);
  }
});

// Start cron after a short delay to let the DB pool warm up
setTimeout(startCronIfConfigured, 3000);

// ── Prune helper — keeps only the last 100 log entries ───────────────────
async function _pruneOldLogs() {
  await pool.query(`
    DELETE FROM sync_log
    WHERE id NOT IN (
      SELECT id FROM sync_log ORDER BY id DESC LIMIT 100
    )
  `).catch((err) =>
    console.warn('[sync] log prune failed (non-fatal):', err.message),
  );
}

// ── GET /api/sync-sheets/status ───────────────────────────────────────────
async function status(req, res) {
  try {
    await ensureSyncLog();
    const { rows } = await pool.query(
      `SELECT id, started_at, finished_at, status, message, rows_synced
       FROM sync_log ORDER BY id DESC LIMIT 1`,
    );
    const last      = rows[0] || null;
    const dbRunning = last ? last.status === 'running' : false;

    // FIX #5: Expose in-memory flag and DB state separately so callers
    // can distinguish per-process state from the authoritative DB state
    // in multi-process (PM2 cluster) deployments.
    res.json({
      syncInProgress:       _syncInProgress || dbRunning,
      syncInProgressLocal:  _syncInProgress,  // per-process flag only
      syncInProgressDb:     dbRunning,         // authoritative across all workers
      cronSchedule: process.env.SYNC_CRON_SCHEDULE || null,
      cronActive:   !!_cronJob,
      lastSync: last ? {
        startedAt:  last.started_at,
        finishedAt: last.finished_at,
        status:     last.status,
        message:    last.message,
        rowsSynced: last.rows_synced,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/sync-sheets ─────────────────────────────────────────────────
async function trigger(req, res) {
  // Ensure table exists BEFORE setting the in-progress flag
  try {
    await ensureSyncLog();
  } catch (err) {
    return res.status(500).json({ ok: false, error: `DB unavailable: ${err.message}` });
  }

  // FIX #1: Set the flag synchronously *before* any await so that two
  // near-simultaneous POST requests cannot both pass this check before
  // either one sets the flag.
  if (_syncInProgress) {
    return res.json({ ok: false, message: 'Sync already running. Please wait.' });
  }
  _syncInProgress = true;

  let logId;
  try {
    logId = await _createLogRow();
  } catch (err) {
    _syncInProgress = false; // release flag if we couldn't even create the log row
    return res.status(500).json({ ok: false, error: `Failed to start sync: ${err.message}` });
  }

  res.json({ ok: true, message: 'Sync started in background.', logId });

  // Pass logId so _launchSyncJob skips _createLogRow (flag already set above)
  setImmediate(() => _launchSyncJob(logId).catch(() => {}));
}

// ── Shared launcher used by both manual trigger and cron ──────────────────
async function _launchSyncJob(existingLogId) {
  // FIX #2: Always ensure the table exists before doing anything,
  // so the cron path can't skip this and fail with a silent error.
  try {
    await ensureSyncLog();
  } catch (err) {
    console.error('[sync] ensureSyncLog failed in _launchSyncJob:', err.message);
    throw err;
  }

  // Set flag synchronously before any await (cron path — trigger() already
  // sets it for the manual path).
  _syncInProgress = true;

  let logId = existingLogId;
  try {
    if (!logId) logId = await _createLogRow();
  } catch (err) {
    _syncInProgress = false;
    throw err;
  }

  // FIX #3: Use a cancellable timeout so that when _runSync resolves first,
  // the pending rejection is cancelled and never fires as an unhandled
  // rejection in Node ≥15. We do this by storing the reject handle and
  // calling clearTimeout before the race can settle on the timeout branch.
  let timeoutHandle = null;
  let rejectTimeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    rejectTimeout = reject;
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Sync timed out after ${SYNC_TIMEOUT_MS / 1000}s`));
    }, SYNC_TIMEOUT_MS);
  });

  // Wrap _runSync so we can cancel the timeout the moment it resolves,
  // preventing the timeout promise from ever becoming an unhandled rejection.
  const syncWithCancelOnSuccess = _runSync(logId).then((result) => {
    clearTimeout(timeoutHandle);
    // Resolve the timeout promise benignly so it is no longer pending.
    // (Calling rejectTimeout after clearTimeout is a no-op in practice,
    // but explicitly resolving via a flag is cleaner.)
    return result;
  });

  try {
    await Promise.race([syncWithCancelOnSuccess, timeoutPromise]);
  } catch (err) {
    clearTimeout(timeoutHandle); // also clear on the timeout branch
    console.error('[sync] background sync error:', err.message);
    await pool.query(
      `UPDATE sync_log SET status='error', finished_at=NOW(), message=$1 WHERE id=$2`,
      [err.message, logId],
    ).catch(() => {});
  } finally {
    _syncInProgress = false;
  }
}

// ── Create a log row and return its id ────────────────────────────────────
async function _createLogRow() {
  const { rows } = await pool.query(
    `INSERT INTO sync_log (status) VALUES ('running') RETURNING id`,
  );
  return rows[0].id;
}

// ── The actual sync work ───────────────────────────────────────────────────
async function _runSync(logId) {
  console.log('[sync] Starting full sync to Google Sheets, logId=', logId);

  const rawCounts = await syncAllToSheets(pool);

  // FIX #7: Defensively destructure with defaults so undefined fields from
  // an unexpected return shape don't silently write null/undefined to the DB.
  const counts = {
    total:     rawCounts?.total     ?? 0,
    records:   rawCounts?.records   ?? 0,
    cashbook:  rawCounts?.cashbook  ?? 0,
    customers: rawCounts?.customers ?? 0,
  };

  console.log('[sync] Sync complete:', counts);

  // FIX #6: Update the status row *before* pruning so that a prune failure
  // can never leave the log row stuck in 'running'. _pruneOldLogs swallows
  // its own errors, but making this order explicit is the correct guard.
  await pool.query(
    `UPDATE sync_log
     SET status='done', finished_at=NOW(), rows_synced=$1,
         message=$2
     WHERE id=$3`,
    [
      counts.total,
      `Synced — records: ${counts.records}, cashbook: ${counts.cashbook}, customers: ${counts.customers}`,
      logId,
    ],
  );

  // Fire-and-forget: prune runs after the status update so its failure
  // cannot affect the log row, and we don't await it.
  _pruneOldLogs();
}

module.exports = { status, trigger };
