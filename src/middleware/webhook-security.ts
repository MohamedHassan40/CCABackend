// Webhook security middleware for payment providers
// Verifies webhook signatures and handles idempotency

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../core/db';
import { config } from '../core/config';

const MOYASAR_WEBHOOK_SECRET = process.env.MOYASAR_WEBHOOK_SECRET || process.env.MOYASAR_SECRET_KEY || '';

function moyasarRawBody(req: Request): Buffer | string {
  if (req.rawBody && req.rawBody.length > 0) {
    return req.rawBody;
  }
  if (req.body !== undefined && req.body !== null) {
    return JSON.stringify(req.body);
  }
  return '';
}

function normalizeMoyasarSignature(header: string): string {
  const trimmed = header.trim();
  if (trimmed.toLowerCase().startsWith('sha256=')) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

function moyasarSignaturesMatch(provided: string, expectedHex: string): boolean {
  try {
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expectedHex, 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verify Moyasar webhook signature (HMAC-SHA256 over the raw request body).
 */
export function verifyMoyasarWebhook(req: Request, res: Response, next: NextFunction): void {
  const signatureHeader = req.headers['x-moyasar-signature'] as string | undefined;

  if (!MOYASAR_WEBHOOK_SECRET) {
    console.warn('MOYASAR_WEBHOOK_SECRET not configured, skipping signature verification');
    next();
    return;
  }

  if (!signatureHeader) {
    if (config.nodeEnv !== 'production' || process.env.MOYASAR_ALLOW_UNSIGNED_WEBHOOKS === 'true') {
      console.warn('Moyasar webhook missing signature — allowed by environment policy');
      next();
      return;
    }
    res.status(401).json({ error: 'Missing webhook signature' });
    return;
  }

  const rawBody = moyasarRawBody(req);
  const expectedSignature = crypto
    .createHmac('sha256', MOYASAR_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const provided = normalizeMoyasarSignature(signatureHeader);

  if (!moyasarSignaturesMatch(provided, expectedSignature)) {
    if (config.nodeEnv !== 'production') {
      console.warn('Moyasar webhook signature mismatch (development — continuing)');
      next();
      return;
    }
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  next();
}

// Simple in-memory cache for webhook idempotency (can be upgraded to Redis later)
const processedWebhooks = new Map<string, number>();
const WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function markWebhookProcessed(webhookId: string): void {
  processedWebhooks.set(webhookId, Date.now());
  if (processedWebhooks.size > 1000) {
    const now = Date.now();
    for (const [id, timestamp] of processedWebhooks.entries()) {
      if (now - timestamp > WEBHOOK_CACHE_TTL) {
        processedWebhooks.delete(id);
      }
    }
  }
}

/**
 * Idempotency middleware — prevents duplicate webhook processing.
 */
export async function webhookIdempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const webhookId = req.body.id || req.body.invoice_id || req.body.payment_id;

  if (!webhookId) {
    next();
    return;
  }

  const processedAt = processedWebhooks.get(webhookId);
  if (processedAt && Date.now() - processedAt < WEBHOOK_CACHE_TTL) {
    res.json({ received: true, message: 'Webhook already processed' });
    return;
  }

  try {
    const existingPayment = await prisma.payment.findFirst({
      where: {
        providerRef: webhookId,
        provider: 'moyasar',
      },
    });

    if (existingPayment?.status === 'succeeded') {
      markWebhookProcessed(webhookId);
      res.json({ received: true, message: 'Webhook already processed' });
      return;
    }

    const metadata =
      req.body.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
        ? (req.body.metadata as Record<string, unknown>)
        : {};
    const memberMembershipId = metadata.memberMembershipId as string | undefined;
    if (metadata.type === 'member_membership' && memberMembershipId) {
      const membership = await prisma.memberMembership.findUnique({
        where: { id: memberMembershipId },
        select: { paymentStatus: true, status: true },
      });
      const action = metadata.action as string | undefined;
      if (membership?.paymentStatus === 'paid') {
        if (action !== 'renew' || membership.status === 'active') {
          markWebhookProcessed(webhookId);
          res.json({ received: true, message: 'Webhook already processed' });
          return;
        }
      }
    }
  } catch (error) {
    console.warn('Failed to check webhook idempotency:', error);
  }

  markWebhookProcessed(webhookId);
  next();
}

/**
 * Log webhook event for debugging
 */
export function logWebhookEvent(req: Request, res: Response, next: NextFunction): void {
  console.log('Webhook received:', {
    provider: 'moyasar',
    eventId: req.body.id || req.body.invoice_id || req.body.payment_id,
    type: req.body.type || req.body.status,
    timestamp: new Date().toISOString(),
  });
  next();
}
