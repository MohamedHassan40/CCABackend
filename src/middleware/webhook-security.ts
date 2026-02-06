// Webhook security middleware for payment providers
// Verifies webhook signatures and handles idempotency

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../core/db';

const MOYASAR_WEBHOOK_SECRET = process.env.MOYASAR_WEBHOOK_SECRET || process.env.MOYASAR_SECRET_KEY || '';
/**
 * Verify Moyasar webhook signature
 * Moyasar sends webhooks with a signature in the X-Moyasar-Signature header
 */
export function verifyMoyasarWebhook(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-moyasar-signature'] as string;
  const body = JSON.stringify(req.body);

  if (!signature) {
    res.status(401).json({ error: 'Missing webhook signature' });
    return;
  }

  if (!MOYASAR_WEBHOOK_SECRET) {
    console.warn('MOYASAR_WEBHOOK_SECRET not configured, skipping signature verification');
    next();
    return;
  }

  // Moyasar uses HMAC SHA256
  const expectedSignature = crypto
    .createHmac('sha256', MOYASAR_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  // Compare signatures (constant-time comparison to prevent timing attacks)
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  next();
}

// Simple in-memory cache for webhook idempotency (can be upgraded to Redis later)
const processedWebhooks = new Map<string, number>();
const WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Idempotency middleware - prevents duplicate webhook processing
 */
export async function webhookIdempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const webhookId = req.body.id || req.body.invoice_id || req.body.payment_id;
  
  if (!webhookId) {
    next();
    return;
  }

  // Check in-memory cache
  const processedAt = processedWebhooks.get(webhookId);
  if (processedAt && Date.now() - processedAt < WEBHOOK_CACHE_TTL) {
    // Already processed recently, return success
    res.json({ received: true, message: 'Webhook already processed' });
    return;
  }

  // Check database for existing payment with this providerRef
  try {
    const existingPayment = await prisma.payment.findFirst({
      where: {
        providerRef: webhookId,
        provider: 'moyasar',
      },
    });

    if (existingPayment && existingPayment.status === 'succeeded') {
      // Already processed, mark in cache and return
      processedWebhooks.set(webhookId, Date.now());
      res.json({ received: true, message: 'Webhook already processed' });
      return;
    }
  } catch (error) {
    // If check fails, continue processing (better to process twice than miss)
    console.warn('Failed to check webhook idempotency:', error);
  }

  // Mark as processing
  processedWebhooks.set(webhookId, Date.now());

  // Clean old entries from cache (keep it under 1000 entries)
  if (processedWebhooks.size > 1000) {
    const now = Date.now();
    for (const [id, timestamp] of processedWebhooks.entries()) {
      if (now - timestamp > WEBHOOK_CACHE_TTL) {
        processedWebhooks.delete(id);
      }
    }
  }

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

