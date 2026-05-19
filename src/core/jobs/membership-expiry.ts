import prisma from '../db';
import { createNotificationForOrgWithPermission } from '../notifications/helper';

/** Mark expired memberships and send staff renewal reminders across all orgs. */
export async function runMembershipMaintenanceJobs(): Promise<{
  expiredUpdated: number;
  orgsNotified: number;
  errors: number;
}> {
  const now = new Date();
  let expiredUpdated = 0;
  let orgsNotified = 0;
  let errors = 0;

  const membershipModule = await prisma.module.findUnique({ where: { key: 'membership' } });
  if (!membershipModule) return { expiredUpdated: 0, orgsNotified: 0, errors: 0 };

  const orgModules = await prisma.orgModule.findMany({
    where: { moduleId: membershipModule.id, isEnabled: true },
    select: { organizationId: true },
  });

  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  for (const { organizationId } of orgModules) {
    try {
      const expired = await prisma.memberMembership.updateMany({
        where: {
          orgId: organizationId,
          status: 'active',
          endDate: { lt: now },
        },
        data: { status: 'expired' },
      });
      expiredUpdated += expired.count;

      const expiringIn7 = await prisma.memberMembership.findMany({
        where: {
          orgId: organizationId,
          status: 'active',
          endDate: { gte: now, lte: in7 },
        },
        select: { memberName: true },
        orderBy: { endDate: 'asc' },
        take: 20,
      });

      const expiringIn30 = await prisma.memberMembership.findMany({
        where: {
          orgId: organizationId,
          status: 'active',
          endDate: { gt: in7, lte: in30 },
        },
        select: { memberName: true },
        orderBy: { endDate: 'asc' },
        take: 20,
      });

      const parts: string[] = [];
      if (expiringIn7.length > 0) {
        parts.push(`${expiringIn7.length} expiring in 7 days: ${expiringIn7.map((x) => x.memberName).join(', ')}`);
      }
      if (expiringIn30.length > 0) {
        parts.push(`${expiringIn30.length} expiring in 30 days: ${expiringIn30.map((x) => x.memberName).join(', ')}`);
      }

      if (parts.length > 0) {
        await createNotificationForOrgWithPermission(organizationId, 'membership.members.view', {
          type: 'warning',
          title: 'Membership renewal reminders',
          message: parts.join('. '),
          link: '/dashboard/membership/members',
        });
        orgsNotified++;
      }
    } catch (e) {
      console.error('Membership maintenance error for org', organizationId, e);
      errors++;
    }
  }

  return { expiredUpdated, orgsNotified, errors };
}
