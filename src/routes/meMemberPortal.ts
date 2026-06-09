import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';
import { addCalendarMonths } from '../core/dates/membershipEndDate';
import { findMemberRecordForUser, linkMemberRecordToUser } from '../core/membership/memberAccounts';
import { getInvoiceCheckoutUrl, moyasarService } from '../core/payments/moyasar';
import { appendPendingMoyasarInvoiceNote } from '../core/payments/moyasar-invoice-resolve';
import {
  enrichMoyasarInvoiceCreateData,
  withPaymentRedirectFlag,
} from '../core/payments/moyasar-checkout';
import {
  buildMembershipVerifyUrl,
  ensureMembershipQrToken,
  isMembershipActiveForVerification,
} from '../core/membership/qrVerify';

const router = Router();

function frontendUrl(): string {
  return (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function apiBaseUrl(): string {
  const base = process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'http://localhost:3001';
  const withProto = base.startsWith('http') ? base : `https://${base}`;
  return withProto.replace(/\/$/, '');
}

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

async function resolveOrgBySlug(orgSlug: string) {
  return prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      status: true,
      membershipNumberPrefix: true,
      membershipNumberPadLength: true,
    },
  });
}

async function requireMemberAccess(req: Request, res: Response, orgSlug: string) {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const org = await resolveOrgBySlug(orgSlug);
  if (!org || !org.isActive || org.status !== 'active') {
    res.status(404).json({ error: 'Organization not found' });
    return null;
  }
  const record = await findMemberRecordForUser(org.id, req.user.id, req.user.email);
  if (!record) {
    res.status(404).json({ error: 'No membership linked to your account' });
    return null;
  }
  if (!record.userId) {
    await linkMemberRecordToUser(record.id, req.user.id);
  }
  return { org, record };
}

