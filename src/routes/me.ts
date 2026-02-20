import { Router, Request, Response } from 'express';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../core/auth/password';
import type { MeResponse, ModuleManifestResponse } from '@cloud-org/shared';
import { moduleRegistry } from '../core/modules/registry';

const router = Router();

// GET /api/me
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Super admin with no org - platform-level only
    if (req.user.isSuperAdmin && !req.org) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
      });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const response: MeResponse = {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.isSuperAdmin,
        },
        currentOrganization: null,
        memberships: [],
        roles: [],
        permissions: [],
        enabledModules: [],
      };
      res.json(response);
      return;
    }

    if (!req.org) {
      res.status(401).json({ error: 'Organization context required' });
      return;
    }

    // Get user with memberships
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        memberships: {
          where: { isActive: true },
          include: {
            organization: true,
            membershipRoles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Get current organization details
    const currentOrg = await prisma.organization.findUnique({
      where: { id: req.org.id },
    });

    if (!currentOrg) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    // Get roles and permissions for current org
    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: req.user.id,
          organizationId: req.org.id,
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

    const roles = membership?.membershipRoles.map((mr) => ({
      id: mr.role.id,
      key: mr.role.key,
      name: mr.role.name,
    })) || [];

    const permissions = membership?.membershipRoles.flatMap((mr) =>
      mr.role.rolePermissions.map((rp) => ({
        id: rp.permission.id,
        key: rp.permission.key,
        name: rp.permission.name,
      }))
    ) || [];

    // Remove duplicate permissions
    const uniquePermissions = Array.from(
      new Map(permissions.map((p) => [p.id, p])).values()
    );

    // Get enabled modules for current org
    const orgModules = await prisma.orgModule.findMany({
      where: {
        organizationId: req.org.id,
        isEnabled: true,
      },
      include: {
        module: true,
      },
    });

    const now = new Date();
    const enabledModules = orgModules.map((om) => {
      const isExpired = om.expiresAt ? om.expiresAt < now : false;
      const isTrial = !!om.trialEndsAt && om.trialEndsAt >= now;

      return {
        moduleKey: om.module.key,
        moduleName: om.module.name,
        isEnabled: om.isEnabled,
        plan: om.plan,
        seats: om.seats,
        expiresAt: om.expiresAt,
        trialEndsAt: om.trialEndsAt,
        isExpired,
        isTrial,
      };
    });

    const isOrgAdmin = roles.some((r) => r.key === 'owner' || r.key === 'admin');

    const response: MeResponse = {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
      },
      memberships: user.memberships.map((m) => ({
        id: m.id,
        organization: {
          id: m.organization.id,
          name: m.organization.name,
          slug: m.organization.slug,
        },
        roles: m.membershipRoles.map((mr) => ({
          id: mr.role.id,
          key: mr.role.key,
          name: mr.role.name,
        })),
      })),
      currentOrganization: {
        id: currentOrg.id,
        name: currentOrg.name,
        slug: currentOrg.slug,
        expiresAt: (currentOrg as { expiresAt?: Date | null }).expiresAt?.toISOString() ?? null,
        isOrgExpired: (currentOrg as { expiresAt?: Date | null }).expiresAt
          ? (currentOrg as { expiresAt: Date }).expiresAt < new Date()
          : false,
      },
      roles,
      isOrgAdmin,
      permissions: uniquePermissions,
      enabledModules,
    };

    res.json(response);
  } catch (error) {
    console.error('Error in /api/me:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/me/modules
router.get('/modules', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Super admin with no org - no org modules (they manage platform, not an org)
    if (req.user.isSuperAdmin && !req.org) {
      res.json([]);
      return;
    }

    if (!req.org) {
      res.status(401).json({ error: 'Organization context required' });
      return;
    }

    // Get modules for current org - include enabled ones and ones with active trials
    const now = new Date();
    const orgModules = await prisma.orgModule.findMany({
      where: {
        organizationId: req.org.id,
        OR: [
          { isEnabled: true },
          // Include modules with active trials even if not explicitly enabled
          {
            isEnabled: false,
            trialEndsAt: {
              gte: now,
            },
          },
        ],
      },
      include: {
        module: true,
      },
    });

    // Auto-enable modules with active trials
    for (const orgModule of orgModules) {
      if (!orgModule.isEnabled && orgModule.trialEndsAt && orgModule.trialEndsAt >= now) {
        await prisma.orgModule.update({
          where: {
            organizationId_moduleId: {
              organizationId: req.org.id,
              moduleId: orgModule.moduleId,
            },
          },
          data: {
            isEnabled: true,
          },
        });
        orgModule.isEnabled = true;
      }
    }

    const manifests: ModuleManifestResponse[] = [];

    // Get user's permissions for filtering
    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: req.user.id,
          organizationId: req.org.id,
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

    const userPermissionKeys = new Set(
      membership?.membershipRoles.flatMap((mr) =>
        mr.role.rolePermissions.map((rp) => rp.permission.key)
      ) || []
    );

    // Super admin has all permissions
    const hasAllPermissions = req.user.isSuperAdmin;

    for (const orgModule of orgModules) {
      // Check expiry
      const isExpired = orgModule.expiresAt ? orgModule.expiresAt < now : false;
      // Super admins don't have trials - they have full access
      const isTrial = !hasAllPermissions && !!orgModule.trialEndsAt && orgModule.trialEndsAt >= now;

      // Skip if expired (unless we want to show expired modules for upsell)
      if (isExpired && !orgModule.trialEndsAt) {
        continue;
      }

      // Get module manifest from registry
      const moduleRegistration = moduleRegistry.get(orgModule.module.key);
      if (!moduleRegistration) {
        continue;
      }

      const manifest = moduleRegistration.manifest;

      // Filter sidebar items and widgets by permissions
      const filteredSidebarItems = manifest.sidebarItems.filter((item) => {
        if (!item.permission) return true;
        return hasAllPermissions || userPermissionKeys.has(item.permission);
      });

      const filteredWidgets = manifest.dashboardWidgets.filter((widget) => {
        if (!widget.permission) return true;
        return hasAllPermissions || userPermissionKeys.has(widget.permission);
      });

      manifests.push({
        key: manifest.key,
        name: manifest.name,
        icon: manifest.icon,
        sidebarItems: filteredSidebarItems,
        dashboardWidgets: filteredWidgets,
        licensing: {
          isEnabled: orgModule.isEnabled,
          plan: orgModule.plan,
          seats: orgModule.seats,
          expiresAt: orgModule.expiresAt,
          trialEndsAt: orgModule.trialEndsAt,
          isExpired,
          isTrial,
        },
      });
    }

    res.json(manifests);
  } catch (error) {
    console.error('Error in /api/me/modules:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/me
router.put('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name !== undefined && { name: name || null }),
      },
    });

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        isSuperAdmin: updated.isSuperAdmin,
      },
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/me/password - Change password
router.put('/password', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters' });
      return;
    }

    // Get user with password hash
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        passwordHash: newPasswordHash,
      },
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

