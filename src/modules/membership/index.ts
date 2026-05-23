import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { Prisma } from '@prisma/client';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import { createAuditLog } from '../../middleware/audit';
import { createNotificationForOrgWithPermission } from '../../core/notifications/helper';
import type { ModuleManifest } from '@cloud-org/shared';
import { normalizeMemberPhone } from './phone';
import { parseImportedDate } from './importDates';
import { addCalendarMonths } from '../../core/dates/membershipEndDate';
import { isValidEmail } from '../../core/validation/email';

const router = Router();

const frontendUrl = () => process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';

function generateQrToken(): string {
  return crypto.randomBytes(12).toString('base64url');
}

/** Display form: PREFIX-00001 or padded digits only when prefix is empty */
function formatMembershipNumber(
  prefix: string | null | undefined,
  padLength: number | null | undefined,
  seq: number | null | undefined
): string | null {
  if (seq == null) return null;
  const pad = Math.min(Math.max(padLength ?? 5, 1), 12);
  const num = String(seq).padStart(pad, '0');
  const p = (prefix ?? '').trim();
  if (!p) return num;
  return `${p}-${num}`;
}

async function assertMembershipTypeCapacity(orgId: string, membershipTypeId: string): Promise<void> {
  const type = await prisma.membershipType.findFirst({
    where: { id: membershipTypeId, orgId },
    select: { maxMemberships: true, name: true },
  });
  if (!type?.maxMemberships) return;
  const count = await prisma.memberMembership.count({
    where: {
      orgId,
      membershipTypeId,
      status: { in: ['active', 'pending'] },
    },
  });
  if (count >= type.maxMemberships) {
    throw new Error(`Maximum memberships (${type.maxMemberships}) reached for type "${type.name}"`);
  }
}

async function allocateMembershipSeq(tx: Prisma.TransactionClient, orgId: string): Promise<number> {
  const orgRow = await tx.organization.findUnique({
    where: { id: orgId },
    select: { membershipNumberNextSeq: true },
  });
  const seq = orgRow?.membershipNumberNextSeq ?? 1;
  await tx.organization.update({
    where: { id: orgId },
    data: { membershipNumberNextSeq: seq + 1 },
  });
  return seq;
}

