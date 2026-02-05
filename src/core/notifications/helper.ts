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
    // Get all active members of the organization
    const memberships = await prisma.membership.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        userId: true,
      },
    });

    // Create notification for each member
    await Promise.all(
      memberships.map((membership) =>
        createNotification({
          ...params,
          userId: membership.userId,
          organizationId,
        })
      )
    );
  } catch (error) {
    console.error('Error creating org notifications:', error);
  }
}














