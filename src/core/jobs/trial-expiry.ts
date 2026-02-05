// Automated trial expiry job
// Runs daily to check for expiring trials and send notifications

import prisma from '../db';
import { sendEmail, emailTemplates } from '../email';
import { captureException } from '../errorTracking';

interface TrialExpiryResult {
  processed: number;
  expired: number;
  notified: number;
  errors: number;
}

/**
 * Check and process expiring trials
 */
export async function checkAndProcessTrials(): Promise<TrialExpiryResult> {
  const result: TrialExpiryResult = {
    processed: 0,
    expired: 0,
    notified: 0,
    errors: 0,
  };

  const now = new Date();
  
  // Find org modules with active trials
  const orgModulesWithTrials = await prisma.orgModule.findMany({
    where: {
      trialEndsAt: {
        not: null,
        gte: now, // Not expired yet
      },
      isEnabled: true,
    },
    include: {
      organization: {
        include: {
          memberships: {
            where: { isActive: true },
            include: {
              user: true,
            },
            take: 1, // Get owner/admin
          },
        },
      },
      module: true,
    },
  });

  for (const orgModule of orgModulesWithTrials) {
    try {
      result.processed++;
      
      if (!orgModule.trialEndsAt) continue;

      const daysUntilExpiry = Math.ceil(
        (orgModule.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Send notification if expiring in 3 days, 1 day, or today
      if (daysUntilExpiry === 3 || daysUntilExpiry === 1 || daysUntilExpiry === 0) {
        await sendTrialExpiryNotification(orgModule, daysUntilExpiry);
        result.notified++;
      }

      // If expired, disable module
      if (daysUntilExpiry < 0) {
        await disableExpiredTrial(orgModule);
        result.expired++;
      }
    } catch (error: any) {
      captureException(error, {
        orgModuleId: orgModule.id,
        organizationId: orgModule.organizationId,
      });
      result.errors++;
    }
  }

  // Also check for already expired trials that are still enabled
  const expiredTrials = await prisma.orgModule.findMany({
    where: {
      trialEndsAt: {
        lt: now, // Already expired
      },
      isEnabled: true,
    },
    include: {
      organization: true,
      module: true,
    },
  });

  for (const orgModule of expiredTrials) {
    try {
      await disableExpiredTrial(orgModule);
      result.expired++;
    } catch (error: any) {
      captureException(error, {
        orgModuleId: orgModule.id,
        organizationId: orgModule.organizationId,
      });
      result.errors++;
    }
  }

  return result;
}

/**
 * Send trial expiry notification
 */
async function sendTrialExpiryNotification(orgModule: any, daysLeft: number): Promise<void> {
  const owner = orgModule.organization.memberships?.[0]?.user;
  if (!owner) return;

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const subscribeUrl = `${frontendUrl}/dashboard/billing/modules`;

  await sendEmail({
    to: owner.email,
    subject: daysLeft === 0
      ? `Trial Expired: ${orgModule.module.name}`
      : `Trial Expiring Soon: ${orgModule.module.name} - ${daysLeft} days left`,
    html: emailTemplates.trialExpiring(
      orgModule.organization.name,
      orgModule.module.name,
      daysLeft
    ).html.replace(
      '{{subscribeUrl}}',
      subscribeUrl
    ),
  });
}

/**
 * Disable expired trial
 */
async function disableExpiredTrial(orgModule: any): Promise<void> {
  await prisma.orgModule.update({
    where: {
      organizationId_moduleId: {
        organizationId: orgModule.organizationId,
        moduleId: orgModule.moduleId,
      },
    },
    data: {
      isEnabled: false,
    },
  });

  // Send expiration email
  const owner = orgModule.organization.memberships?.[0]?.user;
  if (owner) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    await sendEmail({
      to: owner.email,
      subject: `Trial Expired: ${orgModule.module.name}`,
      html: emailTemplates.trialExpired(
        orgModule.organization.name,
        orgModule.module.name,
        `${frontendUrl}/dashboard/billing/modules`
      ).html,
    });
  }

  // Create notification for organization owners
  if (owner) {
    await prisma.notification.create({
      data: {
        userId: owner.id,
        title: 'Trial Expired',
        message: `Your trial for ${orgModule.module.name} has expired. Subscribe to continue using this module.`,
        type: 'trial_expired',
      },
    });
  }
}






