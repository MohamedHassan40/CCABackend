import prisma from '../db';
import type { MoyasarInvoice } from './moyasar';

/** Mark platform subscription checkout as failed when Moyasar invoice will not be paid. */
export async function markSubscriptionPaymentFailedFromInvoice(invoice: MoyasarInvoice): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: {
      providerRef: invoice.id,
      provider: 'moyasar',
    },
  });
  if (!payment || payment.status === 'succeeded') return;
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'failed' },
  });
}
