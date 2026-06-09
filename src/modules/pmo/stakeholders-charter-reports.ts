import { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';
import { requireProjectAccess } from './project-access';

const PROBABILITY_WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 3 };
const IMPACT_WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function riskScore(probability: string, impact: string): number {
  const p = PROBABILITY_WEIGHT[probability] ?? 2;
  const i = IMPACT_WEIGHT[impact] ?? 2;
  return p * i;
}

export function registerPmoPhase2Routes(router: Router): void {
  // GET /api/pmo/projects/:id/stakeholders
  router.get('/projects/:id/stakeholders', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const stakeholders = await prisma.projectStakeholder.findMany({
        where: { projectId: id },
        orderBy: { name: 'asc' },
      });
      res.json(stakeholders);
    } catch (error) {
      console.error('Error fetching stakeholders:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/pmo/projects/:id/stakeholders
  router.post('/projects/:id/stakeholders', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const { name, organization, role, type, influence, interest, engagementStrategy, email, phone, notes } = req.body;
      if (!name || !String(name).trim()) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      const stakeholder = await prisma.projectStakeholder.create({
        data: {
          projectId: id,
          name: String(name).trim(),
          organization: organization?.trim() || null,
          role: role?.trim() || null,
          type: type || 'internal',
          influence: influence || 'medium',
          interest: interest || 'medium',
          engagementStrategy: engagementStrategy?.trim() || null,
          email: email?.trim() || null,
          phone: phone?.trim() || null,
          notes: notes?.trim() || null,
        },
      });
      res.status(201).json(stakeholder);
    } catch (error) {
      console.error('Error creating stakeholder:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/pmo/stakeholders/:id
  router.put('/stakeholders/:id', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const existing = await prisma.projectStakeholder.findFirst({
        where: { id },
        include: { project: true },
      });
      if (!existing || existing.project.orgId !== req.org.id) {
        res.status(404).json({ error: 'Stakeholder not found' });
        return;
      }
      if (!(await requireProjectAccess(req, res, existing.projectId))) return;

      const { name, organization, role, type, influence, interest, engagementStrategy, email, phone, notes } = req.body;
      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = String(name).trim();
      if (organization !== undefined) data.organization = organization?.trim() || null;
      if (role !== undefined) data.role = role?.trim() || null;
      if (type !== undefined) data.type = type;
      if (influence !== undefined) data.influence = influence;
      if (interest !== undefined) data.interest = interest;
      if (engagementStrategy !== undefined) data.engagementStrategy = engagementStrategy?.trim() || null;
      if (email !== undefined) data.email = email?.trim() || null;
      if (phone !== undefined) data.phone = phone?.trim() || null;
      if (notes !== undefined) data.notes = notes?.trim() || null;

      const updated = await prisma.projectStakeholder.update({
        where: { id },
        data: data as never,
      });
      res.json(updated);
    } catch (error) {
      console.error('Error updating stakeholder:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/pmo/stakeholders/:id
  router.delete('/stakeholders/:id', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const existing = await prisma.projectStakeholder.findFirst({
        where: { id },
        include: { project: true },
      });
      if (!existing || existing.project.orgId !== req.org.id) {
        res.status(404).json({ error: 'Stakeholder not found' });
        return;
      }
      if (!(await requireProjectAccess(req, res, existing.projectId))) return;

      await prisma.projectStakeholder.delete({ where: { id } });
      res.json({ message: 'Stakeholder deleted successfully' });
    } catch (error) {
      console.error('Error deleting stakeholder:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/charter
  router.get('/projects/:id/charter', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const charter = await prisma.projectCharter.findUnique({ where: { projectId: id } });
      res.json(charter);
    } catch (error) {
      console.error('Error fetching charter:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/pmo/projects/:id/charter
  router.put('/projects/:id/charter', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const {
        objectives,
        scope,
        outOfScope,
        assumptions,
        constraints,
        successCriteria,
        approvalStatus,
        approvedBy,
        approvedAt,
        notes,
      } = req.body;

      const data = {
        objectives: objectives?.trim() || null,
        scope: scope?.trim() || null,
        outOfScope: outOfScope?.trim() || null,
        assumptions: assumptions?.trim() || null,
        constraints: constraints?.trim() || null,
        successCriteria: successCriteria?.trim() || null,
        approvalStatus: approvalStatus || 'draft',
        approvedBy: approvedBy?.trim() || null,
        approvedAt: approvedAt ? new Date(approvedAt) : null,
        notes: notes?.trim() || null,
      };

      const charter = await prisma.projectCharter.upsert({
        where: { projectId: id },
        create: { projectId: id, ...data },
        update: data,
      });
      res.json(charter);
    } catch (error) {
      console.error('Error saving charter:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/risks/matrix
  router.get('/projects/:id/risks/matrix', requirePermission('pmo.risks.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const risks = await prisma.risk.findMany({
        where: { projectId: id, status: { notIn: ['closed', 'mitigated'] } },
        orderBy: { createdAt: 'desc' },
      });

      const cells: Record<string, Array<{ id: string; title: string; score: number; status: string }>> = {};
      for (const r of risks) {
        const key = `${r.probability}:${r.impact}`;
        if (!cells[key]) cells[key] = [];
        cells[key].push({
          id: r.id,
          title: r.title,
          score: riskScore(r.probability, r.impact),
          status: r.status,
        });
      }

      res.json({
        risks: risks.map((r) => ({
          ...r,
          score: riskScore(r.probability, r.impact),
        })),
        cells,
        probabilities: ['low', 'medium', 'high'],
        impacts: ['low', 'medium', 'high', 'critical'],
      });
    } catch (error) {
      console.error('Error fetching risk matrix:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/reports/executive
  router.get('/projects/:id/reports/executive', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const accessResult = await requireProjectAccess(req, res, id);
      if (!accessResult) return;

      const project = await prisma.project.findFirst({
        where: { id, orgId: req.org.id },
        include: {
          milestones: true,
          risks: { where: { status: { notIn: ['closed', 'mitigated'] } }, take: 5, orderBy: { createdAt: 'desc' } },
          issues: { where: { status: { notIn: ['closed', 'resolved'] } }, take: 5 },
          tasks: { select: { id: true, status: true } },
          deliverables: { select: { id: true, status: true } },
        },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const now = new Date();
      const milestones = project.milestones;
      const tasks = project.tasks;
      const deliverables = project.deliverables;

      res.json({
        generatedAt: now.toISOString(),
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          priority: project.priority,
          progress: project.progress,
          startDate: project.startDate,
          endDate: project.endDate,
          clientName: project.clientName,
        },
        milestones: {
          total: milestones.length,
          completed: milestones.filter((m) => m.status === 'completed').length,
          overdue: milestones.filter(
            (m) => m.status !== 'completed' && m.targetDate && new Date(m.targetDate) < now
          ).length,
        },
        tasks: {
          total: tasks.length,
          completed: tasks.filter((t) => t.status === 'completed').length,
          open: tasks.filter((t) => !['completed', 'cancelled'].includes(t.status)).length,
        },
        deliverables: {
          total: deliverables.length,
          completed: deliverables.filter((d) => d.status === 'completed').length,
        },
        risks: {
          open: project.risks.length,
          topRisks: project.risks.map((r) => ({
            id: r.id,
            title: r.title,
            probability: r.probability,
            impact: r.impact,
            score: riskScore(r.probability, r.impact),
            status: r.status,
          })),
        },
        issues: {
          open: project.issues.length,
          items: project.issues.map((i) => ({
            id: i.id,
            title: i.title,
            priority: i.priority,
            status: i.status,
          })),
        },
        budget: {
          budgetCents: project.budgetCents,
          spentCents: project.spentCents,
          currency: project.currency,
          usedPct:
            project.budgetCents && project.budgetCents > 0
              ? Math.round((project.spentCents / project.budgetCents) * 100)
              : null,
        },
      });
    } catch (error) {
      console.error('Error generating executive report:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/reports/financial
  router.get('/projects/:id/reports/financial', requirePermission('pmo.budget.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const project = await prisma.project.findFirst({
        where: { id, orgId: req.org.id },
        select: {
          id: true,
          name: true,
          currency: true,
          budgetCents: true,
          spentCents: true,
          budgets: { orderBy: { category: 'asc' } },
          deliverables: {
            select: { id: true, name: true, totalCostCents: true, status: true },
          },
        },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const budgetedTotal = project.budgets.reduce((s, b) => s + b.budgetedCents, 0);
      const spentTotal = project.budgets.reduce((s, b) => s + b.spentCents, 0);
      const deliverableCost = project.deliverables.reduce((s, d) => s + d.totalCostCents, 0);

      res.json({
        generatedAt: new Date().toISOString(),
        project: { id: project.id, name: project.name, currency: project.currency },
        summary: {
          projectBudgetCents: project.budgetCents,
          projectSpentCents: project.spentCents,
          lineBudgetedCents: budgetedTotal,
          lineSpentCents: spentTotal,
          deliverableAllocatedCents: deliverableCost,
          remainingCents:
            project.budgetCents != null ? project.budgetCents - project.spentCents : null,
        },
        byCategory: project.budgets.map((b) => ({
          id: b.id,
          category: b.category,
          budgetedCents: b.budgetedCents,
          spentCents: b.spentCents,
          remainingCents: b.budgetedCents - b.spentCents,
          usedPct: b.budgetedCents > 0 ? Math.round((b.spentCents / b.budgetedCents) * 100) : 0,
        })),
        deliverables: project.deliverables,
      });
    } catch (error) {
      console.error('Error generating financial report:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
