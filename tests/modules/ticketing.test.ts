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

describe('Ticketing Module', () => {
  let api: ApiClient;
  let user: any;
  let org: any;
  let ticketingModule: any;

  beforeEach(async () => {
    api = new ApiClient();
    
    user = await createTestUser();
    org = await createTestOrganization();
    await ensureDefaultRoles(org.id);
    await createTestMembership(user.id, org.id, { roleKeys: ['owner'] });
    
    // Enable ticketing module
    ticketingModule = await createTestModule({ key: 'ticketing', name: 'Ticketing Module' });
    await enableModuleForOrg(org.id, ticketingModule.id);
    
    // Create permissions (Permission model doesn't have moduleId)
    const permissions = await Promise.all([
      prisma.permission.upsert({
        where: { key: 'ticketing.tickets.view' },
        update: {},
        create: { key: 'ticketing.tickets.view', name: 'View Tickets' },
      }),
      prisma.permission.upsert({
        where: { key: 'ticketing.tickets.create' },
        update: {},
        create: { key: 'ticketing.tickets.create', name: 'Create Tickets' },
      }),
      prisma.permission.upsert({
        where: { key: 'ticketing.tickets.edit' },
        update: {},
        create: { key: 'ticketing.tickets.edit', name: 'Edit Tickets' },
      }),
    ]);
    
    const ownerRole = await prisma.role.findUnique({
      where: { key: 'owner' },
    });
    
    if (ownerRole) {
      // Check each permission before creating to avoid duplicates
      for (const permission of permissions) {
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
    }
    
    api.setAuth(user.id, org.id);
  });

  describe('GET /api/ticketing/tickets', () => {
    it('should return empty array when no tickets exist', async () => {
      const response = await api.get('/api/ticketing/tickets');
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return tickets for the organization', async () => {
      // Ensure org exists
      let orgExists = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      
      if (!orgExists) {
        org = await createTestOrganization();
        orgExists = org;
      }
      
      // Create a ticket category - use orgId not organizationId
      const category = await prisma.ticketCategory.create({
        data: {
          orgId: org.id,
          name: 'Support',
          color: '#FF0000',
        },
      });

      // Create tickets - use orgId not organizationId
      const ticket1 = await prisma.ticket.create({
        data: {
          orgId: org.id,
          title: 'Ticket 1',
          description: 'Description 1',
          status: 'open',
          priority: 'medium',
          categoryId: category.id,
          createdById: user.id,
        },
      });

      const ticket2 = await prisma.ticket.create({
        data: {
          orgId: org.id,
          title: 'Ticket 2',
          description: 'Description 2',
          status: 'closed',
          priority: 'high',
          categoryId: category.id,
          createdById: user.id,
        },
      });

      const response = await api.get('/api/ticketing/tickets');
      
      expect(response.status).toBe(200);
      expect(response.body.length).toBeGreaterThanOrEqual(2);
      // Verify tickets belong to the organization
      expect(response.body.some((t: any) => t.orgId === org.id)).toBe(true);
    });
  });

  describe('POST /api/ticketing/tickets', () => {
    it('should create a new ticket', async () => {
      // Create a ticket category - ensure org exists first
      const orgExists = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      
      if (!orgExists) {
        // Re-create org if it was cleaned up
        org = await createTestOrganization();
      }
      
      const category = await prisma.ticketCategory.create({
        data: {
          orgId: org.id, // Use orgId not organizationId
          name: 'Support',
          color: '#FF0000',
        },
      });

      const ticketData = {
        title: 'New Ticket',
        description: 'This is a test ticket',
        status: 'open',
        priority: 'medium',
        categoryId: category.id,
      };

      const response = await api.post('/api/ticketing/tickets').send(ticketData);
      
      expect(response.status).toBe(201);
      expect(response.body.title).toBe(ticketData.title);
      expect(response.body.description).toBe(ticketData.description);
      expect(response.body.orgId).toBe(org.id);
      expect(response.body.createdById).toBe(user.id);
    });

    it('should require title', async () => {
      const response = await api.post('/api/ticketing/tickets').send({
        description: 'Description only',
      });
      
      expect(response.status).toBe(400);
    });
  });

  describe('view_own scoping', () => {
    async function createLimitedUser(permissionKeys: string[]) {
      const limitedUser = await createTestUser();
      const role = await prisma.role.create({
        data: {
          key: `ticketing-limited-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: 'Ticketing Limited',
        },
      });
      for (const key of permissionKeys) {
        const perm = await prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key, name: key },
        });
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: perm.id },
        });
      }
      const membership = await createTestMembership(limitedUser.id, org.id, { roleKeys: [] });
      await prisma.membershipRole.create({
        data: { membershipId: membership.id, roleId: role.id },
      });
      return limitedUser;
    }

    it('view_own lists only tickets created by or assigned to the user', async () => {
      await prisma.permission.upsert({
        where: { key: 'ticketing.tickets.view_own' },
        update: {},
        create: { key: 'ticketing.tickets.view_own', name: 'View Own Tickets' },
      });

      const otherUser = await createTestUser();
      const limitedUser = await createLimitedUser(['ticketing.tickets.view_own']);

      await prisma.ticket.createMany({
        data: [
          {
            orgId: org.id,
            title: 'Mine created',
            description: 'x',
            status: 'open',
            priority: 'medium',
            createdById: limitedUser.id,
          },
          {
            orgId: org.id,
            title: 'Mine assigned',
            description: 'x',
            status: 'open',
            priority: 'medium',
            createdById: otherUser.id,
            assigneeId: limitedUser.id,
          },
          {
            orgId: org.id,
            title: 'Someone else',
            description: 'secret',
            status: 'open',
            priority: 'medium',
            createdById: otherUser.id,
          },
        ],
      });

      api.setAuth(limitedUser.id, org.id);
      const response = await api.get('/api/ticketing/tickets');
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body.every((t: { title: string }) => t.title !== 'Someone else')).toBe(true);
    });

    it('view_own search does not leak other users tickets', async () => {
      await prisma.permission.upsert({
        where: { key: 'ticketing.tickets.view_own' },
        update: {},
        create: { key: 'ticketing.tickets.view_own', name: 'View Own Tickets' },
      });

      const otherUser = await createTestUser();
      const limitedUser = await createLimitedUser(['ticketing.tickets.view_own']);

      await prisma.ticket.create({
        data: {
          orgId: org.id,
          title: 'Secret leak keyword',
          description: 'should not appear',
          status: 'open',
          priority: 'medium',
          createdById: otherUser.id,
        },
      });
      await prisma.ticket.create({
        data: {
          orgId: org.id,
          title: 'My leak keyword ticket',
          description: 'visible',
          status: 'open',
          priority: 'medium',
          createdById: limitedUser.id,
        },
      });

      api.setAuth(limitedUser.id, org.id);
      const response = await api.get('/api/ticketing/tickets?search=leak');
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('My leak keyword ticket');
    });

    it('view_own user can comment on own ticket without edit permission', async () => {
      await prisma.permission.upsert({
        where: { key: 'ticketing.tickets.view_own' },
        update: {},
        create: { key: 'ticketing.tickets.view_own', name: 'View Own Tickets' },
      });

      const limitedUser = await createLimitedUser(['ticketing.tickets.view_own']);
      const ticket = await prisma.ticket.create({
        data: {
          orgId: org.id,
          title: 'Need help',
          description: 'issue',
          status: 'open',
          priority: 'medium',
          createdById: limitedUser.id,
        },
      });

      api.setAuth(limitedUser.id, org.id);
      const response = await api
        .post(`/api/ticketing/tickets/${ticket.id}/comments`)
        .send({ content: 'Follow up from employee' });

      expect(response.status).toBe(201);
      expect(response.body.content).toBe('Follow up from employee');
      expect(response.body.isInternal).toBe(false);
    });
  });
});

