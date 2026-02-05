import { describe, it, expect, beforeEach } from 'vitest';
import { requirePermission } from '../../src/middleware/permissions';
import { createMockRequest, createAuthenticatedRequest } from '../utils/test-helpers';
import {
  createTestUser,
  createTestOrganization,
  createTestMembership,
  createTestModule,
  ensureDefaultRoles,
} from '../utils/database';
import prisma from '../../src/core/db';

describe('Permission Middleware', () => {
  it('should allow access when user has permission', async () => {
    const user = await createTestUser();
    const org = await createTestOrganization();
    await ensureDefaultRoles(org.id);
    
    // Create permission (Permission doesn't have moduleId)
    const permission = await prisma.permission.upsert({
      where: { key: `hr.employees.view-${Date.now()}` },
      update: {},
      create: {
        key: `hr.employees.view-${Date.now()}`, // Must be unique
        name: 'View Employees',
      },
    });
    
    // Create role with permission
    const role = await prisma.role.create({
      data: {
        key: `hr-manager-${Date.now()}`, // Must be unique
        name: 'HR Manager',
        organizationId: org.id,
      },
    });
    
    await prisma.rolePermission.create({
      data: {
        roleId: role.id,
        permissionId: permission.id,
      },
    });
    
    // Create membership with role
    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        isActive: true,
      },
    });
    
    await prisma.membershipRole.create({
      data: {
        membershipId: membership.id,
        roleId: role.id,
      },
    });
    
    const req = createAuthenticatedRequest(user.id, org.id) as any;
    const res: any = {
      status: (code: number) => ({
        json: (data: any) => ({ status: code, body: data }),
      }),
      json: (data: any) => ({ status: 200, body: data }),
    };
    
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };
    
    const middleware = requirePermission(permission.key);
    await middleware(req, res, next);
    
    expect(nextCalled).toBe(true);
  });

  it('should deny access when user lacks permission', async () => {
    const user = await createTestUser();
    const org = await createTestOrganization();
    await ensureDefaultRoles(org.id);
    
    // Create membership without the required permission
    await createTestMembership(user.id, org.id, { roleKeys: ['member'] });
    
    const req = createAuthenticatedRequest(user.id, org.id) as any;
    
    let nextCalled = false;
    let responseStatus: number | undefined;
    const next = () => {
      nextCalled = true;
    };
    
    const res: any = {
      status: (code: number) => {
        responseStatus = code;
        return {
          json: (data: any) => ({ status: code, body: data }),
        };
      },
    };
    
    // Use a permission that doesn't exist
    const middleware = requirePermission('nonexistent.permission');
    await middleware(req, res, next);
    
    expect(nextCalled).toBe(false);
    expect(responseStatus).toBe(403);
  });

  it('should allow super admin access', async () => {
    const user = await createTestUser({ isSuperAdmin: true });
    const org = await createTestOrganization();
    
    const req = createAuthenticatedRequest(user.id, org.id) as any;
    req.user!.isSuperAdmin = true;
    
    const res: any = {
      status: (code: number) => ({
        json: (data: any) => ({ status: code, body: data }),
      }),
      json: (data: any) => ({ status: 200, body: data }),
    };
    
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };
    
    // Super admin should bypass any permission check
    const middleware = requirePermission('any.permission');
    await middleware(req, res, next);
    
    expect(nextCalled).toBe(true);
  });
});

