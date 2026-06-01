import type { Request, Response } from 'express';
import type { Subscription } from '@prisma/client';
import prisma from '../db';
import type { MoyasarInvoice } from './moyasar';
import { activateMembershipFromPaidMoyasarInvoice } from './membership-payment-callback';
import { mergeMoyasarMetadata, resolveMoyasarInvoiceFromWebhookBody } from './moyasar-invoice-resolve';
import { invoicePaidWithCreditOrDebitCard } from './moyasar-checkout';
import { isTerminalFailedInvoiceStatus } from './payment-invoice-status';
import { markSubscriptionPaymentFailedFromInvoice } from './subscription-payment-failure';

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
  const metadata = mergeMoyasarMetadata(webhookBody, invoice);
  const orgId = metadata.organizationId as string | undefined;
  const moduleId = metadata.moduleId as string | undefined;
  const plan = metadata.plan as string | undefined;
  const billingPeriod = (metadata.billingPeriod as string | undefined) || 'monthly';

  if (!orgId || !moduleId || !plan) {
    console.error('Missing organizationId, moduleId, or plan in Moyasar invoice metadata');
    return { ok: false, error: 'Missing organization, module, or plan information for this payment' };
  }

  if (!invoicePaidWithCreditOrDebitCard(invoice)) {
    return {
      ok: false,
      error: 'Only credit and debit card payments are accepted for subscriptions',
    };
  }

  const invoiceId = invoice.id;

  const payment = await prisma.payment.findFirst({
    where: {
      providerRef: invoiceId,
      provider: 'moyasar',
    },
  });

  const now = new Date();

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

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'succeeded', paidAt: now, subscriptionId: subscription.id },
    });
  }

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
/** Sync pending Moyasar checkout(s) when the webhook was missed (e.g. local dev). */
export async function syncPendingSubscriptionCheckouts(organizationId: string): Promise<{
  synced: number;
  subscriptions: Subscription[];
  errors: string[];
}> {
  const { moyasarService } = await import('./moyasar');
  const pending = await prisma.payment.findMany({
    where: {
      organizationId,
      status: 'pending',
      provider: 'moyasar',
      providerRef: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const subscriptions: Subscription[] = [];
  const errors: string[] = [];
  let synced = 0;

  for (const row of pending) {
    if (!row.providerRef) continue;
    try {
      const invoice = await moyasarService.getInvoiceById(row.providerRef);
      if (isTerminalFailedInvoiceStatus(invoice.status)) {
        await markSubscriptionPaymentFailedFromInvoice(invoice);
        continue;
      }
      if (invoice.status !== 'paid') continue;
      const metadata = mergeMoyasarMetadata({}, invoice);
      if (metadata.type === 'member_membership') continue;
      const result = await activateSubscriptionFromPaidMoyasarInvoice(invoice, {});
      if (result.ok) {
        synced += 1;
        subscriptions.push(result.subscription);
      } else {
        errors.push(result.error);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Sync failed');
    }
  }

  return { synced, subscriptions, errors };
}

export async function handleSubscriptionPaymentCallback(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const status = body.status;
    if (status === undefined || status === null || status === '') {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const invoice = await resolveMoyasarInvoiceFromWebhookBody(body);
    if (!invoice) {
      res.status(400).json({ error: 'Invalid invoice or payment reference' });
      return;
    }

    const metadata = mergeMoyasarMetadata(body, invoice);

    if (invoice.status !== 'paid') {
      if (metadata.type !== 'member_membership' && isTerminalFailedInvoiceStatus(invoice.status)) {
        await markSubscriptionPaymentFailedFromInvoice(invoice);
      }
      res.json({
        received: true,
        message: 'Payment not completed yet',
        invoiceStatus: invoice.status,
      });
      return;
    }

    if (!invoicePaidWithCreditOrDebitCard(invoice)) {
      if (metadata.type !== 'member_membership') {
        await markSubscriptionPaymentFailedFromInvoice(invoice);
      }
      res.status(400).json({ error: 'Only credit and debit card payments are accepted' });
      return;
    }

    if (metadata.type === 'member_membership') {
      const membershipResult = await activateMembershipFromPaidMoyasarInvoice(invoice, body);
      if (!membershipResult.ok) {
        res.status(400).json({ error: membershipResult.error });
        return;
      }
      res.json({ success: true, membershipId: membershipResult.membershipId });
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
