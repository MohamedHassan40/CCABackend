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

async function getMembershipPermissionKeys(req: Request): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!req.user || !req.org) return keys;

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

  if (!membership?.isActive) return keys;

  for (const mr of membership.membershipRoles) {
    for (const rp of mr.role.rolePermissions) {
      keys.add(rp.permission.key);
    }
  }
  return keys;
}

/** Org-side PMO edit (internal staff), not client portal users. */
export async function hasOrgPmoEditAccess(req: Request): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.isSuperAdmin) return true;
  const keys = await getMembershipPermissionKeys(req);
  return keys.has('pmo.projects.edit') || keys.has('pmo.tasks.edit');
}

/**
 * Client portal user: assigned as ClientProjectManager and lacks org PMO edit permissions.
 */
export async function isClientOnlyPmoUser(req: Request): Promise<boolean> {
  if (!req.user || !req.org) return false;
  if (req.user.isSuperAdmin) return false;
  if (await hasOrgPmoEditAccess(req)) return false;

  const count = await prisma.clientProjectManager.count({
    where: {
      userId: req.user.id,
      isActive: true,
      project: { orgId: req.org.id },
    },
  });
  return count > 0;
}

export async function getUserPermissionKeys(req: Request): Promise<Set<string>> {
  if (!req.user) return new Set();
  if (req.user.isSuperAdmin) {
    return new Set(['*']);
  }
  return getMembershipPermissionKeys(req);
}

function hasPerm(keys: Set<string>, key: string): boolean {
  return keys.has('*') || keys.has(key);
}

/**
 * Prisma include for GET /projects/:id based on access and permissions.
 */
export function buildProjectDetailInclude(access: ProjectAccess, permKeys: Set<string>) {
  const include: Record<string, unknown> = {
    projectManagers: {
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            position: true,
            department: true,
          },
        },
      },
    },
    milestones: {
      orderBy: { targetDate: 'asc' as const },
    },
    projectClients: {
      include: {
        _count: {
          select: { clientProjectManagers: true, clientContacts: true },
        },
      },
    },
  };

  if (access === 'org') {
    if (hasPerm(permKeys, 'pmo.deliverables.view')) {
      include.deliverables = { orderBy: { createdAt: 'desc' as const } };
    }
    if (hasPerm(permKeys, 'pmo.budget.view')) {
      include.budgets = { orderBy: { createdAt: 'desc' as const } };
    }
    if (hasPerm(permKeys, 'pmo.risks.view')) {
      include.risks = { orderBy: { createdAt: 'desc' as const } };
    }
    if (hasPerm(permKeys, 'pmo.issues.view')) {
      include.issues = { orderBy: { createdAt: 'desc' as const } };
    }
    if (hasPerm(permKeys, 'pmo.client_managers.view')) {
      include.clientProjectManagers = {
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      };
      include.clientContacts = true;
    }
    if (hasPerm(permKeys, 'pmo.projects.view')) {
      include.documents = {
        include: { file: true },
        orderBy: { createdAt: 'desc' as const },
      };
      include.stakeholders = { orderBy: { name: 'asc' as const } };
      include.charter = true;
    }
  } else {
    // Client portal: limited project payload
    include.clientProjectManagers = {
      where: { isActive: true },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    };
    include.documents = {
      include: { file: true },
      orderBy: { createdAt: 'desc' as const },
    };
  }

  return include;
}

/**
 * Where clause for listing projects (org-wide vs client-assigned only).
 */
export async function getProjectListWhere(
  req: Request
): Promise<{ orgId: string; id?: { in: string[] } } | null> {
  if (!req.user || !req.org) return null;

  const where: { orgId: string; id?: { in: string[] } } = { orgId: req.org.id };

  if (req.user.isSuperAdmin) return where;

  if (await isClientOnlyPmoUser(req)) {
    const cpmProjects = await prisma.clientProjectManager.findMany({
      where: { userId: req.user.id, isActive: true, project: { orgId: req.org.id } },
      select: { projectId: true },
    });
    const projectIds = cpmProjects.map((c) => c.projectId);
    if (projectIds.length === 0) return { orgId: req.org.id, id: { in: [] } };
    where.id = { in: projectIds };
  }

  return where;
}

/**
 * Resolve project by id and ensure current user has access.
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

  if (req.user.isSuperAdmin) return { project, access: 'org' };

  const clientManager = await prisma.clientProjectManager.findUnique({
    where: {
      projectId_userId: { projectId, userId: req.user.id },
      isActive: true,
    },
  });

  const permKeys = await getMembershipPermissionKeys(req);
  const hasOrgView =
    permKeys.has('pmo.projects.view') || permKeys.has('pmo.tasks.view');

  if (clientManager && !(await hasOrgPmoEditAccess(req))) {
    return { project, access: 'client' };
  }

  if (hasOrgView) {
    return { project, access: 'org' };
  }

  if (clientManager) {
    return { project, access: 'client' };
  }

  return null;
}

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

export async function canUserAccessProjectTask(
  userId: string,
  orgId: string,
  taskId: string,
  isSuperAdmin = false
): Promise<boolean> {
  const task = await prisma.projectTask.findFirst({
    where: { id: taskId },
    select: { orgId: true, projectId: true },
  });
  if (!task || task.orgId !== orgId) return false;

  return canUserAccessProject(userId, orgId, task.projectId, isSuperAdmin);
}

export async function canUserAccessProject(
  userId: string,
  orgId: string,
  projectId: string,
  isSuperAdmin = false
): Promise<boolean> {
  const mockReq = {
    user: { id: userId, isSuperAdmin },
    org: { id: orgId },
  } as Request;
  const access = await getProjectWithAccess(mockReq, projectId);
  return access !== null;
}
