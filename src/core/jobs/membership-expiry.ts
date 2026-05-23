import prisma from '../db';
import { createNotificationForOrgWithPermission } from '../notifications/helper';
import {
  sendMembershipExpiredEmail,
  sendMembershipExpiringEmail,
} from '../membership/memberEmails';

function hasEmailMarker(notes: string | null | undefined, marker: string): boolean {
  return (notes ?? '').includes(`[member-email:${marker}]`);
}

function appendEmailMarker(notes: string | null | undefined, marker: string): string {
  const tag = `[member-email:${marker}:${new Date().toISOString().slice(0, 10)}]`;
  return notes ? `${notes}\n${tag}` : tag;
}

/** Mark expired memberships and send staff + member renewal reminders across all orgs. */
export async function runMembershipMaintenanceJobs(): Promise<{
  expiredUpdated: number;
  orgsNotified: number;
  memberEmailsSent: number;
  errors: number;
}> {
  const now = new Date();
  let expiredUpdated = 0;
  let orgsNotified = 0;
  let memberEmailsSent = 0;
  let errors = 0;

  const membershipModule = await prisma.module.findUnique({ where: { key: 'membership' } });
  if (!membershipModule) {
    return { expiredUpdated: 0, orgsNotified: 0, memberEmailsSent: 0, errors: 0 };
  }

  const orgModules = await prisma.orgModule.findMany({
    where: { moduleId: membershipModule.id, isEnabled: true },
    select: { organizationId: true },
  });

  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  for (const { organizationId } of orgModules) {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, slug: true },
      });
      if (!org?.slug) continue;

      const justExpired = await prisma.memberMembership.findMany({
        where: {
          orgId: organizationId,
          status: 'active',
          endDate: { lt: now },
        },
        select: { id: true, notes: true, memberEmail: true, memberName: true },
      });

      if (justExpired.length > 0) {
        await prisma.memberMembership.updateMany({
          where: { id: { in: justExpired.map((m) => m.id) } },
          data: { status: 'expired' },
        });
        expiredUpdated += justExpired.length;

        for (const m of justExpired) {
          if (hasEmailMarker(m.notes, 'expired')) continue;
          try {
            await sendMembershipExpiredEmail({
              to: m.memberEmail,
              memberName: m.memberName,
              orgName: org.name,
              orgSlug: org.slug,
            });
            await prisma.memberMembership.update({
              where: { id: m.id },
              data: { notes: appendEmailMarker(m.notes, 'expired') },
            });
            memberEmailsSent++;
          } catch (e) {
            console.error('Member expired email failed', m.id, e);
          }
        }
      }

      const expiringIn7 = await prisma.memberMembership.findMany({
        where: {
          orgId: organizationId,
          status: 'active',
          endDate: { gte: now, lte: in7 },
        },
        select: {
          id: true,
          memberName: true,
          memberEmail: true,
          endDate: true,
          notes: true,
        },
        orderBy: { endDate: 'asc' },
        take: 50,
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

      for (const m of expiringIn7) {
        if (hasEmailMarker(m.notes, 'expiring-7d')) continue;
        const daysRemaining = Math.max(
          1,
          Math.ceil((m.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        );
        try {
          await sendMembershipExpiringEmail({
            to: m.memberEmail,
            memberName: m.memberName,
            orgName: org.name,
            orgSlug: org.slug,
            daysRemaining,
            endDate: m.endDate,
          });
          await prisma.memberMembership.update({
            where: { id: m.id },
            data: { notes: appendEmailMarker(m.notes, 'expiring-7d') },
          });
          memberEmailsSent++;
        } catch (e) {
          console.error('Member expiring email failed', m.id, e);
        }
      }

      const parts: string[] = [];
      if (expiringIn7.length > 0) {
        parts.push(
          `${expiringIn7.length} expiring in 7 days: ${expiringIn7.map((x) => x.memberName).join(', ')}`
        );
      }
      if (expiringIn30.length > 0) {
        parts.push(
          `${expiringIn30.length} expiring in 30 days: ${expiringIn30.map((x) => x.memberName).join(', ')}`
        );
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

  return { expiredUpdated, orgsNotified, memberEmailsSent, errors };
}
