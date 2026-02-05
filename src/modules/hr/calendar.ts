import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// GET /api/hr/calendar/events - Get calendar events
router.get('/events', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, startDate, endDate, eventType } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    if (startDate && endDate) {
      where.OR = [
        {
          startDate: {
            gte: new Date(startDate as string),
            lte: new Date(endDate as string),
          },
        },
        {
          AND: [
            { startDate: { lte: new Date(endDate as string) } },
            {
              OR: [
                { endDate: { gte: new Date(startDate as string) } },
                { endDate: null },
              ],
            },
          ],
        },
      ];
    }

    if (eventType) {
      where.eventType = eventType;
    }

    const events = await prisma.calendarEvent.findMany({
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
        task: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
      orderBy: {
        startDate: 'asc',
      },
    });

    res.json(events);
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/calendar/events/:id - Get single event
router.get('/events/:id', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const event = await prisma.calendarEvent.findFirst({
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
        task: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
    });

    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    res.json(event);
  } catch (error) {
    console.error('Error fetching calendar event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/calendar/events - Create calendar event
router.post('/events', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      employeeId,
      taskId,
      title,
      description,
      startDate,
      endDate,
      allDay,
      eventType,
      location,
      attendees,
      color,
      isRecurring,
      recurrenceRule,
      reminderMinutes,
    } = req.body;

    if (!title || !startDate) {
      res.status(400).json({ error: 'Title and start date are required' });
      return;
    }

    // Verify employee if provided
    if (employeeId) {
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
    }

    // Verify task if provided
    if (taskId) {
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
    }

    const event = await prisma.calendarEvent.create({
      data: {
        orgId: req.org.id,
        employeeId: employeeId || null,
        taskId: taskId || null,
        title,
        description: description || null,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        allDay: allDay === true,
        eventType: eventType || 'meeting',
        location: location || null,
        attendees: attendees || null,
        color: color || null,
        isRecurring: isRecurring === true,
        recurrenceRule: recurrenceRule || null,
        reminderMinutes: reminderMinutes || null,
      },
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
          },
        },
      },
    });

    res.status(201).json(event);
  } catch (error) {
    console.error('Error creating calendar event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/calendar/events/:id - Update calendar event
router.put('/events/:id', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      title,
      description,
      startDate,
      endDate,
      allDay,
      eventType,
      location,
      attendees,
      color,
      isRecurring,
      recurrenceRule,
      reminderMinutes,
      employeeId,
      taskId,
    } = req.body;

    const event = await prisma.calendarEvent.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    // Verify employee if provided
    if (employeeId !== undefined) {
      if (employeeId) {
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
      }
    }

    // Verify task if provided
    if (taskId !== undefined) {
      if (taskId) {
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
      }
    }

    const updateData: any = {
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(startDate && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      ...(allDay !== undefined && { allDay }),
      ...(eventType && { eventType }),
      ...(location !== undefined && { location }),
      ...(attendees !== undefined && { attendees }),
      ...(color !== undefined && { color }),
      ...(isRecurring !== undefined && { isRecurring }),
      ...(recurrenceRule !== undefined && { recurrenceRule }),
      ...(reminderMinutes !== undefined && { reminderMinutes }),
      ...(employeeId !== undefined && { employeeId: employeeId || null }),
      ...(taskId !== undefined && { taskId: taskId || null }),
    };

    const updated = await prisma.calendarEvent.update({
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
    console.error('Error updating calendar event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/hr/calendar/events/:id - Delete calendar event
router.delete('/events/:id', requirePermission('hr.employees.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const event = await prisma.calendarEvent.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    await prisma.calendarEvent.delete({
      where: { id },
    });

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;




