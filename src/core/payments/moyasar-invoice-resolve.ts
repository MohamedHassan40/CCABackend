import type { MoyasarInvoice } from './moyasar';

export function mergeMoyasarMetadata(
  body: Record<string, unknown>,
  invoice: MoyasarInvoice
): Record<string, unknown> {
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

export function webhookCandidateId(body: Record<string, unknown>): string | undefined {
  if (typeof body.invoice_id === 'string' && body.invoice_id) return body.invoice_id;
  if (typeof body.id === 'string' && body.id) return body.id;
  return undefined;
}

/** Load invoice from Moyasar webhook/callback payload (invoice id or payment id). */
export async function resolveMoyasarInvoiceFromWebhookBody(
  body: Record<string, unknown>
): Promise<MoyasarInvoice | null> {
  const candidateId = webhookCandidateId(body);
  if (!candidateId) return null;

  const { moyasarService } = await import('./moyasar');

  try {
    return await moyasarService.getInvoiceById(candidateId);
  } catch {
    try {
      const pay = await moyasarService.getPaymentById(candidateId);
      if (!pay.invoice_id) return null;
      return await moyasarService.getInvoiceById(pay.invoice_id);
    } catch {
      return null;
    }
  }
}

export const PENDING_MOYASAR_INVOICE_RE = /\[Pending Moyasar invoice ([^\]]+)\]/g;

export function extractPendingMoyasarInvoiceId(notes: string | null | undefined): string | undefined {
  if (!notes) return undefined;
  const matches = [...notes.matchAll(PENDING_MOYASAR_INVOICE_RE)];
  const last = matches.at(-1);
  return last?.[1];
}

export function appendPendingMoyasarInvoiceNote(
  existingNotes: string | null | undefined,
  invoiceId: string
): string {
  const marker = `[Pending Moyasar invoice ${invoiceId}]`;
  if (existingNotes?.includes(marker)) return existingNotes;
  return existingNotes ? `${existingNotes}\n${marker}` : marker;
}
