import { Request, Response, NextFunction } from 'express';
import prisma from '../core/db';

/**
 * Middleware to require a specific permission for the current user in the current org
 * Must be used after authMiddleware
 */
export function requirePermission(permissionKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
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
      let membership;
      try {
        membership = await prisma.membership.findUnique({
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
      } catch (dbError) {
        console.error('Database error in requirePermission:', dbError);
        res.status(500).json({ error: 'Database error while checking permissions' });
        return;
      }

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
    } catch (error) {
      console.error('Error in requirePermission middleware:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/** Pass if the user has at least one of the listed permissions (super admin bypasses). */
export function requireAnyPermission(...permissionKeys: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.org) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      if (req.user.isSuperAdmin) {
        next();
        return;
      }

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
                  rolePermissions: { include: { permission: true } },
                },
              },
            },
          },
        },
      });

      if (!membership?.isActive) {
        res.status(403).json({ error: 'No active membership found' });
        return;
      }

      const userKeys = new Set<string>();
      for (const mr of membership.membershipRoles) {
        for (const rp of mr.role.rolePermissions) {
          userKeys.add(rp.permission.key);
        }
      }

      const allowed = permissionKeys.some((k) => userKeys.has(k));
      if (!allowed) {
        res.status(403).json({
          error: `Permission required (one of): ${permissionKeys.join(', ')}`,
        });
        return;
      }

      next();
    } catch (error) {
      console.error('Error in requireAnyPermission middleware:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
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
















