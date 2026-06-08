import { describe, it, expect, beforeEach } from 'vitest';
import { ApiClient } from '../utils/api-client';
import {
  createTestUser,
  createTestOrganization,
  createTestMembership,
  createTestModule,
  ensureDefaultRoles,
} from '../utils/database';
import prisma from '../../src/core/db';

describe('Platform subscriptions API', () => {
  let api: ApiClient;
  let user: any;
  let org: any;

  beforeEach(async () => {
    api = new ApiClient();

    user = await createTestUser();
    org = await createTestOrganization();
    await ensureDefaultRoles(org.id);
    await createTestMembership(user.id, org.id, { roleKeys: ['owner'] });

    const permission = await prisma.permission.upsert({
      where: { key: 'subscriptions.view' },
      update: {},
      create: {
        key: 'subscriptions.view',
        name: 'View Platform Subscriptions',
      },
    });

    const ownerRole = await prisma.role.findUnique({
      where: { key: 'owner' },
    });

    if (ownerRole) {
      const existing = await prisma.rolePermission.findFirst({
        where: {
          roleId: ownerRole.id,
          permissionId: permission.id,
        },
      });

      if (!existing) {
        await prisma.rolePermission.create({
          data: {
            roleId: ownerRole.id,
            permissionId: permission.id,
          },
        });
      }
    }

    api.setAuth(user.id, org.id);
  });

  describe('GET /api/subscriptions/modules', () => {
    it('should return available modules', async () => {
      await createTestModule({ key: 'hr', name: 'HR Module' });
      await createTestModule({ key: 'ticketing', name: 'Ticketing Module' });

      const response = await api.get('/api/subscriptions/modules');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/subscriptions/subscriptions', () => {
    it('should return organization subscriptions', async () => {
      const module = await createTestModule({ key: 'hr', name: 'HR Module' });

      await prisma.subscription.create({
        data: {
          organizationId: org.id,
          moduleId: module.id,
          plan: 'pro',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const response = await api.get('/api/subscriptions');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('subscriptions');
      expect(response.body).toHaveProperty('orgModules');
      expect(Array.isArray(response.body.subscriptions)).toBe(true);
      expect(response.body.subscriptions.length).toBeGreaterThan(0);
    });
  });
});
