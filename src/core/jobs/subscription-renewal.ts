// Automated subscription renewal job
// Runs daily to check for expiring subscriptions and renew them

import prisma from '../db';
import { moyasarService } from '../payments/moyasar';
import { sendEmail, emailTemplates } from '../email';
import { captureException } from '../errorTracking';

interface RenewalResult {
  success: boolean;
  subscriptionId: string;
  message: string;
  error?: string;
}

/**
 * Check and renew subscriptions that are expiring soon or have expired
 */
export async function checkAndRenewSubscriptions(): Promise<RenewalResult[]> {
  const results: RenewalResult[] = [];
  const now = new Date();
  
  // Find subscriptions expiring in the next 7 days or already expired (within grace period)
  const gracePeriodDays = 14; // 14-day grace period
  const gracePeriodEnd = new Date(now);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + gracePeriodDays);
  
  // Find active subscriptions that need renewal
  const subscriptionsToRenew = await prisma.subscription.findMany({
    where: {
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: {
        lte: gracePeriodEnd, // Expiring soon or expired
      },
    },
    include: {
      organization: {
        include: {
          memberships: {
            where: { isActive: true },
            include: {
              user: true,
            },
            take: 1, // Get owner/admin for email
          },
        },
      },
      module: true,
      payments: {
        where: {
          status: 'succeeded',
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1, // Get last successful payment
      },
    },
  });

  for (const subscription of subscriptionsToRenew) {
    try {
      const result = await renewSubscription(subscription.id);
      results.push(result);
    } catch (error: any) {
      captureException(error, {
        subscriptionId: subscription.id,
        organizationId: subscription.organizationId,
      });
      results.push({
        success: false,
        subscriptionId: subscription.id,
        message: 'Failed to renew subscription',
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Renew a single subscription
 */
async function renewSubscription(subscriptionId: string): Promise<RenewalResult> {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      organization: {
        include: {
          memberships: {
            where: { isActive: true },
            include: {
              user: true,
            },
            take: 1,
          },
        },
      },
      module: true,
    },
  });

  if (!subscription) {
    return {
      success: false,
      subscriptionId,
      message: 'Subscription not found',
    };
  }

  // Check if subscription is canceled
  if (subscription.cancelAtPeriodEnd || subscription.status === 'canceled') {
    return {
      success: false,
      subscriptionId,
      message: 'Subscription is canceled',
    };
  }

  const now = new Date();
  const isExpired = subscription.currentPeriodEnd < now;
  const daysUntilExpiry = Math.ceil(
    (subscription.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Send renewal reminder if expiring in 7, 3, or 1 days
  if (daysUntilExpiry === 7 || daysUntilExpiry === 3 || daysUntilExpiry === 1) {
    await sendRenewalReminder(subscription);
  }

  // If expired, try to renew
  if (isExpired) {
    return await attemptRenewal(subscription);
  }

  return {
    success: true,
    subscriptionId,
    message: `Subscription is active, expires in ${daysUntilExpiry} days`,
  };
}

/**
 * Attempt to renew an expired subscription
 */
async function attemptRenewal(subscription: any): Promise<RenewalResult> {
  try {
    // Get module pricing
    const modulePrice = await prisma.modulePrice.findFirst({
      where: {
        moduleId: subscription.moduleId,
        plan: subscription.plan,
        billingPeriod: 'monthly', // Default to monthly, could be determined from subscription
      },
    });

    if (!modulePrice) {
      // No pricing found, disable module and set expiry so middleware blocks access
      await prisma.orgModule.updateMany({
        where: {
          organizationId: subscription.organizationId,
          moduleId: subscription.moduleId,
        },
        data: {
          isEnabled: false,
          expiresAt: subscription.currentPeriodEnd,
        },
      });

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'expired',
        },
      });

      return {
        success: false,
        subscriptionId: subscription.id,
        message: 'No pricing found, subscription expired',
      };
    }

    // Check if Moyasar is configured
    const moyasarConfigured = !!process.env.MOYASAR_SECRET_KEY;

    if (moyasarConfigured) {
      // Try to create renewal invoice
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const apiUrl = process.env.API_URL || 'http://localhost:3001';

      try {
        const invoice = await moyasarService.createInvoice({
          amount: modulePrice.priceCents,
          description: `Renewal: ${subscription.module.name} - ${subscription.plan} plan`,
          metadata: {
            organizationId: subscription.organizationId,
            organizationName: subscription.organization.name,
            moduleId: subscription.moduleId,
            moduleKey: subscription.module.key,
            plan: subscription.plan,
            billingPeriod: 'monthly',
            subscriptionId: subscription.id,
            isRenewal: true,
          },
          success_url: `${frontendUrl}/dashboard/billing/subscriptions?renewal=success`,
          back_url: `${frontendUrl}/dashboard/billing/subscriptions`,
          callback_url: `${apiUrl}/api/billing/payment-callback`,
          expired_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        });

        // Create pending payment
        await prisma.payment.create({
          data: {
            organizationId: subscription.organizationId,
            moduleId: subscription.moduleId,
            subscriptionId: subscription.id,
            amountCents: modulePrice.priceCents,
            currency: modulePrice.currency,
            status: 'pending',
            provider: 'moyasar',
            providerRef: invoice.id,
          },
        });

        // Send payment required email
        const owner = subscription.organization.memberships[0]?.user;
        if (owner) {
          await sendEmail({
            to: owner.email,
            subject: `Payment Required: Renew ${subscription.module.name}`,
            html: emailTemplates.paymentFailed(
              subscription.organization.name,
              subscription.module.name,
              `${modulePrice.priceCents / 100} ${modulePrice.currency}`,
              `${frontendUrl}/dashboard/billing/subscriptions`
            ).html,
          });
        }

        return {
          success: true,
          subscriptionId: subscription.id,
          message: 'Renewal invoice created, waiting for payment',
        };
      } catch (error: any) {
        // If Moyasar fails, extend grace period
        const gracePeriodEnd = new Date();
        gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 7); // 7 more days

        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            currentPeriodEnd: gracePeriodEnd,
          },
        });

        return {
          success: false,
          subscriptionId: subscription.id,
          message: 'Failed to create renewal invoice, extended grace period',
          error: error.message,
        };
      }
    } else {
      // No payment gateway, extend subscription manually (for testing)
      const newPeriodEnd = new Date();
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          currentPeriodStart: now,
          currentPeriodEnd: newPeriodEnd,
        },
      });

      return {
        success: true,
        subscriptionId: subscription.id,
        message: 'Subscription renewed (manual mode)',
      };
    }
  } catch (error: any) {
    throw error;
  }
}