async function buildCardPayload(org: NonNullable<Awaited<ReturnType<typeof resolveOrgBySlug>>>, membership: any) {
  const qrToken = await ensureMembershipQrToken(membership.id);

  let design =
    membership.membershipType?.cardDesign ?? membership.cardDesign ?? null;
  if (!design) {
    design = await prisma.membershipCardDesign.findFirst({
      where: { orgId: org.id, isDefault: true },
    });
  }
  if (!design) {
    design = await prisma.membershipCardDesign.findFirst({ where: { orgId: org.id } });
  }

  const membershipNumberDisplay = formatMembershipNumber(
    org.membershipNumberPrefix,
    org.membershipNumberPadLength,
    membership.membershipSeq
  );

  const now = new Date();
  const daysUntilExpiry = Math.ceil(
    (membership.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
  );

  return {
    membership: {
      id: membership.id,
      memberName: membership.memberName,
      memberEmail: membership.memberEmail,
      membershipNumberDisplay,
      status: membership.status,
      paymentStatus: membership.paymentStatus,
      startDate: membership.startDate,
      endDate: membership.endDate,
      isActive: isMembershipActiveForVerification(membership),
      daysUntilExpiry,
      canRenew:
        membership.status === 'expired' ||
        membership.status === 'active' ||
        (membership.status === 'pending' && membership.paymentStatus === 'paid'),
      qrToken,
      membershipType: membership.membershipType,
      organization: { name: org.name, slug: org.slug },
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
          fontFamily: design.fontFamily,
          fontColor: design.fontColor,
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
          fontFamily: 'sans-serif',
          fontColor: '#ffffff',
        },
    verifyUrl: buildMembershipVerifyUrl(qrToken),
  };
}

// GET /api/me/member-portal/orgs — orgs where this user has a member record
router.get('/member-portal/orgs', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const email = req.user.email.trim().toLowerCase();
    const rows = await prisma.memberMembership.findMany({
      where: {
        OR: [
          { userId: req.user.id },
          { memberEmail: { equals: email, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        status: true,
        endDate: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { endDate: 'desc' },
    });
    const bySlug = new Map<string, (typeof rows)[0]>();
    for (const r of rows) {
      const slug = r.organization.slug;
      if (slug && !bySlug.has(slug)) bySlug.set(slug, r);
    }
    res.json(
      Array.from(bySlug.values()).map((r) => ({
        orgId: r.organization.id,
        orgSlug: r.organization.slug,
        orgName: r.organization.name,
        membershipId: r.id,
        status: r.status,
        endDate: r.endDate,
      }))
    );
  } catch (error) {
    console.error('GET /api/me/member-portal/orgs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/me/member-portal/:orgSlug/workspace
router.get('/member-portal/:orgSlug/workspace', authMiddleware, async (req: Request, res: Response) => {
  try {
    const ctx = await requireMemberAccess(req, res, req.params.orgSlug);
    if (!ctx) return;
    const { org, record } = ctx;
    const now = new Date();
    const membershipNumber = formatMembershipNumber(
      org.membershipNumberPrefix,
      org.membershipNumberPadLength,
      record.membershipSeq
    );

    const announcements = await prisma.announcement.findMany({
      where: {
        orgId: org.id,
        isPublished: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        AND: {
          OR: [
            { targetAudience: 'all' },
            { targetAudience: 'expiring_soon' },
            { specificMembershipTypeId: record.membershipTypeId },
          ],
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        content: true,
        type: true,
        priority: true,
        publishedAt: true,
        targetAudience: true,
      },
    });

    const filteredAnnouncements = announcements.filter((a) => {
      if (a.targetAudience !== 'expiring_soon') return true;
      const days = Math.ceil((record.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      return record.status === 'active' && days > 0 && days <= 30;
    });

    res.json({
      organization: { name: org.name, slug: org.slug },
      membership: {
        id: record.id,
        membershipNumber: membershipNumber ?? record.id,
        memberName: record.memberName,
        memberEmail: record.memberEmail,
        status: record.status,
        paymentStatus: record.paymentStatus,
        startDate: record.startDate,
        endDate: record.endDate,
        isActive: record.status === 'active' && record.endDate >= now,
        daysUntilExpiry: Math.ceil((record.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
        membershipType: record.membershipType,
        requiresPayment:
          record.paymentStatus === 'pending' && (record.membershipType?.priceCents ?? 0) > 0,
        paymentFailed: record.paymentStatus === 'failed',
      },
      announcements: filteredAnnouncements,
    });
  } catch (error) {
    console.error('GET member-portal workspace:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/me/member-portal/:orgSlug/card
router.get('/member-portal/:orgSlug/card', authMiddleware, async (req: Request, res: Response) => {
  try {
    const ctx = await requireMemberAccess(req, res, req.params.orgSlug);
    if (!ctx) return;
    const full = await prisma.memberMembership.findUnique({
      where: { id: ctx.record.id },
      include: {
        membershipType: { include: { cardDesign: true } },
        cardDesign: true,
      },
    });
    if (!full) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }
    res.json(await buildCardPayload(ctx.org, full));
  } catch (error) {
    console.error('GET member-portal card:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/me/member-portal/:orgSlug/card/qr
router.get('/member-portal/:orgSlug/card/qr', authMiddleware, async (req: Request, res: Response) => {
  try {
    const ctx = await requireMemberAccess(req, res, req.params.orgSlug);
    if (!ctx) return;
    const qrToken = await ensureMembershipQrToken(ctx.record.id);
    const verifyUrl = buildMembershipVerifyUrl(qrToken);
    const pngBuffer = await QRCode.toBuffer(verifyUrl, { type: 'png', width: 256, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (error: unknown) {
    console.error('GET member-portal card/qr:', error);
    const msg = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: msg });
  }
});

// GET /api/me/member-portal/:orgSlug/announcements
router.get('/member-portal/:orgSlug/announcements', authMiddleware, async (req: Request, res: Response) => {
  try {
    const ctx = await requireMemberAccess(req, res, req.params.orgSlug);
    if (!ctx) return;
    const now = new Date();
    const rows = await prisma.announcement.findMany({
      where: {
        orgId: ctx.org.id,
        isPublished: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        title: true,
        content: true,
        type: true,
        priority: true,
        publishedAt: true,
        targetAudience: true,
        specificMembershipTypeId: true,
      },
    });

    const filtered = rows.filter((a) => {
      if (a.targetAudience === 'all') return true;
      if (a.targetAudience === 'specific_type') {
        return a.specificMembershipTypeId === ctx.record.membershipTypeId;
      }
      if (a.targetAudience === 'expiring_soon') {
        const days = Math.ceil((ctx.record.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        return ctx.record.status === 'active' && days > 0 && days <= 30;
      }
      return false;
    });

    res.json(filtered);
  } catch (error) {
    console.error('GET member-portal announcements:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/me/member-portal/:orgSlug/renew/payment
router.post('/member-portal/:orgSlug/renew/payment', authMiddleware, async (req: Request, res: Response) => {
  try {
    const ctx = await requireMemberAccess(req, res, req.params.orgSlug);
    if (!ctx) return;

    if (!process.env.MOYASAR_SECRET_KEY) {
      res.status(503).json({ error: 'Online payment is not configured' });
      return;
    }

    const membership = await prisma.memberMembership.findUnique({
      where: { id: ctx.record.id },
      include: { membershipType: true },
    });
    if (!membership) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }

    const amount = membership.membershipType.priceCents;
    if (amount <= 0) {
      const now = new Date();
      const base = membership.endDate > now ? membership.endDate : now;
      const newEnd = addCalendarMonths(base, membership.membershipType.durationMonths);
      await prisma.memberMembership.update({
        where: { id: membership.id },
        data: {
          status: 'active',
          paymentStatus: 'paid',
          endDate: newEnd,
          renewedAt: now,
        },
      });
      res.json({ renewed: true, endDate: newEnd });
      return;
    }

    const fe = frontendUrl();
    const api = apiBaseUrl();
    const slug = ctx.org.slug!;
    const portalQs = new URLSearchParams({ renewed: '1' });

    const invoice = await moyasarService.createInvoice(
      enrichMoyasarInvoiceCreateData({
        amount,
        currency: membership.membershipType.currency || 'SAR',
        description: `Renewal: ${membership.membershipType.name} — ${membership.memberName}`,
        metadata: {
          type: 'member_membership',
          memberMembershipId: membership.id,
          organizationId: ctx.org.id,
          organizationSlug: slug,
          action: 'renew',
        },
        success_url: withPaymentRedirectFlag(
          `${fe}/membership/${slug}/account?${portalQs.toString()}`,
          'success'
        ),
        back_url: withPaymentRedirectFlag(`${fe}/membership/${slug}/account`, 'cancelled'),
        callback_url: `${api}/api/public/membership/payment-callback`,
        expired_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      })
    );

    const checkoutUrl = getInvoiceCheckoutUrl(invoice);
    if (!checkoutUrl) {
      res.status(502).json({ error: 'Payment provider did not return a checkout URL' });
      return;
    }

    await prisma.memberMembership.update({
      where: { id: membership.id },
      data: {
        paymentStatus: 'pending',
        notes: appendPendingMoyasarInvoiceNote(membership.notes, invoice.id),
      },
    });

    res.json({
      invoiceUrl: checkoutUrl,
      invoiceId: invoice.id,
      amountCents: amount,
      currency: membership.membershipType.currency,
    });
  } catch (error) {
    console.error('POST member-portal renew/payment:', error);
    const msg = error instanceof Error ? error.message : 'Could not start payment';
    res.status(502).json({ error: msg });
  }
});

// GET /api/me/member-portal/:orgSlug/conversations — member's message threads
router.get('/member-portal/:orgSlug/conversations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const orgSlug = String(req.params.orgSlug);
    const access = await requireMemberAccess(req, res, orgSlug);
    if (!access) return;

    const conversations = await prisma.conversation.findMany({
      where: {
        orgId: access.org.id,
        memberMembershipId: access.record.id,
      },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: true } },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    res.json(conversations);
  } catch (error) {
    console.error('GET member-portal conversations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/me/member-portal/:orgSlug/conversations/:id
router.get('/member-portal/:orgSlug/conversations/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const orgSlug = String(req.params.orgSlug);
    const access = await requireMemberAccess(req, res, orgSlug);
    if (!access) return;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        orgId: access.org.id,
        memberMembershipId: access.record.id,
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json(conversation);
  } catch (error) {
    console.error('GET member-portal conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/me/member-portal/:orgSlug/conversations — start a new thread
router.post('/member-portal/:orgSlug/conversations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const orgSlug = String(req.params.orgSlug);
    const access = await requireMemberAccess(req, res, orgSlug);
    if (!access) return;

    const { subject, message } = req.body as { subject?: string; message?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const membership = access.record;
    if (membership.status !== 'active' || membership.endDate <= new Date()) {
      res.status(403).json({ error: 'Active membership required to send messages' });
      return;
    }

    const conversation = await prisma.conversation.create({
      data: {
        orgId: access.org.id,
        memberMembershipId: membership.id,
        memberEmail: membership.memberEmail,
        memberName: membership.memberName,
        subject: subject?.trim() || null,
        lastMessageAt: new Date(),
      },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderEmail: membership.memberEmail,
        senderName: membership.memberName,
        senderType: 'member',
        content: message.trim(),
      },
    });

    const full = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    res.status(201).json(full);
  } catch (error) {
    console.error('POST member-portal conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/me/member-portal/:orgSlug/conversations/:id/messages
router.post('/member-portal/:orgSlug/conversations/:id/messages', authMiddleware, async (req: Request, res: Response) => {
  try {
    const orgSlug = String(req.params.orgSlug);
    const access = await requireMemberAccess(req, res, orgSlug);
    if (!access) return;

    const { content } = req.body as { content?: string };
    if (!content?.trim()) {
      res.status(400).json({ error: 'Message content is required' });
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        orgId: access.org.id,
        memberMembershipId: access.record.id,
      },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    if (conversation.status === 'closed' || conversation.status === 'archived') {
      res.status(400).json({ error: 'This conversation is closed' });
      return;
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderEmail: access.record.memberEmail,
        senderName: access.record.memberName,
        senderType: 'member',
        content: content.trim(),
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), status: 'open' },
    });

    res.status(201).json(message);
  } catch (error) {
    console.error('POST member-portal message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
