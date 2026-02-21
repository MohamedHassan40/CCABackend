import { Router } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import type { ModuleManifest } from '@cloud-org/shared';

const router = Router();

// Module manifest
export const ticketingManifest: ModuleManifest = {
  key: 'ticketing',
  name: 'Ticketing System',
  icon: 'ticket',
  sidebarItems: [
    {
      path: '/ticketing/tickets',
      label: 'Tickets',
      permission: 'ticketing.tickets.view',
    },
    {
      path: '/ticketing/categories',
      label: 'Categories',
      permission: 'ticketing.tickets.view',
    },
    {
      path: '/ticketing/templates',
      label: 'Templates',
      permission: 'ticketing.tickets.view',
    },
    {
      path: '/ticketing/canned-replies',
      label: 'Canned replies',
      permission: 'ticketing.tickets.view',
    },
    {
      path: '/ticketing/reports',
      label: 'Reports',
      permission: 'ticketing.tickets.view',
    },
  ],
  dashboardWidgets: [
    {
      id: 'ticketing-open-tickets',
      title: 'Open Tickets',
      description: 'Number of open tickets',
      apiPath: '/api/ticketing/widgets/open-tickets',
      permission: 'ticketing.tickets.view',
    },
  ],
};

// Register module
export function registerTicketingModule(routerInstance: Router): void {
  // Register routes
  routerInstance.use('/api/ticketing', authMiddleware, requireModuleEnabled('ticketing'), router);

  // Register in module registry
  moduleRegistry.register({
    key: 'ticketing',
    manifest: ticketingManifest,
    registerRoutes: () => {}, // Already registered above
  });
}

// Helper: record ticket history
async function recordTicketHistory(
  ticketId: string,
  userId: string | null,
  action: string,
  fieldName?: string,
  oldValue?: string,
  newValue?: string
) {
  await prisma.ticketHistory.create({
    data: {
      ticketId,
      userId: userId || undefined,
      action,
      fieldName: fieldName || null,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
    },
  });
}

