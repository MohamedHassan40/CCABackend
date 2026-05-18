import prisma from '../db';

/** Permission keys for the current user in the current org (empty set if no membership). */
export async function getUserPermissionKeys(
  userId: string,
  organizationId: string
): Promise<Set<string>> {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId, organizationId },
    },
    include: {
      membershipRoles: {
        include: {
          role: {
            include: {
              rolePermissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!membership?.isActive) return new Set();

  const keys = new Set<string>();
  for (const mr of membership.membershipRoles) {
    for (const rp of mr.role.rolePermissions) {
      keys.add(rp.permission.key);
    }
  }
  return keys;
}

export function canViewAllOrgTickets(permissionKeys: Set<string>): boolean {
  return (
    permissionKeys.has('ticketing.tickets.edit') ||
    permissionKeys.has('ticketing.tickets.delete') ||
    permissionKeys.has('ticketing.tickets.view')
  );
}

/** Staff who may only see tickets they created or are assigned to. */
export function isOwnTicketsScopeOnly(permissionKeys: Set<string>): boolean {
  if (canViewAllOrgTickets(permissionKeys)) return false;
  return permissionKeys.has('ticketing.tickets.view_own');
}

export function ownTicketsFilter(userId: string) {
  return {
    OR: [{ createdById: userId }, { assigneeId: userId }],
  };
}
