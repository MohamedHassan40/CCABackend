import { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';
import { requireProjectAccess } from './project-access';
import { ensureProjectPortalToken } from '../../routes/publicPmo';
import { riskScore } from './stakeholders-charter-reports';

type Checklist = {
  deliverablesComplete?: boolean;
  issuesClosed?: boolean;
  lessonsCaptured?: boolean;
  budgetReconciled?: boolean;
};

async function computeClosureChecklist(projectId: string): Promise<Checklist & { computed: Checklist }> {
  const [deliverables, issues, lessons, project] = await Promise.all([
    prisma.deliverable.findMany({ where: { projectId }, select: { status: true } }),
    prisma.issue.findMany({ where: { projectId }, select: { status: true } }),
    prisma.projectLessonLearned.count({ where: { projectId } }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { budgetCents: true, spentCents: true },
    }),
  ]);

  const computed: Checklist = {
    deliverablesComplete:
      deliverables.length === 0 || deliverables.every((d) => d.status === 'completed'),
    issuesClosed:
      issues.length === 0 || issues.every((i) => ['closed', 'resolved'].includes(i.status)),
    lessonsCaptured: lessons > 0,
    budgetReconciled:
      project?.budgetCents == null ||
      project.budgetCents === 0 ||
      (project.spentCents ?? 0) <= project.budgetCents,
  };

  const closure = await prisma.projectClosure.findUnique({ where: { projectId } });
  const saved = (closure?.checklist as Checklist | null) ?? {};

  return { ...saved, computed };
}

