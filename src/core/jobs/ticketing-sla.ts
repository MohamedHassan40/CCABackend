import prisma from '../db';
import { createNotification } from '../notifications/helper';
import { sendEmailQueued, emailTemplates } from '../email';
import { getOrgEmailBrand } from '../auth/magicLink';

const frontendUrl = () =>
  (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * Notify assignees of tickets with breached or due-soon SLA (response / resolve).
 */
export async function checkTicketingSlaAlerts(): Promise<{
  processed: number;
  notified: number;
  emailsSent: number;
  errors: number;
}> {
  const now = new Date();
  const dueSoon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  let processed = 0;
  let notified = 0;
  let emailsSent = 0;
  let errors = 0;

  const ticketingModule = await prisma.module.findUnique({ where: { key: 'ticketing' } });
  if (!ticketingModule) return { processed: 0, notified: 0, emailsSent: 0, errors: 0 };

  const orgModules = await prisma.orgModule.findMany({
    where: { moduleId: ticketingModule.id, isEnabled: true },
    select: { organizationId: true },
  });

  for (const { organizationId } of orgModules) {
    try {
      const brand = await getOrgEmailBrand(organizationId, 'ticketing');
      const tickets = await prisma.ticket.findMany({
        where: {
          orgId: organizationId,
          status: { in: ['open', 'in_progress'] },
          OR: [
            { responseDueAt: { lte: dueSoon }, firstResponseAt: null },
            { resolveBy: { lte: dueSoon } },
          ],
        },
        select: {
          id: true,
          title: true,
          assigneeId: true,
          responseDueAt: true,
          resolveBy: true,
          firstResponseAt: true,
          assignee: { select: { email: true } },
        },
      });

      for (const ticket of tickets) {
        processed++;

        const responseOverdue =
          ticket.responseDueAt && !ticket.firstResponseAt && ticket.responseDueAt <= now;
        const resolveOverdue = ticket.resolveBy && ticket.resolveBy <= now;
        const responseDueSoon =
          ticket.responseDueAt &&
          !ticket.firstResponseAt &&
          ticket.responseDueAt > now &&
          ticket.responseDueAt <= dueSoon;
        const resolveDueSoon =
          ticket.resolveBy && ticket.resolveBy > now && ticket.resolveBy <= dueSoon;

        let message: string | null = null;
        let breachType: string | null = null;
        if (responseOverdue) {
          message = `First response SLA breached: ${ticket.title}`;
          breachType = 'response breached';
        } else if (resolveOverdue) {
          message = `Resolution SLA breached: ${ticket.title}`;
          breachType = 'resolution breached';
        } else if (responseDueSoon) {
          message = `First response due within 24h: ${ticket.title}`;
          breachType = 'response due soon';
        } else if (resolveDueSoon) {
          message = `Resolution due within 24h: ${ticket.title}`;
          breachType = 'resolution due soon';
        }

        if (!message) continue;

        const notifyUserIds = new Set<string>();
        if (ticket.assigneeId) notifyUserIds.add(ticket.assigneeId);

        if (notifyUserIds.size === 0) {
          const agents = await prisma.membership.findMany({
            where: {
              organizationId,
              isActive: true,
              membershipRoles: {
                some: {
                  role: {
                    rolePermissions: {
                      some: { permission: { key: 'ticketing.tickets.view' } },
                    },
                  },
                },
              },
            },
            select: { userId: true },
            take: 5,
          });
          for (const a of agents) notifyUserIds.add(a.userId);
        }

        for (const userId of notifyUserIds) {
          await createNotification({
            userId,
            organizationId,
            type: responseOverdue || resolveOverdue ? 'error' : 'warning',
            title: 'SLA alert',
            message,
            link: `/dashboard/ticketing/tickets/${ticket.id}`,
          });
          notified++;
        }

        const emailTo = ticket.assignee?.email;
        if (emailTo && breachType) {
          const ticketUrl = `${frontendUrl()}/dashboard/ticketing/tickets/${ticket.id}`;
          if (responseOverdue || resolveOverdue) {
            const tpl = emailTemplates.slaBreachToAssignee(
              ticket.title,
              breachType,
              ticketUrl,
              brand
            );
            await sendEmailQueued({ to: emailTo, subject: tpl.subject, html: tpl.html, priority: 'high' });
            emailsSent++;
          } else if (responseDueSoon || resolveDueSoon) {
            const { slaDueSoonEmail } = await import('../email/operationalEmails');
            const tpl = slaDueSoonEmail({
              ticketTitle: ticket.title,
              breachType,
              ticketUrl,
              brand,
            });
            await sendEmailQueued({ to: emailTo, subject: tpl.subject, html: tpl.html, priority: 'normal' });
            emailsSent++;
          }
        }
      }
    } catch (e) {
      console.error('SLA check error for org', organizationId, e);
      errors++;
    }
  }

  return { processed, notified, emailsSent, errors };
}
