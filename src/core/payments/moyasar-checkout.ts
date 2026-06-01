import type { MoyasarInvoice } from './moyasar';

/** Hosted checkout: credit/debit cards only (no Apple Pay, STC Pay, Samsung Pay). */
export const MOYASAR_DEFAULT_CHECKOUT_METHODS = ['creditcard'] as const;

/** Mada + international debit/credit schemes. */
export const MOYASAR_DEFAULT_SUPPORTED_NETWORKS = ['mada', 'visa', 'mastercard'] as const;

const DISALLOWED_CHECKOUT_METHODS = new Set(['applepay', 'samsungpay', 'stcpay', 'googlepay']);

function parseEnvList(value: string | undefined, fallback: readonly string[]): string[] {
  if (!value?.trim()) return [...fallback];
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function getMoyasarHostedCheckoutMethods(): string[] {
  const methods = parseEnvList(process.env.MOYASAR_CHECKOUT_METHODS, MOYASAR_DEFAULT_CHECKOUT_METHODS);
  return methods.filter((m) => !DISALLOWED_CHECKOUT_METHODS.has(m));
}

export function getMoyasarSupportedCardNetworks(): string[] {
  return parseEnvList(process.env.MOYASAR_SUPPORTED_NETWORKS, MOYASAR_DEFAULT_SUPPORTED_NETWORKS);
}

/**
 * Append card-only options to Moyasar hosted invoice URLs.
 * Also disable coupons on hosted checkout unless explicitly enabled.
 */
export function buildHostedInvoiceCheckoutUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const methods = getMoyasarHostedCheckoutMethods();
    if (methods.length > 0 && !url.searchParams.has('methods')) {
      url.searchParams.set('methods', methods.join(','));
    }
    const networks = getMoyasarSupportedCardNetworks();
    if (networks.length > 0 && !url.searchParams.has('supported_networks')) {
      url.searchParams.set('supported_networks', networks.join(','));
    }
    if (process.env.MOYASAR_APPLY_COUPON !== 'true' && !url.searchParams.has('apply_coupon')) {
      url.searchParams.set('apply_coupon', 'false');
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

type MoyasarPaymentAttempt = {
  status?: string;
  source?: { type?: string };
};

/** True when the invoice is paid via credit/debit card (not Apple Pay or other wallets). */
export function invoicePaidWithCreditOrDebitCard(invoice: MoyasarInvoice): boolean {
  const attempts = invoice.payments;
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return true;
  }
  const paidAttempts = (attempts as MoyasarPaymentAttempt[]).filter((p) => p.status === 'paid');
  if (paidAttempts.length === 0) return false;
  return paidAttempts.every((p) => {
    const type = p.source?.type?.toLowerCase();
    return type === 'creditcard' || type === undefined;
  });
}

export function hostedCheckoutMetadataExtra(): Record<string, string> {
  return {
    checkoutMethods: getMoyasarHostedCheckoutMethods().join(','),
    cardNetworks: getMoyasarSupportedCardNetworks().join(','),
  };
}

export function enrichMoyasarInvoiceCreateData<T extends { metadata?: Record<string, unknown> }>(
  data: T
): T {
  return {
    ...data,
    metadata: {
      ...(data.metadata ?? {}),
      ...hostedCheckoutMetadataExtra(),
    },
  };
}

/** Append `payment=cancelled|failed|success` for return URLs after hosted checkout. */
export function withPaymentRedirectFlag(
  baseUrl: string,
  flag: 'cancelled' | 'failed' | 'success'
): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}payment=${flag}`;
}