export function registerPmoPhase4Routes(router: Router): void {
  // GET /api/pmo/proposals
  router.get('/proposals', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const proposals = await prisma.projectProposal.findMany({
        where: { orgId: req.org.id },
        include: { project: { select: { id: true, name: true, status: true } } },
        orderBy: { updatedAt: 'desc' },
      });
      res.json(proposals);
    } catch (error) {
      console.error('Error fetching proposals:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/pmo/proposals
  router.post('/proposals', requirePermission('pmo.projects.create'), async (req: Request, res: Response) => {
    try {
      if (!req.org || !req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const {
        title,
        description,
        problemStatement,
        objectives,
        budgetEstimateCents,
        currency,
        startDate,
        endDate,
        logicalFramework,
        problemTree,
        dataCollectionPlan,
        notes,
      } = req.body;

      if (!title || !String(title).trim()) {
        res.status(400).json({ error: 'Title is required' });
        return;
      }

      const proposal = await prisma.projectProposal.create({
        data: {
          orgId: req.org.id,
          title: String(title).trim(),
          description: description?.trim() || null,
          problemStatement: problemStatement?.trim() || null,
          objectives: objectives?.trim() || null,
          budgetEstimateCents: budgetEstimateCents ?? null,
          currency: currency || 'SAR',
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          logicalFramework: logicalFramework ?? null,
          problemTree: problemTree ?? null,
          dataCollectionPlan: dataCollectionPlan ?? null,
          notes: notes?.trim() || null,
          createdById: req.user.id,
        },
      });
      res.status(201).json(proposal);
    } catch (error) {
      console.error('Error creating proposal:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/pmo/proposals/:id
  router.put('/proposals/:id', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const existing = await prisma.projectProposal.findFirst({
        where: { id, orgId: req.org.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }
      if (!['draft', 'rejected'].includes(existing.status)) {
        res.status(400).json({ error: 'Only draft or rejected proposals can be edited' });
        return;
      }

      const {
        title,
        description,
        problemStatement,
        objectives,
        budgetEstimateCents,
        currency,
        startDate,
        endDate,
        logicalFramework,
        problemTree,
        dataCollectionPlan,
        notes,
      } = req.body;

      const proposal = await prisma.projectProposal.update({
        where: { id },
        data: {
          ...(title !== undefined && { title: String(title).trim() }),
          ...(description !== undefined && { description: description?.trim() || null }),
          ...(problemStatement !== undefined && { problemStatement: problemStatement?.trim() || null }),
          ...(objectives !== undefined && { objectives: objectives?.trim() || null }),
          ...(budgetEstimateCents !== undefined && { budgetEstimateCents }),
          ...(currency !== undefined && { currency }),
          ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
          ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
          ...(logicalFramework !== undefined && { logicalFramework }),
          ...(problemTree !== undefined && { problemTree }),
          ...(dataCollectionPlan !== undefined && { dataCollectionPlan }),
          ...(notes !== undefined && { notes: notes?.trim() || null }),
          ...(existing.status === 'rejected' && { status: 'draft', rejectedAt: null, rejectionReason: null }),
        },
      });
      res.json(proposal);
    } catch (error) {
      console.error('Error updating proposal:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/pmo/proposals/:id
  router.delete('/proposals/:id', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const existing = await prisma.projectProposal.findFirst({
        where: { id, orgId: req.org.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }
      if (existing.status === 'approved') {
        res.status(400).json({ error: 'Cannot delete an approved proposal' });
        return;
      }
      await prisma.projectProposal.delete({ where: { id } });
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting proposal:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/pmo/proposals/:id/submit
  router.post('/proposals/:id/submit', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const existing = await prisma.projectProposal.findFirst({
        where: { id, orgId: req.org.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }
      if (existing.status !== 'draft') {
        res.status(400).json({ error: 'Only draft proposals can be submitted' });
        return;
      }
      const proposal = await prisma.projectProposal.update({
        where: { id },
        data: { status: 'submitted', submittedAt: new Date() },
      });
      res.json(proposal);
    } catch (error) {
      console.error('Error submitting proposal:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/pmo/proposals/:id/approve
  router.post('/proposals/:id/approve', requirePermission('pmo.projects.create'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const existing = await prisma.projectProposal.findFirst({
        where: { id, orgId: req.org.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }
      if (existing.status !== 'submitted') {
        res.status(400).json({ error: 'Only submitted proposals can be approved' });
        return;
      }
      if (existing.projectId) {
        res.status(400).json({ error: 'Proposal already linked to a project' });
        return;
      }

      const lf = existing.logicalFramework as Record<string, string> | null;
      const project = await prisma.project.create({
        data: {
          orgId: req.org.id,
          name: existing.title,
          description: existing.description,
          status: 'planning',
          startDate: existing.startDate,
          endDate: existing.endDate,
          budgetCents: existing.budgetEstimateCents,
          currency: existing.currency,
          notes: existing.notes,
          portalToken: ensureProjectPortalToken(),
        },
      });

      const objectives =
        existing.objectives ||
        (lf?.goal ? String(lf.goal) : null) ||
        (lf?.outcomes ? String(lf.outcomes) : null);

      if (objectives || lf?.outputs || existing.problemStatement) {
        await prisma.projectCharter.create({
          data: {
            projectId: project.id,
            objectives: objectives || null,
            scope: lf?.outputs ? String(lf.outputs) : null,
            assumptions: lf?.assumptions ? String(lf.assumptions) : null,
            successCriteria: lf?.indicators ? String(lf.indicators) : null,
            notes: existing.problemStatement,
            approvalStatus: 'draft',
          },
        });
      }

      const proposal = await prisma.projectProposal.update({
        where: { id },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          projectId: project.id,
        },
        include: { project: { select: { id: true, name: true, status: true } } },
      });

      res.json({ proposal, project });
    } catch (error) {
      console.error('Error approving proposal:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/pmo/proposals/:id/reject
  router.post('/proposals/:id/reject', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const { reason } = req.body;
      const existing = await prisma.projectProposal.findFirst({
        where: { id, orgId: req.org.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }
      if (existing.status !== 'submitted') {
        res.status(400).json({ error: 'Only submitted proposals can be rejected' });
        return;
      }
      const proposal = await prisma.projectProposal.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectedAt: new Date(),
          rejectionReason: reason?.trim() || null,
        },
      });
      res.json(proposal);
    } catch (error) {
      console.error('Error rejecting proposal:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/lessons-learned
  router.get('/projects/:id/lessons-learned', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const lessons = await prisma.projectLessonLearned.findMany({
        where: { projectId: id },
        orderBy: { createdAt: 'desc' },
      });
      res.json(lessons);
    } catch (error) {
      console.error('Error fetching lessons learned:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/pmo/projects/:id/lessons-learned
  router.post('/projects/:id/lessons-learned', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org || !req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const { category, description, recommendation, authorName } = req.body;
      if (!description || !String(description).trim()) {
        res.status(400).json({ error: 'Description is required' });
        return;
      }

      const lesson = await prisma.projectLessonLearned.create({
        data: {
          projectId: id,
          category: category || 'other',
          description: String(description).trim(),
          recommendation: recommendation?.trim() || null,
          authorName: authorName?.trim() || req.user.name || req.user.email || null,
          authorId: req.user.id,
        },
      });
      res.status(201).json(lesson);
    } catch (error) {
      console.error('Error creating lesson learned:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/pmo/lessons-learned/:id
  router.put('/lessons-learned/:id', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const existing = await prisma.projectLessonLearned.findFirst({
        where: { id },
        include: { project: { select: { orgId: true } } },
      });
      if (!existing || existing.project.orgId !== req.org.id) {
        res.status(404).json({ error: 'Lesson not found' });
        return;
      }

      const { category, description, recommendation } = req.body;
      const lesson = await prisma.projectLessonLearned.update({
        where: { id },
        data: {
          ...(category !== undefined && { category }),
          ...(description !== undefined && { description: String(description).trim() }),
          ...(recommendation !== undefined && { recommendation: recommendation?.trim() || null }),
        },
      });
      res.json(lesson);
    } catch (error) {
      console.error('Error updating lesson learned:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/pmo/lessons-learned/:id
  router.delete('/lessons-learned/:id', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const existing = await prisma.projectLessonLearned.findFirst({
        where: { id },
        include: { project: { select: { orgId: true } } },
      });
      if (!existing || existing.project.orgId !== req.org.id) {
        res.status(404).json({ error: 'Lesson not found' });
        return;
      }
      await prisma.projectLessonLearned.delete({ where: { id } });
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting lesson learned:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/closure
  router.get('/projects/:id/closure', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      let closure = await prisma.projectClosure.findUnique({ where: { projectId: id } });
      if (!closure) {
        closure = await prisma.projectClosure.create({
          data: { projectId: id },
        });
      }

      const checklist = await computeClosureChecklist(id);
      res.json({ ...closure, checklist });
    } catch (error) {
      console.error('Error fetching closure:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/pmo/projects/:id/closure
  router.put('/projects/:id/closure', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org || !req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const { closureStatus, finalReport, lessonsSummary, checklist } = req.body;

      const closure = await prisma.projectClosure.upsert({
        where: { projectId: id },
        create: {
          projectId: id,
          closureStatus: closureStatus || 'in_progress',
          finalReport: finalReport?.trim() || null,
          lessonsSummary: lessonsSummary?.trim() || null,
          checklist: checklist ?? null,
        },
        update: {
          ...(closureStatus !== undefined && { closureStatus }),
          ...(finalReport !== undefined && { finalReport: finalReport?.trim() || null }),
          ...(lessonsSummary !== undefined && { lessonsSummary: lessonsSummary?.trim() || null }),
          ...(checklist !== undefined && { checklist }),
          ...(closureStatus === 'approved' && {
            approvedAt: new Date(),
            approvedBy: req.user.name || req.user.email || req.user.id,
          }),
        },
      });

      if (closureStatus === 'approved') {
        await prisma.project.update({
          where: { id },
          data: { status: 'completed', actualEndDate: new Date() },
        });
      }

      const checklistData = await computeClosureChecklist(id);
      res.json({ ...closure, checklist: checklistData });
    } catch (error) {
      console.error('Error updating closure:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/reports/final
  router.get('/projects/:id/reports/final', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const project = await prisma.project.findFirst({
        where: { id, orgId: req.org.id },
        include: {
          charter: true,
          milestones: true,
          deliverables: { select: { id: true, name: true, status: true } },
          risks: { where: { status: { notIn: ['closed', 'mitigated'] } } },
          issues: true,
          tasks: { select: { id: true, status: true } },
          lessonsLearned: { orderBy: { createdAt: 'desc' } },
          closure: true,
        },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const now = new Date();
      const checklist = await computeClosureChecklist(id);

      res.json({
        generatedAt: now.toISOString(),
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          clientName: project.clientName,
          startDate: project.startDate,
          endDate: project.endDate,
          actualEndDate: project.actualEndDate,
          progress: project.progress,
        },
        charter: project.charter,
        summary: {
          milestones: {
            total: project.milestones.length,
            completed: project.milestones.filter((m) => m.status === 'completed').length,
          },
          deliverables: {
            total: project.deliverables.length,
            completed: project.deliverables.filter((d) => d.status === 'completed').length,
          },
          tasks: {
            total: project.tasks.length,
            completed: project.tasks.filter((t) => t.status === 'completed').length,
          },
          risks: {
            open: project.risks.length,
            topRisks: project.risks.slice(0, 5).map((r) => ({
              title: r.title,
              score: riskScore(r.probability, r.impact),
              status: r.status,
            })),
          },
          issues: {
            total: project.issues.length,
            open: project.issues.filter((i) => !['closed', 'resolved'].includes(i.status)).length,
          },
        },
        budget: {
          budgetCents: project.budgetCents,
          spentCents: project.spentCents,
          currency: project.currency,
        },
        lessonsLearned: project.lessonsLearned,
        closureChecklist: checklist,
        savedFinalReport: project.closure?.finalReport ?? null,
      });
    } catch (error) {
      console.error('Error generating final report:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/pmo/projects/:id/closure/certificate
  router.post('/projects/:id/closure/certificate', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const project = await prisma.project.findFirst({
        where: { id, orgId: req.org.id },
        include: { organization: { select: { name: true } } },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const certNumber = `PMO-${project.id.slice(-8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      const closure = await prisma.projectClosure.upsert({
        where: { projectId: id },
        create: {
          projectId: id,
          certificateNumber: certNumber,
          certificateGeneratedAt: new Date(),
        },
        update: {
          certificateNumber: certNumber,
          certificateGeneratedAt: new Date(),
        },
      });

      res.json({
        certificateNumber: closure.certificateNumber,
        certificateGeneratedAt: closure.certificateGeneratedAt,
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          endDate: project.endDate,
          actualEndDate: project.actualEndDate,
        },
        organization: project.organization.name,
      });
    } catch (error) {
      console.error('Error generating certificate:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
