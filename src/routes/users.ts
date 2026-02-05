import { Router, Request, Response } from 'express';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { hashPassword } from '../core/auth/password';

const router = Router();

// GET /api/users - Get all users in the organization
router.get('/', authMiddleware, requirePermission('users.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const memberships = await prisma.membership.findMany({
      where: {
        organizationId: req.org.id,
        isActive: true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            isActive: true,
            createdAt: true,
          },
        },
        membershipRoles: {
          include: {
            role: {
              select: {
                id: true,
                key: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const users = memberships.map((membership) => ({
      id: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      isActive: membership.user.isActive,
      membershipId: membership.id,
      roles: membership.membershipRoles.map((mr) => ({
        id: mr.role.id,
        key: mr.role.key,
        name: mr.role.name,
      })),
      joinedAt: membership.createdAt,
    }));

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users - Add a new user to the organization
router.post('/', authMiddleware, requirePermission('users.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Check user limit
    const organization = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: { maxUsers: true },
    });

    if (organization?.maxUsers !== null && organization.maxUsers !== undefined) {
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

    const { email, name, password, roleKeys } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    // Check if user already exists
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      if (!password) {
        res.status(400).json({ error: 'Password is required for new users' });
        return;
      }

      const passwordHash = await hashPassword(password);
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name: name || null,
        },
      });
    }

    // Check if user is already a member
    const existingMembership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: req.org.id,
        },
      },
    });

    if (existingMembership) {
      res.status(400).json({ error: 'User is already a member of this organization' });
      return;
    }

    // Create membership
    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: req.org.id,
        isActive: true,
      },
    });

    // Assign roles if provided
    if (roleKeys && Array.isArray(roleKeys) && roleKeys.length > 0) {
      const roles = await prisma.role.findMany({
        where: {
          key: { in: roleKeys },
        },
      });

      for (const role of roles) {
        await prisma.membershipRole.create({
          data: {
            membershipId: membership.id,
            roleId: role.id,
          },
        });
      }
    } else {
      // Default to 'member' role if no roles specified
      const memberRole = await prisma.role.findUnique({
        where: { key: 'member' },
      });

      if (memberRole) {
        await prisma.membershipRole.create({
          data: {
            membershipId: membership.id,
            roleId: memberRole.id,
          },
        });
      }
    }

    // Get the created membership with roles
    const createdMembership = await prisma.membership.findUnique({
      where: { id: membership.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            isActive: true,
          },
        },
        membershipRoles: {
          include: {
            role: {
              select: {
                id: true,
                key: true,
                name: true,
              },
            },
          },
        },
      },
    });

    res.status(201).json({
      id: createdMembership!.user.id,
      email: createdMembership!.user.email,
      name: createdMembership!.user.name,
      isActive: createdMembership!.user.isActive,
      membershipId: createdMembership!.id,
      roles: createdMembership!.membershipRoles.map((mr) => ({
        id: mr.role.id,
        key: mr.role.key,
        name: mr.role.name,
      })),
      joinedAt: createdMembership!.createdAt,
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/roles - Update user roles
router.put('/:id/roles', authMiddleware, requirePermission('users.manage'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { roleKeys } = req.body;

    if (!Array.isArray(roleKeys)) {
      res.status(400).json({ error: 'roleKeys must be an array' });
      return;
    }

    // Find membership
    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: id,
          organizationId: req.org.id,
        },
      },
    });

    if (!membership) {
      res.status(404).json({ error: 'User is not a member of this organization' });
      return;
    }

    // Remove all existing roles
    await prisma.membershipRole.deleteMany({
      where: {
        membershipId: membership.id,
      },
    });

    // Add new roles
    if (roleKeys.length > 0) {
      const roles = await prisma.role.findMany({
        where: {
          key: { in: roleKeys },
        },
      });

      for (const role of roles) {
        await prisma.membershipRole.create({
          data: {
            membershipId: membership.id,
            roleId: role.id,
          },
        });
      }
    }

    // Get updated membership
    const updatedMembership = await prisma.membership.findUnique({
      where: { id: membership.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            isActive: true,
          },
        },
        membershipRoles: {
          include: {
            role: {
              select: {
                id: true,
                key: true,
                name: true,
              },
            },
          },
        },
      },
    });

    res.json({
      id: updatedMembership!.user.id,
      email: updatedMembership!.user.email,
      name: updatedMembership!.user.name,
      isActive: updatedMembership!.user.isActive,
      membershipId: updatedMembership!.id,
      roles: updatedMembership!.membershipRoles.map((mr) => ({
        id: mr.role.id,
        key: mr.role.key,
        name: mr.role.name,
      })),
      joinedAt: updatedMembership!.createdAt,
    });
  } catch (error) {
    console.error('Error updating user roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/:id - Remove user from organization
router.delete('/:id', authMiddleware, requirePermission('users.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    // Prevent removing yourself
    if (id === req.user?.id) {
      res.status(400).json({ error: 'You cannot remove yourself from the organization' });
      return;
    }

    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: id,
          organizationId: req.org.id,
        },
      },
    });

    if (!membership) {
      res.status(404).json({ error: 'User is not a member of this organization' });
      return;
    }

    // Deactivate membership instead of deleting (soft delete)
    await prisma.membership.update({
      where: { id: membership.id },
      data: { isActive: false },
    });

    res.json({ message: 'User removed from organization' });
  } catch (error) {
    console.error('Error removing user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/roles - Get available roles (grouped by module)
router.get('/roles', authMiddleware, async (req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      where: {
        organizationId: null, // Global roles
      },
      orderBy: {
        name: 'asc',
      },
    });

    // Get all modules for grouping
    const modules = await prisma.module.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    // Group roles by module
    const globalRoles = roles.filter((r) => !r.key.includes('.'));
    const moduleRoles: Record<string, typeof roles> = {};

    // Initialize module groups
    for (const module of modules) {
      moduleRoles[module.key] = [];
    }

    // Group module-specific roles
    for (const role of roles) {
      if (role.key.includes('.')) {
        const [moduleKey] = role.key.split('.');
        if (moduleRoles[moduleKey]) {
          moduleRoles[moduleKey].push(role);
        }
      }
    }

    // Build response
    const response: {
      global: Array<{ id: string; key: string; name: string; description: string | null }>;
      modules: Array<{
        moduleKey: string;
        moduleName: string;
        roles: Array<{ id: string; key: string; name: string; description: string | null }>;
      }>;
    } = {
      global: globalRoles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
      })),
      modules: [],
    };

    // Add module groups
    for (const module of modules) {
      const moduleRoleList = moduleRoles[module.key] || [];
      if (moduleRoleList.length > 0) {
        response.modules.push({
          moduleKey: module.key,
          moduleName: module.name,
          roles: moduleRoleList.map((r) => ({
            id: r.id,
            key: r.key,
            name: r.name,
            description: r.description,
          })),
        });
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/permissions - Get all permissions
router.get('/permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: {
        key: 'asc',
      },
    });

    res.json(permissions.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
    })));
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/roles/:roleId/permissions - Get permissions for a specific role
router.get('/roles/:roleId/permissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { roleId } = req.params;

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }

    const permissions = role.rolePermissions.map((rp) => ({
      id: rp.permission.id,
      key: rp.permission.key,
      name: rp.permission.name,
      description: rp.permission.description,
    }));

    res.json(permissions);
  } catch (error) {
    console.error('Error fetching role permissions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;


