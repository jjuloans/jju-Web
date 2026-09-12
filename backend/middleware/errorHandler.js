'use strict';

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {

  // Fix #5: if a response was already started (e.g. by a stream or timeout
  // handler), don't try to send another one — that would throw and create a
  // second unhandled error.
  if (res.headersSent) return;

  // Fix #2 & #7: sanitise status — accept err.status OR err.statusCode
  // (many libs use statusCode, e.g. node-postgres, http-errors).
  // Clamp to a valid 4xx/5xx range; anything else becomes 500.
  const rawStatus = err.status || err.statusCode;
  const status = (Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599)
    ? rawStatus
    : 500;

  // Fix #3 & #6: log the full stack trace + method/path for correlation.
  // err.stack already includes err.message on the first line.
  console.error(`[ERROR] ${req.method} ${req.path}`, err.stack || err.message);

  // Fix #1: never expose internal error details to the client in production.
  // In development, include the real message to aid debugging.
  // Fix #4: remove path/method from the response — the client already knows these.
  const isDev = process.env.NODE_ENV === 'development';
  res.status(status).json({
    error: (isDev || status < 500)
      ? (err.message || 'Internal server error')
      : 'Internal server error',
    ...(isDev && { stack: err.stack }),  // stack only in dev
  });
}

module.exports = errorHandler;
