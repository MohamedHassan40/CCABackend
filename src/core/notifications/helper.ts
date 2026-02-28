import prisma from '../db';

export interface CreateNotificationParams {
  userId: string;
  organizationId?: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  link?: string;
}

export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        organizationId: params.organizationId || null,
        type: params.type,
        title: params.title,
        message: params.message,
        link: params.link || null,
      },
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    // Don't throw - notifications are non-critical
  }
}

export async function createNotificationForOrg(
  organizationId: string,
  params: Omit<CreateNotificationParams, 'userId' | 'organizationId'>
): Promise<void> {
  try {
    const memberships = await prisma.membership.findMany({
      where: { organizationId, isActive: true },
      select: { userId: true },
    });
    await Promise.all(
      memberships.map((m) =>
        createNotification({ ...params, userId: m.userId, organizationId })
      )
    );
  } catch (error) {
    console.error('Error creating org notifications:', error);
  }
}

/** Get user IDs in org that have a given permission (via any of their roles). */
export async function getOrgUserIdsWithPermission(
  organizationId: string,
  permissionKey: string
): Promise<string[]> {
  const perm = await prisma.permission.findFirst({
    where: { key: permissionKey },
    select: { id: true },
  });
  if (!perm) return [];
  const roleIds = await prisma.rolePermission.findMany({
    where: { permissionId: perm.id },
    select: { roleId: true },
  }).then((r) => r.map((x) => x.roleId));
  if (roleIds.length === 0) return [];
  const memberships = await prisma.membershipRole.findMany({
    where: {
      membership: { organizationId, isActive: true },
      roleId: { in: roleIds },
    },
    select: { membership: { select: { userId: true } } },
  });
  return [...new Set(memberships.map((m) => m.membership.userId))];
}

/** Notify all org users who have the given permission. */
export async function createNotificationForOrgWithPermission(
  organizationId: string,
  permissionKey: string,
  params: Omit<CreateNotificationParams, 'userId' | 'organizationId'>
): Promise<void> {
  try {
    const userIds = await getOrgUserIdsWithPermission(organizationId, permissionKey);
    await Promise.all(
      userIds.map((userId) =>
        createNotification({ ...params, userId, organizationId })
      )
    );
  } catch (error) {
    console.error('Error creating permission-based notifications:', error);
  }
}














