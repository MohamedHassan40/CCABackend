/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  buildHostedInvoiceCheckoutUrl,
  getMoyasarHostedCheckoutMethods,
  invoicePaidWithCreditOrDebitCard,
  withPaymentRedirectFlag,
} from '../../src/core/payments/moyasar-checkout';

describe('moyasar-checkout', () => {
  it('restricts hosted checkout URL to credit card methods', () => {
    const url = buildHostedInvoiceCheckoutUrl('https://checkout.moyasar.com/invoices/abc');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('methods')).toBe('creditcard');
    expect(parsed.searchParams.get('supported_networks')).toContain('mada');
    expect(parsed.searchParams.get('apply_coupon')).toBe('false');
  });

  it('does not include wallet methods in defaults', () => {
    const methods = getMoyasarHostedCheckoutMethods();
    expect(methods).toEqual(['creditcard']);
    expect(methods).not.toContain('applepay');
  });

  it('appends payment redirect flags', () => {
    expect(withPaymentRedirectFlag('https://app.test/page', 'cancelled')).toBe(
      'https://app.test/page?payment=cancelled'
    );
    expect(withPaymentRedirectFlag('https://app.test/page?x=1', 'failed')).toBe(
      'https://app.test/page?x=1&payment=failed'
    );
  });

  it('rejects non-card paid invoice sources', () => {
    expect(
      invoicePaidWithCreditOrDebitCard({
        id: 'inv',
        amount: 100,
        payments: [{ status: 'paid', source: { type: 'applepay' } }],
      } as any)
    ).toBe(false);
    expect(
      invoicePaidWithCreditOrDebitCard({
        id: 'inv',
        amount: 100,
        payments: [{ status: 'paid', source: { type: 'creditcard' } }],
      } as any)
    ).toBe(true);
  });
});
