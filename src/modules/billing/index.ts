import { Router } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import { moyasarService } from '../../core/payments/moyasar';
import type { ModuleManifest } from '@cloud-org/shared';

const router = Router();

// Module manifest
export const billingManifest: ModuleManifest = {
  key: 'billing',
  name: 'Billing & Subscriptions',
  icon: 'credit-card',
  sidebarItems: [
    {
      path: '/billing/subscriptions',
      label: 'Subscriptions',
      permission: 'billing.subscriptions.view',
    },
    {
      path: '/billing/modules',
      label: 'Available Modules',
      permission: 'billing.subscriptions.view',
    },
  ],
  dashboardWidgets: [],
};

// Register module
export function registerBillingModule(routerInstance: Router): void {
  // Register routes
  routerInstance.use('/api/billing', authMiddleware, router);

  // Register in module registry
  moduleRegistry.register({
    key: 'billing',
    manifest: billingManifest,
    registerRoutes: () => {}, // Already registered above
  });
}

// GET /api/billing/modules - List available modules with pricing
router.get('/modules', requirePermission('billing.subscriptions.view'), async (req, res) => {
  try {
    const modules = await prisma.module.findMany({
      where: {
        isActive: true,
      },
      include: {
        modulePrices: {
          orderBy: [
            { plan: 'asc' },
            { billingPeriod: 'asc' },
          ],
        },
      },
    });

    res.json(modules.map((m) => ({
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
    })));
  } catch (error) {
    console.error('Error fetching modules:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/billing/subscribe - Subscribe to a module (simulated payment)
router.post('/subscribe', requirePermission('billing.subscriptions.manage'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { moduleKey, plan, seats, billingPeriod } = req.body;

    if (!moduleKey || !plan) {
      res.status(400).json({ error: 'Module key and plan are required' });
      return;
    }

    // Find module
    const module = await prisma.module.findUnique({
      where: { key: moduleKey },
    });

    if (!module) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }

    // Find pricing
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

    // Check if Moyasar is configured
    const moyasarConfigured = !!process.env.MOYASAR_SECRET_KEY;

    if (moyasarConfigured) {
      // Create Moyasar invoice for payment
      try {
        const frontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';
        const invoice = await moyasarService.createInvoice({
          amount: modulePrice.priceCents, // Already in halalas/cents
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
          success_url: `${frontendUrl}/dashboard/billing/subscriptions?payment=success`,
          back_url: `${frontendUrl}/dashboard/billing/modules`,
          callback_url: `${process.env.API_URL || 'http://localhost:3001'}/api/billing/payment-callback`,
          expired_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        });

        // Create pending payment record
        const payment = await prisma.payment.create({
          data: {
            organizationId: req.org.id,
            moduleId: module.id,
            amountCents: modulePrice.priceCents,
            currency: modulePrice.currency,
            status: 'pending',
            provider: 'moyasar',
            providerRef: invoice.id,
          },
        });

        // Return invoice URL for frontend redirect
        return res.json({
          invoiceUrl: invoice.invoice_url,
          invoiceId: invoice.id,
          paymentId: payment.id,
          message: 'Please complete payment to activate subscription',
        });
      } catch (error: any) {
        console.error('Error creating Moyasar invoice:', error);
        // Fall through to direct activation if Moyasar fails
      }
    }

    // Direct activation (for development/testing when Moyasar is not configured)
    const now = new Date();
    const currentPeriodEnd = new Date();
    if (period === 'yearly') {
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    } else {
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    }

    // Create or update subscription
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

    // Update or create OrgModule
    // For active subscriptions, expiresAt should be null (no expiration)
    // The subscription tracks the billing period, module stays active until canceled
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
        expiresAt: null, // No expiration for active subscriptions
        trialEndsAt: null,
      },
      create: {
        organizationId: req.org.id,
        moduleId: module.id,
        isEnabled: true,
        plan,
        expiresAt: null, // No expiration for active subscriptions
        trialEndsAt: null,
      },
    });

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        organizationId: req.org.id,
        moduleId: module.id,
        subscriptionId: subscription.id,
        amountCents: modulePrice.priceCents,
        currency: modulePrice.currency,
        status: moyasarConfigured ? 'pending' : 'succeeded',
        provider: moyasarConfigured ? 'moyasar' : 'manual',
        paidAt: moyasarConfigured ? null : now,
      },
    });

    res.json({
      message: moyasarConfigured 
        ? 'Subscription activated (payment pending)' 
        : 'Subscription activated successfully',
      subscription,
      paymentId: payment.id,
    });
  } catch (error) {
    console.error('Error subscribing to module:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/billing/subscriptions - Get current org's subscriptions
router.get('/subscriptions', requirePermission('billing.subscriptions.view'), async (req, res) => {
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
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/billing/subscriptions/:id/cancel - Cancel subscription
router.post('/subscriptions/:id/cancel', requirePermission('billing.subscriptions.manage'), async (req, res) => {
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
      // Cancel immediately
      updateData.status = 'canceled';
      updateData.canceledAt = new Date();

      // Disable the module
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

// PUT /api/billing/subscriptions/:id/plan - Change subscription plan
router.put('/subscriptions/:id/plan', requirePermission('billing.subscriptions.manage'), async (req, res) => {
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

    // Find new pricing
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

    // Update subscription
    const updated = await prisma.subscription.update({
      where: { id },
      data: {
        plan,
      },
      include: {
        module: true,
      },
    });

    // Update orgModule
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

// GET /api/billing/payments - Get payment history
router.get('/payments', requirePermission('billing.subscriptions.view'), async (req, res) => {
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

// GET /api/billing/invoices - Get invoices (same as payments for now)
router.get('/invoices', requirePermission('billing.subscriptions.view'), async (req, res) => {
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

    // Format as invoices
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

// GET /api/billing/invoices/:id - Get single invoice (payment) by ID
router.get('/invoices/:id', requirePermission('billing.subscriptions.view'), async (req, res) => {
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

