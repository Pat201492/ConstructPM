const { ROLES, PERMISSIONS } = require('../../src/config/roles');

describe('Roles Configuration', () => {
  describe('ROLES', () => {
    it('should define all 6 roles', () => {
      expect(Object.keys(ROLES)).toHaveLength(7);
      expect(ROLES.ADMIN).toBe('admin');
      expect(ROLES.PROJECT_MANAGER).toBe('project_manager');
      expect(ROLES.ESTIMATOR).toBe('estimator');
      expect(ROLES.ACCOUNTING).toBe('accounting');
      expect(ROLES.SHOP_STAFF).toBe('shop_staff');
      expect(ROLES.FIELD_STAFF).toBe('field_staff');
      expect(ROLES.SCHEDULER).toBe('scheduler');
    });

    it('should NOT have shop_manager (combined into shop_staff)', () => {
      expect(ROLES.SHOP_MANAGER).toBeUndefined();
    });
  });

  describe('PERMISSIONS', () => {
    it('should have at least 30 permission keys', () => {
      expect(Object.keys(PERMISSIONS).length).toBeGreaterThanOrEqual(30);
    });

    it('every permission should map to an array of valid roles', () => {
      const validRoles = Object.values(ROLES);
      for (const [perm, roles] of Object.entries(PERMISSIONS)) {
        expect(Array.isArray(roles)).toBe(true);
        expect(roles.length).toBeGreaterThan(0);
        roles.forEach(role => {
          expect(validRoles).toContain(role);
        });
      }
    });

    it('admin should be in every permission', () => {
      for (const [perm, roles] of Object.entries(PERMISSIONS)) {
        expect(roles).toContain(ROLES.ADMIN);
      }
    });

    it('foreman should only have limited permissions', () => {
      const fieldPermissions = Object.entries(PERMISSIONS)
        .filter(([_, roles]) => roles.includes(ROLES.FIELD_STAFF))
        .map(([perm]) => perm);

      expect(fieldPermissions).toContain('projects:read');
      expect(fieldPermissions).toContain('notifications:read');
      expect(fieldPermissions).toContain('files:download');
      expect(fieldPermissions).not.toContain('users:create');
      expect(fieldPermissions).not.toContain('bids:create');
      expect(fieldPermissions).not.toContain('equipment:manage');
    });

    it('shop_staff should access inventory and equipment but not bids', () => {
      expect(PERMISSIONS['inventory:create']).toContain(ROLES.SHOP_STAFF);
      expect(PERMISSIONS['equipment:manage']).toContain(ROLES.SHOP_STAFF);
      expect(PERMISSIONS['equipment:fulfill']).toContain(ROLES.SHOP_STAFF);
      expect(PERMISSIONS['bids:create']).not.toContain(ROLES.SHOP_STAFF);
    });

    it('only admin should manage users', () => {
      expect(PERMISSIONS['users:create']).toEqual([ROLES.ADMIN]);
      expect(PERMISSIONS['users:delete']).toEqual([ROLES.ADMIN]);
    });

    it('only admin should confirm timesheets', () => {
      expect(PERMISSIONS['timesheets:confirm']).toEqual([ROLES.ADMIN]);
    });

    it('only admin should access admin functions', () => {
      expect(PERMISSIONS['admin:manage']).toEqual([ROLES.ADMIN]);
      expect(PERMISSIONS['admin:bulk_import']).toEqual([ROLES.ADMIN]);
      expect(PERMISSIONS['admin:audit_log']).toEqual([ROLES.ADMIN]);
    });

    it('PM should be able to create equipment requests', () => {
      expect(PERMISSIONS['equipment:request']).toContain(ROLES.PROJECT_MANAGER);
      expect(PERMISSIONS['equipment:request']).not.toContain(ROLES.SHOP_STAFF);
    });
  });
});