/**
 * Send renewal reminder email
 */
async function sendRenewalReminder(subscription: any): Promise<void> {
  const owner = subscription.organization.memberships[0]?.user;
  if (!owner) return;

  const modulePrice = await prisma.modulePrice.findFirst({
    where: {
      moduleId: subscription.moduleId,
      plan: subscription.plan,
      billingPeriod: 'monthly',
    },
  });

  if (!modulePrice) return;

  const daysUntilExpiry = Math.ceil(
    (subscription.currentPeriodEnd.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  );

  await sendEmail({
    to: owner.email,
    subject: `Renewal Reminder: ${subscription.module.name} expires in ${daysUntilExpiry} days`,
    html: emailTemplates.subscriptionRenewalReminder(
      subscription.organization.name,
      subscription.module.name,
      subscription.currentPeriodEnd,
      `${modulePrice.priceCents / 100} ${modulePrice.currency}`
    ).html,
  });
}

/**
 * Process successful renewal payment
 */
export async function processRenewalPayment(
  subscriptionId: string,
  paymentId: string
): Promise<void> {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      module: true,
      organization: true,
    },
  });

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  const now = new Date();
  const newPeriodEnd = new Date();
  newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1); // Monthly renewal

  // Update subscription
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: newPeriodEnd,
      cancelAtPeriodEnd: false,
      canceledAt: null,
    },
  });

  // Ensure module is enabled
  await prisma.orgModule.updateMany({
    where: {
      organizationId: subscription.organizationId,
      moduleId: subscription.moduleId,
    },
    data: {
      isEnabled: true,
      expiresAt: null,
    },
  });

  // Update payment status
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: 'succeeded',
      paidAt: now,
    },
  });
}






