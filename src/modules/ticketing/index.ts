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

// GET /api/ticketing/tickets
router.get('/tickets', requirePermission('ticketing.tickets.view'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, priority, categoryId, search } = req.query;

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
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(tickets);
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

    const { title, description, priority, assigneeId, categoryId } = req.body;

    if (!title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    // Verify category if provided
    if (categoryId) {
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

    const ticket = await prisma.ticket.create({
      data: {
        orgId: req.org.id,
        title,
        description: description || null,
        priority: priority || 'medium',
        status: 'open',
        createdById: req.user.id,
        assigneeId: assigneeId || null,
        categoryId: categoryId || null,
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
      },
    });

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
    const { title, description, priority, status, assigneeId, categoryId } = req.body;

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

    // Verify category if provided
    if (categoryId !== undefined) {
      if (categoryId) {
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
    }

    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description: description || null }),
        ...(priority && { priority }),
        ...(status && { status }),
        ...(assigneeId !== undefined && { assigneeId: assigneeId || null }),
        ...(categoryId !== undefined && { categoryId: categoryId || null }),
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
      },
    });

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
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    res.json(ticket);
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

    // Update ticket updatedAt
    await prisma.ticket.update({
      where: { id },
      data: { updatedAt: new Date() },
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


