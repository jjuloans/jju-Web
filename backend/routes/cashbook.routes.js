'use strict';
const router = require('express').Router();
const c = require('../controllers/cashbook.controller');
const { requireAuth } = require('../middleware/auth');
const { canRead, canCreate, canUpdate, canDelete, adminOnly } = require('../features/rbac.middleware');
const { auditMiddleware } = require('../features/audit.middleware');

// FIX #2: all cashbook routes require a valid session
router.use(requireAuth);

// FIX: wire in the permission matrix from features/rbac.middleware.js —
// previously every route here only checked requireAuth (valid session),
// so any logged-in user regardless of role could permanently delete a
// cashbook entry via DELETE /:id.
// NOTE: '/opening-balance' must be registered before '/:id' — PUT '/:id' is a
// single path segment too, and Express would otherwise match it first with
// :id="opening-balance".
router.get ('/deleted',          canRead('cashbook'), c.listDeleted);
router.get ('/opening-balance',  canRead('cashbook'), c.getOpeningBalance);
router.put ('/opening-balance',  canUpdate('cashbook'), auditMiddleware('UPDATE', 'cashbook'), c.setOpeningBalance);
router.get ('/',        canRead('cashbook'), c.list);
router.post('/bulk',    canCreate('cashbook'), auditMiddleware('CREATE', 'cashbook'), c.bulkInsert);
router.put ('/:id',     canUpdate('cashbook'), auditMiddleware('UPDATE', 'cashbook'), c.update);
router.patch('/:id/soft-delete', canDelete('cashbook'), auditMiddleware('DELETE', 'cashbook'), c.softDelete);
router.patch('/:id/restore',     canUpdate('cashbook'), auditMiddleware('RESTORE', 'cashbook'), c.restore);
// Irreversible, unlike soft-delete — admin-only regardless of the
// cashbook:delete permission a manager otherwise holds.
router.delete('/:id',  adminOnly, auditMiddleware('PERMANENT_DELETE', 'cashbook'), c.permanentDelete);

module.exports = router;
