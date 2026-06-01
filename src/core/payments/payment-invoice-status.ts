import type { MoyasarInvoice, MoyasarInvoiceStatus } from './moyasar';

export const TERMINAL_FAILED_INVOICE_STATUSES: MoyasarInvoiceStatus[] = [
  'failed',
  'expired',
  'canceled',
  'voided',
];

export const STALE_INVOICE_STATUSES: MoyasarInvoiceStatus[] = [
  ...TERMINAL_FAILED_INVOICE_STATUSES,
  'refunded',
];

export function isTerminalFailedInvoiceStatus(
  status: MoyasarInvoiceStatus | string | undefined
): boolean {
  return !!status && TERMINAL_FAILED_INVOICE_STATUSES.includes(status as MoyasarInvoiceStatus);
}

export function isStaleInvoice(invoice: MoyasarInvoice): boolean {
  const status = invoice.status;
  if (status && STALE_INVOICE_STATUSES.includes(status)) return true;
  if (invoice.expired_at) {
    const expiry = Date.parse(invoice.expired_at);
    if (!Number.isNaN(expiry) && expiry < Date.now()) return true;
  }
  return false;
}
