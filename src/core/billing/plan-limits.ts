import prisma from '../db';

/** Max organization staff seats for free (basic) module plans. */
export const FREE_PLAN_MAX_USERS = 5;

const FREE_PLANS = new Set(['basic', 'trial']);
const MEMBERSHIP_PORTAL_ROLE = 'membership.member';

export class OrganizationUserLimitError extends Error {
  readonly statusCode = 403;
  readonly currentCount: number;
  readonly maxUsers: number;
  readonly requested: number;
  readonly available: number;

  constructor(params: {
    maxUsers: number;
    currentCount: number;
    requested?: number;
    message?: string;
  }) {
    const requested = params.requested ?? 1;
    const available = Math.max(0, params.maxUsers - params.currentCount);
    super(
      params.message ??
        `User limit reached. Maximum ${params.maxUsers} users allowed.`
    );
    this.name = 'OrganizationUserLimitError';
    this.maxUsers = params.maxUsers;
    this.currentCount = params.currentCount;
    this.requested = requested;
    this.available = available;
  }

  toJSON() {
    return {
      error: this.message,
      currentCount: this.currentCount,
      maxUsers: this.maxUsers,
      requested: this.requested,
      available: this.available,
    };
  }
}

/** Staff seat holders — excludes portal-only membership.member accounts. */
export async function countOrganizationSeatUsers(orgId: string): Promise<number> {
  const memberships = await prisma.membership.findMany({
    where: { organizationId: orgId, isActive: true },
    select: {
      membershipRoles: {
        select: { role: { select: { key: true } } },
      },
    },
  });

  return memberships.filter((membership) => {
    if (membership.membershipRoles.length === 0) {
      return true;
    }
    return membership.membershipRoles.some((mr) => mr.role.key !== MEMBERSHIP_PORTAL_ROLE);
  }).length;
}

/**
 * Resolves the effective staff user limit for an organization.
 * Uses explicit org/bundle limits first, then falls back to the free-plan cap.
 */
export async function resolveOrganizationMaxUsers(orgId: string): Promise<number | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      maxUsers: true,
      currentBundle: { select: { maxUsers: true } },
      orgModules: {
        where: { isEnabled: true },
        select: { plan: true },
      },
    },
  });

  if (!org) {
    return null;
  }

  if (org.maxUsers != null) {
    return org.maxUsers;
  }

  if (org.currentBundle?.maxUsers != null) {
    return org.currentBundle.maxUsers;
  }

  const enabledModules = org.orgModules;
  if (enabledModules.length === 0) {
    return FREE_PLAN_MAX_USERS;
  }

  const hasPaidPlan = enabledModules.some(
    (om) => om.plan != null && !FREE_PLANS.has(om.plan)
  );
  if (hasPaidPlan) {
    return null;
  }

  return FREE_PLAN_MAX_USERS;
}

/** Throws when adding staff users would exceed the organization limit. */
export async function assertOrganizationCanAddUsers(
  orgId: string,
  additionalUsers = 1
): Promise<void> {
  const maxUsers = await resolveOrganizationMaxUsers(orgId);
  if (maxUsers == null) {
    return;
  }

  const currentCount = await countOrganizationSeatUsers(orgId);
  const available = maxUsers - currentCount;
  if (additionalUsers > available) {
    throw new OrganizationUserLimitError({
      maxUsers,
      currentCount,
      requested: additionalUsers,
      message:
        additionalUsers === 1
          ? `User limit reached. Maximum ${maxUsers} users allowed.`
          : `Cannot add ${additionalUsers} users. Only ${Math.max(0, available)} slots available (limit: ${maxUsers}).`,
    });
  }
}

/** Ensures free-tier organizations have the standard user cap applied. */
export async function applyFreePlanUserLimit(orgId: string): Promise<void> {
  await prisma.organization.updateMany({
    where: { id: orgId, maxUsers: null },
    data: { maxUsers: FREE_PLAN_MAX_USERS },
  });
}

/** Sync org maxUsers from a module price when subscribing to a free plan. */
export async function syncOrgUserLimitFromModulePrice(
  orgId: string,
  moduleId: string,
  plan: string,
  billingPeriod = 'monthly'
): Promise<void> {
  const modulePrice = await prisma.modulePrice.findUnique({
    where: {
      moduleId_plan_billingPeriod: {
        moduleId,
        plan,
        billingPeriod,
      },
    },
    select: { priceCents: true, maxSeats: true },
  });

  if (!modulePrice || modulePrice.priceCents > 0) {
    return;
  }

  const seatLimit = modulePrice.maxSeats ?? FREE_PLAN_MAX_USERS;
  await prisma.organization.updateMany({
    where: {
      id: orgId,
      OR: [{ maxUsers: null }, { maxUsers: { gt: seatLimit } }],
    },
    data: { maxUsers: seatLimit },
  });
}
