'use strict';

// ── Permission matrix ─────────────────────────────────────────────────────
// Roles: admin, manager, staff, viewer
const PERMISSIONS = {
  admin: ['*'],   // all access
  manager: [
    'records:read', 'records:create', 'records:update', 'records:close', 'records:reopen',
    'cashbook:read', 'cashbook:create', 'cashbook:update', 'cashbook:delete',
    'reports:read', 'export:read', 'audit:read', 'dashboard:read',
  ],
  staff: [
    'records:read', 'records:create', 'records:update',
    'cashbook:read', 'cashbook:create', 'cashbook:update',
    'dashboard:read',
  ],
  viewer: [
    'records:read', 'cashbook:read', 'dashboard:read', 'reports:read',
  ],
};

function hasPermission(role, permission) {
  if (!role) return false;
  const perms = PERMISSIONS[role] || [];
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  // wildcard check: 'records:*' grants 'records:read', 'records:create' etc.
  const [resource] = permission.split(':');
  return perms.includes(`${resource}:*`);
}

// ── Middleware factory ────────────────────────────────────────────────────
// Usage: router.delete('/:id', requirePermission('records:delete'), c.softDelete)
function requirePermission(permission) {
  return (req, res, next) => {
    const role = req.session?.role;
    if (!role) return res.status(401).json({ error: 'Not authenticated' });
    if (!hasPermission(role, permission)) {
      return res.status(403).json({
        error: `Permission denied: '${permission}' requires role manager or above`,
        your_role: role,
      });
    }
    next();
  };
}

// ── Convenience shorthands ────────────────────────────────────────────────
const canRead   = (r) => requirePermission(`${r}:read`);
const canCreate = (r) => requirePermission(`${r}:create`);
const canUpdate = (r) => requirePermission(`${r}:update`);
const canDelete = (r) => requirePermission(`${r}:delete`);
const adminOnly = requirePermission('admin:*');

module.exports = { requirePermission, hasPermission, canRead, canCreate, canUpdate, canDelete, adminOnly, PERMISSIONS };

/*
── USAGE IN ROUTES ───────────────────────────────────────────────────────────

  const { requirePermission, adminOnly } = require('../features/rbac/rbac.middleware');

  // In records.routes.js
  router.get('/',        requirePermission('records:read'),   c.list);
  router.post('/',       requirePermission('records:create'), c.create);
  router.put('/:id',     requirePermission('records:update'), c.update);
  router.delete('/:id',  requirePermission('records:delete'), c.softDelete);

  // Admin-only: permanent delete, user management
  router.delete('/:id/permanent', adminOnly, c.permanentDelete);

── CHANGE USER ROLE ─────────────────────────────────────────────────────────
  Update the role column in the users table:
  UPDATE users SET role='manager' WHERE username='john';

  Available roles: admin | manager | staff | viewer
*/
