import type { Request, Response } from 'express';
import type { Subscription } from '@prisma/client';
import prisma from '../db';
import type { MoyasarInvoice } from './moyasar';

function mergeMetadata(body: Record<string, unknown>, invoice: MoyasarInvoice): Record<string, unknown> {
  const fromInvoice =
    invoice.metadata && typeof invoice.metadata === 'object' && !Array.isArray(invoice.metadata)
      ? invoice.metadata
      : {};
  const fromBody =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};
  return { ...fromInvoice, ...fromBody };
}

export type ActivateSubscriptionResult =
  | { ok: true; subscription: Subscription }
  | { ok: false; error: string };

/**
 * Applies paid-invoice state to org subscription + module (same logic as the Moyasar webhook).
 * Use when the webhook was missed (e.g. localhost) but the invoice is already `paid` in Moyasar.
 */
export async function activateSubscriptionFromPaidMoyasarInvoice(
  invoice: MoyasarInvoice,
  webhookBody: Record<string, unknown> = {},
): Promise<ActivateSubscriptionResult> {
  const metadata = mergeMetadata(webhookBody, invoice);
  const orgId = metadata.organizationId as string | undefined;
  const moduleId = metadata.moduleId as string | undefined;
  const plan = metadata.plan as string | undefined;
  const billingPeriod = (metadata.billingPeriod as string | undefined) || 'monthly';

  if (!orgId || !moduleId || !plan) {
    console.error('Missing organizationId, moduleId, or plan in Moyasar invoice metadata');
    return { ok: false, error: 'Missing organization, module, or plan information for this payment' };
  }

  const invoiceId = invoice.id;

  const payment = await prisma.payment.findFirst({
    where: {
      providerRef: invoiceId,
      provider: 'moyasar',
    },
  });

  const now = new Date();

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'succeeded', paidAt: now },
    });
  }

  const currentPeriodEnd = new Date(now);
  if (billingPeriod === 'monthly') {
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
  } else {
    currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
  }

  const existingSubscription = await prisma.subscription.findFirst({
    where: {
      organizationId: orgId,
      moduleId: moduleId,
    },
  });

  const subscription = existingSubscription
    ? await prisma.subscription.update({
        where: { id: existingSubscription.id },
        data: {
          plan,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
          canceledAt: null,
        },
      })
    : await prisma.subscription.create({
        data: {
          organizationId: orgId,
          moduleId: moduleId,
          plan,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd,
        },
      });

  await prisma.orgModule.upsert({
    where: {
      organizationId_moduleId: {
        organizationId: orgId,
        moduleId: moduleId,
      },
    },
    update: {
      isEnabled: true,
      plan,
      expiresAt: null,
      trialEndsAt: null,
    },
    create: {
      organizationId: orgId,
      moduleId: moduleId,
      isEnabled: true,
      plan,
      expiresAt: null,
      trialEndsAt: null,
    },
  });

  if (metadata.isRenewal === true || metadata.isRenewal === 'true') {
    const { processRenewalPayment } = await import('../jobs/subscription-renewal');
    if (payment) {
      await processRenewalPayment(subscription.id, payment.id);
    }
  }

  try {
    const [orgRec, moduleRec] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: orgId },
        include: {
          memberships: {
            where: { isActive: true },
            include: { user: true },
            take: 1,
          },
        },
      }),
      prisma.module.findUnique({ where: { id: moduleId } }),
    ]);
    const owner = orgRec?.memberships?.[0]?.user;
    if (owner?.email && moduleRec && orgRec) {
      const minorUnits = typeof invoice.amount === 'number' ? invoice.amount : 0;
      const cur = invoice.currency || 'SAR';
      const amountLabel = `${(minorUnits / 100).toFixed(2)} ${cur}`;
      const billingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/subscription`;
      const { sendEmailQueued, emailTemplates } = await import('../email');
      const tpl = emailTemplates.purchaseConfirmation({
        userName: owner.name || owner.email.split('@')[0] || 'User',
        orgName: orgRec.name,
        moduleName: moduleRec.name,
        amountLabel,
        billingUrl,
      });
      sendEmailQueued({
        to: owner.email,
        subject: tpl.subject,
        html: tpl.html,
        priority: 'high',
      }).catch((err) => console.error('Purchase confirmation email failed:', err));
    }
  } catch (emailErr) {
    console.error('Purchase confirmation email:', emailErr);
  }

  return { ok: true, subscription };
}

/**
 * Moyasar webhook handler for platform module subscriptions (activated via /api/subscriptions).
 * Mounted at both `/api/subscriptions/payment-callback` and legacy `/api/billing/payment-callback`.
 *
 * Accepts either an **invoice** payload (`id` = invoice id) or a **payment** payload (`invoice_id` set, or `id` = payment id).
 */
export async function handleSubscriptionPaymentCallback(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const status = body.status;
    if (status === undefined || status === null || status === '') {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const candidateId =
      typeof body.invoice_id === 'string'
        ? body.invoice_id
        : typeof body.id === 'string'
          ? body.id
          : undefined;

    if (!candidateId) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const { moyasarService } = await import('./moyasar');

    let invoice: MoyasarInvoice;
    try {
      invoice = await moyasarService.getInvoiceById(candidateId);
    } catch {
      try {
        const pay = await moyasarService.getPaymentById(candidateId);
        if (!pay.invoice_id) {
          res.status(400).json({ error: 'Could not resolve invoice for callback' });
          return;
        }
        invoice = await moyasarService.getInvoiceById(pay.invoice_id);
      } catch {
        res.status(400).json({ error: 'Invalid invoice or payment reference' });
        return;
      }
    }

    if (invoice.status !== 'paid') {
      res.json({ received: true, message: 'Payment not completed yet' });
      return;
    }

    const result = await activateSubscriptionFromPaidMoyasarInvoice(invoice, body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true, subscription: result.subscription });
  } catch (error) {
    console.error('Payment callback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
