import { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import type { ModuleManifest } from '@cloud-org/shared';

const router = Router();

// Module manifest
export const membershipManifest: ModuleManifest = {
  key: 'membership',
  name: 'Membership Management',
  icon: 'users',
  sidebarItems: [
    {
      path: '/membership/types',
      label: 'Membership Types',
      permission: 'membership.types.view',
    },
    {
      path: '/membership/members',
      label: 'Members',
      permission: 'membership.members.view',
    },
    {
      path: '/membership/announcements',
      label: 'Announcements',
      permission: 'membership.announcements.view',
    },
    {
      path: '/membership/messages',
      label: 'Messages',
      permission: 'membership.messages.view',
    },
  ],
  dashboardWidgets: [
    {
      id: 'membership-active-count',
      title: 'Active Members',
      description: 'Number of active memberships',
      apiPath: '/api/membership/widgets/active-count',
      permission: 'membership.members.view',
    },
    {
      id: 'membership-expiring-soon',
      title: 'Expiring Soon',
      description: 'Memberships expiring in 30 days',
      apiPath: '/api/membership/widgets/expiring-soon',
      permission: 'membership.members.view',
    },
  ],
};

// Register module
export function registerMembershipModule(routerInstance: Router): void {
  routerInstance.use('/api/membership', authMiddleware, requireModuleEnabled('membership'), router);

  moduleRegistry.register({
    key: 'membership',
    manifest: membershipManifest,
    registerRoutes: () => {},
  });
}

// ============================================
// MEMBERSHIP TYPES
// ============================================

// GET /api/membership/types - List membership types
router.get('/types', requirePermission('membership.types.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isActive } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    const types = await prisma.membershipType.findMany({
      where,
      include: {
        _count: {
          select: { memberships: true },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json(types);
  } catch (error: any) {
    console.error('Error fetching membership types:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/membership/types/:id - Get membership type
router.get('/types/:id', requirePermission('membership.types.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const type = await prisma.membershipType.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: { memberships: true },
        },
      },
    });

    if (!type) {
      res.status(404).json({ error: 'Membership type not found' });
      return;
    }

    res.json(type);
  } catch (error: any) {
    console.error('Error fetching membership type:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/membership/types - Create membership type
router.post('/types', requirePermission('membership.types.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, priceCents, currency, durationMonths, benefits, features, isActive, maxMemberships } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const type = await prisma.membershipType.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        priceCents: priceCents ? Math.round(priceCents * 100) : 0,
        currency: currency || 'SAR',
        durationMonths: durationMonths || 12,
        benefits: benefits || [],
        features: features || null,
        isActive: isActive !== undefined ? isActive : true,
        maxMemberships: maxMemberships || null,
      },
    });

    res.status(201).json(type);
  } catch (error: any) {
    console.error('Error creating membership type:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/membership/types/:id - Update membership type
router.put('/types/:id', requirePermission('membership.types.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const updateData: any = {};

    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined) {
        if (key === 'priceCents') {
          updateData[key] = Math.round(req.body[key] * 100);
        } else {
          updateData[key] = req.body[key];
        }
      }
    });

    const type = await prisma.membershipType.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!type) {
      res.status(404).json({ error: 'Membership type not found' });
      return;
    }

    const updated = await prisma.membershipType.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating membership type:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/membership/types/:id - Delete membership type
router.delete('/types/:id', requirePermission('membership.types.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const type = await prisma.membershipType.findFirst({
      where: { id, orgId: req.org.id },
      include: {
        _count: {
          select: { memberships: true },
        },
      },
    });

    if (!type) {
      res.status(404).json({ error: 'Membership type not found' });
      return;
    }

    if (type._count.memberships > 0) {
      res.status(400).json({ error: 'Cannot delete membership type with existing memberships' });
      return;
    }

    await prisma.membershipType.delete({
      where: { id },
    });

    res.json({ message: 'Membership type deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting membership type:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// MEMBERSHIPS
// ============================================

// GET /api/membership/members - List memberships
router.get('/members', requirePermission('membership.members.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, membershipTypeId, search, expired } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) where.status = status;
    if (membershipTypeId) where.membershipTypeId = membershipTypeId;

    if (expired === 'true') {
      where.endDate = { lt: new Date() };
      where.status = { not: 'expired' };
    }

    if (search) {
      where.OR = [
        { memberName: { contains: search as string, mode: 'insensitive' } },
        { memberEmail: { contains: search as string, mode: 'insensitive' } },
        { memberPhone: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const memberships = await prisma.memberMembership.findMany({
      where,
      include: {
        membershipType: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Auto-update expired memberships
    const now = new Date();
    for (const membership of memberships) {
      if (membership.status === 'active' && membership.endDate < now) {
        await prisma.memberMembership.update({
          where: { id: membership.id },
          data: { status: 'expired' },
        });
        membership.status = 'expired';
      }
    }

    res.json(memberships);
  } catch (error: any) {
    console.error('Error fetching memberships:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/membership/members/:id - Get membership
router.get('/members/:id', requirePermission('membership.members.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const membership = await prisma.memberMembership.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        membershipType: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!membership) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }

    res.json(membership);
  } catch (error: any) {
    console.error('Error fetching membership:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/membership/members - Create membership
router.post('/members', requirePermission('membership.members.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { membershipTypeId, memberName, memberEmail, memberPhone, memberAddress, memberCity, memberCountry, startDate, endDate, paymentStatus, paymentAmount, paymentMethod, notes } = req.body;

    if (!membershipTypeId || !memberName || !memberEmail) {
      res.status(400).json({ error: 'Membership type, member name, and email are required' });
      return;
    }

    // Get membership type to calculate end date if not provided
    const membershipType = await prisma.membershipType.findFirst({
      where: { id: membershipTypeId, orgId: req.org.id },
    });

    if (!membershipType) {
      res.status(404).json({ error: 'Membership type not found' });
      return;
    }

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(start.getTime() + membershipType.durationMonths * 30 * 24 * 60 * 60 * 1000);

    const membership = await prisma.memberMembership.create({
      data: {
        orgId: req.org.id,
        membershipTypeId,
        memberName,
        memberEmail,
        memberPhone: memberPhone || null,
        memberAddress: memberAddress || null,
        memberCity: memberCity || null,
        memberCountry: memberCountry || null,
        startDate: start,
        endDate: end,
        paymentStatus: paymentStatus || 'paid',
        paymentAmount: paymentAmount ? Math.round(paymentAmount * 100) : null,
        paymentMethod: paymentMethod || null,
        notes: notes || null,
        createdById: req.user.id,
      },
      include: {
        membershipType: true,
      },
    });

    res.status(201).json(membership);
  } catch (error: any) {
    console.error('Error creating membership:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/membership/members/:id - Update membership
router.put('/members/:id', requirePermission('membership.members.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const updateData: any = {};

    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined) {
        if (key === 'paymentAmount') {
          updateData[key] = Math.round(req.body[key] * 100);
        } else if (key === 'startDate' || key === 'endDate') {
          updateData[key] = new Date(req.body[key]);
        } else {
          updateData[key] = req.body[key];
        }
      }
    });

    const membership = await prisma.memberMembership.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!membership) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }

    const updated = await prisma.memberMembership.update({
      where: { id },
      data: updateData,
      include: {
        membershipType: true,
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating membership:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/membership/members/:id/renew - Renew membership
router.put('/members/:id/renew', requirePermission('membership.members.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { months, paymentStatus, paymentAmount, paymentMethod } = req.body;

    const membership = await prisma.memberMembership.findFirst({
      where: { id, orgId: req.org.id },
      include: { membershipType: true },
    });

    if (!membership) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }

    const renewalMonths = months || membership.membershipType.durationMonths;
    const newEndDate = new Date(membership.endDate);
    newEndDate.setMonth(newEndDate.getMonth() + renewalMonths);

    const updated = await prisma.memberMembership.update({
      where: { id },
      data: {
        endDate: newEndDate,
        renewedAt: new Date(),
        status: 'active',
        paymentStatus: paymentStatus || membership.paymentStatus,
        paymentAmount: paymentAmount ? Math.round(paymentAmount * 100) : membership.paymentAmount,
        paymentMethod: paymentMethod || membership.paymentMethod,
      },
      include: {
        membershipType: true,
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error renewing membership:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/membership/members/:id - Delete membership
router.delete('/members/:id', requirePermission('membership.members.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    await prisma.memberMembership.delete({
      where: { id },
    });

    res.json({ message: 'Membership deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting membership:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// ANNOUNCEMENTS
// ============================================

// GET /api/membership/announcements - List announcements
router.get('/announcements', requirePermission('membership.announcements.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { isPublished, memberEmail } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    // If memberEmail is provided, only return published announcements they can see
    if (memberEmail) {
      where.isPublished = true;
      where.expiresAt = {
        OR: [{ equals: null }, { gt: new Date() }],
      };
      // Check if announcement is for all members or specific membership type
      const membership = await prisma.memberMembership.findFirst({
        where: {
          orgId: req.org.id,
          memberEmail: memberEmail as string,
          status: 'active',
          endDate: { gt: new Date() },
        },
      });

      if (membership) {
        where.OR = [
          { targetAudience: 'all' },
          { specificMembershipTypeId: membership.membershipTypeId },
        ];
      } else {
        where.targetAudience = 'all';
      }
    } else if (isPublished !== undefined) {
      where.isPublished = isPublished === 'true';
    }

    const announcements = await prisma.announcement.findMany({
      where,
      include: {
        membershipType: true,
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

// GET /api/membership/announcements/:id - Get announcement
router.get('/announcements/:id', requirePermission('membership.announcements.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { memberEmail } = req.query;

    const announcement = await prisma.announcement.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        membershipType: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!announcement) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    // Track view if memberEmail provided
    if (memberEmail && announcement.isPublished) {
      await prisma.announcementView.upsert({
        where: {
          announcementId_memberEmail: {
            announcementId: id,
            memberEmail: memberEmail as string,
          },
        },
        create: {
          announcementId: id,
          memberEmail: memberEmail as string,
        },
        update: {},
      });
    }

    res.json(announcement);
  } catch (error: any) {
    console.error('Error fetching announcement:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/membership/announcements - Create announcement
router.post('/announcements', requirePermission('membership.announcements.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { title, content, type, priority, targetAudience, specificMembershipTypeId, isPublished, expiresAt } = req.body;

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
        specificMembershipTypeId: specificMembershipTypeId || null,
        isPublished: isPublished || false,
        publishedAt: isPublished ? new Date() : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdById: req.user.id,
      },
      include: {
        membershipType: true,
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

// PUT /api/membership/announcements/:id - Update announcement
router.put('/announcements/:id', requirePermission('membership.announcements.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const updateData: any = {};

    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined) {
        if (key === 'expiresAt' || key === 'publishedAt') {
          updateData[key] = req.body[key] ? new Date(req.body[key]) : null;
        } else if (key === 'isPublished' && req.body[key] === true) {
          updateData[key] = true;
          updateData.publishedAt = new Date();
        } else {
          updateData[key] = req.body[key];
        }
      }
    });

    const announcement = await prisma.announcement.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!announcement) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    const updated = await prisma.announcement.update({
      where: { id },
      data: updateData,
      include: {
        membershipType: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating announcement:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/membership/announcements/:id - Delete announcement
router.delete('/announcements/:id', requirePermission('membership.announcements.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    await prisma.announcement.delete({
      where: { id },
    });

    res.json({ message: 'Announcement deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// CONVERSATIONS & MESSAGES
// ============================================

// GET /api/membership/conversations - List conversations
router.get('/conversations', requirePermission('membership.messages.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, memberEmail, assignedToId } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) where.status = status;
    if (memberEmail) where.memberEmail = memberEmail;
    if (assignedToId) where.assignedToId = assignedToId;

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        memberMembership: {
          include: {
            membershipType: true,
          },
        },
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1, // Latest message
        },
        _count: {
          select: { messages: true },
        },
      },
      orderBy: {
        lastMessageAt: 'desc',
      },
    });

    res.json(conversations);
  } catch (error: any) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/membership/conversations/:id - Get conversation with messages
router.get('/conversations/:id', requirePermission('membership.messages.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        memberMembership: {
          include: {
            membershipType: true,
          },
        },
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json(conversation);
  } catch (error: any) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/membership/conversations - Create conversation (by member)
router.post('/conversations', async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { memberEmail, memberName, memberMembershipId, subject, message } = req.body;

    if (!memberEmail || !memberName || !message) {
      res.status(400).json({ error: 'Member email, name, and message are required' });
      return;
    }

    // Verify member has active membership
    const membership = await prisma.memberMembership.findFirst({
      where: {
        orgId: req.org.id,
        memberEmail,
        status: 'active',
        endDate: { gt: new Date() },
      },
    });

    if (!membership) {
      res.status(403).json({ error: 'You must have an active membership to send messages' });
      return;
    }

    const conversation = await prisma.conversation.create({
      data: {
        orgId: req.org.id,
        memberMembershipId: membership.id,
        memberEmail,
        memberName,
        subject: subject || null,
        lastMessageAt: new Date(),
      },
    });

    // Create first message
    const firstMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderEmail: memberEmail,
        senderName: memberName,
        senderType: 'member',
        content: message,
      },
    });

    const result = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: {
        messages: true,
      },
    });

    res.status(201).json(result);
  } catch (error: any) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/membership/conversations/:id/messages - Send message
router.post('/conversations/:id/messages', requirePermission('membership.messages.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { content, senderType, senderEmail, senderName } = req.body;

    if (!content) {
      res.status(400).json({ error: 'Message content is required' });
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Determine sender info
    const isAdmin = senderType === 'admin' || req.user.isSuperAdmin;
    const messageSenderEmail = isAdmin ? req.user.email : (senderEmail || conversation.memberEmail);
    const messageSenderName = isAdmin ? (req.user.name || req.user.email) : (senderName || conversation.memberName);

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        senderEmail: messageSenderEmail,
        senderName: messageSenderName,
        senderType: isAdmin ? 'admin' : 'member',
        content,
      },
    });

    // Update conversation last message time
    await prisma.conversation.update({
      where: { id },
      data: {
        lastMessageAt: new Date(),
      },
    });

    res.status(201).json(message);
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/membership/conversations/:id/assign - Assign conversation
router.put('/conversations/:id/assign', requirePermission('membership.messages.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { assignedToId } = req.body;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { assignedToId: assignedToId || null },
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error assigning conversation:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/membership/conversations/:id/status - Update conversation status
router.put('/conversations/:id/status', requirePermission('membership.messages.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { status } = req.body;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { status },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating conversation status:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/membership/messages/:id/read - Mark message as read
router.put('/messages/:id/read', requirePermission('membership.messages.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const message = await prisma.message.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    res.json(message);
  } catch (error: any) {
    console.error('Error marking message as read:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// WIDGETS
// ============================================

// GET /api/membership/widgets/active-count - Active members count
router.get('/widgets/active-count', requirePermission('membership.members.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.memberMembership.count({
      where: {
        orgId: req.org.id,
        status: 'active',
        endDate: { gt: new Date() },
      },
    });

    res.json({ count });
  } catch (error: any) {
    console.error('Error fetching active members count:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/membership/widgets/expiring-soon - Memberships expiring soon
router.get('/widgets/expiring-soon', requirePermission('membership.members.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const memberships = await prisma.memberMembership.findMany({
      where: {
        orgId: req.org.id,
        status: 'active',
        endDate: {
          gte: new Date(),
          lte: thirtyDaysFromNow,
        },
      },
      include: {
        membershipType: true,
      },
      orderBy: {
        endDate: 'asc',
      },
    });

    res.json({ count: memberships.length, memberships });
  } catch (error: any) {
    console.error('Error fetching expiring memberships:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});










