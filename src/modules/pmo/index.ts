import { Router } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import { hashPassword } from '../../core/auth/password';
import type { ModuleManifest } from '@cloud-org/shared';
import tasksRouter from './tasks';
import {
  buildProjectDetailInclude,
  getProjectListWhere,
  getUserPermissionKeys,
  requireProjectAccess,
} from './project-access';
import { syncProjectBudgetTotals } from './budget-sync';
import {
  getDeliverableBudgetSummary,
  validateDeliverableCost,
} from './deliverable-budget';
import { ensureProjectPortalToken } from '../../routes/publicPmo';
import { registerPmoPhase2Routes } from './stakeholders-charter-reports';
import { registerPmoPlanningRoutes } from './planning-phase3';
import { registerPmoPhase4Routes } from './identification-closing-phase4';
import { registerPmoLifecycleRoutes } from './lifecycle';
import { assertOrganizationCanAddUsers, OrganizationUserLimitError } from '../../core/billing/plan-limits';

const router = Router();
registerPmoPhase2Routes(router);
registerPmoPlanningRoutes(router);
registerPmoPhase4Routes(router);
registerPmoLifecycleRoutes(router);

// Module manifest
export const pmoManifest: ModuleManifest = {
  key: 'pmo',
  name: 'PMO Portal',
  icon: 'briefcase',
  sidebarItems: [
    {
      path: '/pmo/dashboard',
      label: 'Dashboard',
      permission: 'pmo.projects.view',
    },
    {
      path: '/pmo/proposals',
      label: 'Proposals',
      permission: 'pmo.projects.view',
    },
    {
      path: '/pmo/projects',
      label: 'Projects',
      permission: 'pmo.projects.view',
    },
    {
      path: '/pmo/deliverables',
      label: 'Deliverables',
      permission: 'pmo.deliverables.view',
    },
    {
      path: '/pmo/wbs',
      label: 'WBS',
      permission: 'pmo.deliverables.view',
    },
    {
      path: '/pmo/timeline',
      label: 'Timeline',
      permission: 'pmo.projects.view',
    },
    {
      path: '/pmo/raci',
      label: 'RACI',
      permission: 'pmo.projects.view',
    },
    {
      path: '/pmo/budget',
      label: 'Budget',
      permission: 'pmo.budget.view',
    },
    {
      path: '/pmo/risks',
      label: 'Risks',
      permission: 'pmo.risks.view',
    },
    {
      path: '/pmo/risks/matrix',
      label: 'Risk matrix',
      permission: 'pmo.risks.view',
    },
    {
      path: '/pmo/issues',
      label: 'Issues',
      permission: 'pmo.issues.view',
    },
    {
      path: '/pmo/milestones',
      label: 'Milestones',
      permission: 'pmo.projects.view',
    },
    {
      path: '/pmo/clients',
      label: 'Clients',
      permission: 'pmo.client_managers.view',
    },
    {
      path: '/pmo/tasks',
      label: 'Tasks',
      permission: 'pmo.tasks.view',
    },
    {
      path: '/pmo/knowledge',
      label: 'Knowledge',
      permission: 'pmo.projects.view',
    },
    {
      path: '/pmo/resources',
      label: 'Resource loading',
      permission: 'pmo.projects.view',
    },
  ],
  dashboardWidgets: [
    {
      id: 'pmo-project-count',
      title: 'Active Projects',
      description: 'Number of active projects',
      apiPath: '/api/pmo/widgets/project-count',
      permission: 'pmo.projects.view',
    },
    {
      id: 'pmo-overdue-tasks',
      title: 'Overdue Tasks',
      description: 'Tasks past due date',
      apiPath: '/api/pmo/widgets/overdue-tasks',
      permission: 'pmo.tasks.view',
    },
    {
      id: 'pmo-avg-progress',
      title: 'Avg. Project Progress',
      description: 'Average completion across portfolio',
      apiPath: '/api/pmo/widgets/avg-progress',
      permission: 'pmo.projects.view',
    },
    {
      id: 'pmo-pending-changes',
      title: 'Pending Changes',
      description: 'Open change requests',
      apiPath: '/api/pmo/widgets/pending-changes',
      permission: 'pmo.projects.view',
    },
    {
      id: 'pmo-delayed-projects',
      title: 'Delayed Projects',
      description: 'Projects past end date',
      apiPath: '/api/pmo/widgets/delayed-projects',
      permission: 'pmo.projects.view',
    },
  ],
};

// Project tasks (collaboration with client)
router.use(tasksRouter);

// Register module
export function registerPmoModule(routerInstance: Router): void {
  routerInstance.use('/api/pmo', authMiddleware, requireModuleEnabled('pmo'), router);

  // Register in module registry
  moduleRegistry.register({
    key: 'pmo',
    manifest: pmoManifest,
    registerRoutes: () => {}, // Already registered above
  });
}

// ============================================
// PROJECTS
// ============================================

