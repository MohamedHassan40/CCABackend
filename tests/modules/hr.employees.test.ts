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

describe('HR Module - Employees', () => {
  let api: ApiClient;
  let user: any;
  let org: any;
  let hrModule: any;

  beforeEach(async () => {
    api = new ApiClient();
    
    // Create test data
    user = await createTestUser();
    org = await createTestOrganization();
    await ensureDefaultRoles(org.id);
    await createTestMembership(user.id, org.id, { roleKeys: ['owner'] });
    
    // Enable HR module
    hrModule = await createTestModule({ key: 'hr', name: 'HR Module' });
    await enableModuleForOrg(org.id, hrModule.id);
    
    // Create permissions (Permission model doesn't have moduleId)
    const permissions = await Promise.all([
      prisma.permission.upsert({
        where: { key: 'hr.employees.view' },
        update: {},
        create: { key: 'hr.employees.view', name: 'View Employees' },
      }),
      prisma.permission.upsert({
        where: { key: 'hr.employees.create' },
        update: {},
        create: { key: 'hr.employees.create', name: 'Create Employees' },
      }),
      prisma.permission.upsert({
        where: { key: 'hr.employees.edit' },
        update: {},
        create: { key: 'hr.employees.edit', name: 'Edit Employees' },
      }),
      prisma.permission.upsert({
        where: { key: 'hr.employees.delete' },
        update: {},
        create: { key: 'hr.employees.delete', name: 'Delete Employees' },
      }),
    ]);
    
    // Assign permissions to owner role
    const ownerRole = await prisma.role.findUnique({
      where: { key: 'owner' },
    });
    
    if (ownerRole) {
      // Use createMany with skipDuplicates to handle race conditions
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: ownerRole.id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });
    }
    
    // Refresh membership to ensure roles are loaded (in case of cache issues)
    await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: org.id,
        },
      },
      include: {
        membershipRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    
    // Set authentication (user and org are freshly created, no need to verify)
    api.setAuth(user.id, org.id);
  });

  describe('GET /api/hr/employees', () => {
    it('should return empty array when no employees exist', async () => {
      // Verify auth is set
      if (!api) {
        throw new Error('API client not initialized');
      }
      
      const response = await api.get('/api/hr/employees');
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return employees for the organization', async () => {
      // Create employees
      const employee1 = await prisma.employee.create({
        data: {
          orgId: org.id,
          fullName: 'John Doe',
          email: 'john@example.com',
          position: 'Developer',
          department: 'Engineering',
        },
      });

      const employee2 = await prisma.employee.create({
        data: {
          orgId: org.id,
          fullName: 'Jane Smith',
          email: 'jane@example.com',
          position: 'Designer',
          department: 'Design',
        },
      });

      // Create employee in different org (should not appear)
      const otherOrg = await createTestOrganization({ name: 'Other Org' });
      await prisma.employee.create({
        data: {
          orgId: otherOrg.id,
          fullName: 'Other Employee',
        },
      });

      const response = await api.get('/api/hr/employees');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].fullName).toBe(employee2.fullName); // Ordered by createdAt desc
      expect(response.body[1].fullName).toBe(employee1.fullName);
    });

    it('should require authentication', async () => {
      api.clearAuth();
      const response = await api.get('/api/hr/employees');
      
      expect(response.status).toBe(401);
    });

    it('should require HR module to be enabled', async () => {
      // Disable HR module
      await prisma.orgModule.deleteMany({
        where: { organizationId: org.id, moduleId: hrModule.id },
      });

      const response = await api.get('/api/hr/employees');
      
      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/hr/employees', () => {
    it('should create a new employee', async () => {
      const employeeData = {
        fullName: 'John Doe',
        email: 'john@example.com',
        position: 'Developer',
        department: 'Engineering',
      };

      const response = await api.post('/api/hr/employees').send(employeeData);
      
      expect(response.status).toBe(201);
      expect(response.body.fullName).toBe(employeeData.fullName);
      expect(response.body.email).toBe(employeeData.email);
      expect(response.body.position).toBe(employeeData.position);
      expect(response.body.department).toBe(employeeData.department);
      expect(response.body.orgId).toBe(org.id);
    });

    it('should require fullName', async () => {
      const response = await api.post('/api/hr/employees').send({
        email: 'john@example.com',
      });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Full name is required');
    });

    it('should create employee with user account when createUserAccount is true', async () => {
      const employeeData = {
        fullName: 'John Doe',
        email: 'john.employee@example.com',
        password: 'SecurePass123!',
        position: 'Developer',
        createUserAccount: true,
      };

      const response = await api.post('/api/hr/employees').send(employeeData);
      
      expect(response.status).toBe(201);
      expect(response.body.userId).toBeTruthy();
      
      // Verify user was created
      const user = await prisma.user.findUnique({
        where: { email: employeeData.email },
      });
      
      expect(user).toBeTruthy();
      expect(user?.name).toBe(employeeData.fullName);
      
      // Verify membership was created
      const membership = await prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: user!.id,
            organizationId: org.id,
          },
        },
      });
      
      expect(membership).toBeTruthy();
    });
  });

  describe('PUT /api/hr/employees/:id', () => {
    it('should update an employee', async () => {
      const employee = await prisma.employee.create({
        data: {
          orgId: org.id,
          fullName: 'John Doe',
          email: 'john@example.com',
          position: 'Developer',
        },
      });

      const updateData = {
        fullName: 'John Updated',
        position: 'Senior Developer',
        department: 'Engineering',
      };

      const response = await api.put(`/api/hr/employees/${employee.id}`).send(updateData);
      
      expect(response.status).toBe(200);
      expect(response.body.fullName).toBe(updateData.fullName);
      expect(response.body.position).toBe(updateData.position);
      expect(response.body.department).toBe(updateData.department);
    });

    it('should return 404 if employee does not exist', async () => {
      const response = await api.put('/api/hr/employees/non-existent-id').send({
        fullName: 'Updated Name',
      });
      
      expect(response.status).toBe(404);
    });

    it('should not allow updating employee from different organization', async () => {
      const otherOrg = await createTestOrganization({ name: 'Other Org' });
      const employee = await prisma.employee.create({
        data: {
          orgId: otherOrg.id,
          fullName: 'Other Employee',
        },
      });

      const response = await api.put(`/api/hr/employees/${employee.id}`).send({
        fullName: 'Hacked Name',
      });
      
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/hr/employees/:id', () => {
    it('should delete an employee', async () => {
      const employee = await prisma.employee.create({
        data: {
          orgId: org.id,
          fullName: 'John Doe',
        },
      });

      const response = await api.delete(`/api/hr/employees/${employee.id}`);
      
      expect(response.status).toBe(200);
      expect(response.body.message).toContain('deleted successfully');
      
      // Verify employee is deleted
      const deleted = await prisma.employee.findUnique({
        where: { id: employee.id },
      });
      
      expect(deleted).toBeNull();
    });

    it('should return 404 if employee does not exist', async () => {
      const response = await api.delete('/api/hr/employees/non-existent-id');
      
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/hr/employees/bulk', () => {
    it('should create multiple employees', async () => {
      const employees = [
        { fullName: 'Employee 1', email: 'emp1@example.com', position: 'Developer' },
        { fullName: 'Employee 2', email: 'emp2@example.com', position: 'Designer' },
        { fullName: 'Employee 3', position: 'Manager' },
      ];

      const response = await api.post('/api/hr/employees/bulk').send({ employees });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.created).toBe(3);
      expect(response.body.failed).toBe(0);
      
      // Verify employees were created
      const createdEmployees = await prisma.employee.findMany({
        where: { orgId: org.id },
      });
      
      expect(createdEmployees).toHaveLength(3);
    });

    it('should handle errors in bulk creation', async () => {
      const employees = [
        { fullName: 'Valid Employee' },
        {}, // Invalid - missing fullName
        { fullName: 'Another Valid Employee' },
      ];

      const response = await api.post('/api/hr/employees/bulk').send({ employees });
      
      expect(response.status).toBe(200);
      expect(response.body.created).toBe(2);
      expect(response.body.failed).toBe(1);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0].error).toContain('Full name is required');
    });
  });
});

