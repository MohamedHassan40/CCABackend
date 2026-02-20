import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../core/auth/jwt';
import prisma from '../core/db';
import type { JWTPayload } from '@cloud-org/shared';

// Extend Express Request to include user and org
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name?: string | null;
        isSuperAdmin: boolean;
      };
      org?: {
        id: string;
        name: string;
        slug: string;
      };
      jwtPayload?: JWTPayload;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    // Load user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid token or user inactive' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name ?? undefined,
      isSuperAdmin: user.isSuperAdmin,
    };
    req.jwtPayload = payload;

    // Super admin with no org (platform-level) - skip org validation
    if (user.isSuperAdmin && (payload.orgId === null || payload.orgId === undefined || payload.orgId === 'super-admin')) {
      req.org = undefined;
      next();
      return;
    }

    // Regular users require valid org
    if (payload.orgId == null || typeof payload.orgId !== 'string') {
      res.status(401).json({ error: 'Invalid organization context' });
      return;
    }
    const org = await prisma.organization.findUnique({
      where: { id: payload.orgId },
    });

    if (!org || !org.isActive) {
      res.status(401).json({ error: 'Invalid organization or organization inactive' });
      return;
    }

    // Check organization-level expiry
    const orgExpiresAt = (org as { expiresAt?: Date | null }).expiresAt;
    if (orgExpiresAt && new Date(orgExpiresAt) < new Date()) {
      res.status(403).json({ error: 'Organization subscription has expired' });
      return;
    }

    req.org = {
      id: org.id,
      name: org.name,
      slug: org.slug,
    };

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}
















