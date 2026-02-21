import { Router } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import { hashPassword } from '../../core/auth/password';
import type { ModuleManifest } from '@cloud-org/shared';

const router = Router();

// Module manifest
export const pmoManifest: ModuleManifest = {
  key: 'pmo',
  name: 'PMO Portal',
  icon: 'briefcase',
  sidebarItems: [
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
      path: '/pmo/issues',
      label: 'Issues',
      permission: 'pmo.issues.view',
    },
    {
      path: '/pmo/milestones',
      label: 'Milestones',
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
  ],
};

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

// GET /api/pmo/projects
router.get('/projects', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const projects = await prisma.project.findMany({
      where: {
        orgId: req.org.id,
      },
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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        projectManagers: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                email: true,
                position: true,
                department: true,
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
        deliverables: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        budgets: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        risks: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        issues: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        milestones: {
          orderBy: {
            targetDate: 'asc',
          },
        },
        documents: {
          include: {
            file: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json(project);
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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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

// DELETE /api/pmo/projects/:id
router.delete('/projects/:id', requirePermission('pmo.projects.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
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
    const { name, email, password, phone, company } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Check user limit
    const organization = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: { maxUsers: true },
    });

    if (organization != null && organization.maxUsers != null && organization.maxUsers !== undefined) {
      const currentUserCount = await prisma.membership.count({
        where: {
          organizationId: req.org.id,
          isActive: true,
        },
      });

      if (currentUserCount >= organization.maxUsers) {
        res.status(403).json({
          error: `User limit reached. Maximum ${organization.maxUsers} users allowed.`,
          currentCount: currentUserCount,
          maxUsers: organization.maxUsers,
        });
        return;
      }
    }

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

// GET /api/pmo/projects/:id/client-managers
router.get('/projects/:id/client-managers', requirePermission('pmo.client_managers.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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
// DELIVERABLES
// ============================================

// GET /api/pmo/projects/:id/deliverables
router.get('/projects/:id/deliverables', requirePermission('pmo.deliverables.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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
    const { name, description, status, priority, dueDate, assignedTo, assignedType, notes } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Deliverable name is required' });
      return;
    }

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const deliverable = await prisma.deliverable.create({
      data: {
        projectId: id,
        name,
        description: description || null,
        status: status || 'not_started',
        priority: priority || 'medium',
        dueDate: dueDate ? new Date(dueDate) : null,
        assignedTo: assignedTo || null,
        assignedType: assignedType || null,
        notes: notes || null,
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
    const { name, description, status, priority, dueDate, assignedTo, assignedType, notes, completedAt } = req.body;

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

    const updated = await prisma.deliverable.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(status && { status }),
        ...(priority && { priority }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(assignedTo !== undefined && { assignedTo }),
        ...(assignedType !== undefined && { assignedType }),
        ...(notes !== undefined && { notes }),
        ...(completedAt !== undefined && { completedAt: completedAt ? new Date(completedAt) : null }),
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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const budgets = await prisma.budget.findMany({
      where: {
        projectId: id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculate totals
    const totalBudgeted = budgets.reduce((sum, b) => sum + b.budgetedCents, 0);
    const totalSpent = budgets.reduce((sum, b) => sum + b.spentCents, 0);

    res.json({
      budgets,
      totals: {
        budgetedCents: totalBudgeted,
        spentCents: totalSpent,
        remainingCents: totalBudgeted - totalSpent,
        currency: project.currency,
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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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

    const project = await prisma.project.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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

    const project = await prisma.project.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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

    const project = await prisma.project.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

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
// WIDGETS
// ============================================

// GET /api/pmo/widgets/project-count
router.get('/widgets/project-count', requirePermission('pmo.projects.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.project.count({
      where: {
        orgId: req.org.id,
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










