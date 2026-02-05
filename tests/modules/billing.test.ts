import { describe, it, expect, beforeEach } from 'vitest';
import { ApiClient } from '../utils/api-client';
import {
  createTestUser,
  createTestOrganization,
  createTestMembership,
  createTestModule,
  enableModuleForOrg,
  ensureDefaultRoles,
} from '../utils/database';
import prisma from '../../src/core/db';

describe('Billing Module', () => {
  let api: ApiClient;
  let user: any;
  let org: any;

  beforeEach(async () => {
    api = new ApiClient();
    
    user = await createTestUser();
    org = await createTestOrganization();
    await ensureDefaultRoles(org.id);
    await createTestMembership(user.id, org.id, { roleKeys: ['owner'] });
    
    // Create billing permission (Permission model doesn't have moduleId)
    const billingModule = await createTestModule({ key: 'billing', name: 'Billing' });
    const permission = await prisma.permission.upsert({
      where: { key: 'billing.subscriptions.view' },
      update: {},
      create: {
        key: 'billing.subscriptions.view',
        name: 'View Subscriptions',
      },
    });
    
    const ownerRole = await prisma.role.findUnique({
      where: { key: 'owner' },
    });
    
    if (ownerRole) {
      // Check if already exists (use findFirst since there's no explicit unique constraint name)
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

  describe('GET /api/billing/modules', () => {
    it('should return available modules', async () => {
      // Create some test modules
      const hrModule = await createTestModule({ key: 'hr', name: 'HR Module' });
      const ticketingModule = await createTestModule({ key: 'ticketing', name: 'Ticketing Module' });

      const response = await api.get('/api/billing/modules');
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/billing/subscriptions', () => {
    it('should return organization subscriptions', async () => {
      const module = await createTestModule({ key: 'hr', name: 'HR Module' });
      
      // Create a subscription
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

      const response = await api.get('/api/billing/subscriptions');
      
      expect(response.status).toBe(200);
      // Response is an object with subscriptions and orgModules arrays
      expect(response.body).toHaveProperty('subscriptions');
      expect(response.body).toHaveProperty('orgModules');
      expect(Array.isArray(response.body.subscriptions)).toBe(true);
      expect(response.body.subscriptions.length).toBeGreaterThan(0);
    });
  });
});

