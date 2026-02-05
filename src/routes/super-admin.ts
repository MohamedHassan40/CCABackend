import { Router, Request, Response } from 'express';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/permissions';

const router = Router();

// All routes require super admin
router.use(authMiddleware, requireSuperAdmin);

// GET /api/super-admin/organizations
router.get('/organizations', async (req: Request, res: Response) => {
  try {
    const organizations = await prisma.organization.findMany({
      include: {
        currentBundle: true,
        memberships: {
          where: { isActive: true },
        },
        orgModules: {
          where: { isEnabled: true },
          include: {
            module: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const now = new Date();
    const result = organizations.map((org) => {
      // Find the earliest trial end date and latest expiry date
      const trialModules = org.orgModules.filter((om) => om.trialEndsAt && om.trialEndsAt >= now);
      const earliestTrialEnd = trialModules.length > 0
        ? new Date(Math.min(...trialModules.map((om) => new Date(om.trialEndsAt!).getTime())))
        : null;
      const latestExpiry = org.orgModules
        .filter((om) => om.expiresAt)
        .map((om) => new Date(om.expiresAt!).getTime());
      const latestExpiryDate = latestExpiry.length > 0
        ? new Date(Math.max(...latestExpiry))
        : null;

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        isActive: org.isActive,
        status: org.status,
        industry: org.industry,
        companySize: org.companySize,
        signupSource: org.signupSource,
        maxUsers: org.maxUsers,
        maxEmployees: org.maxEmployees,
        expiresAt: org.expiresAt,
        currentBundleId: org.currentBundleId,
        currentBundle: org.currentBundle ? { id: org.currentBundle.id, name: org.currentBundle.name, priceCents: org.currentBundle.priceCents, billingPeriod: org.currentBundle.billingPeriod, maxUsers: org.currentBundle.maxUsers, maxEmployees: org.currentBundle.maxEmployees } : null,
        isOrgExpired: org.expiresAt ? org.expiresAt < now : false,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
        userCount: org.memberships.length,
        enabledModuleCount: org.orgModules.length,
        earliestTrialEnd,
        latestExpiryDate,
        enabledModules: org.orgModules.map((om) => ({
          moduleKey: om.module.key,
          moduleName: om.module.name,
          plan: om.plan,
          seats: om.seats,
          expiresAt: om.expiresAt,
          trialEndsAt: om.trialEndsAt,
          isExpired: om.expiresAt ? om.expiresAt < now : false,
          isTrial: !!om.trialEndsAt && om.trialEndsAt >= now,
        })),
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/super-admin/organizations/:id
router.get('/organizations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const organization = await prisma.organization.findUnique({
      where: { id },
      include: {
        memberships: {
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                isSuperAdmin: true,
              },
            },
            membershipRoles: {
              include: {
                role: true,
              },
            },
          },
        },
        orgModules: {
          include: {
            module: true,
          },
        },
        subscriptions: {
          include: {
            module: true,
          },
        },
      },
    });

    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    // Get usage metrics
    const employeeCount = await prisma.employee.count({
      where: { orgId: id },
    });

    const ticketCount = await prisma.ticket.count({
      where: { orgId: id },
    });

    const openTicketCount = await prisma.ticket.count({
      where: {
        orgId: id,
        status: 'open',
      },
    });

    const now = new Date();
    const result = {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      isActive: organization.isActive,
      maxUsers: organization.maxUsers,
      maxEmployees: organization.maxEmployees,
      expiresAt: organization.expiresAt,
      currentBundleId: organization.currentBundleId,
      currentBundle: organization.currentBundle ? { id: organization.currentBundle.id, name: organization.currentBundle.name, description: organization.currentBundle.description, priceCents: organization.currentBundle.priceCents, currency: organization.currentBundle.currency, billingPeriod: organization.currentBundle.billingPeriod, maxUsers: organization.currentBundle.maxUsers, maxEmployees: organization.currentBundle.maxEmployees } : null,
      isOrgExpired: organization.expiresAt ? organization.expiresAt < now : false,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      members: organization.memberships.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        isSuperAdmin: m.user.isSuperAdmin,
        roles: m.membershipRoles.map((mr) => ({
          id: mr.role.id,
          key: mr.role.key,
          name: mr.role.name,
        })),
      })),
      modules: organization.orgModules.map((om) => ({
        moduleKey: om.module.key,
        moduleName: om.module.name,
        isEnabled: om.isEnabled,
        plan: om.plan,
        seats: om.seats,
        expiresAt: om.expiresAt,
        trialEndsAt: om.trialEndsAt,
        isExpired: om.expiresAt ? om.expiresAt < now : false,
        isTrial: !!om.trialEndsAt && om.trialEndsAt >= now,
      })),
      subscriptions: organization.subscriptions.map((s) => ({
        id: s.id,
        moduleKey: s.module.key,
        moduleName: s.module.name,
        plan: s.plan,
        seats: s.seats,
        status: s.status,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        trialEndsAt: s.trialEndsAt,
      })),
      usageMetrics: {
        employeeCount,
        ticketCount,
        openTicketCount,
      },
    };

    res.json(result);
  } catch (error) {
    console.error('Error fetching organization details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/super-admin/modules-usage
router.get('/modules-usage', async (req: Request, res: Response) => {
  try {
    const modules = await prisma.module.findMany({
      where: {
        isActive: true,
      },
      include: {
        orgModules: {
          where: { isEnabled: true },
        },
        subscriptions: {
          where: {
            status: 'active',
          },
        },
      },
    });

    const result = modules.map((module) => {
      const now = new Date();
      const activeOrgs = module.orgModules.filter((om) => {
        if (om.expiresAt && om.expiresAt < now) return false;
        if (om.trialEndsAt && om.trialEndsAt < now) return false;
        return true;
      });

      return {
        moduleKey: module.key,
        moduleName: module.name,
        totalEnabledOrgs: module.orgModules.length,
        activeOrgs: activeOrgs.length,
        activeSubscriptions: module.subscriptions.length,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching modules usage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/super-admin/users - Get all users across all organizations
router.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        memberships: {
          include: {
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            membershipRoles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const result = users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
      isActive: user.isActive,
      createdAt: user.createdAt,
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        roles: m.membershipRoles.map((mr) => ({
          id: mr.role.id,
          key: mr.role.key,
          name: mr.role.name,
        })),
      })),
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/super-admin/users/:id/status - Update user status (activate/deactivate)
router.put('/users/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'isActive must be a boolean' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent deactivating super admin
    if (user.isSuperAdmin && !isActive) {
      res.status(400).json({ error: 'Cannot deactivate super admin user' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        isSuperAdmin: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/super-admin/users/:id - Delete user
router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent deleting super admin
    if (user.isSuperAdmin) {
      res.status(400).json({ error: 'Cannot delete super admin user' });
      return;
    }

    // Delete user (cascade will handle memberships, employees, etc.)
    await prisma.user.delete({
      where: { id },
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/super-admin/organizations/:id/modules/:moduleKey - Enable/disable module for organization
router.put('/organizations/:id/modules/:moduleKey', async (req: Request, res: Response) => {
  try {
    const { id, moduleKey } = req.params;
    const { isEnabled, plan, seats, expiresAt, trialEndsAt } = req.body;

    // Find organization
    const organization = await prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    // Find module
    const module = await prisma.module.findUnique({
      where: { key: moduleKey },
    });

    if (!module) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }

    // Update or create OrgModule
    const orgModule = await prisma.orgModule.upsert({
      where: {
        organizationId_moduleId: {
          organizationId: id,
          moduleId: module.id,
        },
      },
      update: {
        isEnabled: isEnabled !== undefined ? isEnabled : undefined,
        plan: plan !== undefined ? plan : undefined,
        seats: seats !== undefined ? seats : undefined,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : undefined,
      },
      create: {
        organizationId: id,
        moduleId: module.id,
        isEnabled: isEnabled !== undefined ? isEnabled : true,
        plan: plan || null,
        seats: seats || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
      },
      include: {
        module: true,
      },
    });

    res.json({
      moduleKey: module.key,
      moduleName: module.name,
      isEnabled: orgModule.isEnabled,
      plan: orgModule.plan,
      seats: orgModule.seats,
      expiresAt: orgModule.expiresAt,
      trialEndsAt: orgModule.trialEndsAt,
    });
  } catch (error) {
    console.error('Error updating organization module:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/super-admin/organizations/:id/user-limit - Set organization user limit
router.put('/organizations/:id/user-limit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { maxUsers } = req.body;

    if (maxUsers !== null && maxUsers !== undefined && (typeof maxUsers !== 'number' || maxUsers < 0)) {
      res.status(400).json({ error: 'maxUsers must be a positive number or null' });
      return;
    }

    // Check current user count
    const currentUserCount = await prisma.membership.count({
      where: {
        organizationId: id,
        isActive: true,
      },
    });

    if (maxUsers !== null && maxUsers < currentUserCount) {
      res.status(400).json({
        error: `Cannot set limit below current user count (${currentUserCount} users)`,
        currentUserCount,
      });
      return;
    }

    const organization = await prisma.organization.update({
      where: { id },
      data: { maxUsers: maxUsers === null ? null : maxUsers },
      select: {
        id: true,
        name: true,
        maxUsers: true,
      },
    });

    res.json(organization);
  } catch (error) {
    console.error('Error updating organization user limit:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/super-admin/organizations/:id/expiry - Set organization-level expiry
router.put('/organizations/:id/expiry', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { expiresAt } = req.body;

    const data: { expiresAt: Date | null } =
      expiresAt === null || expiresAt === undefined || expiresAt === ''
        ? { expiresAt: null }
        : { expiresAt: new Date(expiresAt) };

    const organization = await prisma.organization.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        expiresAt: true,
      },
    });

    res.json(organization);
  } catch (error) {
    console.error('Error updating organization expiry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/super-admin/organizations/:id/employee-limit - Set organization employee limit
router.put('/organizations/:id/employee-limit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { maxEmployees } = req.body;

    if (maxEmployees !== null && maxEmployees !== undefined && (typeof maxEmployees !== 'number' || maxEmployees < 0)) {
      res.status(400).json({ error: 'maxEmployees must be a positive number or null' });
      return;
    }

    const currentEmployeeCount = await prisma.employee.count({
      where: { orgId: id },
    });

    if (maxEmployees !== null && maxEmployees < currentEmployeeCount) {
      res.status(400).json({
        error: `Cannot set limit below current employee count (${currentEmployeeCount} employees)`,
        currentEmployeeCount,
      });
      return;
    }

    const organization = await prisma.organization.update({
      where: { id },
      data: { maxEmployees: maxEmployees === null ? null : maxEmployees },
      select: {
        id: true,
        name: true,
        maxEmployees: true,
      },
    });

    res.json(organization);
  } catch (error) {
    console.error('Error updating organization employee limit:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/super-admin/organizations/:id/package - Assign a bundle/package to organization
router.put('/organizations/:id/package', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { bundleId } = req.body;

    const organization = await prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    if (bundleId === null || bundleId === undefined || bundleId === '') {
      // Unassign package
      await prisma.organization.update({
        where: { id },
        data: { currentBundleId: null },
      });
      res.json({
        message: 'Package unassigned',
        currentBundleId: null,
        currentBundle: null,
      });
      return;
    }

    const bundle = await prisma.bundle.findUnique({
      where: { id: bundleId },
      include: {
        bundleModules: {
          include: { module: true },
        },
      },
    });

    if (!bundle || !bundle.isActive) {
      res.status(404).json({ error: 'Bundle not found or inactive' });
      return;
    }

    const currentUserCount = await prisma.membership.count({
      where: { organizationId: id, isActive: true },
    });
    const currentEmployeeCount = await prisma.employee.count({
      where: { orgId: id },
    });

    const newMaxUsers = bundle.maxUsers ?? organization.maxUsers;
    const newMaxEmployees = bundle.maxEmployees ?? organization.maxEmployees;

    if (newMaxUsers !== null && newMaxUsers < currentUserCount) {
      res.status(400).json({
        error: `Bundle allows max ${newMaxUsers} users; organization has ${currentUserCount}. Increase bundle limit or remove users first.`,
        currentUserCount,
        bundleMaxUsers: newMaxUsers,
      });
      return;
    }
    if (newMaxEmployees !== null && newMaxEmployees < currentEmployeeCount) {
      res.status(400).json({
        error: `Bundle allows max ${newMaxEmployees} employees; organization has ${currentEmployeeCount}. Increase bundle limit or remove employees first.`,
        currentEmployeeCount,
        bundleMaxEmployees: newMaxEmployees,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id },
        data: {
          currentBundleId: bundle.id,
          maxUsers: bundle.maxUsers !== null ? bundle.maxUsers : organization.maxUsers,
          maxEmployees: bundle.maxEmployees !== null ? bundle.maxEmployees : organization.maxEmployees,
        },
      });

      for (const bm of bundle.bundleModules) {
        await tx.orgModule.upsert({
          where: {
            organizationId_moduleId: {
              organizationId: id,
              moduleId: bm.moduleId,
            },
          },
          update: {
            isEnabled: true,
            plan: bm.plan,
          },
          create: {
            organizationId: id,
            moduleId: bm.moduleId,
            isEnabled: true,
            plan: bm.plan,
          },
        });
      }
    });

    const updated = await prisma.organization.findUnique({
      where: { id },
      include: { currentBundle: true },
    });

    res.json({
      message: 'Package assigned',
      currentBundleId: updated!.currentBundleId,
      currentBundle: updated!.currentBundle
        ? {
            id: updated!.currentBundle.id,
            name: updated!.currentBundle.name,
            priceCents: updated!.currentBundle.priceCents,
            billingPeriod: updated!.currentBundle.billingPeriod,
            maxUsers: updated!.currentBundle.maxUsers,
            maxEmployees: updated!.currentBundle.maxEmployees,
          }
        : null,
      maxUsers: updated!.maxUsers,
      maxEmployees: updated!.maxEmployees,
    });
  } catch (error) {
    console.error('Error assigning package:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/super-admin/modules - Get all available modules (active only)
router.get('/modules', async (req: Request, res: Response) => {
  try {
    const modules = await prisma.module.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json(modules);
  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/super-admin/modules/all - Get all modules (including inactive)
router.get('/modules/all', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const modules = await prisma.module.findMany({
      orderBy: {
        name: 'asc',
      },
    });

    res.json(modules);
  } catch (error) {
    console.error('Error fetching all modules:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/super-admin/modules/:moduleKey/availability - Toggle module availability
router.put('/modules/:moduleKey/availability', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { moduleKey } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'isActive must be a boolean' });
      return;
    }

    const module = await prisma.module.findUnique({
      where: { key: moduleKey },
    });

    if (!module) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }

    const updated = await prisma.module.update({
      where: { key: moduleKey },
      data: { isActive },
    });

    res.json({
      id: updated.id,
      key: updated.key,
      name: updated.name,
      isActive: updated.isActive,
      message: `Module ${updated.name} is now ${updated.isActive ? 'available' : 'unavailable'}`,
    });
  } catch (error) {
    console.error('Error toggling module availability:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/super-admin/organizations/:id/status - Suspend/Activate organization
router.put('/organizations/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive, status } = req.body;

    const organization = await prisma.organization.findUnique({ where: { id } });
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const updateData: any = {};
    if (typeof isActive === 'boolean') updateData.isActive = isActive;
    if (status) updateData.status = status;

    const updated = await prisma.organization.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating organization status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/super-admin/organizations/:id - Delete organization
router.delete('/organizations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const organization = await prisma.organization.findUnique({ where: { id } });
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Delete organization (cascade will handle related records)
    await prisma.organization.delete({
      where: { id },
    });

    res.json({ message: 'Organization deleted successfully' });
  } catch (error) {
    console.error('Error deleting organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/super-admin/organizations/:id/extend-trial - Extend trial for all modules
router.post('/organizations/:id/extend-trial', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { days } = req.body;

    if (!days || typeof days !== 'number' || days <= 0) {
      return res.status(400).json({ error: 'Days must be a positive number' });
    }

    const organization = await prisma.organization.findUnique({ where: { id } });
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const orgModules = await prisma.orgModule.findMany({
      where: { organizationId: id, isEnabled: true },
    });

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + days);

    // Extend trial for all enabled modules
    for (const orgModule of orgModules) {
      await prisma.orgModule.update({
        where: { id: orgModule.id },
        data: {
          trialEndsAt,
          plan: orgModule.plan || 'trial',
        },
      });
    }

    res.json({ message: `Trial extended by ${days} days`, trialEndsAt });
  } catch (error) {
    console.error('Error extending trial:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/super-admin/modules/:moduleKey/organizations - Get organizations with module and their users with roles
router.get('/modules/:moduleKey/organizations', async (req: Request, res: Response) => {
  try {
    const { moduleKey } = req.params;

    // Find the module
    const module = await prisma.module.findUnique({
      where: { key: moduleKey },
    });

    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    // Get all organizations that have this module enabled
    const orgModules = await prisma.orgModule.findMany({
      where: {
        moduleId: module.id,
        isEnabled: true,
      },
      include: {
        organization: {
          include: {
            memberships: {
              where: { isActive: true },
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    name: true,
                    isSuperAdmin: true,
                  },
                },
                membershipRoles: {
                  include: {
                    role: true,
                  },
                },
              },
            },
          },
        },
        module: true,
      },
    });

    const now = new Date();

    // Map module key to role prefixes (e.g., 'ticketing' -> roles starting with 'ticketing.')
    const moduleRolePrefixes: Record<string, string[]> = {
      ticketing: ['ticketing.'],
      hr: ['hr.'],
      marketplace: ['marketplace.'],
      inventory: ['inventory.'],
    };

    const rolePrefixes = moduleRolePrefixes[moduleKey] || [`${moduleKey}.`];

    const result = orgModules.map((orgModule) => {
      // Filter users who have roles in this module
      const usersWithModuleRoles = orgModule.organization.memberships
        .map((membership) => {
          const moduleRoles = membership.membershipRoles.filter((mr) =>
            rolePrefixes.some((prefix) => mr.role.key.startsWith(prefix))
          );

          if (moduleRoles.length === 0) {
            return null;
          }

          return {
            id: membership.user.id,
            email: membership.user.email,
            name: membership.user.name,
            isSuperAdmin: membership.user.isSuperAdmin,
            roles: moduleRoles.map((mr) => ({
              id: mr.role.id,
              key: mr.role.key,
              name: mr.role.name,
            })),
          };
        })
        .filter((user): user is NonNullable<typeof user> => user !== null);

      return {
        organization: {
          id: orgModule.organization.id,
          name: orgModule.organization.name,
          slug: orgModule.organization.slug,
        },
        module: {
          moduleKey: orgModule.module.key,
          moduleName: orgModule.module.name,
          isEnabled: orgModule.isEnabled,
          plan: orgModule.plan,
          seats: orgModule.seats,
          expiresAt: orgModule.expiresAt,
          trialEndsAt: orgModule.trialEndsAt,
          isExpired: orgModule.expiresAt ? orgModule.expiresAt < now : false,
          isTrial: !!orgModule.trialEndsAt && orgModule.trialEndsAt >= now,
        },
        users: usersWithModuleRoles,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching organizations with module:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// PRICING MANAGEMENT
// ============================================

// GET /api/super-admin/modules/:moduleKey/prices - Get all prices for a module
router.get('/modules/:moduleKey/prices', async (req: Request, res: Response) => {
  try {
    const { moduleKey } = req.params;

    const module = await prisma.module.findUnique({
      where: { key: moduleKey },
    });

    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const prices = await prisma.modulePrice.findMany({
      where: { moduleId: module.id },
      orderBy: [
        { plan: 'asc' },
        { billingPeriod: 'asc' },
      ],
    });

    res.json(prices.map((p) => ({
      id: p.id,
      plan: p.plan,
      priceCents: p.priceCents,
      currency: p.currency,
      billingPeriod: p.billingPeriod,
      maxSeats: p.maxSeats,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })));
  } catch (error) {
    console.error('Error fetching module prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/super-admin/modules/:moduleKey/prices - Create a new price
router.post('/modules/:moduleKey/prices', async (req: Request, res: Response) => {
  try {
    const { moduleKey } = req.params;
    const { plan, priceCents, currency, billingPeriod, maxSeats } = req.body;

    if (!plan || !priceCents || !billingPeriod) {
      return res.status(400).json({ error: 'plan, priceCents, and billingPeriod are required' });
    }

    if (!['monthly', 'yearly'].includes(billingPeriod)) {
      return res.status(400).json({ error: 'billingPeriod must be "monthly" or "yearly"' });
    }

    const module = await prisma.module.findUnique({
      where: { key: moduleKey },
    });

    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    // Handle priceCents - can be number or string
    const parsedPriceCents = typeof priceCents === 'number' ? priceCents : parseInt(priceCents, 10);
    if (isNaN(parsedPriceCents)) {
      return res.status(400).json({ error: 'priceCents must be a valid number' });
    }

    // Handle maxSeats
    let parsedMaxSeats: number | null = null;
    if (maxSeats !== undefined && maxSeats !== null && maxSeats !== '') {
      parsedMaxSeats = typeof maxSeats === 'number' ? maxSeats : parseInt(maxSeats, 10);
      if (isNaN(parsedMaxSeats)) {
        return res.status(400).json({ error: 'maxSeats must be a valid number or empty' });
      }
    }

    const price = await prisma.modulePrice.create({
      data: {
        moduleId: module.id,
        plan,
        priceCents: parsedPriceCents,
        currency: 'SAR', // Only SAR is supported
        billingPeriod,
        maxSeats: parsedMaxSeats,
      },
    });

    res.status(201).json(price);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A price with this plan and billing period already exists' });
    }
    console.error('Error creating module price:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/super-admin/prices/:id - Update a price
router.put('/prices/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { plan, priceCents, currency, billingPeriod, maxSeats } = req.body;

    const existingPrice = await prisma.modulePrice.findUnique({
      where: { id },
    });

    if (!existingPrice) {
      return res.status(404).json({ error: 'Price not found' });
    }

    const updateData: any = {};
    if (plan !== undefined) updateData.plan = plan;
    if (priceCents !== undefined) {
      // Handle both string and number inputs
      updateData.priceCents = typeof priceCents === 'number' ? priceCents : parseInt(String(priceCents), 10);
      if (isNaN(updateData.priceCents)) {
        return res.status(400).json({ error: 'priceCents must be a valid number' });
      }
    }
    // Currency is always SAR, always set it to ensure consistency
    updateData.currency = 'SAR';
    if (billingPeriod !== undefined) {
      if (!['monthly', 'yearly'].includes(billingPeriod)) {
        return res.status(400).json({ error: 'billingPeriod must be "monthly" or "yearly"' });
      }
      updateData.billingPeriod = billingPeriod;
    }
    if (maxSeats !== undefined) {
      // Handle empty string, null, or number
      if (maxSeats === null || maxSeats === '' || maxSeats === undefined) {
        updateData.maxSeats = null;
      } else {
        const parsedMaxSeats = typeof maxSeats === 'number' ? maxSeats : parseInt(String(maxSeats), 10);
        if (isNaN(parsedMaxSeats) || parsedMaxSeats < 1) {
          return res.status(400).json({ error: 'maxSeats must be a valid positive number or empty for unlimited' });
        }
        updateData.maxSeats = parsedMaxSeats;
      }
    }

    // If plan or billingPeriod is being changed, check for conflicts
    const newPlan = plan !== undefined ? plan : existingPrice.plan;
    const newBillingPeriod = billingPeriod !== undefined ? billingPeriod : existingPrice.billingPeriod;
    
    if (newPlan !== existingPrice.plan || newBillingPeriod !== existingPrice.billingPeriod) {
      const module = await prisma.module.findUnique({
        where: { id: existingPrice.moduleId },
      });

      if (module) {
        const conflictingPrice = await prisma.modulePrice.findUnique({
          where: {
            moduleId_plan_billingPeriod: {
              moduleId: module.id,
              plan: newPlan,
              billingPeriod: newBillingPeriod,
            },
          },
        });

        if (conflictingPrice && conflictingPrice.id !== id) {
          return res.status(409).json({ error: 'A price with this plan and billing period already exists' });
        }
      }
    }

    // Ensure we have at least one field to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const updated = await prisma.modulePrice.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A price with this plan and billing period already exists' });
    }
    console.error('Error updating module price:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack,
    });
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// DELETE /api/super-admin/prices/:id - Delete a price
router.delete('/prices/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const price = await prisma.modulePrice.findUnique({
      where: { id },
    });

    if (!price) {
      return res.status(404).json({ error: 'Price not found' });
    }

    await prisma.modulePrice.delete({
      where: { id },
    });

    res.json({ message: 'Price deleted successfully' });
  } catch (error) {
    console.error('Error deleting module price:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// BUNDLES MANAGEMENT
// ============================================

// Helper function to get module IDs
async function getModuleIds(moduleKeys: string[]): Promise<Map<string, string>> {
  const modules = await prisma.module.findMany({
    where: { key: { in: moduleKeys } },
  });
  return new Map(modules.map((m) => [m.key, m.id]));
}

// GET /api/super-admin/bundles - Get all bundles
router.get('/bundles', async (req: Request, res: Response) => {
  try {
    const bundles = await prisma.bundle.findMany({
      include: {
        bundleModules: {
          include: {
            module: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(bundles.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      priceCents: b.priceCents,
      currency: b.currency,
      billingPeriod: b.billingPeriod,
      isActive: b.isActive,
      discountPercentage: b.discountPercentage,
      maxUsers: b.maxUsers,
      maxEmployees: b.maxEmployees,
      modules: b.bundleModules.map((bm) => ({
        moduleId: bm.moduleId,
        moduleKey: bm.module.key,
        moduleName: bm.module.name,
        plan: bm.plan,
      })),
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    })));
  } catch (error) {
    console.error('Error fetching bundles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/super-admin/bundles/:id - Get a single bundle
router.get('/bundles/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const bundle = await prisma.bundle.findUnique({
      where: { id },
      include: {
        bundleModules: {
          include: {
            module: true,
          },
        },
      },
    });

    if (!bundle) {
      return res.status(404).json({ error: 'Bundle not found' });
    }

    res.json({
      id: bundle.id,
      name: bundle.name,
      description: bundle.description,
      priceCents: bundle.priceCents,
      currency: bundle.currency,
      billingPeriod: bundle.billingPeriod,
      isActive: bundle.isActive,
      discountPercentage: bundle.discountPercentage,
      maxUsers: bundle.maxUsers,
      maxEmployees: bundle.maxEmployees,
      modules: bundle.bundleModules.map((bm) => ({
        moduleId: bm.moduleId,
        moduleKey: bm.module.key,
        moduleName: bm.module.name,
        plan: bm.plan,
      })),
      createdAt: bundle.createdAt,
      updatedAt: bundle.updatedAt,
    });
  } catch (error) {
    console.error('Error fetching bundle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/super-admin/bundles - Create a new bundle
router.post('/bundles', async (req: Request, res: Response) => {
  try {
    const { name, description, priceCents, currency, billingPeriod, discountPercentage, modules } = req.body;

    if (!name || !priceCents || !billingPeriod || !modules || !Array.isArray(modules) || modules.length === 0) {
      return res.status(400).json({ error: 'name, priceCents, billingPeriod, and modules array are required' });
    }

    if (!['monthly', 'yearly'].includes(billingPeriod)) {
      return res.status(400).json({ error: 'billingPeriod must be "monthly" or "yearly"' });
    }

    // Verify all modules exist
    for (const mod of modules) {
      if (!mod.moduleKey || !mod.plan) {
        return res.status(400).json({ error: 'Each module must have moduleKey and plan' });
      }

      const moduleExists = await prisma.module.findUnique({
        where: { key: mod.moduleKey },
      });

      if (!moduleExists) {
        return res.status(404).json({ error: `Module "${mod.moduleKey}" not found` });
      }
    }

    // Fetch module IDs for all modules first
    const moduleMap = await getModuleIds(modules.map((mod: any) => mod.moduleKey));

    // Create bundle
    const bundle = await prisma.bundle.create({
      data: {
        name,
        description: description || null,
      priceCents: parseInt(priceCents),
      currency: 'SAR', // Only SAR is supported
      billingPeriod,
        discountPercentage: discountPercentage ? parseInt(discountPercentage) : null,
      },
    });

    // Create bundle modules
    await prisma.bundleModule.createMany({
      data: modules.map((mod: any) => ({
        bundleId: bundle.id,
        moduleId: moduleMap.get(mod.moduleKey)!,
        plan: mod.plan,
      })),
    });

    const createdBundle = await prisma.bundle.findUnique({
      where: { id: bundle.id },
      include: {
        bundleModules: {
          include: {
            module: true,
          },
        },
      },
    });

    res.status(201).json({
      id: createdBundle!.id,
      name: createdBundle!.name,
      description: createdBundle!.description,
      priceCents: createdBundle!.priceCents,
      currency: createdBundle!.currency,
      billingPeriod: createdBundle!.billingPeriod,
      isActive: createdBundle!.isActive,
      discountPercentage: createdBundle!.discountPercentage,
      modules: createdBundle!.bundleModules.map((bm) => ({
        moduleId: bm.moduleId,
        moduleKey: bm.module.key,
        moduleName: bm.module.name,
        plan: bm.plan,
      })),
      createdAt: createdBundle!.createdAt,
      updatedAt: createdBundle!.updatedAt,
    });
  } catch (error) {
    console.error('Error creating bundle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/super-admin/bundles/:id - Update a bundle
router.put('/bundles/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, priceCents, currency, billingPeriod, discountPercentage, isActive, modules } = req.body;

    const bundle = await prisma.bundle.findUnique({
      where: { id },
    });

    if (!bundle) {
      return res.status(404).json({ error: 'Bundle not found' });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (priceCents !== undefined) updateData.priceCents = parseInt(priceCents);
    if (currency !== undefined) updateData.currency = currency;
    if (billingPeriod !== undefined) {
      if (!['monthly', 'yearly'].includes(billingPeriod)) {
        return res.status(400).json({ error: 'billingPeriod must be "monthly" or "yearly"' });
      }
      updateData.billingPeriod = billingPeriod;
    }
    if (discountPercentage !== undefined) updateData.discountPercentage = discountPercentage ? parseInt(discountPercentage) : null;
    if (isActive !== undefined) updateData.isActive = isActive;

    // Update bundle
    await prisma.bundle.update({
      where: { id },
      data: updateData,
    });

    // Update modules if provided
    if (modules && Array.isArray(modules)) {
      // Verify all modules exist
      const moduleKeys = modules.map((mod: any) => mod.moduleKey).filter(Boolean);
      const moduleMap = await getModuleIds(moduleKeys);

      for (const mod of modules) {
        if (!mod.moduleKey || !mod.plan) {
          return res.status(400).json({ error: 'Each module must have moduleKey and plan' });
        }

        if (!moduleMap.has(mod.moduleKey)) {
          return res.status(404).json({ error: `Module "${mod.moduleKey}" not found` });
        }
      }

      // Delete existing bundle modules and create new ones
      await prisma.bundleModule.deleteMany({
        where: { bundleId: id },
      });

      if (modules.length > 0) {
        await prisma.bundleModule.createMany({
          data: modules.map((mod: any) => ({
            bundleId: id,
            moduleId: moduleMap.get(mod.moduleKey)!,
            plan: mod.plan,
          })),
        });
      }
    }

    const updated = await prisma.bundle.findUnique({
      where: { id },
      include: {
        bundleModules: {
          include: {
            module: true,
          },
        },
      },
    });

    res.json({
      id: updated!.id,
      name: updated!.name,
      description: updated!.description,
      priceCents: updated!.priceCents,
      currency: updated!.currency,
      billingPeriod: updated!.billingPeriod,
      isActive: updated!.isActive,
      discountPercentage: updated!.discountPercentage,
      modules: updated!.bundleModules.map((bm) => ({
        moduleId: bm.moduleId,
        moduleKey: bm.module.key,
        moduleName: bm.module.name,
        plan: bm.plan,
      })),
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    });
  } catch (error) {
    console.error('Error updating bundle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/super-admin/bundles/:id - Delete a bundle
router.delete('/bundles/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const bundle = await prisma.bundle.findUnique({
      where: { id },
    });

    if (!bundle) {
      return res.status(404).json({ error: 'Bundle not found' });
    }

    await prisma.bundle.delete({
      where: { id },
    });

    res.json({ message: 'Bundle deleted successfully' });
  } catch (error) {
    console.error('Error deleting bundle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;


