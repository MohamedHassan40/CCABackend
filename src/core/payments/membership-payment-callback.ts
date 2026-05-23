import type { Request, Response } from 'express';
import type { MoyasarInvoice } from './moyasar';
import prisma from '../db';
import { addCalendarMonths } from '../dates/membershipEndDate';
import { sendMembershipPaymentConfirmedEmail } from '../membership/memberEmails';
import { recordWebhookMetric } from '../monitoring/opsMetrics';

function mergeMetadata(body: Record<string, unknown>, invoice: MoyasarInvoice): Record<string, unknown> {
  const fromInvoice =
    invoice.metadata && typeof invoice.metadata === 'object' && !Array.isArray(invoice.metadata)
      ? invoice.metadata
      : {};
  const fromBody =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};
  return { ...fromInvoice, ...fromBody };
}

export type ActivateMembershipPaymentResult =
  | { ok: true; membershipId: string }
  | { ok: false; error: string };

export async function activateMembershipFromPaidMoyasarInvoice(
  invoice: MoyasarInvoice,
  webhookBody: Record<string, unknown> = {}
): Promise<ActivateMembershipPaymentResult> {
  const metadata = mergeMetadata(webhookBody, invoice);
  if (metadata.type !== 'member_membership') {
    return { ok: false, error: 'Not a membership payment' };
  }

  const memberMembershipId = metadata.memberMembershipId as string | undefined;
  if (!memberMembershipId) {
    return { ok: false, error: 'Missing memberMembershipId in payment metadata' };
  }

  const membership = await prisma.memberMembership.findUnique({
    where: { id: memberMembershipId },
    include: { membershipType: true, organization: { select: { name: true, slug: true } } },
  });

  if (!membership) {
    return { ok: false, error: 'Membership record not found' };
  }

  const action = metadata.action as string | undefined;
  const now = new Date();
  const paidNote = `[Paid via Moyasar invoice ${invoice.id}]`;

  if (action === 'renew') {
    const base = membership.endDate > now ? membership.endDate : now;
    const newEnd = addCalendarMonths(base, membership.membershipType.durationMonths);
    await prisma.memberMembership.update({
      where: { id: membership.id },
      data: {
        status: 'active',
        paymentStatus: 'paid',
        endDate: newEnd,
        renewedAt: now,
        paymentAmount: invoice.amount ?? membership.membershipType.priceCents,
        paymentMethod: 'card',
        notes: membership.notes ? `${membership.notes}\n${paidNote}` : paidNote,
      },
    });
    if (membership.organization.slug) {
      void sendMembershipPaymentConfirmedEmail({
        to: membership.memberEmail,
        memberName: membership.memberName,
        orgName: membership.organization.name,
        orgSlug: membership.organization.slug,
        membershipTypeName: membership.membershipType.name,
        endDate: newEnd,
      });
    }
    return { ok: true, membershipId: membership.id };
  }

  if (membership.paymentStatus === 'paid' && membership.status === 'active') {
    return { ok: true, membershipId: membership.id };
  }

  await prisma.memberMembership.update({
    where: { id: membership.id },
    data: {
      status: 'active',
      paymentStatus: 'paid',
      paymentAmount: invoice.amount ?? membership.membershipType.priceCents,
      paymentMethod: 'card',
      notes: membership.notes ? `${membership.notes}\n${paidNote}` : paidNote,
    },
  });

  if (membership.organization.slug) {
    void sendMembershipPaymentConfirmedEmail({
      to: membership.memberEmail,
      memberName: membership.memberName,
      orgName: membership.organization.name,
      orgSlug: membership.organization.slug,
      membershipTypeName: membership.membershipType.name,
      endDate: membership.endDate,
    });
  }

  return { ok: true, membershipId: membership.id };
}

export async function markMembershipPaymentFailed(
  memberMembershipId: string,
  invoiceId: string
): Promise<void> {
  const membership = await prisma.memberMembership.findUnique({
    where: { id: memberMembershipId },
    select: { id: true, paymentStatus: true, notes: true },
  });
  if (!membership || membership.paymentStatus === 'paid') return;
  const marker = `[Payment failed: ${invoiceId}]`;
  if ((membership.notes ?? '').includes(marker)) return;
  await prisma.memberMembership.update({
    where: { id: membership.id },
    data: {
      paymentStatus: 'failed',
      notes: membership.notes ? `${membership.notes}\n${marker}` : marker,
    },
  });
}

export async function handleMembershipPaymentCallback(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const status = body.status;
    if (status === undefined || status === null || status === '') {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const candidateId =
      typeof body.invoice_id === 'string'
        ? body.invoice_id
        : typeof body.id === 'string'
          ? body.id
          : undefined;

    if (!candidateId) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const { moyasarService } = await import('./moyasar');

    let invoice: MoyasarInvoice;
    try {
      invoice = await moyasarService.getInvoiceById(candidateId);
    } catch {
      try {
        const pay = await moyasarService.getPaymentById(candidateId);
        if (!pay.invoice_id) {
          res.status(400).json({ error: 'Could not resolve invoice for callback' });
          return;
        }
        invoice = await moyasarService.getInvoiceById(pay.invoice_id);
      } catch {
        res.status(400).json({ error: 'Invalid invoice or payment reference' });
        return;
      }
    }

    if (invoice.status !== 'paid') {
      const metadata = mergeMetadata(body, invoice);
      if (
        metadata.type === 'member_membership' &&
        typeof metadata.memberMembershipId === 'string' &&
        (invoice.status === 'failed' || invoice.status === 'expired')
      ) {
        await markMembershipPaymentFailed(metadata.memberMembershipId, invoice.id);
        recordWebhookMetric({
          type: 'membership_payment',
          status: 'failed',
          invoiceId: invoice.id,
          error: `Invoice status: ${invoice.status}`,
        });
      }
      res.json({ received: true, message: 'Payment not completed yet' });
      return;
    }

    const result = await activateMembershipFromPaidMoyasarInvoice(invoice, body);
    if (!result.ok) {
      recordWebhookMetric({
        type: 'membership_payment',
        status: 'failed',
        invoiceId: invoice.id,
        error: result.error,
      });
      res.status(400).json({ error: result.error });
      return;
    }

    recordWebhookMetric({
      type: 'membership_payment',
      status: 'success',
      invoiceId: invoice.id,
    });

    res.json({ success: true, membershipId: result.membershipId });
  } catch (error) {
    console.error('Membership payment callback error:', error);
    recordWebhookMetric({
      type: 'membership_payment',
      status: 'failed',
      error: error instanceof Error ? error.message : 'unknown',
    });
    res.status(500).json({ error: 'Internal server error' });
  }
}
