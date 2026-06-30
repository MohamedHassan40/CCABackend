import prisma from '../../core/db';
import { ensureProjectPortalToken } from '../../routes/publicPmo';

type CloneOptions = {
  name: string;
  includeCharter?: boolean;
  includeStakeholders?: boolean;
  includeRaci?: boolean;
  includePlans?: boolean;
  includeDeliverables?: boolean;
  includeDesignData?: boolean;
};

export async function cloneProject(
  sourceId: string,
  orgId: string,
  options: CloneOptions,
): Promise<{ id: string; name: string }> {
  const source = await prisma.project.findFirst({
    where: { id: sourceId, orgId },
    include: {
      charter: true,
      stakeholders: true,
      raciEntries: true,
      plans: true,
      deliverables: true,
    },
  });
  if (!source) throw new Error('Project not found');

  const project = await prisma.project.create({
    data: {
      orgId,
      name: options.name,
      description: source.description,
      clientName: source.clientName,
      status: 'planning',
      priority: source.priority,
      currency: source.currency,
      lifecyclePhase: 'design',
      designData: options.includeDesignData !== false ? (source.designData ?? undefined) : undefined,
      enabledOptionalTools: source.enabledOptionalTools ?? undefined,
      portalToken: ensureProjectPortalToken(),
    },
  });

  if (options.includeCharter !== false && source.charter) {
    const c = source.charter;
    await prisma.projectCharter.create({
      data: {
        projectId: project.id,
        objectives: c.objectives,
        scope: c.scope,
        outOfScope: c.outOfScope,
        assumptions: c.assumptions,
        constraints: c.constraints,
        successCriteria: c.successCriteria,
        notes: c.notes,
        approvalStatus: 'draft',
      },
    });
  }

  if (options.includeStakeholders !== false) {
    for (const s of source.stakeholders) {
      await prisma.projectStakeholder.create({
        data: {
          projectId: project.id,
          name: s.name,
          role: s.role,
          organization: s.organization,
          email: s.email,
          phone: s.phone,
          influence: s.influence,
          interest: s.interest,
          engagementStrategy: s.engagementStrategy,
          notes: s.notes,
        },
      });
    }
  }

  if (options.includeRaci !== false) {
    for (const r of source.raciEntries) {
      await prisma.projectRaciEntry.create({
        data: {
          projectId: project.id,
          activityKey: r.activityKey,
          deliverableId: null,
          activityName: r.activityName,
          personId: r.personId,
          personType: r.personType,
          raciRole: r.raciRole,
        },
      });
    }
  }

  if (options.includePlans !== false) {
    for (const p of source.plans) {
      await prisma.projectPlan.create({
        data: {
          projectId: project.id,
          planType: p.planType,
          title: p.title,
          description: p.description,
          notes: p.notes,
          status: 'draft',
        },
      });
    }
  }

  if (options.includeDeliverables) {
    const idMap = new Map<string, string>();
    const sorted = [...source.deliverables].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const d of sorted) {
      const created = await prisma.deliverable.create({
        data: {
          projectId: project.id,
          name: d.name,
          description: d.description,
          wbsCode: d.wbsCode,
          parentId: d.parentId ? idMap.get(d.parentId) ?? null : null,
          sortOrder: d.sortOrder,
          status: 'not_started',
          quantity: d.quantity,
          unitCostCents: d.unitCostCents,
        },
      });
      idMap.set(d.id, created.id);
    }
  }

  return { id: project.id, name: project.name };
}
