import prisma from '../db';
import { createNotificationForOrgWithPermission } from '../notifications/helper';
import { sendEmailQueued, emailTemplates } from '../email';
import { getOrgEmailBrand } from '../auth/magicLink';

/** Notify PMO managers when project spend exceeds budget thresholds. */
export async function runPmoBudgetAlertJobs(): Promise<{ alerted: number; errors: number }> {
  let alerted = 0;
  let errors = 0;
  const pmoModule = await prisma.module.findUnique({ where: { key: 'pmo' } });
  if (!pmoModule) return { alerted: 0, errors: 0 };

  const orgModules = await prisma.orgModule.findMany({
    where: { moduleId: pmoModule.id, isEnabled: true },
    select: { organizationId: true },
  });

  for (const { organizationId } of orgModules) {
    try {
      const projects = await prisma.project.findMany({
        where: {
          orgId: organizationId,
          status: { in: ['planning', 'active', 'on_hold'] },
          budgetCents: { gt: 0 },
        },
        select: {
          id: true,
          name: true,
          budgetCents: true,
          spentCents: true,
          currency: true,
          budgetAlert90SentAt: true,
          budgetAlert100SentAt: true,
        },
      });

      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, slug: true },
      });
      const brand = await getOrgEmailBrand(organizationId, 'pmo');

      for (const p of projects) {
        const budget = p.budgetCents ?? 0;
        if (budget <= 0) continue;
        const pct = Math.round((p.spentCents / budget) * 100);
        if (pct < 90) continue;
        if (pct >= 100 && p.budgetAlert100SentAt) continue;
        if (pct >= 90 && pct < 100 && p.budgetAlert90SentAt) continue;

        const message =
          pct >= 100
            ? `Project "${p.name}" is over budget (${pct}% of ${(budget / 100).toFixed(2)} ${p.currency}).`
            : `Project "${p.name}" has used ${pct}% of budget.`;

        await createNotificationForOrgWithPermission(organizationId, 'pmo.projects.view', {
          type: pct >= 100 ? 'error' : 'warning',
          title: 'Budget alert',
          message,
          link: `/dashboard/pmo/projects/${p.id}`,
        });

        const managers = await prisma.projectManager.findMany({
          where: { projectId: p.id },
          include: { employee: { select: { email: true, userId: true } } },
        });
        const emails = new Set<string>();
        for (const m of managers) {
          if (m.employee.email) emails.add(m.employee.email);
        }

        const tpl = emailTemplates.pmoBudgetAlert(
          org?.name ?? 'Organization',
          p.name,
          pct,
          `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/pmo/projects/${p.id}`,
          brand ?? undefined
        );
        for (const to of emails) {
          await sendEmailQueued({ to, subject: tpl.subject, html: tpl.html, priority: 'high' });
        }

        await prisma.project.update({
          where: { id: p.id },
          data: pct >= 100
            ? { budgetAlert100SentAt: new Date() }
            : { budgetAlert90SentAt: new Date() },
        });
        alerted++;
      }
    } catch (e) {
      console.error('PMO budget alert error', organizationId, e);
      errors++;
    }
  }

  return { alerted, errors };
}
