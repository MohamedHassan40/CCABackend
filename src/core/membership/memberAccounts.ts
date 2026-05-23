import prisma from '../db';
import { hashPassword } from '../auth/password';

const MEMBER_ROLE_KEY = 'membership.member';

export async function getOrCreateMembershipMemberRole() {
  return prisma.role.upsert({
    where: { key: MEMBER_ROLE_KEY },
    update: {
      name: 'Membership Member',
      description: 'Member portal: view card, announcements, and renew membership',
    },
    create: {
      key: MEMBER_ROLE_KEY,
      name: 'Membership Member',
      description: 'Member portal: view card, announcements, and renew membership',
    },
  });
}

/** Ensure org User membership with membership.member role (no HR/admin perms). */
export async function ensureOrgMemberRole(userId: string, organizationId: string): Promise<void> {
  const role = await getOrCreateMembershipMemberRole();
  const existing = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId, organizationId },
    },
  });
  if (!existing) {
    const created = await prisma.membership.create({
      data: { userId, organizationId, isActive: true },
    });
    await prisma.membershipRole.create({
      data: { membershipId: created.id, roleId: role.id },
    });
    return;
  }
  if (!existing.isActive) {
    await prisma.membership.update({
      where: { id: existing.id },
      data: { isActive: true },
    });
  }
  const hasRole = await prisma.membershipRole.findFirst({
    where: { membershipId: existing.id, roleId: role.id },
  });
  if (!hasRole) {
    await prisma.membershipRole.create({
      data: { membershipId: existing.id, roleId: role.id },
    });
  }
}

/**
 * Create or link a login account for a member record.
 * Returns user id when an account exists or was created.
 */
export async function provisionMemberLoginAccount(params: {
  orgId: string;
  email: string;
  name: string;
  password?: string;
}): Promise<{ userId: string; created: boolean } | null> {
  const email = params.email.trim().toLowerCase();
  if (!email || !params.password || params.password.length < 8) {
    return null;
  }

  let user = await prisma.user.findUnique({ where: { email } });
  let created = false;

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: params.name.trim() || email,
        passwordHash: await hashPassword(params.password),
        isActive: true,
      },
    });
    created = true;
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(params.password),
        isActive: true,
        name: user.name || params.name.trim(),
      },
    });
  }

  await ensureOrgMemberRole(user.id, params.orgId);
  return { userId: user.id, created };
}

export async function linkMemberRecordToUser(memberMembershipId: string, userId: string): Promise<void> {
  await prisma.memberMembership.update({
    where: { id: memberMembershipId },
    data: { userId },
  });
}

export async function findMemberRecordForUser(orgId: string, userId: string, userEmail: string) {
  const byUser = await prisma.memberMembership.findFirst({
    where: { orgId, userId },
    orderBy: { endDate: 'desc' },
    include: { membershipType: true, organization: true },
  });
  if (byUser) return byUser;

  const email = userEmail.trim().toLowerCase();
  return prisma.memberMembership.findFirst({
    where: {
      orgId,
      memberEmail: { equals: email, mode: 'insensitive' },
    },
    orderBy: { endDate: 'desc' },
    include: { membershipType: true, organization: true },
  });
}
