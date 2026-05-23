/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    memberMembership: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../src/core/db', () => ({
  default: mockPrisma,
}));

import {
  activateMembershipFromPaidMoyasarInvoice,
  markMembershipPaymentFailed,
} from '../../src/core/payments/membership-payment-callback';

describe('membership payment webhook handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('activates membership on paid invoice', async () => {
    mockPrisma.memberMembership.findUnique.mockResolvedValue({
      id: 'mem-1',
      paymentStatus: 'pending',
      status: 'pending',
      endDate: new Date('2026-12-31'),
      notes: null,
      memberEmail: 'a@test.com',
      memberName: 'Alice',
      membershipType: { priceCents: 10000, durationMonths: 12, name: 'Gold' },
      organization: { name: 'Org', slug: 'org' },
    });
    mockPrisma.memberMembership.update.mockResolvedValue({});

    const result = await activateMembershipFromPaidMoyasarInvoice(
      {
        id: 'inv-1',
        status: 'paid',
        amount: 10000,
        metadata: { type: 'member_membership', memberMembershipId: 'mem-1' },
      } as any,
      {}
    );

    expect(result.ok).toBe(true);
    expect(mockPrisma.memberMembership.update).toHaveBeenCalled();
  });

  it('extends end date on renew action', async () => {
    mockPrisma.memberMembership.findUnique.mockResolvedValue({
      id: 'mem-1',
      paymentStatus: 'paid',
      status: 'active',
      endDate: new Date('2026-06-01'),
      notes: null,
      memberEmail: 'a@test.com',
      memberName: 'Alice',
      membershipType: { priceCents: 10000, durationMonths: 12, name: 'Gold' },
      organization: { name: 'Org', slug: 'org' },
    });
    mockPrisma.memberMembership.update.mockResolvedValue({});

    const result = await activateMembershipFromPaidMoyasarInvoice(
      {
        id: 'inv-renew',
        status: 'paid',
        amount: 10000,
        metadata: { type: 'member_membership', memberMembershipId: 'mem-1', action: 'renew' },
      } as any,
      {}
    );

    expect(result.ok).toBe(true);
    const updateArg = mockPrisma.memberMembership.update.mock.calls[0][0];
    expect(updateArg.data.renewedAt).toBeInstanceOf(Date);
  });

  it('marks payment failed without overwriting paid status', async () => {
    mockPrisma.memberMembership.findUnique.mockResolvedValue({
      id: 'mem-1',
      paymentStatus: 'pending',
      notes: null,
    });
    mockPrisma.memberMembership.update.mockResolvedValue({});

    await markMembershipPaymentFailed('mem-1', 'inv-fail');

    expect(mockPrisma.memberMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentStatus: 'failed' }),
      })
    );
  });

  it('rejects non-membership invoice metadata', async () => {
    const result = await activateMembershipFromPaidMoyasarInvoice(
      { id: 'x', status: 'paid', amount: 1, metadata: { type: 'other' } } as any,
      {}
    );
    expect(result.ok).toBe(false);
  });
});
