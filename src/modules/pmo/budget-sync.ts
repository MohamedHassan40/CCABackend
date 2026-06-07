import prisma from '../../core/db';

/** Roll up budget line totals onto the parent Project record. */
export async function syncProjectBudgetTotals(projectId: string): Promise<void> {
  const aggregates = await prisma.budget.aggregate({
    where: { projectId },
    _sum: { budgetedCents: true, spentCents: true },
  });

  const budgetedCents = aggregates._sum.budgetedCents ?? 0;
  const spentCents = aggregates._sum.spentCents ?? 0;

  await prisma.project.update({
    where: { id: projectId },
    data: { budgetCents: budgetedCents, spentCents },
  });
}
