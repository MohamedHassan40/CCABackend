import { Request, Response, NextFunction } from 'express';
import prisma from '../core/db';

export function auditLog(action: string, resourceType: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Don't block the request if audit logging fails
    next();

    try {
      if (!req.user) return;

      const resourceId = req.params.id || req.body.id || null;
      const details = {
        method: req.method,
        path: req.path,
        body: req.method !== 'GET' ? req.body : undefined,
        params: req.params,
      };

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          organizationId: req.org?.id || null,
          action,
          resourceType,
          resourceId,
          details: JSON.stringify(details),
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });
    } catch (error) {
      // Silently fail - don't break the request
      console.error('Audit log error:', error);
    }
  };
}














