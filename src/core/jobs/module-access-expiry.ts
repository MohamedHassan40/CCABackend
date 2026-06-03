/**
 * Notify organizations when OrgModule.expiresAt (dated access) is approaching or has passed.
 * Distinct from trial/trialEndsAt handling in trial-expiry.ts.
 */

import prisma from '../db';
import { sendEmail, emailTemplates } from '../email';
import { captureException } from '../errorTracking';

interface ModuleAccessExpiryResult {
  processed: number;
  notified: number;
  disabled: number;
  errors: number;
}

export async function checkModuleAccessExpiry(): Promise<ModuleAccessExpiryResult> {
  const result: ModuleAccessExpiryResult = {
    processed: 0,
    notified: 0,
    disabled: 0,
    errors: 0,
  };

  const now = new Date();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const renewUrl = `${frontendUrl}/dashboard/subscription/modules`;

  const orgModules = await prisma.orgModule.findMany({
    where: {
      isEnabled: true,
      expiresAt: { not: null },
    },
    include: {
      organization: {
        include: {
          memberships: {
            where: { isActive: true },
            include: { user: true },
            take: 1,
          },
        },
      },
      module: true,
    },
  });

  for (const om of orgModules) {
    try {
      result.processed++;
      if (!om.expiresAt) continue;

      const owner = om.organization.memberships?.[0]?.user;
      if (!owner?.email) continue;

      const ms = om.expiresAt.getTime() - now.getTime();
      const daysUntilExpiry = Math.ceil(ms / (1000 * 60 * 60 * 24));

      if (ms < 0) {
        // Keep module visible in UI; access is blocked via expiresAt + middleware
        result.disabled++;
        const tpl = emailTemplates.subscriptionAccessEnded(
          om.organization.name,
          om.module.name,
          renewUrl
        );
        await sendEmail({
          to: owner.email,
          subject: tpl.subject,
          html: tpl.html,
        });
        result.notified++;
        continue;
      }

      if (daysUntilExpiry === 7 || daysUntilExpiry === 3 || daysUntilExpiry === 1 || daysUntilExpiry === 0) {
        const tpl = emailTemplates.moduleAccessExpiring(
          om.organization.name,
          om.module.name,
          daysUntilExpiry,
          renewUrl
        );
        await sendEmail({
          to: owner.email,
          subject: tpl.subject,
          html: tpl.html,
        });
        result.notified++;
      }
    } catch (error: unknown) {
      captureException(error instanceof Error ? error : new Error(String(error)), {
        orgModuleId: om.id,
        organizationId: om.organizationId,
      });
      result.errors++;
    }
  }

  return result;
}
