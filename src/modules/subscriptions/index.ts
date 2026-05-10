import { Router } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import { activateSubscriptionFromPaidMoyasarInvoice } from '../../core/payments/subscription-payment-callback';
import { getInvoiceCheckoutUrl, moyasarService } from '../../core/payments/moyasar';
import type { MoyasarInvoiceStatus } from '../../core/payments/moyasar';

const router = Router();

const STALE_INVOICE_STATUSES: MoyasarInvoiceStatus[] = [
  'expired',
  'failed',
  'canceled',
  'voided',
  'refunded',
];

function normalizePublicBaseUrl(value: string | undefined, fallback: string): string {
  const raw = (value || '').trim();
  const candidate = raw || fallback;
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  const parsed = new URL(withProtocol);
  return parsed.toString().replace(/\/$/, '');
}

/** Platform subscriptions & invoices for CCA modules — not tied to the optional org Billing module. */
export function registerSubscriptionsModule(routerInstance: Router): void {
  routerInstance.use('/api/subscriptions', authMiddleware, router);
}

// GET /api/subscriptions/modules - List available modules with pricing
router.get('/modules', requirePermission('subscriptions.view'), async (req, res) => {
  try {
    const modules = await prisma.module.findMany({
      where: {
        isActive: true,
      },
      include: {
        modulePrices: {
          orderBy: [{ plan: 'asc' }, { billingPeriod: 'asc' }],
        },
      },
    });

    res.json(
      modules.map((m) => ({
        id: m.id,
        key: m.key,
        name: m.name,
        description: m.description,
        prices: m.modulePrices.map((mp) => ({
          plan: mp.plan,
          priceCents: mp.priceCents,
          currency: mp.currency,
          billingPeriod: mp.billingPeriod,
        })),
      }))
    );
  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/subscriptions/subscribe
router.post('/subscribe', requirePermission('subscriptions.manage'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { moduleKey, plan, billingPeriod } = req.body;

    if (!moduleKey || !plan) {
      res.status(400).json({ error: 'Module key and plan are required' });
      return;
    }

    const module = await prisma.module.findUnique({
      where: { key: moduleKey },
    });

    if (!module) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }

    const period = billingPeriod || 'monthly';
    const modulePrice = await prisma.modulePrice.findUnique({
      where: {
        moduleId_plan_billingPeriod: {
          moduleId: module.id,
          plan,
          billingPeriod: period,
        },
      },
    });

    if (!modulePrice) {
      res.status(404).json({ error: 'Pricing not found for this plan and period' });
      return;
    }

    const moyasarConfigured = !!process.env.MOYASAR_SECRET_KEY;
    const paidPlan = modulePrice.priceCents > 0;

    /** Paid plans require Moyasar checkout — never activate the module until the webhook confirms payment. */
    if (moyasarConfigured && paidPlan) {
      const existingPending = await prisma.payment.findFirst({
        where: {
          organizationId: req.org.id,
          moduleId: module.id,
          status: 'pending',
          provider: 'moyasar',
          invoiceUrl: { not: null },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingPending?.invoiceUrl && existingPending.providerRef) {
        try {
          const remoteInvoice = await moyasarService.getInvoiceById(existingPending.providerRef);

          if (remoteInvoice.status === 'paid') {
            const activated = await activateSubscriptionFromPaidMoyasarInvoice(remoteInvoice, {});
            if (activated.ok) {
              res.json({
                message:
                  'Subscription activated. Your payment was already completed; status has been synced from Moyasar.',
                subscription: activated.subscription,
                syncedFromMoyasar: true,
              });
              return;
            }
            res.status(400).json({ error: activated.error });
            return;
          }

          const status = remoteInvoice.status;
          const pastExpiry =
            !!remoteInvoice.expired_at &&
            !Number.isNaN(Date.parse(remoteInvoice.expired_at)) &&
            new Date(remoteInvoice.expired_at).getTime() < Date.now();

          const stale =
            (!!status && STALE_INVOICE_STATUSES.includes(status as MoyasarInvoiceStatus)) ||
            pastExpiry;

          if (stale) {
            await prisma.payment.update({
              where: { id: existingPending.id },
              data: { status: 'failed' },
            });
            // Create a fresh invoice below (do not return the expired checkout link).
          } else {
            res.json({
              invoiceUrl: existingPending.invoiceUrl,
              invoiceId: existingPending.providerRef,
              paymentId: existingPending.id,
              message: 'Complete payment to activate subscription',
              resumed: true,
            });
            return;
          }
        } catch (e) {
          console.warn('Could not verify pending Moyasar invoice; returning saved checkout URL:', e);
          res.json({
            invoiceUrl: existingPending.invoiceUrl,
            invoiceId: existingPending.providerRef,
            paymentId: existingPending.id,
            message: 'Complete payment to activate subscription',
            resumed: true,
          });
          return;
        }
      }

      try {
        const frontendUrl = normalizePublicBaseUrl(
          process.env.FRONTEND_URL || process.env.CLIENT_URL,
          'http://localhost:3000'
        );
        const apiBase = normalizePublicBaseUrl(
          process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN,
          'http://localhost:3001'
        );
        const invoice = await moyasarService.createInvoice({
          amount: modulePrice.priceCents,
          currency: modulePrice.currency,
          description: `Subscription: ${module.name} - ${plan} plan (${period})`,
          metadata: {
            organizationId: req.org.id,
            organizationName: req.org.name,
            moduleId: module.id,
            moduleKey: module.key,
            plan,
            billingPeriod: period,
            userId: req.user.id,
          },
          success_url: `${frontendUrl}/dashboard/subscription?payment=success`,
          back_url: `${frontendUrl}/dashboard/subscription/modules`,
          callback_url: `${apiBase}/api/subscriptions/payment-callback`,
          expired_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        const checkoutUrl = getInvoiceCheckoutUrl(invoice);
        if (!checkoutUrl) {
          res.status(502).json({
            error:
              'Payment provider did not return a checkout URL. Check Moyasar credentials and API response, then try again.',
          });
          return;
        }

        const payment = await prisma.payment.create({
          data: {
            organizationId: req.org.id,
            moduleId: module.id,
            amountCents: modulePrice.priceCents,
            currency: modulePrice.currency,
            status: 'pending',
            provider: 'moyasar',
            providerRef: invoice.id,
            invoiceUrl: checkoutUrl,
          },
        });

        res.json({
          invoiceUrl: checkoutUrl,
          invoiceId: invoice.id,
          paymentId: payment.id,
          message: 'Please complete payment to activate subscription',
        });
        return;
      } catch (error: unknown) {
        console.error('Error creating Moyasar invoice:', error);
        const msg = error instanceof Error ? error.message : 'Could not start payment with Moyasar.';
        res.status(502).json({
          error: `${msg} Subscription was not activated.`,
        });
        return;
      }
    }

    if (paidPlan && !moyasarConfigured) {
      res.status(503).json({
        error:
          'Online payment is not configured (Moyasar). Add MOYASAR_SECRET_KEY to enable paid module subscriptions.',
      });
      return;
    }

    const now = new Date();
    const currentPeriodEnd = new Date();
    if (period === 'yearly') {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    } else {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    }

    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        organizationId: req.org.id,
        moduleId: module.id,
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
            organizationId: req.org.id,
            moduleId: module.id,
            plan,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd,
          },
        });

    await prisma.orgModule.upsert({
      where: {
        organizationId_moduleId: {
          organizationId: req.org.id,
          moduleId: module.id,
        },
      },
      update: {
        isEnabled: true,
        plan,
        expiresAt: null,
        trialEndsAt: null,
      },
      create: {
        organizationId: req.org.id,
        moduleId: module.id,
        isEnabled: true,
        plan,
        expiresAt: null,
        trialEndsAt: null,
      },
    });

    const payment = await prisma.payment.create({
      data: {
        organizationId: req.org.id,
        moduleId: module.id,
        subscriptionId: subscription.id,
        amountCents: modulePrice.priceCents,
        currency: modulePrice.currency,
        status: 'succeeded',
        provider: 'manual',
        paidAt: now,
      },
    });

    res.json({
      message: 'Subscription activated successfully',
      subscription,
      paymentId: payment.id,
    });
  } catch (error) {
    console.error('Error subscribing to module:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/subscriptions — active module subscriptions + org module state
router.get('/', requirePermission('subscriptions.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const subscriptions = await prisma.subscription.findMany({
      where: {
        organizationId: req.org.id,
      },
      include: {
        module: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const orgModules = await prisma.orgModule.findMany({
      where: {
        organizationId: req.org.id,
      },
      include: {
        module: true,
      },
    });

    const moyasarConfigured = !!process.env.MOYASAR_SECRET_KEY;

    const pendingCheckoutPayments = await prisma.payment.findMany({
      where: {
        organizationId: req.org.id,
        status: 'pending',
        provider: 'moyasar',
      },
      select: {
        id: true,
        moduleId: true,
        subscriptionId: true,
        invoiceUrl: true,
        amountCents: true,
        currency: true,
        createdAt: true,
        providerRef: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      subscriptions,
      orgModules: orgModules.map((om) => ({
        module: om.module,
        isEnabled: om.isEnabled,
        plan: om.plan,
        seats: om.seats,
        expiresAt: om.expiresAt,
        trialEndsAt: om.trialEndsAt,
        isExpired: om.expiresAt ? om.expiresAt < new Date() : false,
        isTrial: !!om.trialEndsAt && om.trialEndsAt >= new Date(),
      })),
      checkout: {
        moyasarEnabled: moyasarConfigured,
        paidPlansRequireMoyasar: moyasarConfigured,
      },
      pendingCheckoutPayments,
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/cancel', requirePermission('subscriptions.manage'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { cancelAtPeriodEnd = true } = req.body;

    const subscription = await prisma.subscription.findFirst({
      where: {
        id,
        organizationId: req.org.id,
      },
    });

    if (!subscription) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    if (subscription.status === 'canceled') {
      res.status(400).json({ error: 'Subscription is already canceled' });
      return;
    }

    const updateData: any = {
      cancelAtPeriodEnd: cancelAtPeriodEnd === true || cancelAtPeriodEnd === 'true',
    };

    if (!cancelAtPeriodEnd) {
      updateData.status = 'canceled';
      updateData.canceledAt = new Date();

      await prisma.orgModule.updateMany({
        where: {
          organizationId: req.org.id,
          moduleId: subscription.moduleId,
        },
        data: {
          isEnabled: false,
        },
      });
    }

    const updated = await prisma.subscription.update({
      where: { id },
      data: updateData,
      include: {
        module: true,
      },
    });

    res.json({
      message: cancelAtPeriodEnd
        ? 'Subscription will be canceled at the end of the billing period'
        : 'Subscription canceled immediately',
      subscription: updated,
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/plan', requirePermission('subscriptions.manage'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { plan, billingPeriod } = req.body;

    if (!plan) {
      res.status(400).json({ error: 'Plan is required' });
      return;
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        id,
        organizationId: req.org.id,
      },
      include: {
        module: true,
      },
    });

    if (!subscription) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    if (subscription.status === 'canceled') {
      res.status(400).json({ error: 'Cannot change plan for canceled subscription' });
      return;
    }

    const period = billingPeriod || 'monthly';
    const modulePrice = await prisma.modulePrice.findUnique({
      where: {
        moduleId_plan_billingPeriod: {
          moduleId: subscription.moduleId,
          plan,
          billingPeriod: period,
        },
      },
    });

    if (!modulePrice) {
      res.status(404).json({ error: 'Pricing not found for this plan and period' });
      return;
    }

    const moyasarConfigured = !!process.env.MOYASAR_SECRET_KEY;
    const paidPlan = modulePrice.priceCents > 0;

    if (moyasarConfigured && paidPlan) {
      try {
        const frontendUrl = normalizePublicBaseUrl(
          process.env.FRONTEND_URL || process.env.CLIENT_URL,
          'http://localhost:3000'
        );
        const apiBase = normalizePublicBaseUrl(
          process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN,
          'http://localhost:3001'
        );
        const invoice = await moyasarService.createInvoice({
          amount: modulePrice.priceCents,
          currency: modulePrice.currency,
          description: `Plan change: ${subscription.module.name} — ${plan} (${period})`,
          metadata: {
            organizationId: req.org.id,
            organizationName: req.org.name,
            moduleId: subscription.moduleId,
            moduleKey: subscription.module.key,
            plan,
            billingPeriod: period,
            userId: req.user.id,
          },
          success_url: `${frontendUrl}/dashboard/subscription?payment=success`,
          back_url: `${frontendUrl}/dashboard/subscription/modules`,
          callback_url: `${apiBase}/api/subscriptions/payment-callback`,
          expired_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        const checkoutUrl = getInvoiceCheckoutUrl(invoice);
        if (!checkoutUrl) {
          res.status(502).json({
            error:
              'Payment provider did not return a checkout URL. Plan was not changed. Try again or contact support.',
          });
          return;
        }

        const payment = await prisma.payment.create({
          data: {
            organizationId: req.org.id,
            moduleId: subscription.moduleId,
            subscriptionId: subscription.id,
            amountCents: modulePrice.priceCents,
            currency: modulePrice.currency,
            status: 'pending',
            provider: 'moyasar',
            providerRef: invoice.id,
            invoiceUrl: checkoutUrl,
          },
        });

        res.json({
          invoiceUrl: checkoutUrl,
          invoiceId: invoice.id,
          paymentId: payment.id,
          message: 'Complete payment to apply the new plan',
        });
        return;
      } catch (error: unknown) {
        console.error('Error creating Moyasar invoice for plan change:', error);
        const msg = error instanceof Error ? error.message : 'Could not start payment with Moyasar.';
        res.status(502).json({
          error: `${msg} Your current plan was kept.`,
        });
        return;
      }
    }

    if (paidPlan && !moyasarConfigured) {
      res.status(503).json({
        error:
          'Online payment is not configured (Moyasar). Add MOYASAR_SECRET_KEY to change to a paid plan.',
      });
      return;
    }

    const updated = await prisma.subscription.update({
      where: { id },
      data: {
        plan,
      },
      include: {
        module: true,
      },
    });

    await prisma.orgModule.updateMany({
      where: {
        organizationId: req.org.id,
        moduleId: subscription.moduleId,
      },
      data: {
        plan,
      },
    });

    res.json({
      message: 'Subscription plan updated successfully',
      subscription: updated,
    });
  } catch (error) {
    console.error('Error updating subscription plan:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/payments', requirePermission('subscriptions.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const payments = await prisma.payment.findMany({
      where: {
        organizationId: req.org.id,
      },
      include: {
        subscription: {
          include: {
            module: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/invoices', requirePermission('subscriptions.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const payments = await prisma.payment.findMany({
      where: {
        organizationId: req.org.id,
        status: 'succeeded',
      },
      include: {
        subscription: {
          include: {
            module: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const invoices = payments.map((payment) => ({
      id: payment.id,
      invoiceNumber: `INV-${payment.id.substring(0, 8).toUpperCase()}`,
      amount: payment.amountCents / 100,
      currency: payment.currency,
      status: payment.status,
      paidAt: payment.paidAt,
      invoiceUrl: payment.invoiceUrl,
      module: payment.subscription?.module,
      createdAt: payment.createdAt,
    }));

    res.json(invoices);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/invoices/:id', requirePermission('subscriptions.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const payment = await prisma.payment.findFirst({
      where: {
        id,
        organizationId: req.org.id,
      },
      include: {
        subscription: {
          include: {
            module: true,
          },
        },
      },
    });

    if (!payment) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const invoice = {
      id: payment.id,
      invoiceNumber: `INV-${payment.id.substring(0, 8).toUpperCase()}`,
      amount: payment.amountCents / 100,
      currency: payment.currency,
      status: payment.status,
      paidAt: payment.paidAt,
      invoiceUrl: payment.invoiceUrl,
      module: payment.subscription?.module,
      createdAt: payment.createdAt,
    };

    res.json(invoice);
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