// GET /api/pmo/projects (client users see only projects where they are ClientProjectManager)
router.get('/projects', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const where = await getProjectListWhere(req);
    if (!where) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (where.id?.in && where.id.in.length === 0) {
      res.json([]);
      return;
    }

    const projects = await prisma.project.findMany({
      where,
      include: {
        projectManagers: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
        clientProjectManagers: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
        _count: {
          select: {
            deliverables: true,
            risks: true,
            issues: true,
            milestones: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pmo/projects/:id
router.get('/projects/:id', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const accessResult = await requireProjectAccess(req, res, id);
    if (!accessResult) return;

    const permKeys = await getUserPermissionKeys(req);
    const include = buildProjectDetailInclude(accessResult.access, permKeys);

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      include: include as any,
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (!project.portalToken && accessResult.access === 'org') {
      const updated = await prisma.project.update({
        where: { id },
        data: { portalToken: ensureProjectPortalToken() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        include: include as any,
      });
      res.json({ ...updated, access: accessResult.access });
      return;
    }

    res.json({ ...project, access: accessResult.access });
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects
router.post('/projects', requirePermission('pmo.projects.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      name,
      description,
      clientName,
      status,
      priority,
      startDate,
      endDate,
      budgetCents,
      currency,
      projectManagerIds, // Array of employee IDs
      notes,
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    const project = await prisma.project.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        clientName: clientName || null,
        status: status || 'planning',
        priority: priority || 'medium',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        budgetCents: budgetCents || null,
        currency: currency || 'SAR',
        notes: notes || null,
        portalToken: ensureProjectPortalToken(),
      },
    });

    // Assign project managers if provided
    if (Array.isArray(projectManagerIds) && projectManagerIds.length > 0) {
      const projectManagers = await Promise.all(
        projectManagerIds.map(async (employeeId: string, index: number) => {
          // Verify employee belongs to organization
          const employee = await prisma.employee.findFirst({
            where: {
              id: employeeId,
              orgId: req.org!.id,
            },
          });

          if (!employee) {
            return null;
          }

          return prisma.projectManager.create({
            data: {
              projectId: project.id,
              employeeId,
              isPrimary: index === 0, // First one is primary
            },
          });
        })
      );

      // Filter out nulls
      await Promise.all(projectManagers.filter(Boolean));
    }

    const createdProject = await prisma.project.findUnique({
      where: { id: project.id },
      include: {
        projectManagers: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    res.status(201).json(createdProject);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/projects/:id
router.put('/projects/:id', requirePermission('pmo.projects.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      name,
      description,
      clientName,
      status,
      priority,
      startDate,
      endDate,
      actualStartDate,
      actualEndDate,
      progress,
      budgetCents,
      spentCents,
      notes,
    } = req.body;

    if (!(await requireProjectAccess(req, res, id))) return;

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(clientName !== undefined && { clientName }),
        ...(status && { status }),
        ...(priority && { priority }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(actualStartDate !== undefined && { actualStartDate: actualStartDate ? new Date(actualStartDate) : null }),
        ...(actualEndDate !== undefined && { actualEndDate: actualEndDate ? new Date(actualEndDate) : null }),
        ...(progress !== undefined && { progress }),
        ...(budgetCents !== undefined && { budgetCents }),
        ...(spentCents !== undefined && { spentCents }),
        ...(notes !== undefined && { notes }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:id/regenerate-portal-token
router.post('/projects/:id/regenerate-portal-token', requirePermission('pmo.projects.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    if (!(await requireProjectAccess(req, res, id))) return;

    const updated = await prisma.project.update({
      where: { id },
      data: { portalToken: ensureProjectPortalToken() },
      select: { id: true, portalToken: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error regenerating portal token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/projects/:id
router.delete('/projects/:id', requirePermission('pmo.projects.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    await prisma.project.delete({
      where: { id },
    });

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:id/managers
router.post('/projects/:id/managers', requirePermission('pmo.projects.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { employeeId, role, isPrimary } = req.body;

    if (!employeeId) {
      res.status(400).json({ error: 'Employee ID is required' });
      return;
    }

    if (!(await requireProjectAccess(req, res, id))) return;

    // Verify employee belongs to organization
    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        orgId: req.org.id,
      },
    });

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    // If setting as primary, unset other primary managers
    if (isPrimary) {
      await prisma.projectManager.updateMany({
        where: {
          projectId: id,
          isPrimary: true,
        },
        data: {
          isPrimary: false,
        },
      });
    }

    const projectManager = await prisma.projectManager.upsert({
      where: {
        projectId_employeeId: {
          projectId: id,
          employeeId,
        },
      },
      update: {
        role: role || 'manager',
        isPrimary: isPrimary || false,
      },
      create: {
        projectId: id,
        employeeId,
        role: role || 'manager',
        isPrimary: isPrimary || false,
      },
    });

    res.json(projectManager);
  } catch (error) {
    console.error('Error assigning project manager:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/projects/:id/managers/:managerId
router.delete('/projects/:id/managers/:managerId', requirePermission('pmo.projects.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, managerId } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    const manager = await prisma.projectManager.findFirst({
      where: { id: managerId, projectId: id },
    });
    if (!manager) {
      res.status(404).json({ error: 'Project manager not found' });
      return;
    }

    await prisma.projectManager.delete({
      where: { id: managerId },
    });

    res.json({ message: 'Project manager removed successfully' });
  } catch (error) {
    console.error('Error removing project manager:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// CLIENT PROJECT MANAGERS
// ============================================

// POST /api/pmo/projects/:id/client-managers
router.post('/projects/:id/client-managers', requirePermission('pmo.client_managers.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, email, password, phone, company, projectClientId } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    if (!(await requireProjectAccess(req, res, id))) return;

    // Check if user already exists
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      const passwordHash = await hashPassword(password);
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
        },
      });
    }

    // Check if user is already a member of this organization
    let membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: req.org.id,
        },
      },
    });

    if (!membership) {
      try {
        await assertOrganizationCanAddUsers(req.org.id);
      } catch (err) {
        if (err instanceof OrganizationUserLimitError) {
          res.status(err.statusCode).json(err.toJSON());
          return;
        }
        throw err;
      }

      // Create membership
      membership = await prisma.membership.create({
        data: {
          userId: user.id,
          organizationId: req.org.id,
          isActive: true,
        },
      });

      // Assign pmo.client_manager role
      const clientManagerRole = await prisma.role.findFirst({
        where: {
          key: 'pmo.client_manager',
          OR: [{ organizationId: req.org.id }, { organizationId: null }],
        },
      });

      if (clientManagerRole) {
        await prisma.membershipRole.create({
          data: {
            membershipId: membership.id,
            roleId: clientManagerRole.id,
          },
        });
      }
    }

    // Create client project manager
    const clientManager = await prisma.clientProjectManager.create({
      data: {
        projectId: id,
        projectClientId: projectClientId || null,
        userId: user.id,
        name,
        email,
        phone: phone || null,
        company: company || null,
        isActive: true,
      },
    });

    const created = await prisma.clientProjectManager.findUnique({
      where: { id: clientManager.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating client project manager:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pmo/client-managers - list all client managers for the org (for Clients tab)
router.get('/client-managers', requirePermission('pmo.client_managers.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const clientManagers = await prisma.clientProjectManager.findMany({
      where: {
        project: {
          orgId: req.org.id,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            clientName: true,
          },
        },
      },
      orderBy: [
        { company: 'asc' },
        { name: 'asc' },
      ],
    });

    res.json(Array.isArray(clientManagers) ? clientManagers : []);
  } catch (error) {
    console.error('Error fetching client managers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pmo/projects/:id/client-managers
router.get('/projects/:id/client-managers', requirePermission('pmo.client_managers.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    const clientManagers = await prisma.clientProjectManager.findMany({
      where: {
        projectId: id,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    res.json(clientManagers);
  } catch (error) {
    console.error('Error fetching client project managers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/projects/:id/client-managers/:managerId
router.delete('/projects/:id/client-managers/:managerId', requirePermission('pmo.client_managers.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, managerId } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    await prisma.clientProjectManager.delete({
      where: { id: managerId },
    });

    res.json({ message: 'Client project manager removed successfully' });
  } catch (error) {
    console.error('Error removing client project manager:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// PROJECT CLIENTS (client companies - add then add employees under each)
// ============================================

// GET /api/pmo/projects/:id/clients
router.get('/projects/:id/clients', requirePermission('pmo.client_managers.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    const clients = await prisma.projectClient.findMany({
      where: { projectId: id },
      include: {
        _count: { select: { clientProjectManagers: true, clientContacts: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json(Array.isArray(clients) ? clients : []);
  } catch (error) {
    console.error('Error fetching project clients:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:id/clients
router.post('/projects/:id/clients', requirePermission('pmo.client_managers.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, website, imageUrl } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Client name is required' });
      return;
    }

    if (!(await requireProjectAccess(req, res, id))) return;

    const client = await prisma.projectClient.create({
      data: {
        projectId: id,
        name: name.trim(),
        website: website?.trim() || null,
        imageUrl: imageUrl?.trim() || null,
      },
    });

    res.status(201).json(client);
  } catch (error) {
    console.error('Error creating project client:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/projects/:id/clients/:clientId
router.put('/projects/:id/clients/:clientId', requirePermission('pmo.client_managers.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, clientId } = req.params;
    const { name, website, imageUrl } = req.body;

    if (!(await requireProjectAccess(req, res, id))) return;

    const existing = await prisma.projectClient.findFirst({
      where: { id: clientId, projectId: id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const updated = await prisma.projectClient.update({
      where: { id: clientId },
      data: {
        ...(name !== undefined && { name: name?.trim() || existing.name }),
        ...(website !== undefined && { website: website?.trim() || null }),
        ...(imageUrl !== undefined && { imageUrl: imageUrl?.trim() || null }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating project client:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/projects/:id/clients/:clientId
router.delete('/projects/:id/clients/:clientId', requirePermission('pmo.client_managers.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, clientId } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    const existing = await prisma.projectClient.findFirst({
      where: { id: clientId, projectId: id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    await prisma.projectClient.delete({
      where: { id: clientId },
    });

    res.json({ message: 'Client removed successfully' });
  } catch (error) {
    console.error('Error deleting project client:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// PROJECT CLIENT CONTACTS (client team / employees - no login)
// ============================================

// GET /api/pmo/projects/:id/client-contacts
router.get('/projects/:id/client-contacts', requirePermission('pmo.client_managers.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    const contacts = await prisma.projectClientContact.findMany({
      where: { projectId: id },
      orderBy: [{ company: 'asc' }, { name: 'asc' }],
    });

    res.json(Array.isArray(contacts) ? contacts : []);
  } catch (error) {
    console.error('Error fetching project client contacts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:id/client-contacts
router.post('/projects/:id/client-contacts', requirePermission('pmo.client_managers.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, email, role, phone, company, projectClientId } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    if (!(await requireProjectAccess(req, res, id))) return;

    const projectRow = await prisma.project.findFirst({
      where: { id, orgId: req.org.id },
      select: { clientName: true },
    });

    let companyVal = company || projectRow?.clientName || null;
    if (projectClientId) {
      const pc = await prisma.projectClient.findFirst({
        where: { id: projectClientId, projectId: id },
      });
      if (pc) companyVal = pc.name;
    }

    const contact = await prisma.projectClientContact.create({
      data: {
        projectId: id,
        projectClientId: projectClientId || null,
        name,
        email: email || null,
        role: role || null,
        phone: phone || null,
        company: companyVal,
      },
    });

    res.status(201).json(contact);
  } catch (error) {
    console.error('Error creating project client contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/projects/:id/client-contacts/:contactId
router.put('/projects/:id/client-contacts/:contactId', requirePermission('pmo.client_managers.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, contactId } = req.params;
    const { name, email, role, phone, company, projectClientId } = req.body;

    if (!(await requireProjectAccess(req, res, id))) return;

    const existing = await prisma.projectClientContact.findFirst({
      where: { id: contactId, projectId: id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Client contact not found' });
      return;
    }

    let companyVal = company !== undefined ? company : existing.company;
    if (projectClientId) {
      const pc = await prisma.projectClient.findFirst({
        where: { id: projectClientId, projectId: id },
      });
      if (pc) companyVal = pc.name;
    }

    const contact = await prisma.projectClientContact.update({
      where: { id: contactId },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email: email || null }),
        ...(role !== undefined && { role: role || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(companyVal !== undefined && { company: companyVal }),
        ...(projectClientId !== undefined && { projectClientId: projectClientId || null }),
      },
    });

    res.json(contact);
  } catch (error) {
    console.error('Error updating project client contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/projects/:id/client-contacts/:contactId
router.delete('/projects/:id/client-contacts/:contactId', requirePermission('pmo.client_managers.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, contactId } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    await prisma.projectClientContact.delete({
      where: { id: contactId },
    });

    res.json({ message: 'Client contact removed successfully' });
  } catch (error) {
    console.error('Error removing project client contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// DELIVERABLES
// ============================================

// GET /api/pmo/projects/:id/deliverable-budget-summary
router.get(
  '/projects/:id/deliverable-budget-summary',
  requirePermission('pmo.deliverables.view'),
  async (req, res) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const summary = await getDeliverableBudgetSummary(id);
      res.json(summary);
    } catch (error) {
      console.error('Error fetching deliverable budget summary:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/pmo/projects/:id/deliverables
router.get('/projects/:id/deliverables', requirePermission('pmo.deliverables.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    const deliverables = await prisma.deliverable.findMany({
      where: {
        projectId: id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(deliverables);
  } catch (error) {
    console.error('Error fetching deliverables:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:id/deliverables
router.post('/projects/:id/deliverables', requirePermission('pmo.deliverables.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      name,
      description,
      status,
      priority,
      dueDate,
      startDate,
      assignedTo,
      assignedType,
      notes,
      quantity,
      unitCostCents,
      parentId,
      wbsCode,
      sortOrder,
      estimatedHours,
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Deliverable name is required' });
      return;
    }

    if (!(await requireProjectAccess(req, res, id))) return;

    if (parentId) {
      const parent = await prisma.deliverable.findFirst({
        where: { id: String(parentId), projectId: id },
      });
      if (!parent) {
        res.status(400).json({ error: 'Parent deliverable not found' });
        return;
      }
    }

    const costCheck = await validateDeliverableCost(id, quantity, unitCostCents);
    if (!costCheck.ok) {
      res.status(400).json({
        error: costCheck.error,
        remainingCents: costCheck.remainingCents,
        projectBudgetCents: costCheck.projectBudgetCents,
        totalCostCents: costCheck.totalCostCents,
      });
      return;
    }

    let resolvedWbsCode = wbsCode?.trim() || null;
    if (!resolvedWbsCode) {
      if (parentId) {
        const parent = await prisma.deliverable.findUnique({ where: { id: String(parentId) } });
        const siblingCount = await prisma.deliverable.count({ where: { projectId: id, parentId: String(parentId) } });
        resolvedWbsCode = parent?.wbsCode ? `${parent.wbsCode}.${siblingCount + 1}` : String(siblingCount + 1);
      } else {
        const rootCount = await prisma.deliverable.count({ where: { projectId: id, parentId: null } });
        resolvedWbsCode = String(rootCount + 1);
      }
    }

    const deliverable = await prisma.deliverable.create({
      data: {
        projectId: id,
        parentId: parentId || null,
        wbsCode: resolvedWbsCode,
        sortOrder: sortOrder != null ? Number(sortOrder) : 0,
        name,
        description: description || null,
        status: status || 'not_started',
        priority: priority || 'medium',
        startDate: startDate ? new Date(startDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        estimatedHours: estimatedHours != null ? Number(estimatedHours) : null,
        assignedTo: assignedTo || null,
        assignedType: assignedType || null,
        notes: notes || null,
        quantity: Math.max(1, Math.floor(Number(quantity)) || 1),
        unitCostCents: Math.max(0, Math.floor(Number(unitCostCents)) || 0),
        totalCostCents: costCheck.totalCostCents,
      },
    });

    res.status(201).json(deliverable);
  } catch (error) {
    console.error('Error creating deliverable:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/deliverables/:id
router.put('/deliverables/:id', requirePermission('pmo.deliverables.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      name,
      description,
      status,
      priority,
      dueDate,
      startDate,
      assignedTo,
      assignedType,
      notes,
      completedAt,
      quantity,
      unitCostCents,
      parentId,
      wbsCode,
      sortOrder,
      estimatedHours,
    } = req.body;

    const deliverable = await prisma.deliverable.findFirst({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!deliverable || deliverable.project.orgId !== req.org.id) {
      res.status(404).json({ error: 'Deliverable not found' });
      return;
    }

    const nextQuantity = quantity !== undefined ? quantity : deliverable.quantity;
    const nextUnitCost =
      unitCostCents !== undefined ? unitCostCents : deliverable.unitCostCents;

    const costCheck = await validateDeliverableCost(
      deliverable.projectId,
      nextQuantity,
      nextUnitCost,
      id
    );
    if (!costCheck.ok) {
      res.status(400).json({
        error: costCheck.error,
        remainingCents: costCheck.remainingCents,
        projectBudgetCents: costCheck.projectBudgetCents,
        totalCostCents: costCheck.totalCostCents,
      });
      return;
    }

    if (parentId !== undefined && parentId !== null && parentId !== deliverable.parentId) {
      if (parentId === id) {
        res.status(400).json({ error: 'Deliverable cannot be its own parent' });
        return;
      }
      const parent = await prisma.deliverable.findFirst({
        where: { id: String(parentId), projectId: deliverable.projectId },
      });
      if (!parent) {
        res.status(400).json({ error: 'Parent deliverable not found' });
        return;
      }
    }

    const updated = await prisma.deliverable.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(status && { status }),
        ...(priority && { priority }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(assignedTo !== undefined && { assignedTo }),
        ...(assignedType !== undefined && { assignedType }),
        ...(notes !== undefined && { notes }),
        ...(completedAt !== undefined && { completedAt: completedAt ? new Date(completedAt) : null }),
        ...(quantity !== undefined && { quantity: Math.max(1, Math.floor(Number(quantity)) || 1) }),
        ...(unitCostCents !== undefined && {
          unitCostCents: Math.max(0, Math.floor(Number(unitCostCents)) || 0),
        }),
        ...(parentId !== undefined && { parentId: parentId || null }),
        ...(wbsCode !== undefined && { wbsCode: wbsCode?.trim() || null }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
        ...(estimatedHours !== undefined && { estimatedHours: estimatedHours != null ? Number(estimatedHours) : null }),
        totalCostCents: costCheck.totalCostCents,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating deliverable:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/deliverables/:id
router.delete('/deliverables/:id', requirePermission('pmo.deliverables.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const deliverable = await prisma.deliverable.findFirst({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!deliverable || deliverable.project.orgId !== req.org.id) {
      res.status(404).json({ error: 'Deliverable not found' });
      return;
    }

    await prisma.deliverable.delete({
      where: { id },
    });

    res.json({ message: 'Deliverable deleted successfully' });
  } catch (error) {
    console.error('Error deleting deliverable:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// BUDGET
// ============================================

// GET /api/pmo/projects/:id/budget
router.get('/projects/:id/budget', requirePermission('pmo.budget.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    const [budgets, projectRow] = await Promise.all([
      prisma.budget.findMany({
        where: { projectId: id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.project.findFirst({
        where: { id, orgId: req.org.id },
        select: { currency: true },
      }),
    ]);

    const totalBudgeted = budgets.reduce((sum, b) => sum + b.budgetedCents, 0);
    const totalSpent = budgets.reduce((sum, b) => sum + b.spentCents, 0);

    res.json({
      budgets,
      totals: {
        budgetedCents: totalBudgeted,
        spentCents: totalSpent,
        remainingCents: totalBudgeted - totalSpent,
        currency: projectRow?.currency ?? 'SAR',
      },
    });
  } catch (error) {
    console.error('Error fetching budget:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:id/budget
router.post('/projects/:id/budget', requirePermission('pmo.budget.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { category, description, budgetedCents, currency, notes } = req.body;

    if (!category || !budgetedCents) {
      res.status(400).json({ error: 'Category and budgeted amount are required' });
      return;
    }

    if (!(await requireProjectAccess(req, res, id))) return;

    const budget = await prisma.budget.create({
      data: {
        projectId: id,
        category,
        description: description || null,
        budgetedCents,
        currency: currency || 'SAR',
        notes: notes || null,
      },
    });

    await syncProjectBudgetTotals(id);

    res.status(201).json(budget);
  } catch (error) {
    console.error('Error creating budget:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/budget/:id
router.put('/budget/:id', requirePermission('pmo.budget.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { category, description, budgetedCents, spentCents, currency, notes } = req.body;

    const budget = await prisma.budget.findFirst({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!budget || budget.project.orgId !== req.org.id) {
      res.status(404).json({ error: 'Budget not found' });
      return;
    }

    const updated = await prisma.budget.update({
      where: { id },
      data: {
        ...(category && { category }),
        ...(description !== undefined && { description }),
        ...(budgetedCents !== undefined && { budgetedCents }),
        ...(spentCents !== undefined && { spentCents }),
        ...(currency && { currency }),
        ...(notes !== undefined && { notes }),
      },
    });

    await syncProjectBudgetTotals(budget.projectId);

    res.json(updated);
  } catch (error) {
    console.error('Error updating budget:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/budget/:id
router.delete('/budget/:id', requirePermission('pmo.budget.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const budget = await prisma.budget.findFirst({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!budget || budget.project.orgId !== req.org.id) {
      res.status(404).json({ error: 'Budget not found' });
      return;
    }

    await prisma.budget.delete({
      where: { id },
    });

    await syncProjectBudgetTotals(budget.projectId);

    res.json({ message: 'Budget deleted successfully' });
  } catch (error) {
    console.error('Error deleting budget:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// RISKS
// ============================================

// GET /api/pmo/projects/:id/risks
router.get('/projects/:id/risks', requirePermission('pmo.risks.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    const risks = await prisma.risk.findMany({
      where: {
        projectId: id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(risks);
  } catch (error) {
    console.error('Error fetching risks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:id/risks
router.post('/projects/:id/risks', requirePermission('pmo.risks.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      title,
      description,
      category,
      probability,
      impact,
      status,
      mitigationPlan,
      owner,
      ownerType,
      notes,
    } = req.body;

    if (!title) {
      res.status(400).json({ error: 'Risk title is required' });
      return;
    }

    if (!(await requireProjectAccess(req, res, id))) return;

    const risk = await prisma.risk.create({
      data: {
        projectId: id,
        title,
        description: description || null,
        category: category || null,
        probability: probability || 'medium',
        impact: impact || 'medium',
        status: status || 'identified',
        mitigationPlan: mitigationPlan || null,
        owner: owner || null,
        ownerType: ownerType || null,
        notes: notes || null,
      },
    });

    res.status(201).json(risk);
  } catch (error) {
    console.error('Error creating risk:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/risks/:id
router.put('/risks/:id', requirePermission('pmo.risks.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      title,
      description,
      category,
      probability,
      impact,
      status,
      mitigationPlan,
      owner,
      ownerType,
      occurredAt,
      resolvedAt,
      notes,
    } = req.body;

    const risk = await prisma.risk.findFirst({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!risk || risk.project.orgId !== req.org.id) {
      res.status(404).json({ error: 'Risk not found' });
      return;
    }

    const updated = await prisma.risk.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(probability && { probability }),
        ...(impact && { impact }),
        ...(status && { status }),
        ...(mitigationPlan !== undefined && { mitigationPlan }),
        ...(owner !== undefined && { owner }),
        ...(ownerType !== undefined && { ownerType }),
        ...(occurredAt !== undefined && { occurredAt: occurredAt ? new Date(occurredAt) : null }),
        ...(resolvedAt !== undefined && { resolvedAt: resolvedAt ? new Date(resolvedAt) : null }),
        ...(notes !== undefined && { notes }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating risk:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/risks/:id
router.delete('/risks/:id', requirePermission('pmo.risks.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const risk = await prisma.risk.findFirst({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!risk || risk.project.orgId !== req.org.id) {
      res.status(404).json({ error: 'Risk not found' });
      return;
    }

    await prisma.risk.delete({
      where: { id },
    });

    res.json({ message: 'Risk deleted successfully' });
  } catch (error) {
    console.error('Error deleting risk:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// ISSUES
// ============================================

// GET /api/pmo/projects/:id/issues
router.get('/projects/:id/issues', requirePermission('pmo.issues.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    const issues = await prisma.issue.findMany({
      where: {
        projectId: id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(issues);
  } catch (error) {
    console.error('Error fetching issues:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:id/issues
router.post('/projects/:id/issues', requirePermission('pmo.issues.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { title, description, category, priority, status, assignedTo, assignedType, notes } = req.body;

    if (!title) {
      res.status(400).json({ error: 'Issue title is required' });
      return;
    }

    if (!(await requireProjectAccess(req, res, id))) return;

    const issue = await prisma.issue.create({
      data: {
        projectId: id,
        title,
        description: description || null,
        category: category || null,
        priority: priority || 'medium',
        status: status || 'open',
        assignedTo: assignedTo || null,
        assignedType: assignedType || null,
        notes: notes || null,
      },
    });

    res.status(201).json(issue);
  } catch (error) {
    console.error('Error creating issue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/issues/:id
router.put('/issues/:id', requirePermission('pmo.issues.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      title,
      description,
      category,
      priority,
      status,
      assignedTo,
      assignedType,
      resolution,
      resolvedAt,
      closedAt,
      notes,
    } = req.body;

    const issue = await prisma.issue.findFirst({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!issue || issue.project.orgId !== req.org.id) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const updated = await prisma.issue.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(priority && { priority }),
        ...(status && { status }),
        ...(assignedTo !== undefined && { assignedTo }),
        ...(assignedType !== undefined && { assignedType }),
        ...(resolution !== undefined && { resolution }),
        ...(resolvedAt !== undefined && { resolvedAt: resolvedAt ? new Date(resolvedAt) : null }),
        ...(closedAt !== undefined && { closedAt: closedAt ? new Date(closedAt) : null }),
        ...(notes !== undefined && { notes }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating issue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/issues/:id
router.delete('/issues/:id', requirePermission('pmo.issues.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const issue = await prisma.issue.findFirst({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!issue || issue.project.orgId !== req.org.id) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    await prisma.issue.delete({
      where: { id },
    });

    res.json({ message: 'Issue deleted successfully' });
  } catch (error) {
    console.error('Error deleting issue:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// MILESTONES
// ============================================

// GET /api/pmo/projects/:id/milestones
router.get('/projects/:id/milestones', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    if (!(await requireProjectAccess(req, res, id))) return;

    const milestones = await prisma.projectMilestone.findMany({
      where: { projectId: id },
      orderBy: { targetDate: 'asc' },
    });

    res.json(milestones);
  } catch (error) {
    console.error('Error fetching milestones:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:id/milestones
router.post('/projects/:id/milestones', requirePermission('pmo.projects.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, description, targetDate, status, notes } = req.body;

    if (!name || !targetDate) {
      res.status(400).json({ error: 'Name and target date are required' });
      return;
    }

    if (!(await requireProjectAccess(req, res, id))) return;

    const milestone = await prisma.projectMilestone.create({
      data: {
        projectId: id,
        name,
        description: description || null,
        targetDate: new Date(targetDate),
        status: status || 'pending',
        notes: notes || null,
      },
    });

    res.status(201).json(milestone);
  } catch (error) {
    console.error('Error creating milestone:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/milestones/:id
router.put('/milestones/:id', requirePermission('pmo.projects.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, description, targetDate, completedAt, status, notes } = req.body;

    const milestone = await prisma.projectMilestone.findFirst({
      where: { id },
      include: { project: true },
    });

    if (!milestone || milestone.project.orgId !== req.org.id) {
      res.status(404).json({ error: 'Milestone not found' });
      return;
    }

    const updated = await prisma.projectMilestone.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(targetDate && { targetDate: new Date(targetDate) }),
        ...(completedAt !== undefined && { completedAt: completedAt ? new Date(completedAt) : null }),
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating milestone:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/milestones/:id
router.delete('/milestones/:id', requirePermission('pmo.projects.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const milestone = await prisma.projectMilestone.findFirst({
      where: { id },
      include: { project: true },
    });

    if (!milestone || milestone.project.orgId !== req.org.id) {
      res.status(404).json({ error: 'Milestone not found' });
      return;
    }

    await prisma.projectMilestone.delete({
      where: { id },
    });

    res.json({ message: 'Milestone deleted successfully' });
  } catch (error) {
    console.error('Error deleting milestone:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// PROJECT DOCUMENTS
// ============================================

// GET /api/pmo/projects/:id/documents
router.get('/projects/:id/documents', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const accessResult = await requireProjectAccess(req, res, id);
    if (!accessResult) return;

    const documents = await prisma.projectDocument.findMany({
      where: { projectId: id },
      include: { file: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json(documents);
  } catch (error) {
    console.error('Error fetching project documents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:id/documents
router.post('/projects/:id/documents', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { fileId, category, title, notes } = req.body;

    if (!fileId) {
      res.status(400).json({ error: 'fileId is required' });
      return;
    }

    const accessResult = await requireProjectAccess(req, res, id);
    if (!accessResult) return;

    if (accessResult.access === 'org') {
      const permKeys = await getUserPermissionKeys(req);
      if (!permKeys.has('*') && !permKeys.has('pmo.projects.edit')) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    }

    const file = await prisma.file.findFirst({
      where: { id: fileId, organizationId: req.org.id },
    });
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const doc = await prisma.projectDocument.create({
      data: {
        projectId: id,
        fileId,
        category: category || null,
        title: title || file.originalName,
        notes: notes || null,
      },
      include: { file: true },
    });

    res.status(201).json(doc);
  } catch (error) {
    console.error('Error creating project document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/projects/:id/documents/:docId
router.put('/projects/:id/documents/:docId', requirePermission('pmo.projects.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, docId } = req.params;
    const accessResult = await requireProjectAccess(req, res, id);
    if (!accessResult) return;
    if (accessResult.access === 'client') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { category, title, notes } = req.body;
    const existing = await prisma.projectDocument.findFirst({
      where: { id: docId, projectId: id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const updated = await prisma.projectDocument.update({
      where: { id: docId },
      data: {
        ...(category !== undefined && { category }),
        ...(title !== undefined && { title }),
        ...(notes !== undefined && { notes }),
      },
      include: { file: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating project document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/projects/:id/documents/:docId
router.delete('/projects/:id/documents/:docId', requirePermission('pmo.projects.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, docId } = req.params;
    const accessResult = await requireProjectAccess(req, res, id);
    if (!accessResult) return;
    if (accessResult.access === 'client') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const existing = await prisma.projectDocument.findFirst({
      where: { id: docId, projectId: id },
      include: { file: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    await prisma.projectDocument.delete({ where: { id: docId } });

    if (existing.file.storageKey) {
      const { storageService } = await import('../../core/storage');
      await storageService.deleteFile(existing.file.storageKey, existing.file.storageType);
      await prisma.file.delete({ where: { id: existing.fileId } }).catch(() => undefined);
    }

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error deleting project document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// WIDGETS
// ============================================

// GET /api/pmo/widgets/project-count
router.get('/widgets/project-count', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const listWhere = await getProjectListWhere(req);
    if (!listWhere) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.project.count({
      where: {
        orgId: req.org.id,
        ...(listWhere.id ? { id: listWhere.id } : {}),
        status: {
          in: ['planning', 'active'],
        },
      },
    });

    res.json({ count });
  } catch (error) {
    console.error('Error fetching project count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pmo/widgets/overdue-tasks
router.get('/widgets/overdue-tasks', requirePermission('pmo.tasks.view'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const listWhere = await getProjectListWhere(req);
    if (!listWhere) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.projectTask.count({
      where: {
        orgId: req.org.id,
        ...(listWhere.id ? { project: { id: listWhere.id } } : {}),
        status: { notIn: ['completed', 'cancelled'] },
        dueDate: { lt: new Date() },
      },
    });

    res.json({ count });
  } catch (error) {
    console.error('Error fetching overdue tasks count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/widgets/avg-progress', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    const listWhere = await getProjectListWhere(req);
    if (!listWhere) return res.status(401).json({ error: 'Unauthorized' });
    const projects = await prisma.project.findMany({
      where: { orgId: req.org.id, ...(listWhere.id ? { id: listWhere.id } : {}) },
      select: { progress: true },
    });
    const avg =
      projects.length > 0
        ? Math.round(projects.reduce((s, p) => s + (p.progress || 0), 0) / projects.length)
        : 0;
    res.json({ count: avg, label: `${avg}%` });
  } catch (error) {
    console.error('Error fetching avg progress:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/widgets/pending-changes', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    const listWhere = await getProjectListWhere(req);
    if (!listWhere) return res.status(401).json({ error: 'Unauthorized' });
    const count = await prisma.projectChangeRequest.count({
      where: { status: 'pending', project: { orgId: req.org.id, ...(listWhere.id ? { id: listWhere.id } : {}) } },
    });
    res.json({ count });
  } catch (error) {
    console.error('Error fetching pending changes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/widgets/delayed-projects', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org || !req.user) return res.status(401).json({ error: 'Unauthorized' });
    const listWhere = await getProjectListWhere(req);
    if (!listWhere) return res.status(401).json({ error: 'Unauthorized' });
    const now = new Date();
    const count = await prisma.project.count({
      where: {
        orgId: req.org.id,
        ...(listWhere.id ? { id: listWhere.id } : {}),
        endDate: { lt: now },
        status: { notIn: ['completed', 'cancelled'] },
      },
    });
    res.json({ count });
  } catch (error) {
    console.error('Error fetching delayed projects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pmo/resources/loading — cross-project resource utilization
router.get('/resources/loading', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const orgId = req.org.id;
    const tasks = await prisma.projectTask.findMany({
      where: {
        orgId,
        project: { status: { in: ['planning', 'active', 'on_hold'] } },
        assigneeId: { not: null },
        status: { in: ['submitted', 'in_progress', 'review'] },
      },
      select: {
        id: true,
        title: true,
        status: true,
        estimatedMinutes: true,
        assigneeId: true,
        assignee: { select: { id: true, fullName: true, email: true, userId: true } },
        project: { select: { id: true, name: true } },
      },
    });

    const byAssignee = new Map<
      string,
      {
        employeeId: string;
        userId: string | null;
        name: string;
        email: string;
        openTasks: number;
        estimatedMinutes: number;
        projects: Set<string>;
      }
    >();

    for (const t of tasks) {
      if (!t.assigneeId || !t.assignee) continue;
      const displayName = t.assignee.fullName || t.assignee.email || 'Employee';
      const row = byAssignee.get(t.assigneeId) ?? {
        employeeId: t.assigneeId,
        userId: t.assignee.userId,
        name: displayName,
        email: t.assignee.email ?? '',
        openTasks: 0,
        estimatedMinutes: 0,
        projects: new Set<string>(),
      };
      row.openTasks++;
      row.estimatedMinutes += t.estimatedMinutes ?? 0;
      row.projects.add(t.project.name);
      byAssignee.set(t.assigneeId, row);
    }

    res.json(
      Array.from(byAssignee.values())
        .map((r) => ({
          employeeId: r.employeeId,
          userId: r.userId,
          name: r.name,
          email: r.email,
          openTasks: r.openTasks,
          estimatedHours: Math.round((r.estimatedMinutes / 60) * 10) / 10,
          projectCount: r.projects.size,
          projects: Array.from(r.projects),
        }))
        .sort((a, b) => b.openTasks - a.openTasks)
    );
  } catch (error) {
    console.error('Error fetching resource loading:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});










