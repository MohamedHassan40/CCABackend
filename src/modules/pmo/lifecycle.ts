import type { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';
import { getProjectListWhere, requireProjectAccess } from './project-access';
import {
  PMO_PHASES,
  type PmoPhase,
  computePhaseGate,
  computePhaseProgress,
  evaluateToolStatus,
  filterVisibleTools,
  getAvailableOptionalTools,
  canViewPhase,
  nextPhase,
  prevPhase,
} from './lifecycle-config';

function escapeCsv(val: unknown): string {
  const s = val == null ? '' : String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function loadProjectForLifecycle(projectId: string, orgId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, orgId },
    include: {
      projectManagers: true,
      stakeholders: true,
      risks: true,
      charter: true,
      deliverables: true,
      tasks: { select: { id: true, status: true, title: true, dueDate: true } },
      budgets: true,
      plans: true,
      raciEntries: true,
      issues: true,
      changeRequests: true,
      closure: true,
      lessonsLearned: true,
      proposal: true,
    },
  });
}

function getOrgDisabledTools(pmoSettings: unknown): string[] {
  const settings = (pmoSettings && typeof pmoSettings === 'object' ? pmoSettings : {}) as {
    disabledOptionalTools?: string[];
  };
  return Array.isArray(settings.disabledOptionalTools) ? settings.disabledOptionalTools : [];
}

function getProjectEnabledTools(raw: unknown): string[] | null {
  const val = (raw && typeof raw === 'object' ? raw : null) as { enabled?: string[] } | null;
  return Array.isArray(val?.enabled) ? val!.enabled : null;
}

