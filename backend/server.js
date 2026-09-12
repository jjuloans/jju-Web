"use strict";

// ── Load .env before anything else ──────────────────────────────────────────
// ENV_FILE lets a second, independent copy of this app point at a different
// database/port without touching any existing setup: the default (ENV_FILE
// unset) behaves exactly as before and loads .env from the current
// directory. To run a staging copy side by side with production, copy
// .env.example to .env.staging (point DB_NAME at a separate staging
// database and PORT at a free port), then run e.g.
//   cross-env ENV_FILE=.env.staging PORT=4002 node backend/server.js
// (see the "dev:staging" / "pm2:staging" npm scripts in package.json).
require("dotenv").config({ path: process.env.ENV_FILE || undefined });

const os = require("os");
const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const PLATFORM = IS_WINDOWS ? "Windows" : IS_MAC ? "macOS" : "Linux";

// ── Validate required environment variables ──────────────────────────────────
const _REQUIRED_ENV = ["DB_NAME", "DB_PASSWORD"];
const _missingEnv = _REQUIRED_ENV.filter((k) => !process.env[k]);
if (_missingEnv.length) {
  console.error("\n  Missing required environment variables:");
  _missingEnv.forEach((k) => console.error(`   - ${k}`));
  console.error("\n  Create a .env file in the backend/ folder. Example:\n");
  console.error("    DB_NAME=jju_bank");
  console.error("    DB_PASSWORD=yourpassword");
  console.error("    DB_USER=jju_user");
  console.error("    DB_HOST=localhost");
  console.error("    DB_PORT=5432");
  console.error("    PORT=4001\n");
  process.exit(1);
}

const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const errorHandler = require("./middleware/errorHandler");
const { runMigrations } = require("./db/migrations");

const app = express();
const PORT = parseInt(process.env.PORT || "4001", 10);

// ── Helmet (security headers) ─────────────────────────────────────────────────
app.use(helmet({
  // LAN-only plain HTTP server — HSTS tells browsers "always use https for
  // this host", which Helmet sends by default even over http. A phone that
  // ever saw this header (e.g. via a previous ngrok/tunnel/https setup) will
  // cache that policy and silently rewrite http://<ip>:4001 to https://,
  // which then fails to connect since there's no TLS listener here.
  hsts: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "blob:"],
      frameSrc:   ["'self'", "blob:"],
      connectSrc:    ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      // Explicitly disable — Helmet adds upgrade-insecure-requests by default,
      // which rewrites http:// asset requests to https://, breaking this
      // plain-HTTP LAN server on all browsers.
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── Compression ───────────────────────────────────────────────────────────────
app.use(compression());

if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`  Invalid PORT "${process.env.PORT}" -- must be 1-65535`);
  process.exit(1);
}

// ── Detect all local network IPs at startup ──────────────────────────────────
// os.networkInterfaces() works identically on Windows, Mac, and Linux.
// We use this to (a) show friendly URLs in the startup banner and
// (b) auto-whitelist the server's own IPs in CORS.
// OPTIMIZATION: Cache result to avoid calling os.networkInterfaces() multiple times
// (can be 100-500ms on Windows, especially with many adapters or VMs)
let _cachedLocalIPs = null;
function getLocalIPs() {
  if (_cachedLocalIPs) return _cachedLocalIPs;

  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  _cachedLocalIPs = ips;
  return ips;
}

// ── CORS ─────────────────────────────────────────────────────────────────────
// Priority order:
//   1. No Origin header (curl / Postman / same-origin)  -> allow
//   2. Explicitly listed in ALLOWED_ORIGINS .env var    -> allow
//   3. Server's own detected network IPs                -> allow
//   4. Any private LAN range (192.168 / 10. / 172.16+) -> allow
//   5. Everything else                                  -> block + log
//
// Result: works on any WiFi network without ever editing .env.

const _explicitOrigins = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
]);

// RFC-1918 private IP ranges
const _privateIP =
  /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

// Own IPs discovered at startup (handles VMs / unusual network configs)
const _ownOrigins = new Set(getLocalIPs().map((ip) => `http://${ip}:${PORT}`));

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (_explicitOrigins.has(origin)) return cb(null, true);
      if (_ownOrigins.has(origin)) return cb(null, true);
      if (_privateIP.test(origin)) return cb(null, true);
      console.warn(`  CORS blocked origin: ${origin}`);
      cb(new Error(`CORS: origin not allowed -- ${origin}`));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// General API limit: 500 req/min per IP (generous for LAN bank app)
