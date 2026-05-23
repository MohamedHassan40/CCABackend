import { Router, Request, Response } from 'express';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';
import { getUserPermissionKeys } from '../core/permissions/membershipPermissions';

const router = Router();

export type ActivityCategory = 'action_required' | 'in_progress' | 'waiting';

export interface MeActivityItem {
  id: string;
  type: string;
  category: ActivityCategory;
  title: string;
  subtitle?: string;
  status: string;
  priority?: string;
  dueDate?: string;
  href: string;
  sortDate: string;
}

function pushActivity(items: MeActivityItem[], item: MeActivityItem) {
  items.push(item);
}

function sortActivities(items: MeActivityItem[]): MeActivityItem[] {
  const rank: Record<ActivityCategory, number> = {
    action_required: 0,
    in_progress: 1,
    waiting: 2,
  };
  return items.sort((a, b) => {
    const cat = rank[a.category] - rank[b.category];
    if (cat !== 0) return cat;
    return new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime();
  });
}

// GET /api/me/activities — personalized next steps for the signed-in user
router.get('/activities', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

  // Super admin without org context
    if (req.user.isSuperAdmin && !req.org) {
      const pendingOrgs = await prisma.organization.count({ where: { status: 'pending' } });
      const items: MeActivityItem[] = [];
      if (pendingOrgs > 0) {
        pushActivity(items, {
          id: 'super-admin-pending-orgs',
          type: 'org_pending_approval',
          category: 'action_required',
          title: `${pendingOrgs} organization${pendingOrgs === 1 ? '' : 's'} pending approval`,
          status: 'pending',
          href: '/dashboard/super-admin/organizations?status=pending',
          sortDate: new Date().toISOString(),
        });
      }
      res.json({ items: sortActivities(items).slice(0, 12), summary: { total: items.length, actionRequired: items.filter((i) => i.category === 'action_required').length } });
      return;
    }

    if (!req.org) {
      res.status(401).json({ error: 'Organization context required' });
      return;
    }

    const userId = req.user.id;
    const orgId = req.org.id;
    const permKeys = await getUserPermissionKeys(userId, orgId);
    const items: MeActivityItem[] = [];

    const employee = await prisma.employee.findFirst({
      where: { orgId, userId },
      select: { id: true, fullName: true, email: true },
    });

    const userEmail = req.user.email?.trim().toLowerCase();
    const employeeEmail = employee?.email?.trim().toLowerCase();
    const ticketEmails = [...new Set([userEmail, employeeEmail].filter(Boolean))] as string[];

    const queries: Promise<void>[] = [];

    // --- Supervisor / manager: items needing approval or review ---
    if (permKeys.has('hr.leave.approve')) {
      queries.push(
        prisma.leaveRequest
          .findMany({
            where: { orgId, status: 'pending' },
            take: 8,
            orderBy: { createdAt: 'asc' },
            include: {
              employee: { select: { fullName: true } },
              leaveType: { select: { name: true } },
            },
          })
          .then((rows) => {
            for (const r of rows) {
              pushActivity(items, {
                id: `leave-approve-${r.id}`,
                type: 'leave_approval',
                category: 'action_required',
                title: `Approve leave: ${r.employee.fullName}`,
                subtitle: `${r.leaveType.name} · ${r.days} day(s)`,
                status: r.status,
                dueDate: r.startDate.toISOString(),
                href: '/dashboard/hr/leave',
                sortDate: r.createdAt.toISOString(),
              });
            }
          })
      );
    }

    if (permKeys.has('hr.requests.edit') || permKeys.has('hr.requests.view')) {
      queries.push(
        prisma.employeeRequest
          .findMany({
            where: { orgId, status: 'pending' },
            take: 8,
            orderBy: { createdAt: 'asc' },
            include: { employee: { select: { fullName: true } } },
          })
          .then((rows) => {
            for (const r of rows) {
              pushActivity(items, {
                id: `req-approve-${r.id}`,
                type: 'employee_request_approval',
                category: 'action_required',
                title: `Review request: ${r.title}`,
                subtitle: r.employee.fullName,
                status: r.status,
                priority: r.priority,
                href: '/dashboard/hr/employee-requests',
                sortDate: r.createdAt.toISOString(),
              });
            }
          })
      );
    }

    if (permKeys.has('hr.assets.assignments.approve')) {
      queries.push(
        prisma.inventoryAssignment
          .findMany({
            where: { orgId, status: 'pending' },
            take: 5,
            orderBy: { createdAt: 'asc' },
            include: {
              employee: { select: { fullName: true } },
              item: { select: { name: true } },
            },
          })
          .then((rows) => {
            for (const r of rows) {
              pushActivity(items, {
                id: `asset-assign-${r.id}`,
                type: 'asset_assignment_approval',
                category: 'action_required',
                title: `Approve asset assignment: ${r.item.name}`,
                subtitle: r.employee.fullName,
                status: r.status,
                href: '/dashboard/hr/assets/assignments',
                sortDate: r.createdAt.toISOString(),
              });
            }
          })
      );
    }

    if (permKeys.has('hr.performance.edit') || permKeys.has('hr.performance.create')) {
      queries.push(
        prisma.performanceReview
          .findMany({
            where: {
              orgId,
              reviewerId: userId,
              status: { in: ['draft', 'in_progress'] },
            },
            take: 5,
            orderBy: { updatedAt: 'desc' },
            include: { employee: { select: { fullName: true } } },
          })
          .then((rows) => {
            for (const r of rows) {
              pushActivity(items, {
                id: `perf-review-${r.id}`,
                type: 'performance_review',
                category: 'action_required',
                title: `Complete review: ${r.employee.fullName}`,
                subtitle: r.reviewType,
                status: r.status,
                href: '/dashboard/hr/performance',
                sortDate: r.updatedAt.toISOString(),
              });
            }
          })
      );
    }

    // --- Employee / self-service: own pending & active work ---
    if (employee) {
      queries.push(
        prisma.task
          .findMany({
            where: {
              orgId,
              employeeId: employee.id,
              status: { in: ['pending', 'in_progress'] },
            },
            take: 8,
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
          })
          .then((rows) => {
            for (const r of rows) {
              pushActivity(items, {
                id: `hr-task-${r.id}`,
                type: 'hr_task',
                category: r.status === 'pending' ? 'action_required' : 'in_progress',
                title: r.title,
                subtitle: 'HR task',
                status: r.status,
                priority: r.priority,
                dueDate: r.dueDate?.toISOString(),
                href: '/dashboard/hr/tasks',
                sortDate: (r.dueDate ?? r.updatedAt).toISOString(),
              });
            }
          })
      );

      queries.push(
        prisma.projectTask
          .findMany({
            where: {
              orgId,
              assigneeId: employee.id,
              status: { notIn: ['completed', 'cancelled'] },
            },
            take: 8,
            orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
            include: { project: { select: { id: true, name: true } } },
          })
          .then((rows) => {
            for (const r of rows) {
              pushActivity(items, {
                id: `pmo-task-${r.id}`,
                type: 'project_task',
                category: r.status === 'review' ? 'waiting' : 'in_progress',
                title: r.title,
                subtitle: r.project.name,
                status: r.status,
                priority: r.priority,
                dueDate: r.dueDate?.toISOString(),
                href: `/dashboard/pmo/projects/${r.project.id}`,
                sortDate: (r.dueDate ?? r.updatedAt).toISOString(),
              });
            }
          })
      );

      queries.push(
        prisma.goal
          .findMany({
            where: {
              orgId,
              employeeId: employee.id,
              status: { in: ['not_started', 'in_progress'] },
            },
            take: 5,
            orderBy: { targetDate: 'asc' },
          })
          .then((rows) => {
            for (const r of rows) {
              pushActivity(items, {
                id: `goal-${r.id}`,
                type: 'goal',
                category: r.status === 'not_started' ? 'action_required' : 'in_progress',
                title: r.title,
                subtitle: 'Performance goal',
                status: r.status,
                dueDate: r.targetDate.toISOString(),
                href: '/dashboard/hr/performance',
                sortDate: r.targetDate.toISOString(),
              });
            }
          })
      );

      queries.push(
        prisma.leaveRequest
          .findMany({
            where: { orgId, employeeId: employee.id, status: 'pending' },
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: { leaveType: { select: { name: true } } },
          })
          .then((rows) => {
            for (const r of rows) {
              pushActivity(items, {
                id: `leave-mine-${r.id}`,
                type: 'leave_pending',
                category: 'waiting',
                title: `Leave awaiting approval`,
                subtitle: `${r.leaveType.name} · ${r.days} day(s)`,
                status: r.status,
                dueDate: r.startDate.toISOString(),
                href: '/dashboard/my-work',
                sortDate: r.createdAt.toISOString(),
              });
            }
          })
      );

      queries.push(
        prisma.employeeRequest
          .findMany({
            where: { orgId, employeeId: employee.id, status: 'pending' },
            take: 5,
            orderBy: { createdAt: 'desc' },
          })
          .then((rows) => {
            for (const r of rows) {
              pushActivity(items, {
                id: `req-mine-${r.id}`,
                type: 'employee_request_pending',
                category: 'waiting',
                title: r.title,
                subtitle: 'Awaiting HR review',
                status: r.status,
                priority: r.priority,
                href: '/dashboard/my-work',
                sortDate: r.createdAt.toISOString(),
              });
            }
          })
      );
    }

    // --- Ticketing: assigned open tickets ---
    const canViewTickets =
      permKeys.has('ticketing.tickets.view') ||
      permKeys.has('ticketing.tickets.view_own') ||
      permKeys.has('ticketing.tickets.edit');

    if (canViewTickets) {
      const ticketWhere: Record<string, unknown> = {
        orgId,
        status: { in: ['open', 'in_progress', 'pending'] },
      };

      if (!permKeys.has('ticketing.tickets.view') && !permKeys.has('ticketing.tickets.edit')) {
        ticketWhere.OR = [
          { assigneeId: userId },
          { createdById: userId },
          ...ticketEmails.map((email) => ({
            submittedByEmail: { equals: email, mode: 'insensitive' as const },
          })),
        ];
      } else {
        ticketWhere.assigneeId = userId;
      }

      queries.push(
        prisma.ticket
          .findMany({
            where: ticketWhere,
            take: 8,
            orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              updatedAt: true,
              category: { select: { name: true } },
            },
          })
          .then((rows) => {
            for (const r of rows) {
              const isAssigned = true;
              pushActivity(items, {
                id: `ticket-${r.id}`,
                type: 'ticket',
                category: isAssigned ? 'action_required' : 'in_progress',
                title: r.title,
                subtitle: r.category?.name ?? 'Support ticket',
                status: r.status,
                priority: r.priority,
                href: '/dashboard/ticketing/tickets',
                sortDate: r.updatedAt.toISOString(),
              });
            }
          })
      );
    }

    // --- Sales activities assigned to user ---
    if (permKeys.has('sales.activities.view')) {
      queries.push(
        prisma.salesActivity
          .findMany({
            where: {
              orgId,
              assignedToId: userId,
              status: { in: ['not_started', 'in_progress'] },
            },
            take: 5,
            orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
          })
          .then((rows) => {
            for (const r of rows) {
              pushActivity(items, {
                id: `sales-${r.id}`,
                type: 'sales_activity',
                category: r.status === 'not_started' ? 'action_required' : 'in_progress',
                title: r.subject,
                subtitle: r.type,
                status: r.status,
                priority: r.priority,
                dueDate: r.dueDate?.toISOString(),
                href: '/dashboard/sales/activities',
                sortDate: (r.dueDate ?? r.updatedAt).toISOString(),
              });
            }
          })
      );
    }

    await Promise.all(queries);

    const sorted = sortActivities(items).slice(0, 12);
    res.json({
      items: sorted,
      summary: {
        total: sorted.length,
        actionRequired: sorted.filter((i) => i.category === 'action_required').length,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/me/activities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
