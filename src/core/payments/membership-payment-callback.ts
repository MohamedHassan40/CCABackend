import type { Request, Response } from 'express';
import type { MoyasarInvoice } from './moyasar';
import prisma from '../db';
import { addCalendarMonths } from '../dates/membershipEndDate';
import { sendMembershipPaymentConfirmedEmail } from '../membership/memberEmails';
import { recordWebhookMetric } from '../monitoring/opsMetrics';
import {
  extractPendingMoyasarInvoiceId,
  mergeMoyasarMetadata,
  resolveMoyasarInvoiceFromWebhookBody,
} from './moyasar-invoice-resolve';
import { invoicePaidWithCreditOrDebitCard } from './moyasar-checkout';
import { isTerminalFailedInvoiceStatus } from './payment-invoice-status';

export type ActivateMembershipPaymentResult =
  | { ok: true; membershipId: string }
  | { ok: false; error: string; invoiceStatus?: string };

export async function activateMembershipFromPaidMoyasarInvoice(
  invoice: MoyasarInvoice,
  webhookBody: Record<string, unknown> = {}
): Promise<ActivateMembershipPaymentResult> {
  const metadata = mergeMoyasarMetadata(webhookBody, invoice);
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

  if (!invoicePaidWithCreditOrDebitCard(invoice)) {
    return { ok: false, error: 'Only credit and debit card payments are accepted for membership' };
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

export async function syncMembershipPaymentFromMoyasar(params: {
  orgId: string;
  membershipId: string;
  email: string;
  invoiceId?: string;
}): Promise<ActivateMembershipPaymentResult> {
  const membership = await prisma.memberMembership.findFirst({
    where: { id: params.membershipId, orgId: params.orgId },
    select: { id: true, memberEmail: true, notes: true, paymentStatus: true, status: true },
  });

  if (!membership) {
    return { ok: false, error: 'Membership not found' };
  }
  if (membership.memberEmail.toLowerCase() !== params.email.trim().toLowerCase()) {
    return { ok: false, error: 'Email does not match this membership' };
  }

  const invoiceId =
    params.invoiceId?.trim() || extractPendingMoyasarInvoiceId(membership.notes);
  if (!invoiceId) {
    return { ok: false, error: 'No pending payment invoice found for this membership' };
  }

  const { moyasarService } = await import('./moyasar');
  let invoice: MoyasarInvoice;
  try {
    invoice = await moyasarService.getInvoiceById(invoiceId);
  } catch {
    return { ok: false, error: 'Could not load payment from Moyasar' };
  }

  if (isTerminalFailedInvoiceStatus(invoice.status)) {
    await markMembershipPaymentFailed(membership.id, invoice.id);
    return { ok: false, error: 'Payment was not completed', invoiceStatus: invoice.status };
  }

  if (invoice.status !== 'paid') {
    return { ok: false, error: 'Payment not completed yet', invoiceStatus: invoice.status };
  }

  if (!invoicePaidWithCreditOrDebitCard(invoice)) {
    return { ok: false, error: 'Only credit and debit card payments are accepted' };
  }

  return activateMembershipFromPaidMoyasarInvoice(invoice, {});
}

export async function handleMembershipPaymentCallback(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const status = body.status;
    if (status === undefined || status === null || status === '') {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const invoice = await resolveMoyasarInvoiceFromWebhookBody(body);
    if (!invoice) {
      res.status(400).json({ error: 'Invalid invoice or payment reference' });
      return;
    }

    if (invoice.status !== 'paid') {
      const metadata = mergeMoyasarMetadata(body, invoice);
      if (
        metadata.type === 'member_membership' &&
        typeof metadata.memberMembershipId === 'string' &&
        isTerminalFailedInvoiceStatus(invoice.status)
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