const _apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down" },
  skip: (req) => !req.path.startsWith("/api/"),
});
// Strict limit on auth endpoints: 20 req/min per IP
const _authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts — try again in a minute" },
});
app.use(_apiLimiter);
app.use("/api/auth", _authLimiter);

// ── safeRequire ──────────────────────────────────────────────────────────────
// path.resolve() handles both Windows backslash and Unix slash paths.
function safeRequire(modulePath) {
  try {
    return require(path.resolve(__dirname, modulePath));
  } catch (e) {
    console.error(`\n  Could not load "${modulePath}": ${e.message}`);
    console.error("  Requests to this route will return 503 until fixed.\n");
    const stub = express.Router();
    stub.use((_req, res) =>
      res.status(503).json({
        error: `Module unavailable: ${path.basename(modulePath)}`,
        detail: e.message,
      }),
    );
    return stub;
  }
}

// ── DB pool ──────────────────────────────────────────────────────────────────
let pool;
try {
  pool = require("./db/pool");
} catch (e) {
  console.error("  DB pool failed to load:", e.message);
}

// ── Static frontend ──────────────────────────────────────────────────────────
// path.join() always produces the correct separator for the current OS.
// OPTIMIZATION: Cache the result to avoid repeated fs.existsSync() calls
const _siblingFrontend = path.join(__dirname, "..", "frontend");
const FRONTEND = fs.existsSync(_siblingFrontend)
  ? _siblingFrontend
  : path.join(__dirname, "frontend");

// Pre-check for admin.html existence to avoid repeated fs.existsSync() in route
const _adminHtmlPath = path.join(FRONTEND, "admin.html");
const _indexHtmlPath = path.join(FRONTEND, "index.html");
const _adminHtmlExists = fs.existsSync(_adminHtmlPath);
const _indexHtmlExists = fs.existsSync(_indexHtmlPath);

// no-cache on JS/CSS so browsers always revalidate — fixes stale app.js
app.use(
  express.static(FRONTEND, {
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      if (/\.(js|css)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

app.get("/", (req, res) => {
  if (_indexHtmlExists) return res.sendFile(_indexHtmlPath);
  res
    .status(404)
    .send("index.html not found -- place it in the frontend/ folder");
});

app.get(["/admin", "/admin.html"], (req, res) => {
  if (_adminHtmlExists) return res.sendFile(_adminHtmlPath);
  res
    .status(404)
    .send("admin.html not found -- place it in the frontend/ folder");
});

// ── Request logger ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    console.log(`${ts}  ${req.method.padEnd(6)} ${req.path}`);
  }
  next();
});

// ── Auth routes ──────────────────────────────────────────────────────────────
app.use("/api/auth", safeRequire("./routes/auth.routes"));

// ── Core API routes ──────────────────────────────────────────────────────────
// IMPORTANT: shares.memberships.routes must be registered BEFORE other /api routes
// to ensure /api/shares and /api/memberships are matched correctly
app.use("/api", safeRequire("./routes/shares.memberships.routes"));
app.use("/api/records", safeRequire("./routes/records.routes"));
app.use("/api/cashbook", safeRequire("./routes/cashbook.routes"));
app.use("/api/sync-sheets", safeRequire("./routes/sync.routes"));
app.use("/api/combined", safeRequire("./routes/combined.routes"));

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  if (!pool || typeof pool.query !== "function") {
    return res.status(503).json({
      ok: false,
      db: "unavailable",
      platform: PLATFORM,
      error: "DB pool not initialised -- check DB_PASSWORD / DB_NAME in .env",
    });
  }
  try {
    const _healthStart = Date.now();
    await pool.query("SELECT 1");
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      db: "connected",
      db_latency_ms: Date.now() - _healthStart,
      platform: PLATFORM,
      uptime: Math.floor(process.uptime()),
      node: process.version,
      memory: {
        rss_mb:  Math.round(mem.rss        / 1024 / 1024),
        heap_mb: Math.round(mem.heapUsed   / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      },
    });
  } catch (e) {
    res.status(503).json({ ok: false, db: "error", error: e.message });
  }
});

