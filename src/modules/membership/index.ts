import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import { createAuditLog } from '../../middleware/audit';
import { createNotificationForOrgWithPermission } from '../../core/notifications/helper';
import type { ModuleManifest } from '@cloud-org/shared';

const router = Router();

const frontendUrl = () => process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';

function generateQrToken(): string {
  return crypto.randomBytes(12).toString('base64url');
}

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
    {
      path: '/membership/card-designs',
      label: 'Card Designs',
      permission: 'membership.types.view',
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
// CARD DESIGNS (digital card & QR customization)
// ============================================

// GET /api/membership/card-designs - List card designs
router.get('/card-designs', requirePermission('membership.types.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const designs = await prisma.membershipCardDesign.findMany({
      where: { orgId: req.org.id },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    res.json(designs);
  } catch (error: any) {
    console.error('Error fetching card designs:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/membership/card-designs/:id - Get one design
router.get('/card-designs/:id', requirePermission('membership.types.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const design = await prisma.membershipCardDesign.findFirst({
      where: { id: req.params.id, orgId: req.org.id },
    });
    if (!design) {
      res.status(404).json({ error: 'Card design not found' });
      return;
    }
    res.json(design);
  } catch (error: any) {
    console.error('Error fetching card design:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/membership/card-designs - Create design
router.post('/card-designs', requirePermission('membership.types.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { name, isDefault, layout, primaryColor, secondaryColor, accentColor, logoUrl, showQR, qrPosition, customCss, fontFamily } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (isDefault === true) {
      await prisma.membershipCardDesign.updateMany({
        where: { orgId: req.org.id },
        data: { isDefault: false },
      });
    }
    const design = await prisma.membershipCardDesign.create({
      data: {
        orgId: req.org.id,
        name: name,
        isDefault: isDefault === true,
        layout: layout || 'standard',
        primaryColor: primaryColor || '#1e3a5f',
        secondaryColor: secondaryColor || '#3b82f6',
        accentColor: accentColor || null,
        logoUrl: logoUrl || null,
        showQR: showQR !== false,
        qrPosition: qrPosition || 'right',
        customCss: customCss || null,
        fontFamily: fontFamily || 'sans-serif',
      },
    });
    res.status(201).json(design);
  } catch (error: any) {
    console.error('Error creating card design:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/membership/card-designs/:id - Update design
router.put('/card-designs/:id', requirePermission('membership.types.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const design = await prisma.membershipCardDesign.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!design) {
      res.status(404).json({ error: 'Card design not found' });
      return;
    }
    const { name, isDefault, layout, primaryColor, secondaryColor, accentColor, logoUrl, showQR, qrPosition, customCss, fontFamily } = req.body;
    if (isDefault === true) {
      await prisma.membershipCardDesign.updateMany({
        where: { orgId: req.org.id },
        data: { isDefault: false },
      });
    }
    const updated = await prisma.membershipCardDesign.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(isDefault !== undefined && { isDefault }),
        ...(layout !== undefined && { layout }),
        ...(primaryColor !== undefined && { primaryColor }),
        ...(secondaryColor !== undefined && { secondaryColor }),
        ...(accentColor !== undefined && { accentColor }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(showQR !== undefined && { showQR }),
        ...(qrPosition !== undefined && { qrPosition }),
        ...(customCss !== undefined && { customCss }),
        ...(fontFamily !== undefined && { fontFamily }),
      },
    });
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating card design:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/membership/card-designs/:id - Delete design
router.delete('/card-designs/:id', requirePermission('membership.types.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const design = await prisma.membershipCardDesign.findFirst({
      where: { id, orgId: req.org.id },
    });
    if (!design) {
      res.status(404).json({ error: 'Card design not found' });
      return;
    }
    await prisma.membershipCardDesign.delete({ where: { id } });
    res.json({ message: 'Card design deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting card design:', error);
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

    const { status, membershipTypeId, search, expired, expiringWithinDays, limit: qLimit, offset: qOffset, page } = req.query;
    const limit = Math.min(parseInt(String(qLimit || 50), 10) || 50, 200);
    const offset = parseInt(String(qOffset || 0), 10) || 0;
    const pageNum = parseInt(String(page), 10);
    const skip = pageNum >= 1 ? (pageNum - 1) * limit : offset;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) where.status = status;
    if (membershipTypeId) where.membershipTypeId = membershipTypeId;

    if (expired === 'true') {
      where.endDate = { lt: new Date() };
      where.status = { not: 'expired' };
    }

    const days = expiringWithinDays ? parseInt(String(expiringWithinDays), 10) : NaN;
    if (!isNaN(days) && days > 0) {
      const now = new Date();
      const future = new Date(now);
      future.setDate(future.getDate() + days);
      where.status = 'active';
      where.endDate = { gte: now, lte: future };
    }

    if (search) {
      where.OR = [
        { memberName: { contains: search as string, mode: 'insensitive' } },
        { memberEmail: { contains: search as string, mode: 'insensitive' } },
        { memberPhone: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [memberships, total] = await Promise.all([
      prisma.memberMembership.findMany({
        where,
        include: {
          membershipType: true,
          cardDesign: true,
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
        skip,
      }),
      prisma.memberMembership.count({ where }),
    ]);

    // Auto-update expired memberships in this page
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

    res.json({ data: memberships, total, limit, offset: skip });
  } catch (error: any) {
    console.error('Error fetching memberships:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/membership/members/export - Export members as CSV (same filters as list)
router.get('/members/export', requirePermission('membership.members.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, membershipTypeId, search, expired, expiringWithinDays } = req.query;

    const where: any = { orgId: req.org.id };
    if (status) where.status = status as string;
    if (membershipTypeId) where.membershipTypeId = membershipTypeId as string;
    if (expired === 'true') {
      where.endDate = { lt: new Date() };
      where.status = { not: 'expired' };
    }
    const days = expiringWithinDays ? parseInt(String(expiringWithinDays), 10) : NaN;
    if (!isNaN(days) && days > 0) {
      const now = new Date();
      const future = new Date(now);
      future.setDate(future.getDate() + days);
      where.status = 'active';
      where.endDate = { gte: now, lte: future };
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
        membershipType: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const escape = (v: string | number | null | undefined) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const headers = ['Name', 'Email', 'Phone', 'Type', 'Status', 'Start Date', 'End Date', 'Payment Status', 'Created At'];
    const rows = memberships.map((m) => [
      m.memberName,
      m.memberEmail,
      m.memberPhone ?? '',
      m.membershipType.name,
      m.status,
      m.startDate.toISOString().slice(0, 10),
      m.endDate.toISOString().slice(0, 10),
      m.paymentStatus ?? '',
      m.createdAt.toISOString().slice(0, 10),
    ]);

    const csv =
      headers.map(escape).join(',') +
      '\n' +
      rows.map((row) => row.map(escape).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="members-export.csv"');
    res.send(csv);
  } catch (error: any) {
    console.error('Error exporting members:', error);
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
        cardDesign: true,
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

    const { membershipTypeId, memberName, memberEmail, memberPhone, memberAddress, memberCity, memberCountry, startDate, endDate, paymentStatus, paymentAmount, paymentMethod, notes, cardDesignId } = req.body;

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
        qrToken: generateQrToken(),
        cardDesignId: cardDesignId || null,
      },
      include: {
        membershipType: true,
        cardDesign: true,
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
        cardDesign: true,
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating membership:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/membership/members/:id/card - Get membership + design for digital card rendering
router.get('/members/:id/card', requirePermission('membership.members.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;

    const membership = await prisma.memberMembership.findFirst({
      where: { id, orgId: req.org.id },
      include: {
        membershipType: true,
        cardDesign: true,
        organization: { select: { name: true, slug: true } },
      },
    });

    if (!membership) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }

    // Ensure QR token exists (for members created before this feature)
    let qrToken = membership.qrToken;
    if (!qrToken) {
      qrToken = generateQrToken();
      await prisma.memberMembership.update({
        where: { id: membership.id },
        data: { qrToken },
      });
    }

    // If no design assigned, use org default or a built-in default
    let design = membership.cardDesign;
    if (!design) {
      design = await prisma.membershipCardDesign.findFirst({
        where: { orgId: req.org.id, isDefault: true },
      });
    }
    if (!design) {
      design = await prisma.membershipCardDesign.findFirst({
        where: { orgId: req.org.id },
      });
    }

    res.json({
      membership: {
        id: membership.id,
        memberName: membership.memberName,
        memberEmail: membership.memberEmail,
        memberPhone: membership.memberPhone,
        status: membership.status,
        startDate: membership.startDate,
        endDate: membership.endDate,
        qrToken,
        membershipType: membership.membershipType,
        organization: membership.organization,
      },
      design: design
        ? {
            id: design.id,
            name: design.name,
            layout: design.layout,
            primaryColor: design.primaryColor,
            secondaryColor: design.secondaryColor,
            accentColor: design.accentColor,
            logoUrl: design.logoUrl,
            showQR: design.showQR,
            qrPosition: design.qrPosition,
            customCss: design.customCss,
            fontFamily: design.fontFamily,
          }
        : {
            name: 'Default',
            layout: 'standard',
            primaryColor: '#1e3a5f',
            secondaryColor: '#3b82f6',
            accentColor: null,
            logoUrl: null,
            showQR: true,
            qrPosition: 'right',
            customCss: null,
            fontFamily: 'sans-serif',
          },
      verifyUrl: qrToken ? `${frontendUrl()}/membership/verify/${qrToken}` : null,
    });
  } catch (error: any) {
    console.error('Error fetching membership card:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/membership/members/:id/qr - Get QR code image (PNG) for membership verification
router.get('/members/:id/qr', requirePermission('membership.members.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;

    let membership = await prisma.memberMembership.findFirst({
      where: { id, orgId: req.org.id },
      select: { id: true, qrToken: true },
    });

    if (!membership) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }

    let qrToken = membership.qrToken;
    if (!qrToken) {
      qrToken = generateQrToken();
      await prisma.memberMembership.update({
        where: { id: membership.id },
        data: { qrToken },
      });
    }

    const verifyUrl = `${frontendUrl()}/membership/verify/${qrToken}`;
    const pngBuffer = await QRCode.toBuffer(verifyUrl, { type: 'png', width: 256, margin: 2 });

    res.set('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (error: any) {
    console.error('Error generating QR code:', error);
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

    createAuditLog({
      userId: (req as any).user?.id ?? null,
      organizationId: req.org.id,
      action: 'delete',
      resourceType: 'member_membership',
      resourceId: id,
      details: { memberMembershipId: id },
      req,
    }).catch(() => {});

    res.json({ message: 'Membership deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting membership:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/membership/members/bulk - Bulk create members from CSV-like payload
router.post('/members/bulk', requirePermission('membership.members.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { members } = req.body;
    if (!Array.isArray(members) || members.length === 0) {
      res.status(400).json({ error: 'Members array is required' });
      return;
    }

    const results = { created: 0, failed: 0, errors: [] as Array<{ row: number; error: string }> };

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      try {
        if (!m.memberName || !m.memberEmail) {
          results.failed++;
          results.errors.push({ row: i + 1, error: 'Member name and email are required' });
          continue;
        }
        const membershipTypeId = m.membershipTypeId || m.membershipType;
        if (!membershipTypeId) {
          results.failed++;
          results.errors.push({ row: i + 1, error: 'Membership type is required' });
          continue;
        }

        const membershipType = await prisma.membershipType.findFirst({
          where: { id: membershipTypeId, orgId: req.org.id },
        });
        if (!membershipType) {
          results.failed++;
          results.errors.push({ row: i + 1, error: 'Membership type not found' });
          continue;
        }

        const start = m.startDate ? new Date(m.startDate) : new Date();
        const end = m.endDate ? new Date(m.endDate) : new Date(start.getTime() + membershipType.durationMonths * 30 * 24 * 60 * 60 * 1000);

        await prisma.memberMembership.create({
          data: {
            orgId: req.org.id,
            membershipTypeId: membershipType.id,
            memberName: m.memberName,
            memberEmail: m.memberEmail,
            memberPhone: m.memberPhone || null,
            memberAddress: m.memberAddress || null,
            memberCity: m.memberCity || null,
            memberCountry: m.memberCountry || null,
            startDate: start,
            endDate: end,
            paymentStatus: m.paymentStatus || 'paid',
            paymentAmount: m.paymentAmount != null ? Math.round(Number(m.paymentAmount) * 100) : null,
            paymentMethod: m.paymentMethod || null,
            notes: m.notes || null,
            createdById: req.user.id,
            qrToken: generateQrToken(),
            cardDesignId: m.cardDesignId || null,
          },
        });
        results.created++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ row: i + 1, error: err.message || 'Failed to create member' });
      }
    }

    res.json({ success: true, ...results });
  } catch (error: any) {
    console.error('Error bulk creating members:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/membership/jobs/renewal-reminders - Create notifications for members expiring in 7/30 days
router.post('/jobs/renewal-reminders', requirePermission('membership.members.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const expiringIn7 = await prisma.memberMembership.findMany({
      where: {
        orgId: req.org.id,
        status: 'active',
        endDate: { gte: now, lte: in7 },
      },
      include: { membershipType: { select: { name: true } } },
      orderBy: { endDate: 'asc' },
    });

    const expiringIn30 = await prisma.memberMembership.findMany({
      where: {
        orgId: req.org.id,
        status: 'active',
        endDate: { gt: in7, lte: in30 },
      },
      include: { membershipType: { select: { name: true } } },
      orderBy: { endDate: 'asc' },
    });

    const parts: string[] = [];
    if (expiringIn7.length > 0) {
      parts.push(`${expiringIn7.length} expiring in 7 days: ${expiringIn7.map((x) => x.memberName).join(', ')}`);
    }
    if (expiringIn30.length > 0) {
      parts.push(`${expiringIn30.length} expiring in 30 days: ${expiringIn30.map((x) => x.memberName).join(', ')}`);
    }

    if (parts.length > 0) {
      createNotificationForOrgWithPermission(req.org.id, 'membership.members.view', {
        type: 'warning',
        title: 'Membership renewal reminders',
        message: parts.join('. '),
        link: '/dashboard/membership/members',
      }).catch(() => {});
    }

    res.json({
      message: 'Renewal reminders processed',
      expiringIn7Days: expiringIn7.length,
      expiringIn30Days: expiringIn30.length,
    });
  } catch (error: any) {
    console.error('Error running renewal reminders:', error);
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
    const messageSenderName = isAdmin ? ((req.user as { name?: string | null }).name || req.user.email) : (senderName || conversation.memberName);

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