// GET /api/ticketing/tickets
router.get('/tickets', requirePermission('ticketing.tickets.view'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, priority, categoryId, search, tag, parentId } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) {
      where.status = status;
    }

    if (priority) {
      where.priority = priority;
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (tag) {
      where.tags = { has: tag as string };
    }

    if (parentId === 'none' || parentId === '') {
      where.parentTicketId = null;
    } else if (parentId) {
      where.parentTicketId = parentId;
    }

    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        assignee: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        category: true,
        _count: {
          select: { timeEntries: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Add totalMinutes from time entries
    const ticketsWithTime = await Promise.all(
      tickets.map(async (t) => {
        const sum = await prisma.ticketTimeEntry.aggregate({
          where: { ticketId: t.id },
          _sum: { minutes: true },
        });
        return {
          ...t,
          totalMinutes: sum._sum.minutes ?? 0,
        };
      })
    );

    res.json(ticketsWithTime);
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ticketing/tickets
router.post('/tickets', requirePermission('ticketing.tickets.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      title,
      description,
      priority,
      assigneeId,
      categoryId,
      tags,
      dueDate,
      responseDueAt,
      resolveBy,
      parentTicketId,
      templateId,
    } = req.body;

    let finalTitle = title;
    let finalDescription = description;
    let finalPriority = priority || 'medium';
    let finalCategoryId = categoryId || null;
    let finalTags: string[] = Array.isArray(tags) ? tags : [];

    if (templateId) {
      const template = await prisma.ticketTemplate.findFirst({
        where: { id: templateId, orgId: req.org.id },
        include: { category: true },
      });
      if (template) {
        finalTitle = finalTitle || template.title;
        finalDescription = finalDescription ?? template.description ?? null;
        finalPriority = template.priority;
        finalCategoryId = finalCategoryId || template.categoryId;
        if (template.tags?.length) finalTags = [...new Set([...finalTags, ...template.tags])];
      }
    }

    if (!finalTitle) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    if (finalCategoryId) {
      const category = await prisma.ticketCategory.findFirst({
        where: {
          id: finalCategoryId,
          orgId: req.org.id,
          isActive: true,
        },
      });
      if (!category) {
        res.status(400).json({ error: 'Invalid or inactive category' });
        return;
      }
    }

    if (parentTicketId) {
      const parent = await prisma.ticket.findFirst({
        where: { id: parentTicketId, orgId: req.org.id },
      });
      if (!parent) {
        res.status(400).json({ error: 'Parent ticket not found' });
        return;
      }
    }

    const ticket = await prisma.ticket.create({
      data: {
        orgId: req.org.id,
        title: finalTitle,
        description: finalDescription || null,
        priority: finalPriority,
        status: 'open',
        createdById: req.user.id,
        assigneeId: assigneeId || null,
        categoryId: finalCategoryId,
        tags: finalTags,
        dueDate: dueDate ? new Date(dueDate) : null,
        responseDueAt: responseDueAt ? new Date(responseDueAt) : null,
        resolveBy: resolveBy ? new Date(resolveBy) : null,
        parentTicketId: parentTicketId || null,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        assignee: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        category: true,
        parentTicket: true,
      },
    });

    await recordTicketHistory(ticket.id, req.user.id, 'created');

    res.status(201).json(ticket);
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/ticketing/tickets/:id
router.put('/tickets/:id', requirePermission('ticketing.tickets.edit'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      title,
      description,
      priority,
      status,
      assigneeId,
      categoryId,
      tags,
      dueDate,
      responseDueAt,
      resolveBy,
      parentTicketId,
    } = req.body;

    const ticket = await prisma.ticket.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    if (categoryId !== undefined && categoryId) {
      const category = await prisma.ticketCategory.findFirst({
        where: {
          id: categoryId,
          orgId: req.org.id,
          isActive: true,
        },
      });
      if (!category) {
        res.status(400).json({ error: 'Invalid or inactive category' });
        return;
      }
    }

    if (parentTicketId !== undefined && parentTicketId) {
      if (parentTicketId === id) {
        res.status(400).json({ error: 'Ticket cannot be its own parent' });
        return;
      }
      if (parentTicketId) {
        const parent = await prisma.ticket.findFirst({
          where: { id: parentTicketId, orgId: req.org.id },
        });
        if (!parent) {
          res.status(400).json({ error: 'Parent ticket not found' });
          return;
        }
      }
    }

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description || null;
    if (priority !== undefined) data.priority = priority;
    if (status !== undefined) {
      data.status = status;
      if (['resolved', 'closed'].includes(status) && !ticket.resolvedAt) {
        data.resolvedAt = new Date();
      }
    }
    if (assigneeId !== undefined) data.assigneeId = assigneeId || null;
    if (categoryId !== undefined) data.categoryId = categoryId || null;
    if (Array.isArray(tags)) data.tags = tags;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (responseDueAt !== undefined) data.responseDueAt = responseDueAt ? new Date(responseDueAt) : null;
    if (resolveBy !== undefined) data.resolveBy = resolveBy ? new Date(resolveBy) : null;
    if (parentTicketId !== undefined) data.parentTicketId = parentTicketId || null;

    const updated = await prisma.ticket.update({
      where: { id },
      data,
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        assignee: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        category: true,
        parentTicket: true,
        childTickets: true,
        mergedInto: true,
      },
    });

    // Record history for changed fields
    if (title !== undefined && title !== ticket.title) {
      await recordTicketHistory(id, req.user!.id, 'title_changed', 'title', ticket.title, title);
    }
    if (priority !== undefined && priority !== ticket.priority) {
      await recordTicketHistory(id, req.user!.id, 'priority_changed', 'priority', ticket.priority, priority);
    }
    if (status !== undefined && status !== ticket.status) {
      await recordTicketHistory(id, req.user!.id, 'status_changed', 'status', ticket.status, status);
    }
    if (assigneeId !== undefined && assigneeId !== ticket.assigneeId) {
      await recordTicketHistory(id, req.user!.id, 'assignee_changed', 'assigneeId', ticket.assigneeId ?? '', assigneeId ?? '');
    }
    if (categoryId !== undefined && categoryId !== ticket.categoryId) {
      await recordTicketHistory(id, req.user!.id, 'category_changed', 'categoryId', ticket.categoryId ?? '', categoryId ?? '');
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/ticketing/tickets/:id
router.delete('/tickets/:id', requirePermission('ticketing.tickets.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const ticket = await prisma.ticket.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    await prisma.ticket.delete({
      where: { id },
    });

    res.json({ message: 'Ticket deleted successfully' });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/ticketing/tickets/:id - Get single ticket with details
router.get('/tickets/:id', requirePermission('ticketing.tickets.view'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const ticket = await prisma.ticket.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        assignee: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        category: true,
        parentTicket: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
        childTickets: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            createdAt: true,
          },
        },
        mergedInto: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
        comments: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        attachments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        timeEntries: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: {
            loggedAt: 'desc',
          },
        },
        history: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 100,
        },
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    const totalMinutes = ticket.timeEntries.reduce((s, e) => s + e.minutes, 0);

    res.json({
      ...ticket,
      totalMinutes,
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ticketing/tickets/:id/comments - Add comment to ticket
router.post('/tickets/:id/comments', requirePermission('ticketing.tickets.edit'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { content, isInternal } = req.body;

    if (!content) {
      res.status(400).json({ error: 'Comment content is required' });
      return;
    }

    const ticket = await prisma.ticket.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: id,
        userId: req.user.id,
        content,
        isInternal: isInternal === true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    const updateData: { updatedAt: Date; firstResponseAt?: Date } = { updatedAt: new Date() };
    if (!ticket.firstResponseAt && !(isInternal === true)) {
      updateData.firstResponseAt = new Date();
    }
    await prisma.ticket.update({
      where: { id },
      data: updateData,
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error('Error creating ticket comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/ticketing/tickets/:id/comments/:commentId - Delete comment
router.delete('/tickets/:id/comments/:commentId', requirePermission('ticketing.tickets.edit'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, commentId } = req.params;

    const comment = await prisma.ticketComment.findFirst({
      where: {
        id: commentId,
        ticketId: id,
      },
    });

    if (!comment) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    // Only allow deletion if user is the comment author or has delete permission
    if (comment.userId !== req.user.id && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Not authorized to delete this comment' });
      return;
    }

    await prisma.ticketComment.delete({
      where: { id: commentId },
    });

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Error deleting ticket comment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/ticketing/tickets/:id/time-entries
router.get('/tickets/:id/time-entries', requirePermission('ticketing.tickets.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const ticket = await prisma.ticket.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    const entries = await prisma.ticketTimeEntry.findMany({
      where: { ticketId: id },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { loggedAt: 'desc' },
    });
    const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
    res.json({ entries, totalMinutes });
  } catch (error) {
    console.error('Error fetching time entries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ticketing/tickets/:id/time-entries
router.post('/tickets/:id/time-entries', requirePermission('ticketing.tickets.edit'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const { minutes, description, loggedAt } = req.body;
    if (minutes == null || minutes < 1) {
      res.status(400).json({ error: 'Minutes is required and must be positive' });
      return;
    }
    const ticket = await prisma.ticket.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    const entry = await prisma.ticketTimeEntry.create({
      data: {
        ticketId: id,
        userId: req.user.id,
        minutes: Number(minutes),
        description: description || null,
        loggedAt: loggedAt ? new Date(loggedAt) : new Date(),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    await recordTicketHistory(id, req.user.id, 'time_logged', 'minutes', null, String(minutes));
    res.status(201).json(entry);
  } catch (error) {
    console.error('Error creating time entry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/ticketing/tickets/:id/history
router.get('/tickets/:id/history', requirePermission('ticketing.tickets.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const ticket = await prisma.ticket.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    const history = await prisma.ticketHistory.findMany({
      where: { ticketId: id },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(history);
  } catch (error) {
    console.error('Error fetching ticket history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ticketing/tickets/:id/merge - Merge this ticket into targetTicketId
router.post('/tickets/:id/merge', requirePermission('ticketing.tickets.edit'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const { targetTicketId } = req.body;
    if (!targetTicketId) {
      res.status(400).json({ error: 'targetTicketId is required' });
      return;
    }
    if (id === targetTicketId) {
      res.status(400).json({ error: 'Cannot merge ticket into itself' });
      return;
    }
    const [source, target] = await Promise.all([
      prisma.ticket.findFirst({ where: { id, orgId: req.org.id } }),
      prisma.ticket.findFirst({ where: { id: targetTicketId, orgId: req.org.id } }),
    ]);
    if (!source) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    if (!target) {
      res.status(404).json({ error: 'Target ticket not found' });
      return;
    }
    await prisma.ticket.update({
      where: { id },
      data: { status: 'merged', mergedIntoId: targetTicketId },
    });
    await recordTicketHistory(id, req.user.id, 'merged', 'mergedIntoId', null, targetTicketId);
    await recordTicketHistory(targetTicketId, req.user.id, 'merge_source', 'mergedTicketId', null, id);
    res.json({ message: 'Ticket merged successfully', mergedInto: targetTicketId });
  } catch (error) {
    console.error('Error merging ticket:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ticketing/tickets/:id/pause-sla
router.post('/tickets/:id/pause-sla', requirePermission('ticketing.tickets.edit'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const ticket = await prisma.ticket.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    if (ticket.slaPausedAt) {
      res.status(400).json({ error: 'SLA is already paused' });
      return;
    }
    await prisma.ticket.update({
      where: { id },
      data: { slaPausedAt: new Date() },
    });
    await recordTicketHistory(id, req.user.id, 'sla_paused');
    res.json({ message: 'SLA paused', slaPausedAt: new Date() });
  } catch (error) {
    console.error('Error pausing SLA:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ticketing/tickets/:id/resume-sla
router.post('/tickets/:id/resume-sla', requirePermission('ticketing.tickets.edit'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const ticket = await prisma.ticket.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    if (!ticket.slaPausedAt) {
      res.status(400).json({ error: 'SLA is not paused' });
      return;
    }
    await prisma.ticket.update({
      where: { id },
      data: { slaPausedAt: null },
    });
    await recordTicketHistory(id, req.user.id, 'sla_resumed');
    res.json({ message: 'SLA resumed' });
  } catch (error) {
    console.error('Error resuming SLA:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/ticketing/categories - Get ticket categories (optional includeInactive for management)
router.get('/categories', requirePermission('ticketing.tickets.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const includeInactive = req.query.includeInactive === 'true';
    const where: { orgId: string; isActive?: boolean } = {
      orgId: req.org.id,
    };
    if (!includeInactive) {
      where.isActive = true;
    }

    const categories = await prisma.ticketCategory.findMany({
      where,
      include: includeInactive
        ? { _count: { select: { tickets: true } } }
        : undefined,
      orderBy: {
        name: 'asc',
      },
    });

    res.json(categories);
  } catch (error) {
    console.error('Error fetching ticket categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ticketing/categories - Create ticket category
router.post('/categories', requirePermission('ticketing.tickets.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, color } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Category name is required' });
      return;
    }

    // Check if category already exists
    const existing = await prisma.ticketCategory.findUnique({
      where: {
        orgId_name: {
          orgId: req.org.id,
          name,
        },
      },
    });

    if (existing) {
      res.status(400).json({ error: 'Category with this name already exists' });
      return;
    }

    const category = await prisma.ticketCategory.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        color: color || null,
      },
    });

    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating ticket category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/ticketing/categories/:id - Update ticket category
router.put('/categories/:id', requirePermission('ticketing.tickets.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, description, color, isActive } = req.body;

    const category = await prisma.ticketCategory.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    // Check if new name conflicts with existing category
    if (name && name !== category.name) {
      const existing = await prisma.ticketCategory.findUnique({
        where: {
          orgId_name: {
            orgId: req.org.id,
            name,
          },
        },
      });

      if (existing) {
        res.status(400).json({ error: 'Category with this name already exists' });
        return;
      }
    }

    const updated = await prisma.ticketCategory.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating ticket category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/ticketing/categories/:id - Delete ticket category
router.delete('/categories/:id', requirePermission('ticketing.tickets.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const category = await prisma.ticketCategory.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            tickets: true,
          },
        },
      },
    });

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    if (category._count.tickets > 0) {
      res.status(400).json({ error: 'Cannot delete category with tickets. Please reassign tickets first.' });
      return;
    }

    await prisma.ticketCategory.delete({
      where: { id },
    });

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting ticket category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Ticket templates ==========
router.get('/templates', requirePermission('ticketing.tickets.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const list = await prisma.ticketTemplate.findMany({
      where: { orgId: req.org.id },
      include: { category: { select: { id: true, name: true, color: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(list);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/templates', requirePermission('ticketing.tickets.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { name, title, description, categoryId, priority, tags } = req.body;
    if (!name || !title) {
      res.status(400).json({ error: 'Name and title are required' });
      return;
    }
    const template = await prisma.ticketTemplate.create({
      data: {
        orgId: req.org.id,
        name,
        title,
        description: description || null,
        categoryId: categoryId || null,
        priority: priority || 'medium',
        tags: Array.isArray(tags) ? tags : [],
      },
      include: { category: true },
    });
    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/templates/:id', requirePermission('ticketing.tickets.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const { name, title, description, categoryId, priority, tags } = req.body;
    const existing = await prisma.ticketTemplate.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    const template = await prisma.ticketTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description: description || null }),
        ...(categoryId !== undefined && { categoryId: categoryId || null }),
        ...(priority !== undefined && { priority }),
        ...(Array.isArray(tags) && { tags }),
      },
      include: { category: true },
    });
    res.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/templates/:id', requirePermission('ticketing.tickets.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.ticketTemplate.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    await prisma.ticketTemplate.delete({ where: { id } });
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Canned replies ==========
router.get('/canned-replies', requirePermission('ticketing.tickets.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const list = await prisma.cannedReply.findMany({
      where: { orgId: req.org.id },
      orderBy: { name: 'asc' },
    });
    res.json(list);
  } catch (error) {
    console.error('Error fetching canned replies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/canned-replies', requirePermission('ticketing.tickets.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { name, content, shortcut } = req.body;
    if (!name || !content) {
      res.status(400).json({ error: 'Name and content are required' });
      return;
    }
    const reply = await prisma.cannedReply.create({
      data: {
        orgId: req.org.id,
        name,
        content,
        shortcut: shortcut || null,
      },
    });
    res.status(201).json(reply);
  } catch (error) {
    console.error('Error creating canned reply:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/canned-replies/:id', requirePermission('ticketing.tickets.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const { name, content, shortcut } = req.body;
    const existing = await prisma.cannedReply.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Canned reply not found' });
      return;
    }
    const reply = await prisma.cannedReply.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(content !== undefined && { content }),
        ...(shortcut !== undefined && { shortcut: shortcut || null }),
      },
    });
    res.json(reply);
  } catch (error) {
    console.error('Error updating canned reply:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/canned-replies/:id', requirePermission('ticketing.tickets.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.cannedReply.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Canned reply not found' });
      return;
    }
    await prisma.cannedReply.delete({ where: { id } });
    res.json({ message: 'Canned reply deleted successfully' });
  } catch (error) {
    console.error('Error deleting canned reply:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/ticketing/reports - Stats by status, category, assignee, priority
router.get('/reports', requirePermission('ticketing.tickets.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const [byStatus, byPriority, byCategory, byAssignee, total, openCount] = await Promise.all([
      prisma.ticket.groupBy({
        by: ['status'],
        where: { orgId: req.org.id },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.ticket.groupBy({
        by: ['priority'],
        where: { orgId: req.org.id },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.ticket.groupBy({
        by: ['categoryId'],
        where: { orgId: req.org.id },
        _count: { id: true },
      }),
      prisma.ticket.groupBy({
        by: ['assigneeId'],
        where: { orgId: req.org.id },
        _count: { id: true },
      }),
      prisma.ticket.count({ where: { orgId: req.org.id } }),
      prisma.ticket.count({
        where: { orgId: req.org.id, status: 'open' },
      }),
    ]);

    const categoryIds = [...new Set(byCategory.map((c) => c.categoryId).filter(Boolean))] as string[];
    const categories = categoryIds.length
      ? await prisma.ticketCategory.findMany({
          where: { id: { in: categoryIds }, orgId: req.org.id },
          select: { id: true, name: true, color: true },
        })
      : [];
    const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c]));

    const assigneeIds = [...new Set(byAssignee.map((a) => a.assigneeId).filter(Boolean))] as string[];
    const users = assigneeIds.length
      ? await prisma.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    res.json({
      total,
      openCount,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.id })),
      byPriority: byPriority.map((p) => ({ priority: p.priority, count: p._count.id })),
      byCategory: byCategory.map((c) => ({
        categoryId: c.categoryId,
        categoryName: c.categoryId ? categoryMap[c.categoryId]?.name ?? 'Uncategorized' : 'Uncategorized',
        color: c.categoryId ? categoryMap[c.categoryId]?.color ?? null : null,
        count: c._count.id,
      })),
      byAssignee: byAssignee.map((a) => ({
        assigneeId: a.assigneeId,
        assigneeName: a.assigneeId ? userMap[a.assigneeId]?.name ?? userMap[a.assigneeId]?.email ?? 'Unknown' : 'Unassigned',
        count: a._count.id,
      })),
    });
  } catch (error) {
    console.error('Error fetching ticketing reports:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Widget endpoint
router.get('/widgets/open-tickets', requirePermission('ticketing.tickets.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.ticket.count({
      where: {
        orgId: req.org.id,
        status: 'open',
      },
    });

    res.json({ count });
  } catch (error) {
    console.error('Error fetching open tickets count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


