import { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// GET /api/hr/announcements - List announcements
router.get('/', requirePermission('hr.announcements.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isPublished, employeeId } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    // If employeeId is provided, only return published announcements they can see
    if (employeeId) {
      where.isPublished = true;
      where.expiresAt = {
        OR: [{ equals: null }, { gt: new Date() }],
      };
      // Check if announcement is for all employees or specific department
      const employee = await prisma.employee.findFirst({
        where: {
          id: employeeId as string,
          orgId: req.org.id,
        },
        select: {
          department: true,
        },
      });

      // Schema has targetAudience: "all" | "specific_type" (no department). Show all published to org.
      where.targetAudience = 'all';
    } else if (isPublished !== undefined) {
      where.isPublished = isPublished === 'true';
    }

    const announcements = await prisma.announcement.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { views: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(announcements);
  } catch (error: any) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/hr/announcements/:id - Get announcement
router.get('/:id', requirePermission('hr.announcements.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { employeeId } = req.query;

    const announcement = await prisma.announcement.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { views: true },
        },
      },
    });

    if (!announcement) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    // Mark as viewed if memberEmail (or employeeId for backwards compat) is provided
    const memberEmail = (req.query.memberEmail as string) || (employeeId ? `${employeeId}@employee` : null);
    if (memberEmail && announcement.isPublished) {
      try {
        await prisma.announcementView.upsert({
          where: {
            announcementId_memberEmail: {
              announcementId: id,
              memberEmail,
            },
          },
          create: {
            announcementId: id,
            memberEmail,
          },
          update: {},
        });
      } catch (error) {
        // Ignore errors for view tracking
        console.error('Error tracking view:', error);
      }
    }

    res.json(announcement);
  } catch (error: any) {
    console.error('Error fetching announcement:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/hr/announcements - Create announcement
router.post('/', requirePermission('hr.announcements.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { title, content, type, priority, targetAudience, department, isPublished, expiresAt } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: 'Title and content are required' });
      return;
    }

    const announcement = await prisma.announcement.create({
      data: {
        orgId: req.org.id,
        title,
        content,
        type: type || 'info',
        priority: priority || 'normal',
        targetAudience: targetAudience || 'all',
        isPublished: isPublished || false,
        publishedAt: isPublished ? new Date() : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdById: req.user.id,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.status(201).json(announcement);
  } catch (error: any) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/hr/announcements/:id - Update announcement
router.put('/:id', requirePermission('hr.announcements.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { title, content, type, priority, targetAudience, department, isPublished, expiresAt } = req.body;

    const announcement = await prisma.announcement.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!announcement) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    const updateData: any = {};

    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (type !== undefined) updateData.type = type;
    if (priority !== undefined) updateData.priority = priority;
    if (targetAudience !== undefined) {
      updateData.targetAudience = targetAudience;
      // Schema uses specificMembershipTypeId for "specific_type", not department
    }
    if (isPublished !== undefined) {
      updateData.isPublished = isPublished;
      if (isPublished && !announcement.publishedAt) {
        updateData.publishedAt = new Date();
      }
    }
    if (expiresAt !== undefined) {
      updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }

    const updated = await prisma.announcement.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { views: true },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating announcement:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/hr/announcements/:id - Delete announcement
router.delete('/:id', requirePermission('hr.announcements.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const announcement = await prisma.announcement.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!announcement) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    await prisma.announcement.delete({
      where: { id },
    });

    res.json({ message: 'Announcement deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;





