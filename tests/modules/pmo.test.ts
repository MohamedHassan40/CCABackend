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

async function ensurePmoPermissions(ownerRoleId: string) {
  const keys = [
    'pmo.projects.view',
    'pmo.projects.create',
    'pmo.projects.edit',
    'pmo.projects.delete',
    'pmo.tasks.view',
    'pmo.tasks.create',
    'pmo.budget.view',
    'pmo.budget.create',
    'pmo.budget.edit',
  ];
  for (const key of keys) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, name: key },
    });
    const existing = await prisma.rolePermission.findFirst({
      where: { roleId: ownerRoleId, permissionId: permission.id },
    });
    if (!existing) {
      await prisma.rolePermission.create({
        data: { roleId: ownerRoleId, permissionId: permission.id },
      });
    }
  }
}

describe('PMO Module', () => {
  let api: ApiClient;
  let user: { id: string };
  let org: { id: string };

  beforeEach(async () => {
    api = new ApiClient();
    user = await createTestUser();
    org = await createTestOrganization();
    await ensureDefaultRoles(org.id);
    await createTestMembership(user.id, org.id, { roleKeys: ['owner'] });

    const pmoModule = await createTestModule({ key: 'pmo', name: 'PMO Portal' });
    await enableModuleForOrg(org.id, pmoModule.id);

    const ownerRole = await prisma.role.findUnique({ where: { key: 'owner' } });
    if (ownerRole) await ensurePmoPermissions(ownerRole.id);

    api.setAuth(user.id, org.id);
  });

  describe('GET /api/pmo/projects', () => {
    it('returns empty array when no projects exist', async () => {
      const response = await api.get('/api/pmo/projects');
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('POST /api/pmo/projects', () => {
    it('creates a project with a portal token', async () => {
      const response = await api.post('/api/pmo/projects').send({
        name: 'Test Project Alpha',
        status: 'planning',
      });
      expect(response.status).toBe(201);
      expect(response.body.name).toBe('Test Project Alpha');
      expect(response.body.portalToken).toBeTruthy();
    });
  });

  describe('POST /api/pmo/projects/:id/regenerate-portal-token', () => {
    it('regenerates the portal token', async () => {
      const created = await api.post('/api/pmo/projects').send({ name: 'Token Project' });
      const projectId = created.body.id;
      const oldToken = created.body.portalToken;

      const response = await api.post(`/api/pmo/projects/${projectId}/regenerate-portal-token`).send({});
      expect(response.status).toBe(200);
      expect(response.body.portalToken).toBeTruthy();
      expect(response.body.portalToken).not.toBe(oldToken);
    });
  });

  describe('Budget sync', () => {
    it('rolls budget line totals to project after creating budget items', async () => {
      const created = await api.post('/api/pmo/projects').send({ name: 'Budget Project' });
      const projectId = created.body.id;

      const labor = await api.post(`/api/pmo/projects/${projectId}/budget`).send({
        category: 'labor',
        budgetedCents: 100000,
      });
      await api.put(`/api/pmo/budget/${labor.body.id}`).send({ spentCents: 25000 });

      const materials = await api.post(`/api/pmo/projects/${projectId}/budget`).send({
        category: 'materials',
        budgetedCents: 50000,
      });
      await api.put(`/api/pmo/budget/${materials.body.id}`).send({ spentCents: 10000 });

      const project = await api.get(`/api/pmo/projects/${projectId}`);
      expect(project.status).toBe(200);
      expect(project.body.budgetCents).toBe(150000);
      expect(project.body.spentCents).toBe(35000);
    });
  });
});
