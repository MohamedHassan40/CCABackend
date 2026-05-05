import prisma from '../../core/db';
import { createNotificationForOrgWithPermission } from '../../core/notifications/helper';

export type SubmitLeaveRequestResult =
  | { ok: true; leaveRequest: object }
  | { ok: false; status: number; error: string };

/**
 * Shared validation + create flow for leave requests (HR UI and employee self-service).
 */
export async function submitLeaveRequestForEmployee(params: {
  orgId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
}): Promise<SubmitLeaveRequestResult> {
  const { orgId, employeeId, leaveTypeId, startDate, endDate, reason } = params;

  const employee = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      orgId,
    },
  });

  if (!employee) {
    return { ok: false, status: 404, error: 'Employee not found' };
  }

  const leaveType = await prisma.leaveType.findFirst({
    where: {
      id: leaveTypeId,
      orgId,
      isActive: true,
    },
  });

  if (!leaveType) {
    return { ok: false, status: 404, error: 'Leave type not found' };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (start < now) {
    return { ok: false, status: 400, error: 'Start date cannot be in the past' };
  }

  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (days < 1) {
    return { ok: false, status: 400, error: 'End date must be after or equal to start date' };
  }

  const overlapping = await prisma.leaveRequest.findFirst({
    where: {
      employeeId,
      status: { in: ['pending', 'approved'] },
      OR: [{ startDate: { lte: end }, endDate: { gte: start } }],
    },
  });
  if (overlapping) {
    return {
      ok: false,
      status: 400,
      error: 'This leave period overlaps with an existing approved or pending leave request',
    };
  }

  const currentYear = new Date().getFullYear();
  let leaveBalance = await prisma.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId,
        leaveTypeId,
        year: currentYear,
      },
    },
  });

  if (!leaveBalance) {
    leaveBalance = await prisma.leaveBalance.create({
      data: {
        orgId,
        employeeId,
        leaveTypeId,
        year: currentYear,
        totalDays: leaveType.maxDays || 0,
        remainingDays: leaveType.maxDays || 0,
      },
    });
  }

  if (leaveType.maxDays && leaveBalance.remainingDays < days) {
    return {
      ok: false,
      status: 400,
      error: `Insufficient leave balance. Available: ${leaveBalance.remainingDays} days, Requested: ${days} days`,
    };
  }

  const leaveRequest = await prisma.leaveRequest.create({
    data: {
      orgId,
      employeeId,
      leaveTypeId,
      startDate: start,
      endDate: end,
      days,
      reason: reason || null,
      status: leaveType.requiresApproval ? 'pending' : 'approved',
    },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      leaveType: true,
    },
  });

  if (!leaveType.requiresApproval) {
    await prisma.leaveBalance.update({
      where: { id: leaveBalance.id },
      data: {
        usedDays: leaveBalance.usedDays + days,
        remainingDays: leaveBalance.remainingDays - days,
      },
    });
  }

  if (leaveType.requiresApproval) {
    createNotificationForOrgWithPermission(orgId, 'hr.leave.approve', {
      type: 'info',
      title: 'New leave request',
      message: `${leaveRequest.employee.fullName} requested ${days} day(s) of ${leaveRequest.leaveType.name}`,
      link: `/dashboard/hr/leave`,
    }).catch(() => {});
  }

  return { ok: true, leaveRequest };
}