export function registerPmoLifecycleRoutes(router: Router): void {
  // GET /api/pmo/dashboard
  router.get('/dashboard', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const listWhere = await getProjectListWhere(req);
      if (!listWhere) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const baseWhere = {
        orgId: req.org.id,
        ...(listWhere.id ? { id: listWhere.id } : {}),
      };

      const projects = await prisma.project.findMany({
        where: baseWhere,
        select: {
          id: true,
          name: true,
          status: true,
          lifecyclePhase: true,
          progress: true,
          endDate: true,
          budgetCents: true,
          spentCents: true,
          currency: true,
        },
      });

      const now = new Date();
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const tasks = await prisma.projectTask.findMany({
        where: {
          orgId: req.org.id,
          project: baseWhere,
          status: { notIn: ['completed', 'cancelled'] },
        },
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          project: { select: { id: true, name: true } },
        },
      });

      const totalProjects = projects.length;
      const avgProgress =
        totalProjects > 0
          ? Math.round(projects.reduce((s, p) => s + (p.progress || 0), 0) / totalProjects)
          : 0;

      const phaseCounts: Record<string, number> = {};
      for (const p of PMO_PHASES) phaseCounts[p] = 0;
      for (const p of projects) {
        const phase = PMO_PHASES.includes(p.lifecyclePhase as PmoPhase) ? p.lifecyclePhase : 'planning';
        phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
      }

      const statusCounts = {
        planning: projects.filter((p) => p.status === 'planning').length,
        active: projects.filter((p) => p.status === 'active').length,
        on_hold: projects.filter((p) => p.status === 'on_hold').length,
        completed: projects.filter((p) => p.status === 'completed').length,
      };

      const overdueTasks = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now);
      const dueThisWeek = tasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) >= now && new Date(t.dueDate) <= weekEnd,
      );
      const dueToday = tasks.filter((t) => {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        return d.toDateString() === now.toDateString();
      });

      const totalBudget = projects.reduce((s, p) => s + (p.budgetCents || 0), 0);
      const totalSpent = projects.reduce((s, p) => s + (p.spentCents || 0), 0);

      const delayedProjects = projects.filter(
        (p) =>
          p.endDate &&
          new Date(p.endDate) < now &&
          !['completed', 'cancelled'].includes(p.status),
      );

      const alerts: Array<{ type: string; message: string; projectId?: string; severity: string }> = [];
      for (const p of delayedProjects.slice(0, 5)) {
        alerts.push({
          type: 'delay',
          message: `${p.name}: deadline passed`,
          projectId: p.id,
          severity: 'high',
        });
      }
      for (const t of overdueTasks.slice(0, 5)) {
        alerts.push({
          type: 'task_overdue',
          message: `${t.title} (${t.project.name})`,
          projectId: t.project.id,
          severity: 'medium',
        });
      }

      const pendingChanges = await prisma.projectChangeRequest.count({
        where: { project: baseWhere, status: 'pending' },
      });

      const [openIssues, openRisks, pendingProposals, totalOpenTasks] = await Promise.all([
        prisma.issue.count({
          where: { project: baseWhere, status: { in: ['open', 'in_progress'] } },
        }),
        prisma.risk.count({
          where: { project: baseWhere, status: { in: ['identified', 'mitigating'] } },
        }),
        prisma.projectProposal.count({
          where: { orgId: req.org.id, status: { in: ['draft', 'submitted'] } },
        }),
        prisma.projectTask.count({
          where: {
            orgId: req.org.id,
            project: baseWhere,
            status: { notIn: ['completed', 'cancelled'] },
          },
        }),
      ]);

      if (pendingChanges > 0) {
        alerts.push({
          type: 'change_request',
          message: `${pendingChanges} pending change request(s)`,
          severity: 'medium',
        });
      }

      res.json({
        summary: {
          totalProjects,
          activeProjects: statusCounts.active + statusCounts.planning,
          avgProgress,
          dueThisWeek: dueThisWeek.length,
          overdueTasks: overdueTasks.length,
          delayedProjects: delayedProjects.length,
          openIssues,
          openRisks,
          pendingProposals,
          pendingChanges,
          totalOpenTasks,
        },
        financial: {
          totalBudgetCents: totalBudget,
          totalSpentCents: totalSpent,
          spendPercent: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0,
          remainingCents: totalBudget - totalSpent,
          currency: projects[0]?.currency ?? 'SAR',
        },
        phaseCounts,
        statusCounts,
        dueTasks: {
          today: dueToday.length,
          thisWeek: dueThisWeek.length,
          later: tasks.length - dueToday.length - dueThisWeek.length,
        },
        alerts,
        recentTasks: tasks
          .filter((t) => t.dueDate)
          .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
          .slice(0, 10),
      });
    } catch (error) {
      console.error('PMO dashboard error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/stats
  router.get('/projects/:id/stats', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const now = new Date();
      const project = await prisma.project.findFirst({
        where: { id, orgId: req.org.id },
        select: {
          id: true,
          name: true,
          status: true,
          lifecyclePhase: true,
          progress: true,
          startDate: true,
          endDate: true,
          budgetCents: true,
          spentCents: true,
          currency: true,
        },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const [tasks, deliverables, risks, issues, milestones, pendingChanges] = await Promise.all([
        prisma.projectTask.findMany({
          where: { projectId: id },
          select: { id: true, status: true, dueDate: true },
        }),
        prisma.deliverable.findMany({
          where: { projectId: id },
          select: { id: true, status: true },
        }),
        prisma.risk.findMany({ where: { projectId: id }, select: { id: true, status: true, impact: true } }),
        prisma.issue.findMany({ where: { projectId: id }, select: { id: true, status: true } }),
        prisma.projectMilestone.findMany({
          where: { projectId: id },
          select: { id: true, status: true, targetDate: true, completedAt: true },
        }),
        prisma.projectChangeRequest.count({ where: { projectId: id, status: 'pending' } }),
      ]);

      const openTasks = tasks.filter((t) => !['completed', 'cancelled'].includes(t.status));
      const overdueTasks = openTasks.filter((t) => t.dueDate && new Date(t.dueDate) < now);
      const completedTasks = tasks.filter((t) => t.status === 'completed');
      const completedDeliverables = deliverables.filter((d) => d.status === 'completed');
      const openIssues = issues.filter((i) => ['open', 'in_progress'].includes(i.status));
      const openRisks = risks.filter((r) => !['closed', 'mitigated', 'occurred'].includes(r.status));
      const highRisks = openRisks.filter((r) => r.impact === 'high' || r.impact === 'critical');
      const overdueMilestones = milestones.filter(
        (m) => !m.completedAt && m.targetDate && new Date(m.targetDate) < now,
      );

      const budgetCents = project.budgetCents ?? 0;
      const spentCents = project.spentCents ?? 0;

      res.json({
        project,
        tasks: {
          total: tasks.length,
          completed: completedTasks.length,
          open: openTasks.length,
          overdue: overdueTasks.length,
        },
        deliverables: { total: deliverables.length, completed: completedDeliverables.length },
        risks: { total: risks.length, open: openRisks.length, high: highRisks.length },
        issues: { total: issues.length, open: openIssues.length },
        milestones: { total: milestones.length, overdue: overdueMilestones.length },
        pendingChanges,
        financial: {
          budgetCents,
          spentCents,
          remainingCents: budgetCents - spentCents,
          spendPercent: budgetCents > 0 ? Math.round((spentCents / budgetCents) * 100) : 0,
          currency: project.currency,
        },
        isDelayed:
          !!project.endDate &&
          new Date(project.endDate) < now &&
          !['completed', 'cancelled'].includes(project.status),
      });
    } catch (error) {
      console.error('PMO project stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/tasks/my-dashboard
  router.get('/tasks/my-dashboard', requirePermission('pmo.tasks.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org || !req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const employee = await prisma.employee.findFirst({
        where: { orgId: req.org.id, userId: req.user.id },
      });

      const listWhere = await getProjectListWhere(req);
      if (!listWhere) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const where: Record<string, unknown> = {
        orgId: req.org.id,
        project: { orgId: req.org.id, ...(listWhere.id ? { id: listWhere.id } : {}) },
        status: { notIn: ['cancelled'] },
      };
      if (employee) {
        where.assigneeId = employee.id;
      } else if (!req.user.isSuperAdmin) {
        where.createdById = req.user.id;
      }

      const tasks = await prisma.projectTask.findMany({
        where,
        include: {
          project: { select: { id: true, name: true } },
          assignee: { select: { id: true, fullName: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      });

      const now = new Date();
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const byStatus: Record<string, number> = {};
      for (const t of tasks) {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      }

      res.json({
        tasks,
        summary: {
          total: tasks.length,
          overdue: tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'completed').length,
          dueThisWeek: tasks.filter(
            (t) =>
              t.dueDate &&
              new Date(t.dueDate) >= now &&
              new Date(t.dueDate) <= weekEnd &&
              t.status !== 'completed',
          ).length,
          completed: tasks.filter((t) => t.status === 'completed').length,
          byStatus,
        },
        employee: employee ? { id: employee.id, fullName: employee.fullName } : null,
      });
    } catch (error) {
      console.error('PMO my tasks dashboard error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/knowledge
  router.get('/knowledge', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const listWhere = await getProjectListWhere(req);
      if (!listWhere) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const projectFilter = { orgId: req.org.id, ...(listWhere.id ? { id: listWhere.id } : {}) };

      const [lessons, issues] = await Promise.all([
        prisma.projectLessonLearned.findMany({
          where: { project: projectFilter },
          include: { project: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
        prisma.issue.findMany({
          where: { project: projectFilter, status: { in: ['open', 'in_progress', 'resolved'] } },
          include: { project: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
      ]);

      res.json({
        lessons,
        issues,
        stats: {
          totalLessons: lessons.length,
          totalIssues: issues.length,
          openIssues: issues.filter((i) => i.status === 'open' || i.status === 'in_progress').length,
        },
      });
    } catch (error) {
      console.error('PMO knowledge hub error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/settings
  router.get('/settings', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const org = await prisma.organization.findUnique({
        where: { id: req.org.id },
        select: { pmoSettings: true },
      });
      res.json(org?.pmoSettings ?? { disabledOptionalTools: [] });
    } catch (error) {
      console.error('PMO settings get error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/pmo/settings
  router.put('/settings', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { disabledOptionalTools } = req.body;
      const updated = await prisma.organization.update({
        where: { id: req.org.id },
        data: {
          pmoSettings: {
            disabledOptionalTools: Array.isArray(disabledOptionalTools) ? disabledOptionalTools : [],
          },
        },
        select: { pmoSettings: true },
      });
      res.json(updated.pmoSettings);
    } catch (error) {
      console.error('PMO settings update error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/export
  router.get('/projects/export', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const listWhere = await getProjectListWhere(req);
      if (!listWhere) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const projects = await prisma.project.findMany({
        where: { orgId: req.org.id, ...(listWhere.id ? { id: listWhere.id } : {}) },
        orderBy: { createdAt: 'desc' },
      });

      const headers = [
        'ID',
        'Name',
        'Status',
        'Phase',
        'Progress',
        'Start Date',
        'End Date',
        'Budget',
        'Spent',
        'Currency',
      ];
      const rows = projects.map((p) =>
        [
          p.id,
          p.name,
          p.status,
          p.lifecyclePhase,
          p.progress,
          p.startDate?.toISOString().slice(0, 10) ?? '',
          p.endDate?.toISOString().slice(0, 10) ?? '',
          p.budgetCents != null ? p.budgetCents / 100 : '',
          p.spentCents / 100,
          p.currency,
        ]
          .map(escapeCsv)
          .join(','),
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="pmo-projects.csv"');
      res.send([headers.join(','), ...rows].join('\n'));
    } catch (error) {
      console.error('PMO export error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/lifecycle
  router.get('/projects/:id/lifecycle', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const project = await loadProjectForLifecycle(id, req.org.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const org = await prisma.organization.findUnique({
        where: { id: req.org.id },
        select: { pmoSettings: true },
      });
      const disabledOrgTools = getOrgDisabledTools(org?.pmoSettings);
      const enabledProjectTools = getProjectEnabledTools(project.enabledOptionalTools);
      const approvals = project.phaseGateApprovals as Record<string, { approvedAt?: string }> | null;

      const currentLifecyclePhase = (PMO_PHASES.includes(project.lifecyclePhase as PmoPhase)
        ? project.lifecyclePhase
        : 'design') as PmoPhase;

      const requestedPhase = req.query.phase as string | undefined;
      let phase = currentLifecyclePhase;
      if (requestedPhase && PMO_PHASES.includes(requestedPhase as PmoPhase)) {
        const candidate = requestedPhase as PmoPhase;
        phase = canViewPhase(candidate, currentLifecyclePhase, approvals) ? candidate : currentLifecyclePhase;
      }

      const phases = PMO_PHASES.map((p) => ({
        key: p,
        progress: computePhaseProgress(p, project),
        approved: !!approvals?.[p]?.approvedAt,
        isCurrent: p === currentLifecyclePhase,
        locked: !canViewPhase(p, currentLifecyclePhase, approvals),
      }));

      const visibleTools = filterVisibleTools(phase, disabledOrgTools, enabledProjectTools).map((tool) => ({
        ...tool,
        status: evaluateToolStatus(tool.key, project),
      }));

      const availableOptionalTools = getAvailableOptionalTools(phase, disabledOrgTools, enabledProjectTools);

      const gate = computePhaseGate(
        phase,
        project,
        project.phaseGateChecklist,
        project.phaseGateApprovals,
      );

      res.json({
        lifecyclePhase: currentLifecyclePhase,
        viewPhase: phase,
        phases,
        tools: visibleTools,
        availableOptionalTools,
        allowedTabs: [...new Set(visibleTools.map((t) => t.tab))],
        gate,
        designData: project.designData ?? {},
        enabledOptionalTools: enabledProjectTools ?? [],
        nextPhase: nextPhase(phase),
        prevPhase: prevPhase(phase),
        canApproveCurrentPhase: phase === currentLifecyclePhase,
      });
    } catch (error) {
      console.error('PMO lifecycle get error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/pmo/projects/:id/lifecycle
  router.put('/projects/:id/lifecycle', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org || !req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const {
        lifecyclePhase,
        designData,
        phaseGateChecklist,
        enabledOptionalTools,
        action,
        checklistItem,
        checklistValue,
        phase: viewPhase,
        toolKey,
      } = req.body;

      const project = await loadProjectForLifecycle(id, req.org.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const currentPhase = (PMO_PHASES.includes(project.lifecyclePhase as PmoPhase)
        ? project.lifecyclePhase
        : 'design') as PmoPhase;

      const phaseForAction =
        viewPhase && PMO_PHASES.includes(viewPhase as PmoPhase) ? (viewPhase as PmoPhase) : currentPhase;

      let phaseGateApprovals = (project.phaseGateApprovals ?? {}) as Record<
        string,
        { approvedAt?: string; approvedBy?: string; approvedByName?: string }
      >;
      let nextLifecyclePhase = currentPhase;
      let manualChecklist = project.phaseGateChecklist;
      let optionalToolsUpdate: string[] | undefined;

      if (action === 'add_optional_tool' && toolKey) {
        const existing = getProjectEnabledTools(project.enabledOptionalTools) ?? [];
        if (!existing.includes(String(toolKey))) {
          optionalToolsUpdate = [...existing, String(toolKey)];
        }
      } else if (action === 'approve_gate') {
        if (phaseForAction !== currentPhase) {
          res.status(400).json({ error: 'Can only approve the current project phase' });
          return;
        }
        const gate = computePhaseGate(currentPhase, project, manualChecklist, phaseGateApprovals);
        if (!gate.canApprove) {
          res.status(400).json({ error: 'Cannot approve phase: mandatory requirements incomplete' });
          return;
        }
        phaseGateApprovals = {
          ...phaseGateApprovals,
          [currentPhase]: {
            approvedAt: new Date().toISOString(),
            approvedBy: req.user.id,
            approvedByName: req.user.name ?? req.user.email,
          },
        };
        const nxt = nextPhase(currentPhase);
        if (nxt) nextLifecyclePhase = nxt;
      } else if (action === 'set_checklist' && checklistItem) {
        const existing = (manualChecklist && typeof manualChecklist === 'object' ? manualChecklist : {}) as Record<
          string,
          Record<string, boolean>
        >;
        manualChecklist = {
          ...existing,
          [phaseForAction]: {
            ...(existing[phaseForAction] ?? {}),
            [checklistItem]: !!checklistValue,
          },
        };
      } else if (lifecyclePhase && PMO_PHASES.includes(lifecyclePhase)) {
        nextLifecyclePhase = lifecyclePhase;
      }

      if (enabledOptionalTools !== undefined && Array.isArray(enabledOptionalTools)) {
        optionalToolsUpdate = enabledOptionalTools.map(String);
      }

      const updated = await prisma.project.update({
        where: { id },
        data: {
          lifecyclePhase: nextLifecyclePhase,
          ...(designData !== undefined && { designData }),
          ...(manualChecklist !== undefined && { phaseGateChecklist: manualChecklist as object }),
          ...(optionalToolsUpdate !== undefined && {
            enabledOptionalTools: { enabled: optionalToolsUpdate },
          }),
          phaseGateApprovals,
        },
      });

      res.json(updated);
    } catch (error) {
      console.error('PMO lifecycle update error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/executive-plan
  router.get(
    '/projects/:id/executive-plan',
    requirePermission('pmo.projects.view'),
    async (req: Request, res: Response) => {
      try {
        if (!req.org) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        const { id } = req.params;
        if (!(await requireProjectAccess(req, res, id))) return;

        const [deliverables, tasks, project] = await Promise.all([
          prisma.deliverable.findMany({
            where: { projectId: id },
            orderBy: [{ sortOrder: 'asc' }, { wbsCode: 'asc' }],
          }),
          prisma.projectTask.findMany({
            where: { projectId: id },
            include: {
              assignee: { select: { id: true, fullName: true, email: true } },
            },
            orderBy: { createdAt: 'asc' },
          }),
          prisma.project.findFirst({
            where: { id, orgId: req.org.id },
            select: { startDate: true, endDate: true, budgetCents: true, spentCents: true, currency: true, progress: true },
          }),
        ]);

        const items = [
          ...deliverables.map((d) => ({
            id: d.id,
            type: 'deliverable' as const,
            wbsCode: d.wbsCode,
            name: d.name,
            responsible: d.assignedTo,
            startDate: d.startDate,
            endDate: d.dueDate,
            durationDays:
              d.startDate && d.dueDate
                ? Math.max(1, Math.ceil((new Date(d.dueDate).getTime() - new Date(d.startDate).getTime()) / 86400000))
                : null,
            plannedCostCents: d.totalCostCents,
            actualCostCents: d.totalCostCents,
            progress: d.status === 'completed' ? 100 : d.status === 'in_progress' ? 50 : 0,
            status: d.status,
          })),
          ...tasks.map((t) => ({
            id: t.id,
            type: 'task' as const,
            wbsCode: null,
            name: t.title,
            responsible: t.assignee?.fullName ?? null,
            startDate: t.createdAt,
            endDate: t.dueDate,
            durationDays: t.dueDate
              ? Math.max(1, Math.ceil((new Date(t.dueDate).getTime() - t.createdAt.getTime()) / 86400000))
              : null,
            plannedCostCents: null,
            actualCostCents: null,
            progress: t.status === 'completed' ? 100 : t.status === 'in_progress' ? 50 : t.status === 'review' ? 75 : 0,
            status: t.status,
          })),
        ];

        const totalTasks = tasks.length;
        const completedTasks = tasks.filter((t) => t.status === 'completed').length;
        const avgCompletion =
          items.length > 0 ? Math.round(items.reduce((s, i) => s + i.progress, 0) / items.length) : 0;

        res.json({
          items,
          kanban: {
            not_started: tasks.filter((t) => t.status === 'draft' || t.status === 'submitted'),
            in_progress: tasks.filter((t) => t.status === 'in_progress'),
            review: tasks.filter((t) => t.status === 'review'),
            on_hold: tasks.filter((t) => t.status === 'cancelled'),
            completed: tasks.filter((t) => t.status === 'completed'),
          },
          summary: {
            totalTasks,
            totalOutputs: deliverables.length,
            avgCompletion,
            spendPercent:
              project?.budgetCents && project.budgetCents > 0
                ? Math.round(((project.spentCents || 0) / project.budgetCents) * 100)
                : 0,
            budgetCents: project?.budgetCents ?? 0,
            spentCents: project?.spentCents ?? 0,
            currency: project?.currency ?? 'SAR',
          },
          projectStart: project?.startDate,
          projectEnd: project?.endDate,
        });
      } catch (error) {
        console.error('PMO executive plan error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  // Change requests CRUD
  router.get(
    '/projects/:id/change-requests',
    requirePermission('pmo.projects.view'),
    async (req: Request, res: Response) => {
      try {
        if (!req.org) return res.status(401).json({ error: 'Unauthorized' });
        const { id } = req.params;
        if (!(await requireProjectAccess(req, res, id))) return;
        const rows = await prisma.projectChangeRequest.findMany({
          where: { projectId: id },
          orderBy: { createdAt: 'desc' },
        });
        res.json(rows);
      } catch (error) {
        console.error('Change requests list error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  router.post(
    '/projects/:id/change-requests',
    requirePermission('pmo.projects.edit'),
    async (req: Request, res: Response) => {
      try {
        if (!req.org || !req.user) return res.status(401).json({ error: 'Unauthorized' });
        const { id } = req.params;
        if (!(await requireProjectAccess(req, res, id))) return;
        const { title, description, priority, impact } = req.body;
        if (!title) return res.status(400).json({ error: 'Title is required' });
        const row = await prisma.projectChangeRequest.create({
          data: {
            projectId: id,
            title,
            description: description || null,
            priority: priority || 'medium',
            impact: impact || null,
            requestedById: req.user.id,
            requestedByName: req.user.name ?? req.user.email,
          },
        });
        res.status(201).json(row);
      } catch (error) {
        console.error('Change request create error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  router.put('/change-requests/:id', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org || !req.user) return res.status(401).json({ error: 'Unauthorized' });
      const { id } = req.params;
      const existing = await prisma.projectChangeRequest.findFirst({
        where: { id },
        include: { project: true },
      });
      if (!existing || existing.project.orgId !== req.org.id) {
        return res.status(404).json({ error: 'Change request not found' });
      }
      const { title, description, status, priority, impact, rejectionReason } = req.body;
      const data: Record<string, unknown> = {};
      if (title) data.title = title;
      if (description !== undefined) data.description = description;
      if (priority) data.priority = priority;
      if (impact !== undefined) data.impact = impact;
      if (status) {
        data.status = status;
        if (status === 'approved') {
          data.approvedAt = new Date();
          data.approvedById = req.user.id;
          data.approvedByName = req.user.name ?? req.user.email;
        }
        if (status === 'rejected') {
          data.rejectedAt = new Date();
          data.rejectionReason = rejectionReason || null;
        }
      }
      const updated = await prisma.projectChangeRequest.update({ where: { id }, data });
      res.json(updated);
    } catch (error) {
      console.error('Change request update error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/change-requests/:id', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) return res.status(401).json({ error: 'Unauthorized' });
      const { id } = req.params;
      const existing = await prisma.projectChangeRequest.findFirst({
        where: { id },
        include: { project: true },
      });
      if (!existing || existing.project.orgId !== req.org.id) {
        return res.status(404).json({ error: 'Change request not found' });
      }
      await prisma.projectChangeRequest.delete({ where: { id } });
      res.json({ message: 'Deleted' });
    } catch (error) {
      console.error('Change request delete error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
