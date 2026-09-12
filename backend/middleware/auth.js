'use strict';

const path = require('path');
const fs   = require('fs');

// ── Session persistence ────────────────────────────────────────────────────
// Sessions are saved to disk so pm2 restarts don't log everyone out.
const SESSION_FILE = path.join(__dirname, '..', '.sessions.json');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const sessions = new Map(); // token -> { id, username, role, expiresAt }

// Load saved sessions from disk on startup
function loadSessionsFromDisk() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      const now = Date.now();
      let loaded = 0, skipped = 0;
      for (const [token, sess] of Object.entries(raw)) {
        // Validate session shape before restoring
        if (sess && sess.expiresAt && sess.id && sess.username && sess.role) {
          if (sess.expiresAt > now) {
            sessions.set(token, sess);
            loaded++;
          } else {
            skipped++;
          }
        }
      }
      console.log(`[auth] Restored ${loaded} session(s) from disk (${skipped} expired, skipped)`);
    }
  } catch (e) {
    console.warn('[auth] Could not load sessions from disk:', e.message);
  }
}

function saveSessionsToDisk() {
  // Atomic write: write to a temp file then rename so a crash mid-write
  // never corrupts the session store (avoids everyone getting logged out).
  const tmp = SESSION_FILE + '.tmp';
  try {
    const obj = {};
    for (const [token, sess] of sessions) obj[token] = sess;
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, SESSION_FILE);
  } catch (e) {
    console.warn('[auth] Could not save sessions to disk:', e.message);
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

loadSessionsFromDisk();

// FIX: getSession() slides expiresAt forward on every call but previously
// never persisted that change — only login/logout/prune called
// saveSessionsToDisk(). If PM2 restarted between a user's last activity and
// their session's *original* (pre-slide) expiry, the disk copy still had
// the stale, earlier expiresAt, so an actively-working user could be
// silently logged out on restart. Debounce the write instead of doing sync
// disk I/O on every authenticated request (which every slide would
// otherwise trigger).
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveSessionsToDisk();
  }, 5000);
  saveTimer.unref(); // don't keep the process alive just for this timer
}

function createSession(user) {
  const token = require('crypto').randomBytes(32).toString('hex');
  sessions.set(token, {
    id:        user.id,
    username:  user.username,
    role:      user.role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  saveSessionsToDisk();
  return token;
}

function getSession(token) {
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expiresAt) {
    sessions.delete(token);
    saveSessionsToDisk();
    return null;
  }
  // Slide the expiry on activity
  sess.expiresAt = Date.now() + SESSION_TTL_MS;
  scheduleSave();
  return sess;
}

function deleteSession(token) {
  sessions.delete(token);
  saveSessionsToDisk();
}

// Prune expired sessions every 30 minutes
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [token, sess] of sessions) {
    if (now > sess.expiresAt) { sessions.delete(token); changed = true; }
  }
  if (changed) saveSessionsToDisk();
}, 30 * 60 * 1000);

// FIX #2: middleware that protects every route it is applied to
// Also accepts token from query string (?token=) for window.open / download links
function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  const sess  = getSession(token);
  if (!sess) return res.status(401).json({ error: 'Not authenticated' });
  req.session = sess;
  next();
}

// Role-based access: requireRole('admin') — call after requireAuth
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { sessions, createSession, getSession, deleteSession, requireAuth, requireRole };
