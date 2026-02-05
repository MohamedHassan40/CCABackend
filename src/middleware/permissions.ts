import { Request, Response, NextFunction } from 'express';
import prisma from '../core/db';

/**
 * Middleware to require a specific permission for the current user in the current org
 * Must be used after authMiddleware
 */
export function requirePermission(permissionKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Super admin bypass
    if (req.user.isSuperAdmin) {
      next();
      return;
    }

    // Get user's memberships for this org
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

    if (!membership || !membership.isActive) {
      res.status(403).json({ error: 'No active membership found' });
      return;
    }

    // Check if any role has the required permission
    const hasPermission = membership.membershipRoles.some((mr) =>
      mr.role.rolePermissions.some((rp) => rp.permission.key === permissionKey)
    );

    if (!hasPermission) {
      res.status(403).json({ error: `Permission required: ${permissionKey}` });
      return;
    }

    next();
  };
}

/**
 * Middleware to require super admin access
 */
export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user || !req.user.isSuperAdmin) {
    res.status(403).json({ error: 'Super admin access required' });
    return;
  }
  next();
}
















