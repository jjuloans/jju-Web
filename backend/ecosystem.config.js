// PM2 Ecosystem Config — JJU Bank
// Usage:
//   First time:  pm2 start ecosystem.config.js
//   Save state:  pm2 save
//   On reboot:   pm2 startup   (run the printed command once)
//   Logs:        pm2 logs jju-bank
//   Restart:     pm2 restart jju-bank
//   Stop:        pm2 stop jju-bank

module.exports = {
  apps: [
    {
      name: 'jju-bank',
      script: 'server.js',          // path relative to this config file
      cwd: __dirname,               // run from the backend folder

      // ── Auto-restart settings ──────────────────────────────────
      watch: false,                 // don't watch files (use pm2 restart manually)
      autorestart: true,            // restart if it crashes
      max_restarts: 10,             // give up after 10 crash-restart cycles
      restart_delay: 2000,          // wait 2s before restarting after crash
      min_uptime: '10s',            // must stay up 10s to count as "stable"
      max_memory_restart: '400M',   // restart if RSS exceeds 400 MB (leak guard)

      // ── Environment ────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
        PORT: 4001,
      },

      // ── Logging ────────────────────────────────────────────────
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