app.use("/api", safeRequire("./routes/dashboard.routes"));

// ── Feature routes ───────────────────────────────────────────────────────────
app.use("/api/audit", safeRequire("./features/audit.routes"));
app.use("/api/notifications", safeRequire("./features/notifications.routes"));
app.use("/api/sms", safeRequire("./features/sms.routes"));
app.use("/api/reports", safeRequire("./features/reports.routes"));
app.use("/api/export", safeRequire("./features/export.routes"));
app.use("/api/interest", safeRequire("./features/interest.routes"));
app.use("/api/backup", safeRequire("./features/backup.routes"));
app.use("/api/pdf-sync", safeRequire("./features/pdf_sync.routes"));

// ── Guard: stray POST / (form with no action, misconfigured fetch) ────────────
app.post("/", (req, res) => res.redirect("/"));

// ── 404 for unknown API routes ───────────────────────────────────────────────
app.use("/api/*", (req, res) => {
  res
    .status(404)
    .json({ error: `API route not found: ${req.method} ${req.path}` });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Graceful shutdown ────────────────────────────────────────────────────────
// SIGINT  = Ctrl+C on all platforms
// SIGTERM = pm2 restart / Docker stop
// SIGUSR2 = nodemon restart (Mac/Linux only -- Windows doesn't support it)
function shutdown(signal) {
  console.log(`\n  ${signal} received -- shutting down...`);
  if (pool && typeof pool.end === "function") {
    pool.end(() => {
      console.log("  DB pool closed.");
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  } else {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
if (!IS_WINDOWS) process.on("SIGUSR2", () => shutdown("SIGUSR2"));

// ── Keep running on unhandled errors ─────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  console.error("  Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("  Uncaught exception (exiting for PM2 restart):", err.message);
  process.exit(1);
});

// Wait for Postgres to accept connections before running migrations --
// on Windows, PM2 can start Node before the Postgres service has finished
// booting. Retries with a short delay instead of crashing immediately.
async function waitForDB(maxAttempts = 15, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      const reason =
        err.name === "AggregateError" && Array.isArray(err.errors)
          ? err.errors.map((e) => e.message).join(" | ")
          : err.message || err.code || err.name;
      console.log(`  ⏳ Waiting for database (${attempt}/${maxAttempts}): ${reason}`);
      if (attempt === maxAttempts) throw err;
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
}

// ── Start ────────────────────────────────────────────────────────────────────
async function start() {
  const startTime = Date.now();

  try {
    await waitForDB();
    const migStartTime = Date.now();
    await runMigrations();
    const migTime = Date.now() - migStartTime;
    if (migTime > 100) {
      console.log(`  ⏱ Migrations took ${migTime}ms`);
    }
  } catch (e) {
    const reason =
      e.name === "AggregateError" && Array.isArray(e.errors)
        ? e.errors.map((x) => x.message).join(" | ")
        : e.message || e.code || e.name;
    console.error("  Migration failed:", reason);
    if (pool && typeof pool.end === "function") {
      await pool.end().catch(() => {});
    }
    process.exit(1);
  }

  // Bind to 0.0.0.0 so ALL network interfaces are reachable --
  // required for LAN access on Windows and Mac alike.
  const http = require("http");
  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;   // slightly above LAN proxy 60s
  server.headersTimeout  = 70_000;    // must exceed keepAliveTimeout
  server.requestTimeout  = 120_000;   // 2 min max per request
  server.listen(PORT, "0.0.0.0", () => {
    const localIPs = getLocalIPs(); // Use cached result
    const line = "-".repeat(50);
    const totalTime = Date.now() - startTime;

    console.log(`\n  ${line}`);
    console.log(`  JJU Bank  |  ${PLATFORM}  |  Node ${process.version}`);
    console.log(`  ${line}`);
    console.log(`\n  This machine:`);
    console.log(`    http://localhost:${PORT}`);
    console.log(`    http://localhost:${PORT}/admin`);

    if (localIPs.length) {
      console.log(`\n  Other devices on same WiFi:`);
      localIPs.forEach((ip) => console.log(`    http://${ip}:${PORT}`));
    }

    console.log(`\n  Health: http://localhost:${PORT}/api/health`);
    console.log(`  Ready in ${totalTime}ms  |  ${line}\n`);
  });
}

start();
module.exports = { app, start };
