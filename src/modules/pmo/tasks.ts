import { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';
import { createNotification, createNotificationForOrgWithPermission } from '../../core/notifications/helper';
import {
  getProjectListWhere,
  getProjectWithAccess,
  requireProjectAccess,
  type ProjectAccess,
} from './project-access';

const router = Router();

// GET /api/pmo/tasks — cross-project task list
router.get('/tasks', requirePermission('pmo.tasks.view'), async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const listWhere = await getProjectListWhere(req);
    if (!listWhere) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const taskWhere: {
      orgId: string;
      projectId?: { in: string[] };
      status?: string;
    } = { orgId: req.org.id };

    if (listWhere.id) {
      if (listWhere.id.in.length === 0) {
        res.json([]);
        return;
      }
      taskWhere.projectId = { in: listWhere.id.in };
    }

    if (typeof req.query.status === 'string') {
      taskWhere.status = req.query.status;
    }

    const tasks = await prisma.projectTask.findMany({
      where: taskWhere,
      include: {
        project: { select: { id: true, name: true, status: true, clientName: true } },
        createdBy: { select: { id: true, email: true, name: true } },
        assignee: { select: { id: true, fullName: true, email: true } },
        _count: { select: { comments: true, timeEntries: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });

    const taskIds = tasks.map((t) => t.id);
    const timeSums =
      taskIds.length > 0
        ? await prisma.projectTaskTimeEntry.groupBy({
            by: ['projectTaskId'],
            where: { projectTaskId: { in: taskIds } },
            _sum: { minutes: true },
          })
        : [];
    const minutesByTask: Record<string, number> = {};
    for (const s of timeSums) minutesByTask[s.projectTaskId] = s._sum.minutes ?? 0;

    res.json(
      tasks.map((t) => ({
        ...t,
        totalMinutes: minutesByTask[t.id] ?? 0,
      }))
    );
  } catch (error) {
    console.error('Error fetching PMO tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const taskInclude = {
  project: { select: { id: true, name: true, orgId: true, status: true, clientName: true } },
  createdBy: { select: { id: true, email: true, name: true } },
  assignee: { select: { id: true, fullName: true, email: true, position: true } },
  assignedBy: { select: { id: true, email: true, name: true } },
  comments: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      user: { select: { id: true, email: true, name: true } },
      clientProjectManager: { select: { id: true, name: true, email: true } },
    },
  },
  timeEntries: {
    orderBy: { loggedAt: 'desc' as const },
    include: {
      employee: { select: { id: true, fullName: true, email: true } },
      createdBy: { select: { id: true, name: true } },
    },
  },
};

// GET /api/pmo/projects/:projectId/tasks
router.get('/projects/:projectId/tasks', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { projectId } = req.params;
    const result = await requireProjectAccess(req, res, projectId);
    if (!result) return;

    const { status, assigneeId, createdByType } = req.query;
    const where: { projectId: string; status?: string; assigneeId?: string; createdByType?: string } = {
      projectId,
    };
    if (typeof status === 'string') where.status = status;
    if (typeof assigneeId === 'string') where.assigneeId = assigneeId;
    if (typeof createdByType === 'string') where.createdByType = createdByType;

    const tasks = await prisma.projectTask.findMany({
      where,
      include: {
        createdBy: { select: { id: true, email: true, name: true } },
        assignee: { select: { id: true, fullName: true, email: true } },
        _count: { select: { comments: true, timeEntries: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Total minutes per task for display
    const taskIds = tasks.map((t) => t.id);
    const timeSums = await prisma.projectTaskTimeEntry.groupBy({
      by: ['projectTaskId'],
      where: { projectTaskId: { in: taskIds } },
      _sum: { minutes: true },
    });
    const minutesByTask: Record<string, number> = {};
    for (const s of timeSums) minutesByTask[s.projectTaskId] = s._sum.minutes ?? 0;

    type TaskRow = (typeof tasks)[number];
    const list = tasks.map((t: TaskRow) => ({
      ...t,
      totalMinutes: minutesByTask[t.id] ?? 0,
    }));

    res.json(list);
  } catch (error) {
    console.error('Error fetching project tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/projects/:projectId/tasks
router.post('/projects/:projectId/tasks', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { projectId } = req.params;
    const result = await requireProjectAccess(req, res, projectId);
    if (!result) return;

    const { title, description, status, priority, dueDate, estimatedMinutes, createdByType } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const createdByTypeVal = createdByType === 'client_manager' ? 'client_manager' : 'org_user';
    if (result.access === 'client' && createdByTypeVal !== 'client_manager') {
      res.status(403).json({ error: 'Client users must submit tasks as client_manager' });
      return;
    }

    const task = await prisma.projectTask.create({
      data: {
        projectId,
        orgId: result.project.orgId,
        title: title.trim(),
        description: description?.trim() || null,
        status: status || 'submitted',
        priority: priority || 'medium',
        dueDate: dueDate ? new Date(dueDate) : null,
        estimatedMinutes: estimatedMinutes ?? null,
        createdById: req.user.id,
        createdByType: createdByTypeVal,
      },
      include: taskInclude,
    });

    if (result.access === 'client') {
      createNotificationForOrgWithPermission(result.project.orgId, 'pmo.tasks.view', {
        type: 'info',
        title: 'New client task submitted',
        message: `"${task.title}" was submitted on project ${result.project.name}`,
        link: `/pmo/projects/${projectId}?tab=tasks`,
      }).catch(() => {});
    }

    res.status(201).json(sanitizeTaskForAccess(task, result.access));
  } catch (error) {
    console.error('Error creating project task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: load task and check access (project must belong to org or user is client manager)
async function getTaskWithAccess(
  req: Request,
  taskId: string
): Promise<{ task: Awaited<ReturnType<typeof prisma.projectTask.findFirst>>; access: ProjectAccess } | null> {
  if (!req.user || !req.org) return null;

  const task = await prisma.projectTask.findFirst({
    where: { id: taskId },
    include: { project: true },
  });
  if (!task || task.orgId !== req.org.id) return null;

  const projectAccess = await getProjectWithAccess(req, task.projectId);
  if (!projectAccess) return null;

  return { task, access: projectAccess.access };
}

function sanitizeTaskForAccess<T extends { comments?: Array<{ isInternal?: boolean }>; timeEntries?: unknown[] }>(
  task: T,
  access: ProjectAccess
): T {
  if (access === 'org') return task;
  return {
    ...task,
    comments: (task.comments || []).filter((c) => !c.isInternal),
    timeEntries: [],
  };
}

// GET /api/pmo/tasks/:taskId
router.get('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { taskId } = req.params;
    const result = await getTaskWithAccess(req, taskId);
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const task = await prisma.projectTask.findUnique({
      where: { id: taskId },
      include: taskInclude,
    });
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const totalMinutes = await prisma.projectTaskTimeEntry.aggregate({
      where: { projectTaskId: taskId },
      _sum: { minutes: true },
    });

    res.json({
      ...sanitizeTaskForAccess(task, result.access),
      totalMinutes: totalMinutes._sum.minutes ?? 0,
    });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/tasks/:taskId (org only; client cannot edit/assign)
router.put('/tasks/:taskId', requirePermission('pmo.tasks.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { taskId } = req.params;
    const result = await getTaskWithAccess(req, taskId);
    if (!result || result.access !== 'org') {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const previousAssigneeId = result.task?.assigneeId;

    const {
      title,
      description,
      status,
      priority,
      dueDate,
      completedAt,
      assigneeId,
      estimatedMinutes,
    } = req.body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = String(title).trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (completedAt !== undefined) updateData.completedAt = completedAt ? new Date(completedAt) : null;
    if (estimatedMinutes !== undefined) updateData.estimatedMinutes = estimatedMinutes ?? null;

    if (assigneeId !== undefined) {
      if (assigneeId === null || assigneeId === '') {
        updateData.assigneeId = null;
        updateData.assignedById = null;
        updateData.assignedAt = null;
      } else {
        const employee = await prisma.employee.findFirst({
          where: { id: String(assigneeId), orgId: req.org.id },
        });
        if (!employee) {
          res.status(400).json({ error: 'Employee not found' });
          return;
        }
        updateData.assigneeId = employee.id;
        updateData.assignedById = req.user.id;
        updateData.assignedAt = new Date();
      }
    }

    const updated = await prisma.projectTask.update({
      where: { id: taskId },
      data: updateData as never,
      include: taskInclude,
    });

    if (
      assigneeId !== undefined &&
      updated.assigneeId &&
      updated.assigneeId !== previousAssigneeId
    ) {
      const assignee = await prisma.employee.findUnique({
        where: { id: updated.assigneeId },
        select: { userId: true, fullName: true },
      });
      if (assignee?.userId) {
        createNotification({
          userId: assignee.userId,
          organizationId: req.org!.id,
          type: 'info',
          title: 'Task assigned to you',
          message: `You were assigned to "${updated.title}"`,
          link: `/pmo/projects/${updated.projectId}?tab=tasks`,
        }).catch(() => {});
      }
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/tasks/:taskId (org only)
router.delete('/tasks/:taskId', requirePermission('pmo.tasks.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { taskId } = req.params;
    const result = await getTaskWithAccess(req, taskId);
    if (!result || result.access !== 'org') {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    await prisma.projectTask.delete({ where: { id: taskId } });
    res.json({ message: 'Task deleted' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pmo/tasks/:taskId/comments
router.get('/tasks/:taskId/comments', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { taskId } = req.params;
    const result = await getTaskWithAccess(req, taskId);
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const comments = await prisma.projectTaskComment.findMany({
      where: {
        projectTaskId: taskId,
        ...(result.access === 'client' ? { isInternal: false } : {}),
      },
      include: {
        user: { select: { id: true, email: true, name: true } },
        clientProjectManager: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(comments);
  } catch (error) {
    console.error('Error fetching task comments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/tasks/:taskId/comments (org or client)
router.post('/tasks/:taskId/comments', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { taskId } = req.params;
    const result = await getTaskWithAccess(req, taskId);
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const { content, isInternal } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    const taskForComment = result.task;
    if (!taskForComment) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const isInternalVal = result.access === 'org' && isInternal === true;
    let userId: string | null = null;
    let clientProjectManagerId: string | null = null;

    if (result.access === 'client') {
      const cpm = await prisma.clientProjectManager.findUnique({
        where: {
          projectId_userId: { projectId: taskForComment.projectId, userId: req.user!.id },
          isActive: true,
        },
      });
      if (!cpm) {
        res.status(403).json({ error: 'Not a client manager for this project' });
        return;
      }
      clientProjectManagerId = cpm.id;
    } else {
      userId = req.user!.id;
    }

    const comment = await prisma.projectTaskComment.create({
      data: {
        projectTaskId: taskId,
        content: content.trim(),
        userId,
        clientProjectManagerId,
        isInternal: isInternalVal,
      },
      include: {
        user: { select: { id: true, email: true, name: true } },
        clientProjectManager: { select: { id: true, name: true, email: true } },
      },
    });

    if (!isInternalVal && taskForComment.assigneeId) {
      const assignee = await prisma.employee.findUnique({
        where: { id: taskForComment.assigneeId },
        select: { userId: true },
      });
      if (assignee?.userId && assignee.userId !== req.user!.id) {
        createNotification({
          userId: assignee.userId,
          organizationId: req.org!.id,
          type: 'info',
          title: 'New comment on your task',
          message: `New comment on "${taskForComment.title}"`,
          link: `/pmo/projects/${taskForComment.projectId}?tab=tasks`,
        }).catch(() => {});
      }
    }

    res.status(201).json(comment);
  } catch (error) {
    console.error('Error creating task comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pmo/tasks/:taskId/time-entries (org only)
router.get('/tasks/:taskId/time-entries', requirePermission('pmo.tasks.view'), async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { taskId } = req.params;
    const result = await getTaskWithAccess(req, taskId);
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const timeEntries = await prisma.projectTaskTimeEntry.findMany({
      where: { projectTaskId: taskId },
      include: {
        employee: { select: { id: true, fullName: true, email: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { loggedAt: 'desc' },
    });

    res.json(timeEntries);
  } catch (error) {
    console.error('Error fetching task time entries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pmo/tasks/:taskId/time-entries (org only)
router.post('/tasks/:taskId/time-entries', requirePermission('pmo.tasks.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { taskId } = req.params;
    const result = await getTaskWithAccess(req, taskId);
    if (!result || result.access !== 'org') {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const { employeeId, minutes, description, loggedAt } = req.body;
    if (!employeeId || minutes == null || minutes < 0) {
      res.status(400).json({ error: 'employeeId and minutes are required' });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { id: String(employeeId), orgId: req.org.id },
    });
    if (!employee) {
      res.status(400).json({ error: 'Employee not found' });
      return;
    }

    const entry = await prisma.projectTaskTimeEntry.create({
      data: {
        projectTaskId: taskId,
        orgId: req.org.id,
        employeeId: employee.id,
        minutes: Number(minutes),
        description: description?.trim() || null,
        loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
        createdById: req.user.id,
      },
      include: {
        employee: { select: { id: true, fullName: true, email: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error('Error creating task time entry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pmo/tasks/:taskId/time-entries/:entryId (org only)
router.put('/tasks/:taskId/time-entries/:entryId', requirePermission('pmo.tasks.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { taskId, entryId } = req.params;
    const result = await getTaskWithAccess(req, taskId);
    if (!result || result.access !== 'org') {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const existing = await prisma.projectTaskTimeEntry.findFirst({
      where: { id: entryId, projectTaskId: taskId, orgId: req.org.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Time entry not found' });
      return;
    }

    const { employeeId, minutes, description, loggedAt } = req.body;
    const data: Record<string, unknown> = {};
    if (minutes != null) data.minutes = Number(minutes);
    if (description !== undefined) data.description = description?.trim() || null;
    if (loggedAt !== undefined) data.loggedAt = loggedAt ? new Date(loggedAt) : existing.loggedAt;
    if (employeeId) {
      const employee = await prisma.employee.findFirst({
        where: { id: String(employeeId), orgId: req.org.id },
      });
      if (!employee) {
        res.status(400).json({ error: 'Employee not found' });
        return;
      }
      data.employeeId = employee.id;
    }

    const entry = await prisma.projectTaskTimeEntry.update({
      where: { id: entryId },
      data: data as never,
      include: {
        employee: { select: { id: true, fullName: true, email: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    res.json(entry);
  } catch (error) {
    console.error('Error updating task time entry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pmo/tasks/:taskId/time-entries/:entryId (org only)
router.delete('/tasks/:taskId/time-entries/:entryId', requirePermission('pmo.tasks.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { taskId, entryId } = req.params;
    const result = await getTaskWithAccess(req, taskId);
    if (!result || result.access !== 'org') {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const existing = await prisma.projectTaskTimeEntry.findFirst({
      where: { id: entryId, projectTaskId: taskId, orgId: req.org.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Time entry not found' });
      return;
    }

    await prisma.projectTaskTimeEntry.delete({ where: { id: entryId } });
    res.json({ message: 'Time entry deleted' });
  } catch (error) {
    console.error('Error deleting task time entry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pmo/tasks/:taskId/files - list files attached to this task (entityType=project_task, entityId=taskId)
router.get('/tasks/:taskId/files', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { taskId } = req.params;
    const result = await getTaskWithAccess(req, taskId);
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const files = await prisma.file.findMany({
      where: {
        entityType: 'project_task',
        entityId: taskId,
        organizationId: req.org.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(files);
  } catch (error) {
    console.error('Error fetching task files:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
