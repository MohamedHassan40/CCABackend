import { Router, Request, Response } from 'express';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/audit-logs - Get audit logs
router.get('/', requirePermission('organizations.update'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { action, resourceType, userId, limit = 100, offset = 0 } = req.query;

    const where: any = {
      organizationId: req.org.id,
    };

    if (action) where.action = action as string;
    if (resourceType) where.resourceType = resourceType as string;
    if (userId) where.userId = userId as string;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: Number(limit),
        skip: Number(offset),
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      logs: logs.map((log) => ({
        ...log,
        details: log.details ? JSON.parse(log.details) : null,
      })),
      total,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;














