import { describe, expect, it } from 'vitest';
import { getOrgModuleAccessState, orgModuleHadAccess } from '../../src/core/modules/orgModuleAccess';

describe('orgModuleAccess', () => {
  const now = new Date('2026-06-03T12:00:00Z');

  it('marks dated access as expired', () => {
    const state = getOrgModuleAccessState(
      {
        isEnabled: true,
        expiresAt: new Date('2026-06-01T00:00:00Z'),
        trialEndsAt: null,
      },
      null,
      now
    );
    expect(state.isExpired).toBe(true);
    expect(state.hasAccess).toBe(false);
  });

  it('marks lapsed subscription as expired but keeps hadAccess', () => {
    const orgModule = {
      isEnabled: true,
      expiresAt: null,
      trialEndsAt: null,
    };
    const subscription = {
      currentPeriodEnd: new Date('2026-05-01T00:00:00Z'),
      status: 'active',
    };
    expect(orgModuleHadAccess(orgModule, true)).toBe(true);
    const state = getOrgModuleAccessState(orgModule, subscription, now);
    expect(state.isExpired).toBe(true);
  });

  it('allows active subscription', () => {
    const state = getOrgModuleAccessState(
      { isEnabled: true, expiresAt: null, trialEndsAt: null },
      { currentPeriodEnd: new Date('2026-07-01T00:00:00Z'), status: 'active' },
      now
    );
    expect(state.isExpired).toBe(false);
    expect(state.hasAccess).toBe(true);
  });
});
