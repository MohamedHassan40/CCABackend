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
});