async function resolveOrgCardDesignId(orgId: string, cardDesignId: unknown): Promise<string | null> {
  if (cardDesignId == null || cardDesignId === '') return null;
  if (typeof cardDesignId !== 'string') return null;
  const id = cardDesignId.trim();
  if (!id) return null;
  const row = await prisma.membershipCardDesign.findFirst({
    where: { id, orgId },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function notifyMembersOfPublishedAnnouncement(
  orgId: string,
  ann: {
    title: string;
    content: string;
    targetAudience: string;
    specificMembershipTypeId: string | null;
  }
): Promise<void> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, slug: true },
    });
    const base = frontendUrl().replace(/\/$/, '');
    const optionalUrl = org?.slug ? `${base}/membership/${org.slug}/account` : base;

    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const where: any = {
      orgId,
      status: 'active',
      endDate: { gt: now },
    };
    if (ann.targetAudience === 'specific_type' && ann.specificMembershipTypeId) {
      where.membershipTypeId = ann.specificMembershipTypeId;
    }
    if (ann.targetAudience === 'expiring_soon') {
      where.endDate = { gt: now, lte: in30 };
    }

    const rows = await prisma.memberMembership.findMany({
      where,
      select: { memberEmail: true },
    });

    const seen = new Set<string>();
    const recipients: string[] = [];
    for (const r of rows) {
      const raw = r.memberEmail?.trim();
      if (!raw) continue;
      const lower = raw.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      recipients.push(raw);
    }

    const { sendEmailQueued, emailTemplates } = await import('../../core/email');

    for (const to of recipients) {
      const tpl = emailTemplates.membershipAnnouncement(
        org?.name ?? 'Organization',
        ann.title,
        ann.content,
        optionalUrl
      );
      await sendEmailQueued({ to, subject: tpl.subject, html: tpl.html, priority: 'normal' });
    }
  } catch (e) {
    console.error('notifyMembersOfPublishedAnnouncement:', e);
  }
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
      path: '/membership/analytics',
      label: 'Analytics',
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
        cardDesign: { select: { id: true, name: true } },
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
        cardDesign: { select: { id: true, name: true } },
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

    const { name, description, priceCents, currency, durationMonths, benefits, features, isActive, maxMemberships, cardDesignId } = req.body;

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const descTrim = description != null ? String(description).trim() : '';
    if (!descTrim) {
      res.status(400).json({ error: 'Description is required' });
      return;
    }

    let benefitArr: string[] = [];
    if (Array.isArray(benefits)) {
      benefitArr = benefits.map((b: unknown) => String(b).trim()).filter(Boolean);
    } else if (typeof benefits === 'string') {
      benefitArr = benefits
        .split('\n')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    if (benefitArr.length === 0) {
      res.status(400).json({ error: 'At least one benefit is required' });
      return;
    }

    const dm = Number(durationMonths);
    if (!Number.isFinite(dm) || dm < 1) {
      res.status(400).json({ error: 'Duration must be at least 1 month' });
      return;
    }

    const designCount = await prisma.membershipCardDesign.count({
      where: { orgId: req.org.id },
    });

    const resolvedCardDesignId = await resolveOrgCardDesignId(req.org.id, cardDesignId);
    if (cardDesignId != null && cardDesignId !== '' && !resolvedCardDesignId) {
      res.status(400).json({ error: 'Card design not found' });
      return;
    }
    if (designCount > 0 && !resolvedCardDesignId) {
      res.status(400).json({ error: 'Card template is required' });
      return;
    }

    const type = await prisma.membershipType.create({
      data: {
        orgId: req.org.id,
        name: String(name).trim(),
        description: descTrim,
        priceCents: priceCents != null && priceCents !== '' ? Math.round(Number(priceCents) * 100) : 0,
        currency: currency != null && String(currency).trim() ? String(currency).trim() : 'SAR',
        durationMonths: dm,
        benefits: benefitArr,
        features: features || null,
        isActive: isActive !== undefined ? isActive : true,
        maxMemberships: maxMemberships || null,
        cardDesignId: resolvedCardDesignId,
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

    if (updateData.description !== undefined && !String(updateData.description).trim()) {
      res.status(400).json({ error: 'Description is required' });
      return;
    }
    if (updateData.benefits !== undefined) {
      const benefitArr = Array.isArray(updateData.benefits)
        ? updateData.benefits
        : String(updateData.benefits || '')
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean);
      if (benefitArr.length === 0) {
        res.status(400).json({ error: 'At least one benefit is required' });
        return;
      }
      updateData.benefits = benefitArr;
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'cardDesignId')) {
      const raw = updateData.cardDesignId;
      const resolved = await resolveOrgCardDesignId(req.org.id, raw);
      if (raw != null && raw !== '' && !resolved) {
        res.status(400).json({ error: 'Card design not found' });
        return;
      }
      updateData.cardDesignId = resolved;
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
    const { name, isDefault, layout, primaryColor, secondaryColor, accentColor, logoUrl, showQR, qrPosition, showMemberId, memberIdPrefix, customCss, fontFamily } = req.body;
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
        showMemberId: showMemberId !== false,
        memberIdPrefix: memberIdPrefix || null,
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
    const { name, isDefault, layout, primaryColor, secondaryColor, accentColor, logoUrl, showQR, qrPosition, showMemberId, memberIdPrefix, customCss, fontFamily } = req.body;
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
        ...(showMemberId !== undefined && { showMemberId }),
        ...(memberIdPrefix !== undefined && { memberIdPrefix }),
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
// MEMBERSHIP MODULE SETTINGS (org-wide numbers)
// ============================================

// GET /api/membership/settings
router.get('/settings', requirePermission('membership.members.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const org = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: {
        membershipNumberPrefix: true,
        membershipNumberPadLength: true,
        membershipNumberNextSeq: true,
      },
    });
    res.json(
      org ?? {
        membershipNumberPrefix: null,
        membershipNumberPadLength: 5,
        membershipNumberNextSeq: 1,
      }
    );
  } catch (error: any) {
    console.error('Error fetching membership settings:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/membership/settings
router.put('/settings', requirePermission('membership.types.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { membershipNumberPrefix, membershipNumberPadLength } = req.body;
    const padRaw = membershipNumberPadLength;
    const pad =
      padRaw !== undefined && padRaw !== null && padRaw !== ''
        ? Math.min(Math.max(parseInt(String(padRaw), 10) || 5, 1), 12)
        : undefined;

    const prefixData =
      membershipNumberPrefix !== undefined
        ? {
            membershipNumberPrefix:
              membershipNumberPrefix === null || String(membershipNumberPrefix).trim() === ''
                ? null
                : String(membershipNumberPrefix).trim(),
          }
        : {};

    const updated = await prisma.organization.update({
      where: { id: req.org.id },
      data: {
        ...prefixData,
        ...(pad !== undefined ? { membershipNumberPadLength: pad } : {}),
      },
      select: {
        membershipNumberPrefix: true,
        membershipNumberPadLength: true,
        membershipNumberNextSeq: true,
      },
    });
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating membership settings:', error);
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
      const q = search as string;
      const seqGuess = /^\d+$/.test(q.trim()) ? parseInt(q.trim(), 10) : NaN;
      where.OR = [
        { memberName: { contains: q, mode: 'insensitive' } },
        { memberEmail: { contains: q, mode: 'insensitive' } },
        { memberPhone: { contains: q, mode: 'insensitive' } },
      ];
      if (!Number.isNaN(seqGuess)) {
        where.OR.push({ membershipSeq: seqGuess });
      }
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

    const orgFmt = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: { membershipNumberPrefix: true, membershipNumberPadLength: true },
    });

    const data = memberships.map((m) => ({
      ...m,
      membershipNumber: formatMembershipNumber(
        orgFmt?.membershipNumberPrefix,
        orgFmt?.membershipNumberPadLength,
        m.membershipSeq
      ),
    }));

    res.json({ data, total, limit, offset: skip });
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
      const q = search as string;
      const seqGuess = /^\d+$/.test(q.trim()) ? parseInt(q.trim(), 10) : NaN;
      where.OR = [
        { memberName: { contains: q, mode: 'insensitive' } },
        { memberEmail: { contains: q, mode: 'insensitive' } },
        { memberPhone: { contains: q, mode: 'insensitive' } },
      ];
      if (!Number.isNaN(seqGuess)) {
        where.OR.push({ membershipSeq: seqGuess });
      }
    }

    const memberships = await prisma.memberMembership.findMany({
      where,
      include: {
        membershipType: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const exportOrgFmt = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: { membershipNumberPrefix: true, membershipNumberPadLength: true },
    });

    const delimParam = String(req.query.delimiter ?? '').toLowerCase();
    let delimiter = ',';
    if (delimParam === 'semicolon' || delimParam === ';' || delimParam === 'excel') delimiter = ';';
    else if (delimParam === 'tab') delimiter = '\t';

    const escape = (v: string | number | null | undefined) => {
      if (v == null) return '';
      const s = String(v);
      const needsQuote =
        /["\n\r]/.test(s) ||
        (delimiter === ',' && s.includes(',')) ||
        (delimiter === ';' && s.includes(';')) ||
        (delimiter === '\t' && s.includes('\t'));
      if (needsQuote) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    // Machine-readable headers first so exported files re-import reliably (incl. after Excel round-trip).
    const headers = [
      'membershipTypeId',
      'memberName',
      'memberEmail',
      'membershipNumber',
      'memberPhone',
      'memberAddress',
      'memberCity',
      'memberCountry',
      'startDate',
      'endDate',
      'paymentStatus',
      'status',
      'notes',
      'typeName',
    ];
    const rows = memberships.map((m) => [
      m.membershipType.id,
      m.memberName,
      m.memberEmail,
      formatMembershipNumber(
        exportOrgFmt?.membershipNumberPrefix,
        exportOrgFmt?.membershipNumberPadLength,
        m.membershipSeq
      ) ?? '',
      m.memberPhone ?? '',
      m.memberAddress ?? '',
      m.memberCity ?? '',
      m.memberCountry ?? '',
      m.startDate.toISOString().slice(0, 10),
      m.endDate.toISOString().slice(0, 10),
      m.paymentStatus ?? '',
      m.status,
      m.notes ?? '',
      m.membershipType.name,
    ]);

    const csvBody =
      headers.map(escape).join(delimiter) +
      '\n' +
      rows.map((row) => row.map(escape).join(delimiter)).join('\n');
    const csv = `\ufeff${csvBody}`;

    const filename =
      delimiter === ';' ? 'members-export-excel.csv' : delimiter === '\t' ? 'members-export.tsv' : 'members-export.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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

    const orgFmtOne = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: { membershipNumberPrefix: true, membershipNumberPadLength: true },
    });

    res.json({
      ...membership,
      membershipNumber: formatMembershipNumber(
        orgFmtOne?.membershipNumberPrefix,
        orgFmtOne?.membershipNumberPadLength,
        membership.membershipSeq
      ),
    });
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

    const {
      membershipTypeId,
      memberName,
      memberEmail,
      memberPhone,
      memberAddress,
      memberCity,
      memberCountry,
      startDate,
      endDate,
      paymentStatus,
      paymentAmount,
      paymentMethod,
      notes,
      cardDesignId,
    } = req.body;

    if (!membershipTypeId || !String(memberName || '').trim() || !String(memberEmail || '').trim()) {
      res.status(400).json({ error: 'Membership type, member name, and email are required' });
      return;
    }

    const emailTrim = String(memberEmail).trim();
    if (!isValidEmail(emailTrim)) {
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }

    const addrTrim = memberAddress != null ? String(memberAddress).trim() : '';
    const cityTrim = memberCity != null ? String(memberCity).trim() : '';
    if (!addrTrim) {
      res.status(400).json({ error: 'Address is required' });
      return;
    }
    if (!cityTrim) {
      res.status(400).json({ error: 'City is required' });
      return;
    }

    if (!startDate || String(startDate).trim() === '') {
      res.status(400).json({ error: 'Start date is required' });
      return;
    }

    const resolvedMemberCard = await resolveOrgCardDesignId(req.org.id, cardDesignId);
    if (cardDesignId != null && cardDesignId !== '' && !resolvedMemberCard) {
      res.status(400).json({ error: 'Card design not found' });
      return;
    }

    const phoneNorm = normalizeMemberPhone(memberPhone, memberCountry);
    if (memberPhone != null && String(memberPhone).trim() !== '' && phoneNorm.error) {
      res.status(400).json({ error: phoneNorm.error });
      return;
    }
    if (!phoneNorm.e164) {
      res.status(400).json({ error: 'Phone number is required' });
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

    try {
      await assertMembershipTypeCapacity(req.org.id, membershipTypeId);
    } catch (capErr: any) {
      res.status(400).json({ error: capErr.message || 'Membership type capacity reached' });
      return;
    }

    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      res.status(400).json({ error: 'Invalid start date' });
      return;
    }
    const end = endDate ? new Date(endDate) : addCalendarMonths(start, membershipType.durationMonths);

    const membership = await prisma.$transaction(
      async (tx) => {
        const seq = await allocateMembershipSeq(tx, req.org!.id);
        return tx.memberMembership.create({
          data: {
            orgId: req.org!.id,
            membershipTypeId,
            memberName: String(memberName).trim(),
            memberEmail: emailTrim,
            memberPhone: phoneNorm.e164,
            memberAddress: addrTrim,
            memberCity: cityTrim,
            memberCountry: memberCountry || null,
            startDate: start,
            endDate: end,
            paymentStatus: paymentStatus || 'paid',
            paymentAmount: paymentAmount ? Math.round(paymentAmount * 100) : null,
            paymentMethod: paymentMethod || null,
            notes: notes || null,
            createdById: req.user!.id,
            qrToken: generateQrToken(),
            cardDesignId: resolvedMemberCard,
            membershipSeq: seq,
          },
          include: {
            membershipType: true,
            cardDesign: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    const orgFmtCreate = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: { membershipNumberPrefix: true, membershipNumberPadLength: true },
    });

    res.status(201).json({
      ...membership,
      membershipNumber: formatMembershipNumber(
        orgFmtCreate?.membershipNumberPrefix,
        orgFmtCreate?.membershipNumberPadLength,
        membership.membershipSeq
      ),
    });
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
        if (key === 'cardDesignId' || key === 'membershipSeq' || key === 'membershipNumber') {
          return;
        }
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

    if (updateData.memberEmail !== undefined) {
      const emailTrim = String(updateData.memberEmail).trim();
      if (!emailTrim || !isValidEmail(emailTrim)) {
        res.status(400).json({ error: 'Invalid email address' });
        return;
      }
      updateData.memberEmail = emailTrim;
    }

    if (updateData.memberName !== undefined && !String(updateData.memberName).trim()) {
      res.status(400).json({ error: 'Member name is required' });
      return;
    }

    if (updateData.memberPhone !== undefined || updateData.memberAddress !== undefined) {
      const phoneVal =
        updateData.memberPhone !== undefined ? updateData.memberPhone : membership.memberPhone;
      if (phoneVal == null || String(phoneVal).trim() === '') {
        res.status(400).json({ error: 'Phone number is required' });
        return;
      }
      const addrVal =
        updateData.memberAddress !== undefined ? updateData.memberAddress : membership.memberAddress;
      if (addrVal == null || String(addrVal).trim() === '') {
        res.status(400).json({ error: 'Address is required' });
        return;
      }
      const cityVal = updateData.memberCity !== undefined ? updateData.memberCity : membership.memberCity;
      if (cityVal == null || String(cityVal).trim() === '') {
        res.status(400).json({ error: 'City is required' });
        return;
      }
    }

    const country =
      updateData.memberCountry !== undefined ? updateData.memberCountry : membership.memberCountry;
    const phoneTouched = Object.prototype.hasOwnProperty.call(updateData, 'memberPhone');
    const phoneVal = phoneTouched ? updateData.memberPhone : membership.memberPhone;

    if (phoneVal != null && String(phoneVal).trim() !== '') {
      const pn = normalizeMemberPhone(String(phoneVal), country);
      if (pn.error) {
        res.status(400).json({ error: pn.error });
        return;
      }
      updateData.memberPhone = pn.e164;
    } else if (phoneTouched) {
      updateData.memberPhone = null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'cardDesignId')) {
      const resolvedCard = await resolveOrgCardDesignId(req.org.id, req.body.cardDesignId);
      if (req.body.cardDesignId != null && req.body.cardDesignId !== '' && !resolvedCard) {
        res.status(400).json({ error: 'Card design not found' });
        return;
      }
      updateData.cardDesignId = resolvedCard;
    }

    const updated = await prisma.memberMembership.update({
      where: { id },
      data: updateData,
      include: {
        membershipType: true,
        cardDesign: true,
      },
    });

    const orgFmtUp = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: { membershipNumberPrefix: true, membershipNumberPadLength: true },
    });

    res.json({
      ...updated,
      membershipNumber: formatMembershipNumber(
        orgFmtUp?.membershipNumberPrefix,
        orgFmtUp?.membershipNumberPadLength,
        updated.membershipSeq
      ),
    });
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
        membershipType: {
          include: { cardDesign: true },
        },
        cardDesign: true,
        organization: {
          select: {
            name: true,
            slug: true,
            membershipNumberPrefix: true,
            membershipNumberPadLength: true,
          },
        },
      },
    });

    if (!membership) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }

    const membershipNumberDisplay = formatMembershipNumber(
      membership.organization.membershipNumberPrefix,
      membership.organization.membershipNumberPadLength,
      membership.membershipSeq
    );

    // Ensure QR token exists (for members created before this feature)
    let qrToken = membership.qrToken;
    if (!qrToken) {
      qrToken = generateQrToken();
      await prisma.memberMembership.update({
        where: { id: membership.id },
        data: { qrToken },
      });
    }

    let design =
      membership.membershipType.cardDesign ?? membership.cardDesign ?? null;
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
        memberPhone: membershipNumberDisplay ? null : membership.memberPhone,
        membershipSeq: membership.membershipSeq,
        membershipNumberDisplay,
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
            showMemberId: design.showMemberId,
            memberIdPrefix: design.memberIdPrefix,
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
            showMemberId: true,
            memberIdPrefix: null,
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

        const bulkPhone = normalizeMemberPhone(m.memberPhone, m.memberCountry);
        if (m.memberPhone != null && String(m.memberPhone).trim() !== '' && bulkPhone.error) {
          results.failed++;
          results.errors.push({ row: i + 1, error: bulkPhone.error });
          continue;
        }

        const typeKey = m.membershipTypeId || m.membershipType || m.typeName;
        if (!typeKey || String(typeKey).trim() === '') {
          results.failed++;
          results.errors.push({ row: i + 1, error: 'Membership type is required' });
          continue;
        }

        const typeStr = String(typeKey).trim();
        let membershipType = await prisma.membershipType.findFirst({
          where: { id: typeStr, orgId: req.org.id },
        });
        if (!membershipType) {
          membershipType = await prisma.membershipType.findFirst({
            where: { orgId: req.org.id, name: { equals: typeStr, mode: 'insensitive' } },
          });
        }
        if (!membershipType) {
          results.failed++;
          results.errors.push({ row: i + 1, error: 'Membership type not found (use id or exact type name)' });
          continue;
        }

        let start: Date | null = null;
        if (m.startDate != null && String(m.startDate).trim() !== '') {
          start = parseImportedDate(m.startDate);
          if (!start) {
            results.failed++;
            results.errors.push({ row: i + 1, error: 'Invalid start date (use YYYY-MM-DD or Excel date)' });
            continue;
          }
        }
        if (!start) start = new Date();

        let end: Date | null = null;
        if (m.endDate != null && String(m.endDate).trim() !== '') {
          end = parseImportedDate(m.endDate);
          if (!end) {
            results.failed++;
            results.errors.push({ row: i + 1, error: 'Invalid end date (use YYYY-MM-DD or Excel date)' });
            continue;
          }
        }
        if (!end) end = addCalendarMonths(start, membershipType.durationMonths);

        try {
          await assertMembershipTypeCapacity(req.org!.id, membershipType.id);
        } catch (capErr: any) {
          results.failed++;
          results.errors.push({ row: i + 1, error: capErr.message || 'Capacity reached' });
          continue;
        }

        const bulkEmail = String(m.memberEmail).trim();
        if (!isValidEmail(bulkEmail)) {
          results.failed++;
          results.errors.push({ row: i + 1, error: 'Invalid email address' });
          continue;
        }

        await prisma.$transaction(
          async (tx) => {
            const seq = await allocateMembershipSeq(tx, req.org!.id);
            await tx.memberMembership.create({
              data: {
                orgId: req.org!.id,
                membershipTypeId: membershipType.id,
                memberName: m.memberName,
                memberEmail: m.memberEmail,
                memberPhone: bulkPhone.e164,
                memberAddress: m.memberAddress || null,
                memberCity: m.memberCity || null,
                memberCountry: m.memberCountry || null,
                startDate: start,
                endDate: end,
                paymentStatus: m.paymentStatus || 'paid',
                paymentAmount: m.paymentAmount != null ? Math.round(Number(m.paymentAmount) * 100) : null,
                paymentMethod: m.paymentMethod || null,
                notes: m.notes || null,
                createdById: req.user!.id,
                qrToken: generateQrToken(),
                cardDesignId: null,
                membershipSeq: seq,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
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

// GET /api/membership/analytics — revenue by type, churn, renewals over time
router.get('/analytics', requirePermission('membership.members.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const orgId = req.org.id;
    const now = new Date();
    const monthsBack = 12;
    const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

    const members = await prisma.memberMembership.findMany({
      where: { orgId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        paymentAmount: true,
        membershipTypeId: true,
        membershipType: { select: { id: true, name: true, priceCents: true, currency: true } },
        startDate: true,
        endDate: true,
        renewedAt: true,
        createdAt: true,
      },
    });

    const revenueByType = new Map<
      string,
      { typeId: string; typeName: string; currency: string; revenueCents: number; activeCount: number }
    >();

    for (const m of members) {
      const key = m.membershipTypeId;
      const row = revenueByType.get(key) ?? {
        typeId: key,
        typeName: m.membershipType.name,
        currency: m.membershipType.currency || 'SAR',
        revenueCents: 0,
        activeCount: 0,
      };
      if (m.paymentStatus === 'paid' && m.paymentAmount) {
        row.revenueCents += m.paymentAmount;
      }
      if (m.status === 'active' && m.endDate >= now) row.activeCount++;
      revenueByType.set(key, row);
    }

    const totalActive = members.filter((m) => m.status === 'active' && m.endDate >= now).length;
    const totalExpired = members.filter((m) => m.status === 'expired').length;
    const totalCancelled = members.filter((m) => m.status === 'cancelled').length;
    const churnRate =
      totalActive + totalExpired > 0 ? totalExpired / (totalActive + totalExpired) : 0;

    const renewalsByMonth: { month: string; count: number }[] = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const count = members.filter(
        (m) => m.renewedAt && m.renewedAt >= d && m.renewedAt < next
      ).length;
      renewalsByMonth.push({ month: label, count });
    }

    const signupsByMonth: { month: string; count: number }[] = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const count = members.filter((m) => m.createdAt >= d && m.createdAt < next).length;
      signupsByMonth.push({ month: label, count });
    }

    res.json({
      summary: {
        totalMembers: members.length,
        active: totalActive,
        expired: totalExpired,
        cancelled: totalCancelled,
        churnRate: Math.round(churnRate * 1000) / 1000,
        totalRevenueCents: members
          .filter((m) => m.paymentStatus === 'paid' && m.paymentAmount)
          .reduce((s, m) => s + (m.paymentAmount ?? 0), 0),
      },
      revenueByType: Array.from(revenueByType.values()).sort((a, b) => b.revenueCents - a.revenueCents),
      renewalsByMonth,
      signupsByMonth,
      periodStart: start,
    });
  } catch (error: unknown) {
    console.error('Error fetching membership analytics:', error);
    const msg = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: msg });
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
        const days = Math.ceil(
          (membership.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
        );
        const or: any[] = [
          { targetAudience: 'all' },
          { specificMembershipTypeId: membership.membershipTypeId },
        ];
        if (membership.status === 'active' && days > 0 && days <= 30) {
          or.push({ targetAudience: 'expiring_soon' });
        }
        where.OR = or;
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

    if (announcement.isPublished) {
      void notifyMembersOfPublishedAnnouncement(req.org.id, {
        title: announcement.title,
        content: announcement.content,
        targetAudience: announcement.targetAudience,
        specificMembershipTypeId: announcement.specificMembershipTypeId,
      });
    }

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

    const wasPublished = announcement.isPublished;

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

    if (updated.isPublished && !wasPublished) {
      void notifyMembersOfPublishedAnnouncement(req.org.id, {
        title: updated.title,
        content: updated.content,
        targetAudience: updated.targetAudience,
        specificMembershipTypeId: updated.specificMembershipTypeId,
      });
    }

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

    const { status, memberEmail, assignedToId, unassignedOnly } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) where.status = status;
    if (memberEmail) {
      where.memberEmail = { contains: memberEmail as string, mode: 'insensitive' };
    }
    if (unassignedOnly === 'true') {
      where.assignedToId = null;
    } else if (assignedToId) {
      where.assignedToId = assignedToId as string;
    }

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

// GET /api/membership/conversations/assignees — org staff for assignment (before :id route)
router.get('/conversations/assignees', requirePermission('membership.messages.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rows = await prisma.membership.findMany({
      where: { organizationId: req.org.id, isActive: true },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const users = rows.map((r) => r.user).filter(Boolean);
    res.json(users);
  } catch (error: any) {
    console.error('Error fetching assignees:', error);
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

// POST /api/membership/conversations/from-admin — start or continue an open thread with a member
router.post(
  '/conversations/from-admin',
  requirePermission('membership.messages.create'),
  async (req: Request, res: Response) => {
    try {
      if (!req.org || !req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { memberMembershipId, subject, message } = req.body as {
        memberMembershipId?: string;
        subject?: string | null;
        message?: string | null;
      };

      if (!memberMembershipId) {
        res.status(400).json({ error: 'memberMembershipId is required' });
        return;
      }

      const mm = await prisma.memberMembership.findFirst({
        where: { id: memberMembershipId, orgId: req.org.id },
      });

      if (!mm) {
        res.status(404).json({ error: 'Member membership not found' });
        return;
      }

      let conversation = await prisma.conversation.findFirst({
        where: {
          orgId: req.org.id,
          memberMembershipId: mm.id,
          status: 'open',
        },
        orderBy: { lastMessageAt: 'desc' },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            orgId: req.org.id,
            memberMembershipId: mm.id,
            memberEmail: mm.memberEmail,
            memberName: mm.memberName,
            subject: subject?.trim() || null,
            lastMessageAt: new Date(),
          },
        });
      } else if (subject?.trim() && !conversation.subject) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { subject: subject.trim() },
        });
      }

      const adminName = (req.user as { name?: string | null }).name || req.user.email;

      if (message?.trim()) {
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderEmail: req.user.email,
            senderName: adminName,
            senderType: 'admin',
            content: message.trim(),
          },
        });
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });
      }

      const full = await prisma.conversation.findFirst({
        where: { id: conversation.id, orgId: req.org.id },
        include: {
          memberMembership: {
            include: { membershipType: true },
          },
          assignedTo: {
            select: { id: true, name: true, email: true },
          },
          messages: {
            orderBy: { createdAt: 'asc' },
          },
          _count: { select: { messages: true } },
        },
      });

      res.status(201).json(full);
    } catch (error: any) {
      console.error('Error creating admin conversation:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

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

    const allowed = new Set(['open', 'closed', 'archived']);
    if (typeof status !== 'string' || !allowed.has(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

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

// PUT /api/membership/conversations/:id/mark-read — mark all member messages in thread as read
router.put('/conversations/:id/mark-read', requirePermission('membership.messages.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    await prisma.message.updateMany({
      where: {
        conversationId: id,
        senderType: 'member',
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    res.json({ ok: true });
  } catch (error: any) {
    console.error('Error marking conversation read:', error);
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

    const existing = await prisma.message.findFirst({
      where: { id },
      include: {
        conversation: { select: { orgId: true } },
      },
    });

    if (!existing || existing.conversation.orgId !== req.org.id) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

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










