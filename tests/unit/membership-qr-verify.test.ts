import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildMembershipVerifyUrl,
  isMembershipActiveForVerification,
  membershipVerifyReason,
} from '../../src/core/membership/qrVerify';

describe('membership QR verify', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats membership as active through end of endDate day (UTC)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00.000Z'));

    const endDate = new Date('2026-05-24T00:00:00.000Z');
    expect(
      isMembershipActiveForVerification({ status: 'active', endDate })
    ).toBe(true);
  });

  it('marks expired when endDate day has passed', () => {
    const endDate = new Date('2020-01-01T00:00:00.000Z');
    expect(
      isMembershipActiveForVerification({ status: 'active', endDate })
    ).toBe(false);
    expect(membershipVerifyReason({ status: 'active', endDate })).toBe('expired');
  });

  it('returns pending for unpaid registrations', () => {
    const endDate = new Date('2030-01-01T00:00:00.000Z');
    expect(membershipVerifyReason({ status: 'pending', endDate })).toBe('pending');
  });

  it('encodes verify URL with token', () => {
    const url = buildMembershipVerifyUrl('abc-123_token');
    expect(url).toContain('/membership/verify/');
    expect(url).toContain(encodeURIComponent('abc-123_token'));
  });
});
