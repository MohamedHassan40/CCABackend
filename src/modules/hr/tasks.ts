import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// ============================================
// TASKS
// ============================================

// GET /api/hr/tasks - Get all tasks
router.get('/', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, status, priority, search } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    if (status) {
      where.status = status;
    }

    if (priority) {
      where.priority = priority;
    }

    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: true,
            employmentType: true,
          },
        },
        assignedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            trackers: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/tasks/:id - Get single task
router.get('/:id', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const task = await prisma.task.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: true,
            employmentType: true,
          },
        },
        assignedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        trackers: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
          orderBy: {
            startTime: 'desc',
          },
        },
        calendarEvents: {
          orderBy: {
            startDate: 'asc',
          },
        },
      },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.json(task);
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/tasks - Create task
router.post('/', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      employeeId,
      title,
      description,
      priority,
      dueDate,
      estimatedHours,
      tags,
    } = req.body;

    if (!employeeId || !title) {
      res.status(400).json({ error: 'Employee ID and title are required' });
      return;
    }

    // Verify employee belongs to org
    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        orgId: req.org.id,
      },
    });

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const task = await prisma.task.create({
      data: {
        orgId: req.org.id,
        employeeId,
        title,
        description: description || null,
        priority: priority || 'medium',
        dueDate: dueDate ? new Date(dueDate) : null,
        estimatedHours: estimatedHours || null,
        tags: tags || null,
        assignedById: req.user.id,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        assignedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/tasks/:id - Update task
router.put('/:id', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      title,
      description,
      status,
      priority,
      dueDate,
      estimatedHours,
      tags,
    } = req.body;

    const task = await prisma.task.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const updateData: any = {
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(status && { status }),
      ...(priority && { priority }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      ...(estimatedHours !== undefined && { estimatedHours }),
      ...(tags !== undefined && { tags }),
    };

    if (status === 'completed' && task.status !== 'completed') {
      updateData.completedAt = new Date();
    }

    const updated = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        assignedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/hr/tasks/:id - Delete task
router.delete('/:id', requirePermission('hr.employees.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const task = await prisma.task.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    await prisma.task.delete({
      where: { id },
    });

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// TASK TRACKERS
// ============================================

// GET /api/hr/tasks/:taskId/trackers - Get trackers for a task
router.get('/:taskId/trackers', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.params;

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        orgId: req.org.id,
      },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const trackers = await prisma.taskTracker.findMany({
      where: {
        taskId,
        orgId: req.org.id,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: {
        startTime: 'desc',
      },
    });

    res.json(trackers);
  } catch (error) {
    console.error('Error fetching task trackers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/tasks/:taskId/trackers/start - Start tracking time
router.post('/:taskId/trackers/start', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.params;
    const { employeeId, description } = req.body;

    // Find employee by user ID if employeeId not provided
    let employee;
    if (employeeId) {
      employee = await prisma.employee.findFirst({
        where: {
          id: employeeId,
          orgId: req.org.id,
        },
      });
    } else {
      employee = await prisma.employee.findFirst({
        where: {
          userId: req.user.id,
          orgId: req.org.id,
        },
      });
    }

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    // Verify task exists and belongs to employee
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        orgId: req.org.id,
        employeeId: employee.id,
      },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // Stop any active trackers for this employee
    await prisma.taskTracker.updateMany({
      where: {
        employeeId: employee.id,
        orgId: req.org.id,
        isActive: true,
      },
      data: {
        isActive: false,
        endTime: new Date(),
      },
    });

    // Create new tracker
    const tracker = await prisma.taskTracker.create({
      data: {
        orgId: req.org.id,
        taskId,
        employeeId: employee.id,
        startTime: new Date(),
        description: description || null,
        isActive: true,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
          },
        },
        task: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    res.status(201).json(tracker);
  } catch (error) {
    console.error('Error starting tracker:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/tasks/:taskId/trackers/:trackerId/stop - Stop tracking time
router.post('/:taskId/trackers/:trackerId/stop', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId, trackerId } = req.params;

    const tracker = await prisma.taskTracker.findFirst({
      where: {
        id: trackerId,
        taskId,
        orgId: req.org.id,
        isActive: true,
      },
    });

    if (!tracker) {
      res.status(404).json({ error: 'Active tracker not found' });
      return;
    }

    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - tracker.startTime.getTime()) / (1000 * 60)); // Duration in minutes

    const updated = await prisma.taskTracker.update({
      where: { id: trackerId },
      data: {
        endTime,
        duration,
        isActive: false,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
          },
        },
        task: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error stopping tracker:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/tasks/trackers/active - Get active trackers
router.get('/trackers/active', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId } = req.query;

    const where: any = {
      orgId: req.org.id,
      isActive: true,
    };

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    const trackers = await prisma.taskTracker.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        task: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
      orderBy: {
        startTime: 'desc',
      },
    });

    res.json(trackers);
  } catch (error) {
    console.error('Error fetching active trackers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;




