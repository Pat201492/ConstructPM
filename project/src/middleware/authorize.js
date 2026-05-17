const { PERMISSIONS } = require('../config/roles');
const db = require('../config/database');

// Map permission prefixes to the tab that grants them
const PERM_TO_TAB = {
  'bids': 'bids',
  'projects': 'projects',
  'equipment': 'equipment',
  'inventory': 'equipment',
  'extractions': 'inbox',
  'files': 'bids',       // file ops are part of bid/project workflow
  'exports': 'exports',
  'timesheets': 'timesheets',
  'notifications': 'notifications',
  'users': 'admin',
  'admin': 'admin',
  'field_notes': 'field-notes',
  'oil_samples': 'oil-samples',
};

// Cache role configs (refreshes every 5 min)
let roleCache = {};
let roleCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getRoleConfig(roleName) {
  if (Date.now() - roleCacheTime > CACHE_TTL) {
    try {
      const rows = await db('role_configurations');
      roleCache = {};
      rows.forEach(r => {
        roleCache[r.role_name] = {
          tabs: typeof r.allowed_tabs === 'string' ? JSON.parse(r.allowed_tabs) : (r.allowed_tabs || []),
          permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : (r.permissions || []),
        };
      });
      roleCacheTime = Date.now();
    } catch { /* fall back to hardcoded */ }
  }
  return roleCache[roleName] || null;
}

/**
 * Checks if the user's role has the required permission.
 * 
 * Resolution order:
 * 1. Admin role → always allowed
 * 2. Hardcoded PERMISSIONS (system roles)
 * 3. DB role_configurations: if role has wildcard '*' → allowed
 * 4. Tab-based: if the permission maps to a tab the role has access to → allowed
 */
function authorize(permission) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const role = req.user.role;

    // Admin always passes
    if (role === 'admin') return next();

    // Check hardcoded PERMISSIONS
    const allowedRoles = PERMISSIONS[permission];
    if (allowedRoles && allowedRoles.includes(role)) return next();

    // Check DB role configuration
    const config = await getRoleConfig(role);
    if (config) {
      // Wildcard permission
      if (config.permissions.includes('*')) return next();

      // Exact permission match (e.g., 'bids:create')
      if (config.permissions.includes(permission)) return next();

      // Prefix wildcard (e.g., 'bids:*' matches 'bids:create')
      const prefix = permission.split(':')[0];
      if (config.permissions.includes(prefix + ':*')) return next();

      // Tab-based: if role has access to the tab that covers this permission
      const requiredTab = PERM_TO_TAB[prefix];
      if (requiredTab && config.tabs.includes(requiredTab)) return next();
    }

    return res.status(403).json({
      error: 'Forbidden',
      message: `Your role (${role}) does not have permission for this action.`,
    });
  };
}

/**
 * Allows access only to specific roles.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', message: `Requires: ${roles.join(', ')}` });
    }
    next();
  };
}

module.exports = { authorize, requireRole };
