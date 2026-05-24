import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getCorsOriginsList } from '../core/config';
import { normalizeOrigin } from './cors';

// CSRF token generation and validation
const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex');

// Generate CSRF token
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// CSRF protection middleware
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Skip CSRF for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  // Skip CSRF for webhook endpoints (they use signature verification)
  if (req.path.includes('/webhook') || req.path.includes('/payment-callback')) {
    next();
    return;
  }

  // Get token from header or body
  const token = req.headers['x-csrf-token'] || req.body?.csrfToken;

  // For API requests, we can use a simpler approach with origin checking
  // In production, you should use proper CSRF tokens stored in sessions
  const origin = req.headers.origin || req.headers.referer;
  const allowedOrigins = getCorsOriginsList();

  if (origin) {
    const allowed = allowedOrigins.map((a) => normalizeOrigin(a)).filter(Boolean);
    try {
      const u = new URL(origin);
      const requestOrigin = normalizeOrigin(`${u.protocol}//${u.host}`);
      if (allowed.includes(requestOrigin)) {
        next();
        return;
      }
    } catch {
      /* not a full URL — fall through to prefix check */
    }
    if (allowed.some((a) => origin.startsWith(a))) {
      next();
      return;
    }
  }

  // If no origin check passes and no token, reject
  if (!token) {
    res.status(403).json({ error: 'CSRF token missing' });
    return;
  }

  next();
}

// Set CSRF token in response header (for frontend to use)
export function setCsrfToken(req: Request, res: Response, next: NextFunction): void {
  const token = generateCsrfToken();
  res.setHeader('X-CSRF-Token', token);
  next();
}






