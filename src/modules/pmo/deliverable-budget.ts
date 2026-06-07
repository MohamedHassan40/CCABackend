import prisma from '../../core/db';

export type DeliverableBudgetSummary = {
  projectBudgetCents: number | null;
  allocatedCents: number;
  remainingCents: number | null;
  currency: string;
};

export async function getDeliverableBudgetSummary(projectId: string): Promise<DeliverableBudgetSummary> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { budgetCents: true, currency: true },
  });

  const agg = await prisma.deliverable.aggregate({
    where: { projectId },
    _sum: { totalCostCents: true },
  });

  const allocatedCents = agg._sum.totalCostCents ?? 0;
  const projectBudgetCents = project?.budgetCents ?? null;

  return {
    projectBudgetCents,
    allocatedCents,
    remainingCents:
      projectBudgetCents != null ? Math.max(0, projectBudgetCents - allocatedCents) : null,
    currency: project?.currency ?? 'SAR',
  };
}

export function computeDeliverableTotalCost(quantity: unknown, unitCostCents: unknown): number {
  const qty = Math.max(1, Math.floor(Number(quantity)) || 1);
  const unit = Math.max(0, Math.floor(Number(unitCostCents)) || 0);
  return qty * unit;
}

export async function validateDeliverableCost(
  projectId: string,
  quantity: unknown,
  unitCostCents: unknown,
  excludeDeliverableId?: string
): Promise<
  | { ok: true; totalCostCents: number }
  | {
      ok: false;
      error: string;
      remainingCents: number;
      projectBudgetCents: number;
      totalCostCents: number;
    }
> {
  const totalCostCents = computeDeliverableTotalCost(quantity, unitCostCents);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { budgetCents: true },
  });

  if (project?.budgetCents == null || project.budgetCents <= 0) {
    return { ok: true, totalCostCents };
  }

  const where: { projectId: string; id?: { not: string } } = { projectId };
  if (excludeDeliverableId) {
    where.id = { not: excludeDeliverableId };
  }

  const agg = await prisma.deliverable.aggregate({
    where,
    _sum: { totalCostCents: true },
  });

  const otherAllocated = agg._sum.totalCostCents ?? 0;
  const newTotal = otherAllocated + totalCostCents;

  if (newTotal > project.budgetCents) {
    const remainingCents = Math.max(0, project.budgetCents - otherAllocated);
    return {
      ok: false,
      error: 'Deliverable cost exceeds project budget',
      remainingCents,
      projectBudgetCents: project.budgetCents,
      totalCostCents,
    };
  }

  return { ok: true, totalCostCents };
}
