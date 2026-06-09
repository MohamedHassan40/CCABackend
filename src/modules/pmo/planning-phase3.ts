import { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';
import { requireProjectAccess } from './project-access';

type WbsNode = {
  id: string;
  projectId: string;
  parentId: string | null;
  wbsCode: string | null;
  sortOrder: number;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  progress?: number;
  children: WbsNode[];
};

function buildWbsTree(
  items: Array<{
    id: string;
    projectId: string;
    parentId: string | null;
    wbsCode: string | null;
    sortOrder: number;
    name: string;
    description: string | null;
    status: string;
    priority: string;
    startDate: Date | null;
    dueDate: Date | null;
    estimatedHours: number | null;
  }>
): WbsNode[] {
  const map = new Map<string, WbsNode>();
  for (const d of items) {
    map.set(d.id, {
      ...d,
      progress: d.status === 'completed' ? 100 : d.status === 'in_progress' ? 50 : 0,
      children: [],
    });
  }
  const roots: WbsNode[] = [];
  for (const d of items) {
    const node = map.get(d.id)!;
    if (d.parentId && map.has(d.parentId)) {
      map.get(d.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: WbsNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

export function registerPmoPlanningRoutes(router: Router): void {
  // GET /api/pmo/projects/:id/wbs
  router.get('/projects/:id/wbs', requirePermission('pmo.deliverables.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const deliverables = await prisma.deliverable.findMany({
        where: { projectId: id },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      res.json({ tree: buildWbsTree(deliverables), flat: deliverables });
    } catch (error) {
      console.error('Error fetching WBS:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/timeline
  router.get('/projects/:id/timeline', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const project = await prisma.project.findFirst({
        where: { id, orgId: req.org.id },
        select: { id: true, name: true, startDate: true, endDate: true },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const [deliverables, milestones, tasks] = await Promise.all([
        prisma.deliverable.findMany({
          where: { projectId: id },
          select: { id: true, name: true, wbsCode: true, startDate: true, dueDate: true, status: true },
        }),
        prisma.projectMilestone.findMany({
          where: { projectId: id },
          select: { id: true, name: true, targetDate: true, status: true },
        }),
        prisma.projectTask.findMany({
          where: { projectId: id, status: { notIn: ['cancelled'] } },
          select: {
            id: true,
            title: true,
            startDate: true,
            dueDate: true,
            status: true,
            predecessorTaskId: true,
            dependencyType: true,
          },
        }),
      ]);

      const items: Array<{
        id: string;
        type: string;
        label: string;
        start: string | null;
        end: string | null;
        status: string;
        meta?: Record<string, unknown>;
      }> = [];

      for (const d of deliverables) {
        const start = d.startDate ?? project.startDate;
        const end = d.dueDate ?? project.endDate;
        if (start || end) {
          items.push({
            id: d.id,
            type: 'deliverable',
            label: d.wbsCode ? `${d.wbsCode} ${d.name}` : d.name,
            start: start ? start.toISOString() : null,
            end: end ? end.toISOString() : null,
            status: d.status,
          });
        }
      }
      for (const m of milestones) {
        items.push({
          id: m.id,
          type: 'milestone',
          label: m.name,
          start: m.targetDate.toISOString(),
          end: m.targetDate.toISOString(),
          status: m.status,
        });
      }
      for (const t of tasks) {
        if (t.startDate || t.dueDate) {
          items.push({
            id: t.id,
            type: 'task',
            label: t.title,
            start: t.startDate?.toISOString() ?? null,
            end: t.dueDate?.toISOString() ?? null,
            status: t.status,
            meta: { predecessorTaskId: t.predecessorTaskId, dependencyType: t.dependencyType },
          });
        }
      }

      res.json({ project, items });
    } catch (error) {
      console.error('Error fetching timeline:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/network
  router.get('/projects/:id/network', requirePermission('pmo.tasks.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const tasks = await prisma.projectTask.findMany({
        where: { projectId: id, status: { notIn: ['cancelled'] } },
        select: {
          id: true,
          title: true,
          status: true,
          predecessorTaskId: true,
          dependencyType: true,
        },
      });

      const edges = tasks
        .filter((t) => t.predecessorTaskId)
        .map((t) => ({
          from: t.predecessorTaskId!,
          to: t.id,
          type: t.dependencyType || 'FS',
        }));

      res.json({ nodes: tasks, edges });
    } catch (error) {
      console.error('Error fetching network:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/raci
  router.get('/projects/:id/raci', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const [entries, deliverables, managers, employees] = await Promise.all([
        prisma.projectRaciEntry.findMany({ where: { projectId: id }, orderBy: { activityKey: 'asc' } }),
        prisma.deliverable.findMany({ where: { projectId: id }, select: { id: true, name: true, wbsCode: true } }),
        prisma.projectManager.findMany({
          where: { projectId: id },
          include: { employee: { select: { id: true, fullName: true } } },
        }),
        prisma.employee.findMany({
          where: { orgId: req.org.id },
          select: { id: true, fullName: true },
        }),
      ]);

      const activities = deliverables.map((d) => ({
        key: `deliverable:${d.id}`,
        label: d.wbsCode ? `${d.wbsCode} ${d.name}` : d.name,
        deliverableId: d.id,
      }));
      const customKeys = new Set(
        entries.filter((e) => e.activityKey.startsWith('custom:')).map((e) => e.activityKey)
      );
      for (const key of customKeys) {
        const entry = entries.find((e) => e.activityKey === key);
        activities.push({
          key,
          label: entry?.activityName || key.replace('custom:', ''),
          deliverableId: null as unknown as string,
        });
      }

      const people = [
        ...employees.map((e) => ({ id: e.id, type: 'employee', name: e.fullName })),
        ...managers.map((m) => ({
          id: m.employee.id,
          type: 'employee',
          name: m.employee.fullName,
        })),
      ];
      const uniquePeople = Array.from(new Map(people.map((p) => [`${p.type}:${p.id}`, p])).values());

      res.json({ entries, activities, people: uniquePeople });
    } catch (error) {
      console.error('Error fetching RACI:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/pmo/projects/:id/raci (bulk upsert)
  router.put('/projects/:id/raci', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const { entries } = req.body as {
        entries: Array<{
          activityKey: string;
          deliverableId?: string | null;
          activityName?: string | null;
          personId: string;
          personType: string;
          raciRole: string;
        }>;
      };

      if (!Array.isArray(entries)) {
        res.status(400).json({ error: 'entries array is required' });
        return;
      }

      await prisma.projectRaciEntry.deleteMany({ where: { projectId: id } });

      if (entries.length > 0) {
        await prisma.projectRaciEntry.createMany({
          data: entries.map((e) => ({
            projectId: id,
            activityKey: e.activityKey,
            deliverableId: e.deliverableId || null,
            activityName: e.activityName || null,
            personId: e.personId,
            personType: e.personType,
            raciRole: e.raciRole,
          })),
          skipDuplicates: true,
        });
      }

      const saved = await prisma.projectRaciEntry.findMany({ where: { projectId: id } });
      res.json(saved);
    } catch (error) {
      console.error('Error saving RACI:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/pmo/projects/:id/plans
  router.get('/projects/:id/plans', requirePermission('pmo.projects.view'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const plans = await prisma.projectPlan.findMany({
        where: { projectId: id },
        orderBy: [{ planType: 'asc' }, { title: 'asc' }],
      });
      res.json(plans);
    } catch (error) {
      console.error('Error fetching plans:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/pmo/projects/:id/plans
  router.post('/projects/:id/plans', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      if (!(await requireProjectAccess(req, res, id))) return;

      const { planType, title, description, status, notes } = req.body;
      if (!title?.trim()) {
        res.status(400).json({ error: 'Title is required' });
        return;
      }

      const plan = await prisma.projectPlan.create({
        data: {
          projectId: id,
          planType: planType || 'other',
          title: String(title).trim(),
          description: description?.trim() || null,
          status: status || 'draft',
          notes: notes?.trim() || null,
        },
      });
      res.status(201).json(plan);
    } catch (error) {
      console.error('Error creating plan:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/pmo/plans/:id
  router.put('/plans/:id', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const existing = await prisma.projectPlan.findFirst({
        where: { id },
        include: { project: true },
      });
      if (!existing || existing.project.orgId !== req.org.id) {
        res.status(404).json({ error: 'Plan not found' });
        return;
      }
      if (!(await requireProjectAccess(req, res, existing.projectId))) return;

      const { planType, title, description, status, notes } = req.body;
      const updated = await prisma.projectPlan.update({
        where: { id },
        data: {
          ...(planType !== undefined && { planType }),
          ...(title !== undefined && { title: String(title).trim() }),
          ...(description !== undefined && { description: description?.trim() || null }),
          ...(status !== undefined && { status }),
          ...(notes !== undefined && { notes: notes?.trim() || null }),
        },
      });
      res.json(updated);
    } catch (error) {
      console.error('Error updating plan:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/pmo/plans/:id
  router.delete('/plans/:id', requirePermission('pmo.projects.edit'), async (req: Request, res: Response) => {
    try {
      if (!req.org) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = req.params;
      const existing = await prisma.projectPlan.findFirst({
        where: { id },
        include: { project: true },
      });
      if (!existing || existing.project.orgId !== req.org.id) {
        res.status(404).json({ error: 'Plan not found' });
        return;
      }
      if (!(await requireProjectAccess(req, res, existing.projectId))) return;

      await prisma.projectPlan.delete({ where: { id } });
      res.json({ message: 'Plan deleted successfully' });
    } catch (error) {
      console.error('Error deleting plan:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
