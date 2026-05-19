import prisma from '../db';
import { createNotification } from '../notifications/helper';

/**
 * Notify assignees of tickets with breached or due-soon SLA (response / resolve).
 */
export async function checkTicketingSlaAlerts(): Promise<{ processed: number; notified: number; errors: number }> {
  const now = new Date();
  const dueSoon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  let processed = 0;
  let notified = 0;
  let errors = 0;

  const ticketingModule = await prisma.module.findUnique({ where: { key: 'ticketing' } });
  if (!ticketingModule) return { processed: 0, notified: 0, errors: 0 };

  const orgModules = await prisma.orgModule.findMany({
    where: { moduleId: ticketingModule.id, isEnabled: true },
    select: { organizationId: true },
  });

  for (const { organizationId } of orgModules) {
    try {
      const tickets = await prisma.ticket.findMany({
        where: {
          orgId: organizationId,
          status: { in: ['open', 'in_progress'] },
          assigneeId: { not: null },
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
        },
      });

      for (const ticket of tickets) {
        processed++;
        if (!ticket.assigneeId) continue;

        const responseOverdue =
          ticket.responseDueAt &&
          !ticket.firstResponseAt &&
          ticket.responseDueAt <= now;
        const resolveOverdue = ticket.resolveBy && ticket.resolveBy <= now;
        const responseDueSoon =
          ticket.responseDueAt &&
          !ticket.firstResponseAt &&
          ticket.responseDueAt > now &&
          ticket.responseDueAt <= dueSoon;
        const resolveDueSoon =
          ticket.resolveBy && ticket.resolveBy > now && ticket.resolveBy <= dueSoon;

        let message: string | null = null;
        if (responseOverdue) message = `First response SLA breached: ${ticket.title}`;
        else if (resolveOverdue) message = `Resolution SLA breached: ${ticket.title}`;
        else if (responseDueSoon) message = `First response due within 24h: ${ticket.title}`;
        else if (resolveDueSoon) message = `Resolution due within 24h: ${ticket.title}`;

        if (!message) continue;

        await createNotification({
          userId: ticket.assigneeId,
          organizationId,
          type: responseOverdue || resolveOverdue ? 'error' : 'warning',
          title: 'SLA alert',
          message,
          link: `/dashboard/ticketing/tickets/${ticket.id}`,
        });
        notified++;
      }
    } catch (e) {
      console.error('SLA check error for org', organizationId, e);
      errors++;
    }
  }

  return { processed, notified, errors };
}
