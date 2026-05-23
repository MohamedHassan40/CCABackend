import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../core/db';
import { publicTicketRateLimiter } from '../middleware/security';
import { addCalendarMonths } from '../core/dates/membershipEndDate';
import { isValidEmail } from '../core/validation/email';
import { normalizeMemberPhone } from '../modules/membership/phone';
import { getInvoiceCheckoutUrl, moyasarService } from '../core/payments/moyasar';

const router = Router();

function frontendUrl(): string {
  const base = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';
  return base.replace(/\/$/, '');
}

function apiBaseUrl(): string {
  const base = process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'http://localhost:3001';
  const withProto = base.startsWith('http') ? base : `https://${base}`;
  return withProto.replace(/\/$/, '');
}

function generateQrToken(): string {
  return crypto.randomBytes(12).toString('base64url');
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
    throw new Error(`Maximum memberships (${type.maxMemberships}) reached for "${type.name}"`);
  }
}

async function resolveOrgAndModule(orgSlug: string) {
  const org = await prisma.organization.findUnique({
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
  if (!org || !org.isActive || org.status !== 'active') {
    return null;
  }

  const membershipModule = await prisma.module.findUnique({ where: { key: 'membership' } });
  if (!membershipModule) return null;

  const orgModule = await prisma.orgModule.findUnique({
    where: {
      organizationId_moduleId: {
        organizationId: org.id,
        moduleId: membershipModule.id,
      },
    },
  });
  if (!orgModule?.isEnabled) return null;

  return org;
}

async function getOrgCreatorUserId(orgId: string): Promise<string> {
  const membership = await prisma.membership.findFirst({
    where: { organizationId: orgId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  if (!membership) {
    throw new Error('Organization is not configured for public registration');
  }
  return membership.userId;
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

// GET /api/public/membership/:orgSlug — portal info + active membership types
router.get('/:orgSlug', async (req: Request, res: Response) => {
  try {
    const org = await resolveOrgAndModule(req.params.orgSlug);
    if (!org) {
      res.status(404).json({ error: 'Membership portal not found' });
      return;
    }

    const types = await prisma.membershipType.findMany({
      where: { orgId: org.id, isActive: true },
      orderBy: { priceCents: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        priceCents: true,
        currency: true,
        durationMonths: true,
        benefits: true,
        maxMemberships: true,
      },
    });

    const moyasarConfigured = !!process.env.MOYASAR_SECRET_KEY;

    res.json({
      organization: { id: org.id, name: org.name, slug: org.slug },
      types,
      moyasarConfigured,
    });
  } catch (error) {
    console.error('GET public membership portal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/public/membership/:orgSlug/register
router.post('/:orgSlug/register', publicTicketRateLimiter, async (req: Request, res: Response) => {
  try {
    const org = await resolveOrgAndModule(req.params.orgSlug);
    if (!org) {
      res.status(404).json({ error: 'Membership portal not found' });
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
    } = req.body;

    if (!membershipTypeId || !String(memberName || '').trim() || !String(memberEmail || '').trim()) {
      res.status(400).json({ error: 'Membership type, name, and email are required' });
      return;
    }

    const emailTrim = String(memberEmail).trim();
    if (!isValidEmail(emailTrim)) {
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }

    const addrTrim = memberAddress != null ? String(memberAddress).trim() : '';
    const cityTrim = memberCity != null ? String(memberCity).trim() : '';
    if (!addrTrim || !cityTrim) {
      res.status(400).json({ error: 'Address and city are required' });
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

    const membershipType = await prisma.membershipType.findFirst({
      where: { id: membershipTypeId, orgId: org.id, isActive: true },
    });
    if (!membershipType) {
      res.status(404).json({ error: 'Membership type not found' });
      return;
    }

    try {
      await assertMembershipTypeCapacity(org.id, membershipTypeId);
    } catch (capErr: unknown) {
      const msg = capErr instanceof Error ? capErr.message : 'Capacity reached';
      res.status(400).json({ error: msg });
      return;
    }

    const createdById = await getOrgCreatorUserId(org.id);
    const cardDesignId = await resolveOrgCardDesignId(org.id, membershipType.cardDesignId);
    const start = new Date();
    const end = addCalendarMonths(start, membershipType.durationMonths);
    const isPaid = membershipType.priceCents > 0;

    const membership = await prisma.$transaction(async (tx) => {
      const seq = await allocateMembershipSeq(tx, org.id);
      return tx.memberMembership.create({
        data: {
          orgId: org.id,
          membershipTypeId,
          memberName: String(memberName).trim(),
          memberEmail: emailTrim,
          memberPhone: phoneNorm.e164,
          memberAddress: addrTrim,
          memberCity: cityTrim,
          memberCountry: memberCountry || null,
          startDate: start,
          endDate: end,
          status: isPaid ? 'pending' : 'active',
          paymentStatus: isPaid ? 'pending' : 'paid',
          paymentAmount: isPaid ? null : membershipType.priceCents,
          paymentMethod: isPaid ? null : 'free',
          notes: '[Public registration]',
          createdById,
          qrToken: generateQrToken(),
          cardDesignId,
          membershipSeq: seq,
        },
        include: { membershipType: { select: { name: true, priceCents: true, currency: true } } },
      });
    });

    const membershipNumber = formatMembershipNumber(
      org.membershipNumberPrefix,
      org.membershipNumberPadLength,
      membership.membershipSeq
    );

    res.status(201).json({
      id: membership.id,
      membershipNumber: membershipNumber ?? membership.id,
      memberName: membership.memberName,
      memberEmail: membership.memberEmail,
      status: membership.status,
      paymentStatus: membership.paymentStatus,
      membershipTypeName: membership.membershipType.name,
      priceCents: membership.membershipType.priceCents,
      currency: membership.membershipType.currency,
      requiresPayment: isPaid,
      message: isPaid
        ? 'Registration received. Complete payment to activate your membership.'
        : 'Your membership is active.',
    });
  } catch (error) {
    console.error('POST public membership register:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/public/membership/:orgSlug/payment — start Moyasar checkout
router.post('/:orgSlug/payment', publicTicketRateLimiter, async (req: Request, res: Response) => {
  try {
    const org = await resolveOrgAndModule(req.params.orgSlug);
    if (!org) {
      res.status(404).json({ error: 'Membership portal not found' });
      return;
    }

    const { membershipId, email } = req.body;
    if (!membershipId || !email) {
      res.status(400).json({ error: 'membershipId and email are required' });
      return;
    }

    if (!process.env.MOYASAR_SECRET_KEY) {
      res.status(503).json({
        error: 'Online payment is not configured. Please contact the organization.',
      });
      return;
    }

    const membership = await prisma.memberMembership.findFirst({
      where: { id: String(membershipId), orgId: org.id },
      include: { membershipType: true },
    });

    if (!membership) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }

    if (membership.memberEmail.toLowerCase() !== String(email).trim().toLowerCase()) {
      res.status(403).json({ error: 'Email does not match this membership' });
      return;
    }

    if (membership.paymentStatus === 'paid' && membership.status === 'active') {
      res.status(400).json({ error: 'This membership is already paid and active' });
      return;
    }

    const amount = membership.membershipType.priceCents;
    if (amount <= 0) {
      res.status(400).json({ error: 'No payment required for this membership' });
      return;
    }

    const fe = frontendUrl();
    const api = apiBaseUrl();
    const slug = org.slug!;
    const trackQs = new URLSearchParams({
      membershipId: membership.id,
      email: membership.memberEmail,
    });

    const invoice = await moyasarService.createInvoice({
      amount,
      currency: membership.membershipType.currency || 'SAR',
      description: `Membership: ${membership.membershipType.name} — ${membership.memberName}`,
      metadata: {
        type: 'member_membership',
        memberMembershipId: membership.id,
        organizationId: org.id,
        organizationSlug: slug,
      },
      success_url: `${fe}/membership/${slug}/track?${trackQs.toString()}&payment=success`,
      back_url: `${fe}/membership/${slug}/pay?membershipId=${membership.id}&email=${encodeURIComponent(membership.memberEmail)}`,
      callback_url: `${api}/api/public/membership/payment-callback`,
      expired_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });

    const checkoutUrl = getInvoiceCheckoutUrl(invoice);
    if (!checkoutUrl) {
      res.status(502).json({ error: 'Payment provider did not return a checkout URL' });
      return;
    }

    res.json({
      invoiceUrl: checkoutUrl,
      invoiceId: invoice.id,
      amountCents: amount,
      currency: membership.membershipType.currency,
    });
  } catch (error) {
    console.error('POST public membership payment:', error);
    const msg = error instanceof Error ? error.message : 'Could not start payment';
    res.status(502).json({ error: msg });
  }
});

// GET /api/public/membership/:orgSlug/track?membershipId=&email=
router.get('/:orgSlug/track', async (req: Request, res: Response) => {
  try {
    const org = await resolveOrgAndModule(req.params.orgSlug);
    if (!org) {
      res.status(404).json({ error: 'Membership portal not found' });
      return;
    }

    const membershipId = String(req.query.membershipId || '').trim();
    const email = String(req.query.email || '').trim();
    if (!membershipId || !email) {
      res.status(400).json({ error: 'membershipId and email are required' });
      return;
    }

    const membership = await prisma.memberMembership.findFirst({
      where: {
        orgId: org.id,
        OR: [{ id: membershipId }, { membershipSeq: parseInt(membershipId, 10) || -1 }],
      },
      include: {
        membershipType: { select: { name: true, priceCents: true, currency: true, durationMonths: true } },
      },
    });

    if (!membership) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }

    if (membership.memberEmail.toLowerCase() !== email.toLowerCase()) {
      res.status(403).json({ error: 'Email does not match this membership' });
      return;
    }

    const membershipNumber = formatMembershipNumber(
      org.membershipNumberPrefix,
      org.membershipNumberPadLength,
      membership.membershipSeq
    );

    const now = new Date();
    const isActive = membership.status === 'active' && membership.endDate >= now;

    res.json({
      id: membership.id,
      membershipNumber: membershipNumber ?? membership.id,
      memberName: membership.memberName,
      memberEmail: membership.memberEmail,
      status: membership.status,
      paymentStatus: membership.paymentStatus,
      startDate: membership.startDate,
      endDate: membership.endDate,
      isActive,
      membershipType: membership.membershipType,
      requiresPayment:
        membership.paymentStatus === 'pending' && membership.membershipType.priceCents > 0,
      priceCents: membership.membershipType.priceCents,
      currency: membership.membershipType.currency,
    });
  } catch (error) {
    console.error('GET public membership track:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
