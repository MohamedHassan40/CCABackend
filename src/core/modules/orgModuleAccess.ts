import type { OrgModule, Subscription } from '@prisma/client';

export type OrgModuleAccessState = {
  isExpired: boolean;
  isTrial: boolean;
  hasAccess: boolean;
};

/**
 * Whether the org may use module features (API + UI actions).
 * Visibility in nav is separate — expired modules stay listed with isExpired.
 */
export function getOrgModuleAccessState(
  orgModule: Pick<OrgModule, 'expiresAt' | 'trialEndsAt' | 'isEnabled'>,
  subscription: Pick<Subscription, 'currentPeriodEnd' | 'status'> | null | undefined,
  now: Date = new Date(),
  bypassExpiry = false
): OrgModuleAccessState {
  if (bypassExpiry) {
    return { isExpired: false, isTrial: false, hasAccess: true };
  }

  const isTrial = !!orgModule.trialEndsAt && orgModule.trialEndsAt >= now;
  const trialExpired = !!orgModule.trialEndsAt && orgModule.trialEndsAt < now;
  const dateExpired = !!orgModule.expiresAt && orgModule.expiresAt < now;
  const subscriptionLapsed =
    !!subscription &&
    (subscription.status === 'canceled' ||
      subscription.status === 'expired' ||
      subscription.currentPeriodEnd < now);

  const isExpired = !isTrial && (trialExpired || dateExpired || subscriptionLapsed);

  const hasAccess = orgModule.isEnabled && !isExpired;

  return { isExpired, isTrial, hasAccess };
}

export function orgModuleHadAccess(
  orgModule: Pick<OrgModule, 'isEnabled' | 'expiresAt' | 'trialEndsAt'>,
  hasSubscription: boolean
): boolean {
  return (
    orgModule.isEnabled ||
    orgModule.expiresAt != null ||
    orgModule.trialEndsAt != null ||
    hasSubscription
  );
}
