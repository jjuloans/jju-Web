'use strict';
const router = require('express').Router();
const c = require('../controllers/records.controller');
const { requireAuth } = require('../middleware/auth');
const { canRead, canCreate, canUpdate, canDelete, adminOnly, requirePermission } = require('../features/rbac.middleware');
const { auditMiddleware } = require('../features/audit.middleware');

// FIX #2: all records routes require a valid session
router.use(requireAuth);

// FIX: features/rbac.middleware.js defined a full permission matrix
// (admin/manager/staff/viewer) but was never imported by any route file —
// every route below only checked requireAuth (valid session), not role.
// Concretely, DELETE /:id/permanent was reachable by any logged-in user
// regardless of role. Wiring it in here restores the access control the
// permission matrix was written to provide.

// ── IMPORTANT: specific routes MUST come before /:id ──────────────────────
router.get ('/stats',                   canRead('records'), c.stats);
router.get ('/deleted',                 canRead('records'), c.listDeleted);
router.get ('/next-loan-no-auto',       canRead('records'), c.nextLoanNoAuto);
router.get ('/next-loan-no/:prefix',    canRead('records'), c.nextLoanNo);
router.get ('/check-loan-no/:no',       canRead('records'), c.checkLoanNo);
router.get ('/next-fd-acc-no/:prefix',  canRead('records'), c.nextFdAccNo);
router.get ('/check-fd-acc-no/:no',     canRead('records'), c.checkFdAccNo);
router.get ('/fd-linked-od-loans/:fdAccNo', canRead('records'), c.fdLinkedOdLoans);
router.get ('/next-mis-acc-no/:prefix', canRead('records'), c.nextMisAccNo);
router.get ('/check-mis-acc-no/:no',    canRead('records'), c.checkMisAccNo);
router.get ('/customers/search',        canRead('records'), c.customerSearch);
router.get ('/fd-accounts/by-customer',    canRead('records'), c.fdAccountsByCustomer);
router.get ('/od-loans/by-customer',       canRead('records'), c.odLoansByCustomer);
router.get ('/od-loans/list',              canRead('records'), c.odLoansList);
router.get ('/gold-loans/list',            canRead('records'), c.goldLoansList);
// Maintenance/repair endpoint — rewrites data across every od_loans row.
// Not part of normal day-to-day workflow, so admin-only rather than
// records:update, and audited like the other admin-only maintenance routes.
router.post('/od-loans/backfill-fd-acc',   adminOnly, auditMiddleware('BACKFILL', 'od_loans'), c.odLoansBackfillFdAcc);
router.get ('/next-saving-acc-no/:prefix',  canRead('records'), c.nextSavingAccNo);
router.get ('/check-saving-acc-no/:no',     canRead('records'), c.checkSavingAccNo);
router.get ('/saving-balance/:accNo',        canRead('records'), c.getSavingBalance);
router.get ('/next-customer-id',            canRead('records'), c.nextCustomerId);
router.get ('/next-share-acc-no/:prefix',   canRead('records'), c.nextShareAccNo);
// Guarded: only registers the real handler if the controller actually
// exports it. A missing/undefined handler here previously crashed the
// WHOLE records router at load time (Route.get() requires a callback
// function but got [object Undefined]) — turning one 404 into a 503 for
// every /api/records endpoint. This keeps that failure contained to just
// this one endpoint until checkShareAccNo is added to the controller.
if (typeof c.checkShareAccNo === 'function') {
  router.get('/check-share-acc-no/:no', canRead('records'), c.checkShareAccNo);
} else {
  router.get('/check-share-acc-no/:no', canRead('records'), (req, res) => {
    console.error('[records.routes] checkShareAccNo is not defined on records.controller — add it to enable share-acc-no duplicate checking.');
    res.status(501).json({ error: 'check-share-acc-no not implemented yet on the server' });
  });
}
router.get ('/next-od-acc-no/:prefix',      canRead('records'), c.nextOdAccNo);
router.get ('/check-od-acc-no/:no',         canRead('records'), c.checkOdAccNo);
router.get ('/check-customer-id/:id',       canRead('records'), c.checkCustomerId);
router.get ('/customer-full-data',           canRead('records'), c.customerFullData);
router.get ('/customers/:id/profile',        canRead('records'), c.customerProfile);
router.get ('/statement/:id',                canRead('records'), c.statement);
router.get ('/loan-holder/:groupNo',        canRead('records'), c.loanHolder);
router.post('/process-transaction',     canCreate('records'), auditMiddleware('PROCESS_TRANSACTION', 'records'), c.processTransaction);
// Bulk import can seed/overwrite a large number of rows in one call —
// treated as a maintenance operation, not routine data entry.
router.post('/import/bulk',             adminOnly, auditMiddleware('IMPORT_BULK', 'records'), c.importBulk);

// ── Generic CRUD ──────────────────────────────────────────────────────────
router.get ('/',        canRead('records'), c.list);
router.post('/',        canCreate('records'), auditMiddleware('CREATE', 'records'), c.create);
router.get ('/:id',     canRead('records'), c.getOne);
router.put ('/:id',     canUpdate('records'), auditMiddleware('UPDATE', 'records'), c.update);
router.delete('/:id',   canDelete('records'), auditMiddleware('DELETE', 'records'), c.softDelete);

// ── Status mutations ──────────────────────────────────────────────────────
// records:close / records:reopen are only granted to manager and admin in
// the permission matrix (features/rbac.middleware.js) — staff and viewer
// are excluded.
router.patch('/:id/close',       requirePermission('records:close'),  auditMiddleware('CLOSE', 'records'),  c.close);
router.patch('/:id/reopen',      requirePermission('records:reopen'), auditMiddleware('REOPEN', 'records'), c.reopen);
router.patch('/:id/soft-delete', canDelete('records'), auditMiddleware('DELETE', 'records'), c.softDeletePatch);
router.patch('/:id/restore',     canUpdate('records'), auditMiddleware('RESTORE', 'records'), c.restore);
// FIX #10: permanentDelete now also requires soft-delete first (enforced in
// controller). No role in the permission matrix grants records:delete except
// admin's '*', so canDelete('records') already restricts this to admin —
// kept as an explicit adminOnly here too since this is the one truly
// irreversible operation in this file (matches the rbac.middleware.js usage
// example, which calls this out by name).
router.delete('/:id/permanent',  adminOnly, auditMiddleware('PERMANENT_DELETE', 'records'), c.permanentDelete);

module.exports = router;
