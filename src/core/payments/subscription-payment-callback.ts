import type { Request, Response } from 'express';
import prisma from '../db';

/**
 * Moyasar webhook handler for platform module subscriptions (activated via /api/subscriptions).
 * Mounted at both `/api/subscriptions/payment-callback` and legacy `/api/billing/payment-callback`.
 */
export async function handleSubscriptionPaymentCallback(req: Request, res: Response): Promise<void> {
  try {
    const { id: invoiceId, status, metadata } = req.body;

    if (!invoiceId || !status) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const { moyasarService } = await import('./moyasar');
    const invoice = await moyasarService.getInvoiceById(invoiceId);

    if (invoice.status !== 'paid') {
      res.json({ received: true, message: 'Payment not completed yet' });
      return;
    }

    const orgId = metadata?.organizationId || invoice.metadata?.organizationId;
    const moduleId = metadata?.moduleId || invoice.metadata?.moduleId;
    const plan = metadata?.plan || invoice.metadata?.plan;
    const billingPeriod = metadata?.billingPeriod || invoice.metadata?.billingPeriod || 'monthly';

    if (!orgId || !moduleId) {
      console.error('Missing organizationId or moduleId in payment callback');
      res.status(400).json({ error: 'Missing organization or module information' });
      return;
    }

    const payment = await prisma.payment.findFirst({
      where: {
        providerRef: invoiceId,
        provider: 'moyasar',
      },
    });

    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'succeeded' },
      });
    }

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

    if (metadata?.isRenewal === true || invoice.metadata?.isRenewal === true) {
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
        const halalas = typeof invoice.amount === 'number' ? invoice.amount : 0;
        const amountLabel = `${(halalas / 100).toFixed(2)} SAR`;
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

    res.json({ success: true, subscription });
  } catch (error) {
    console.error('Payment callback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
