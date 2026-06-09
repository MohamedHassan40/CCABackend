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

const INVENTORY_PERMISSIONS = [
  'inventory.items.view',
  'inventory.items.create',
  'inventory.items.edit',
  'inventory.items.delete',
  'inventory.categories.view',
  'inventory.categories.create',
  'inventory.categories.edit',
  'inventory.categories.delete',
  'inventory.assignments.view',
  'inventory.assignments.create',
  'inventory.assignments.approve',
  'inventory.assignments.edit',
];

describe('Inventory Module', () => {
  let api: ApiClient;
  let user: { id: string };
  let org: { id: string };

  beforeEach(async () => {
    api = new ApiClient();

    user = await createTestUser();
    org = await createTestOrganization();
    await ensureDefaultRoles(org.id);
    await createTestMembership(user.id, org.id, { roleKeys: ['owner'] });

    const inventoryModule = await createTestModule({ key: 'inventory', name: 'Inventory Module' });
    await enableModuleForOrg(org.id, inventoryModule.id);

    const permissions = await Promise.all(
      INVENTORY_PERMISSIONS.map((key) =>
        prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key, name: key },
        })
      )
    );

    const ownerRole = await prisma.role.findUnique({ where: { key: 'owner' } });
    if (ownerRole) {
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: ownerRole.id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });
    }

    api.setAuth(user.id, org.id);
  });

  async function createCategory(name = 'Electronics') {
    const response = await api.post('/api/inventory/categories').send({ name, description: 'Test category' });
    expect(response.status).toBe(201);
    return response.body;
  }

  async function createItem(overrides: Record<string, unknown> = {}) {
    const response = await api.post('/api/inventory').send({
      name: 'Laptop',
      description: 'Dell laptop',
      sku: 'LAP-001',
      quantity: 10,
      minQuantity: 2,
      status: 'available',
      condition: 'new',
      location: 'Warehouse A',
      ...overrides,
    });
    expect(response.status).toBe(201);
    return response.body;
  }

  describe('GET /api/inventory', () => {
    it('should return empty array when no items exist', async () => {
      const response = await api.get('/api/inventory');
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return items for the organization', async () => {
      await createItem({ name: 'Monitor', sku: 'MON-001' });
      await createItem({ name: 'Keyboard', sku: 'KEY-001' });

      const response = await api.get('/api/inventory');
      expect(response.status).toBe(200);
      expect(response.body.length).toBeGreaterThanOrEqual(2);
      expect(response.body.every((item: { orgId: string }) => item.orgId === org.id)).toBe(true);
    });
  });

  describe('POST /api/inventory', () => {
    it('should create a new inventory item', async () => {
      const category = await createCategory();
      const response = await api.post('/api/inventory').send({
        name: 'Office Chair',
        description: 'Ergonomic chair',
        sku: 'CHR-001',
        categoryId: category.id,
        quantity: 5,
        minQuantity: 1,
        status: 'available',
        condition: 'new',
        location: 'Warehouse B',
        notes: 'Handle with care',
      });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('Office Chair');
      expect(response.body.sku).toBe('CHR-001');
      expect(response.body.quantity).toBe(5);
      expect(response.body.orgId).toBe(org.id);
      expect(response.body.category.id).toBe(category.id);
      expect(response.body.location).toBe('Warehouse B');
      expect(response.body.notes).toBe('Handle with care');
    });

    it('should require name', async () => {
      const response = await api.post('/api/inventory').send({ quantity: 1 });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/inventory/:id', () => {
    it('should return a single item', async () => {
      const item = await createItem();
      const response = await api.get(`/api/inventory/${item.id}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(item.id);
      expect(response.body.name).toBe('Laptop');
    });

    it('should return 404 for non-existent item', async () => {
      const response = await api.get('/api/inventory/non-existent-id');
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/inventory/:id', () => {
    it('should update an inventory item', async () => {
      const item = await createItem();

      const response = await api.put(`/api/inventory/${item.id}`).send({
        name: 'Updated Laptop',
        quantity: 15,
        status: 'maintenance',
        condition: 'used',
        location: 'Repair bay',
        notes: 'Needs service',
      });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated Laptop');
      expect(response.body.quantity).toBe(15);
      expect(response.body.status).toBe('maintenance');
      expect(response.body.condition).toBe('used');
      expect(response.body.location).toBe('Repair bay');
      expect(response.body.notes).toBe('Needs service');
    });

    it('should return 404 when updating item from another organization', async () => {
      const item = await createItem();
      const otherOrg = await createTestOrganization();
      await ensureDefaultRoles(otherOrg.id);
      await createTestMembership(user.id, otherOrg.id, { roleKeys: ['owner'] });

      const inventoryModule = await createTestModule({ key: 'inventory', name: 'Inventory Module' });
      await enableModuleForOrg(otherOrg.id, inventoryModule.id);

      api.setAuth(user.id, otherOrg.id);

      const response = await api.put(`/api/inventory/${item.id}`).send({ name: 'Hacked' });
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/inventory/:id', () => {
    it('should delete an inventory item', async () => {
      const item = await createItem();
      const response = await api.delete(`/api/inventory/${item.id}`);
      expect(response.status).toBe(200);

      const getResponse = await api.get(`/api/inventory/${item.id}`);
      expect(getResponse.status).toBe(404);
    });
  });

  describe('Inventory categories', () => {
    it('should create and update a category', async () => {
      const created = await createCategory('Furniture');

      const updateResponse = await api.put(`/api/inventory/categories/${created.id}`).send({
        name: 'Office Furniture',
        description: 'Updated description',
        isActive: false,
      });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.name).toBe('Office Furniture');
      expect(updateResponse.body.isActive).toBe(false);
    });

    it('should list categories', async () => {
      await createCategory('Tools');
      const response = await api.get('/api/inventory/categories');
      expect(response.status).toBe(200);
      expect(response.body.some((c: { name: string }) => c.name === 'Tools')).toBe(true);
    });
  });

  describe('Assignment workflow', () => {
    async function createEmployeeRecord() {
      return prisma.employee.create({
        data: {
          orgId: org.id,
          fullName: 'Test Employee',
          email: `emp-${Date.now()}@example.com`,
          employeeCode: `EMP-${Date.now()}`,
          status: 'active',
        },
      });
    }

    it('creates pending assignment and approves it', async () => {
      const item = await createItem({ quantity: 5 });
      const employee = await createEmployeeRecord();

      const createRes = await api.post('/api/inventory/assignments').send({
        assetId: item.id,
        employeeId: employee.id,
        quantity: 2,
        reason: 'Onboarding',
      });
      expect(createRes.status).toBe(201);
      expect(createRes.body.status).toBe('pending');

      const approveRes = await api.put(`/api/inventory/assignments/${createRes.body.id}/approve`);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('active');
    });

    it('rejects and cancels pending assignments', async () => {
      const item = await createItem({ quantity: 5, sku: `SKU-${Date.now()}-a` });
      const employee = await createEmployeeRecord();

      const rejectTarget = await api.post('/api/inventory/assignments').send({
        assetId: item.id,
        employeeId: employee.id,
        quantity: 1,
      });
      expect(rejectTarget.status).toBe(201);

      const rejectRes = await api
        .put(`/api/inventory/assignments/${rejectTarget.body.id}/reject`)
        .send({ rejectionReason: 'Not needed' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe('rejected');

      const item2 = await createItem({ quantity: 5, sku: `SKU-${Date.now()}-b` });
      const cancelTarget = await api.post('/api/inventory/assignments').send({
        assetId: item2.id,
        employeeId: employee.id,
        quantity: 1,
      });
      expect(cancelTarget.status).toBe(201);

      const cancelRes = await api.put(`/api/inventory/assignments/${cancelTarget.body.id}/cancel`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('cancelled');
    });
  });
});
