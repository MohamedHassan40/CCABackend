import { Request, Response, NextFunction } from 'express';
import prisma from '../core/db';

export type AuditParams = {
  userId: string | null;
  organizationId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  req?: Request;
};

/** Call from route handlers to log key actions (leave approve/reject/cancel, payroll paid, member delete, ticket assign). */
export async function createAuditLog(params: AuditParams): Promise<void> {
  try {
    const { userId, organizationId, action, resourceType, resourceId, details, req: reqOpt } = params;
    await prisma.auditLog.create({
      data: {
        userId: userId || undefined,
        organizationId: organizationId || undefined,
        action,
        resourceType,
        resourceId: resourceId ?? null,
        details: details ? JSON.stringify(details) : null,
        ipAddress: reqOpt?.ip || (reqOpt?.headers['x-forwarded-for'] as string) || null,
        userAgent: (reqOpt?.headers['user-agent'] as string) || null,
      },
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

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














