import { Request, Response } from 'express';
import prisma from '../../core/db';

export type ProjectAccess = 'org' | 'client';

export type ProjectWithAccess = {
  project: {
    id: string;
    orgId: string;
    name: string;
    status: string;
    clientName: string | null;
  };
  access: ProjectAccess;
};

/**
 * Resolve project by id and ensure current user has access.
 * - Org access: project.orgId === req.org.id and user has pmo.projects.view or pmo.tasks.view
 * - Client access: user is ClientProjectManager for this project
 * Returns null if not found or no access (caller should 404/403).
 */
export async function getProjectWithAccess(
  req: Request,
  projectId: string
): Promise<ProjectWithAccess | null> {
  if (!req.user || !req.org) return null;

  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { id: true, orgId: true, name: true, status: true, clientName: true },
  });
  if (!project || project.orgId !== req.org.id) return null;

  // Super admin has org access
  if (req.user.isSuperAdmin) return { project, access: 'org' };

  // Check if user is client project manager for this project
  const clientManager = await prisma.clientProjectManager.findUnique({
    where: {
      projectId_userId: { projectId, userId: req.user.id },
      isActive: true,
    },
  });
  if (clientManager) return { project, access: 'client' };

  // Org user: must have membership and pmo.projects.view or pmo.tasks.view
  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId: req.user.id, organizationId: req.org.id },
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
  if (!membership?.isActive) return null;

  const permKeys = new Set<string>();
  for (const mr of membership.membershipRoles) {
    for (const rp of mr.role.rolePermissions) {
      permKeys.add(rp.permission.key);
    }
  }
  if (permKeys.has('pmo.projects.view') || permKeys.has('pmo.tasks.view')) {
    return { project, access: 'org' };
  }

  return null;
}

/**
 * Send 404 if project not found or no access.
 */
export async function requireProjectAccess(
  req: Request,
  res: Response,
  projectId: string
): Promise<ProjectWithAccess | null> {
  const result = await getProjectWithAccess(req, projectId);
  if (!result) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return result;
}

/**
 * Check if user has access to a project task (for file upload etc).
 * Same logic as getTaskWithAccess: task must belong to org and user has project access (org or client).
 */
export async function canUserAccessProjectTask(
  userId: string,
  orgId: string,
  taskId: string
): Promise<boolean> {
  const task = await prisma.projectTask.findFirst({
    where: { id: taskId },
    select: { orgId: true, projectId: true },
  });
  if (!task || task.orgId !== orgId) return false;

  const clientManager = await prisma.clientProjectManager.findUnique({
    where: {
      projectId_userId: { projectId: task.projectId, userId },
      isActive: true,
    },
  });
  if (clientManager) return true;

  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      organizationId: orgId,
      isActive: true,
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
  if (!membership) return false;

  for (const mr of membership.membershipRoles) {
    for (const rp of mr.role.rolePermissions) {
      if (rp.permission.key === 'pmo.projects.view' || rp.permission.key === 'pmo.tasks.view') return true;
    }
  }
  return false;
}
