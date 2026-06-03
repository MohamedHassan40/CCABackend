import { Request, Response, NextFunction } from 'express';
import prisma from '../core/db';
import { getOrgModuleAccessState } from '../core/modules/orgModuleAccess';

/**
 * Middleware to require that a module is enabled for the current organization
 * Must be used after authMiddleware
 * Checks:
 * - Module exists and is enabled for the org
 * - Module is not expired (expiresAt is null or in the future)
 * - Module trial is still valid (trialEndsAt is null or in the future)
 */
export function requireModuleEnabled(moduleKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Super admin bypass
      if (req.user?.isSuperAdmin) {
        next();
        return;
      }

    // Find the module
    let module;
    try {
      module = await prisma.module.findUnique({
        where: { key: moduleKey },
      });
    } catch (dbError) {
      console.error('Database error in requireModuleEnabled (module lookup):', dbError);
      res.status(500).json({ error: 'Database error while checking module' });
      return;
    }

    if (!module || !module.isActive) {
      res.status(404).json({ error: `Module not found: ${moduleKey}` });
      return;
    }

    // Check org module status
    let orgModule;
    try {
      orgModule = await prisma.orgModule.findUnique({
        where: {
          organizationId_moduleId: {
            organizationId: req.org.id,
            moduleId: module.id,
          },
        },
      });
    } catch (dbError) {
      console.error('Database error in requireModuleEnabled (orgModule lookup):', dbError);
      res.status(500).json({ error: 'Database error while checking module subscription' });
      return;
    }

      if (!orgModule) {
        res.status(403).json({ error: `Module ${moduleKey} is not enabled for this organization` });
        return;
      }

      const subscription = await prisma.subscription.findFirst({
        where: {
          organizationId: req.org.id,
          moduleId: module.id,
        },
        orderBy: { createdAt: 'desc' },
      });

      const access = getOrgModuleAccessState(orgModule, subscription);
      if (access.isExpired) {
        res.status(403).json({
          error: `Module ${moduleKey} subscription has expired`,
          code: 'MODULE_SUBSCRIPTION_EXPIRED',
          moduleKey,
        });
        return;
      }

      if (!orgModule.isEnabled) {
        res.status(403).json({ error: `Module ${moduleKey} is not enabled for this organization` });
        return;
      }

      next();
    } catch (error) {
      console.error('Error in requireModuleEnabled middleware:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
















