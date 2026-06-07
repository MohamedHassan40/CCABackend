import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission, requireAnyPermission } from '../../middleware/permissions';
import { createNotification } from '../../core/notifications/helper';
import { submitLeaveRequestForEmployee } from './leaveRequestSubmit';
import { createAuditLog } from '../../middleware/audit';

const router = Router();

// ============================================
// LEAVE TYPES
// ============================================

// GET /api/hr/leave/types - Get all leave types
router.get('/types', requirePermission('hr.leave.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const leaveTypes = await prisma.leaveType.findMany({
      where: {
        orgId: req.org.id,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json(leaveTypes);
  } catch (error) {
    console.error('Error fetching leave types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/leave/types - Create leave type
router.post('/types', requirePermission('hr.leave.manage'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, maxDays, isPaid, requiresApproval } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Leave type name is required' });
      return;
    }

    // Check if leave type already exists
    const existing = await prisma.leaveType.findUnique({
      where: {
        orgId_name: {
          orgId: req.org.id,
          name,
        },
      },
    });

    if (existing) {
      res.status(400).json({ error: 'Leave type with this name already exists' });
      return;
    }

    const leaveType = await prisma.leaveType.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        maxDays: maxDays || null,
        isPaid: isPaid !== false,
        requiresApproval: requiresApproval !== false,
      },
    });

    res.status(201).json(leaveType);
  } catch (error) {
    console.error('Error creating leave type:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/leave/types/:id - Update leave type
router.put('/types/:id', requirePermission('hr.leave.manage'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, description, maxDays, isPaid, requiresApproval, isActive } = req.body;

    const leaveType = await prisma.leaveType.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!leaveType) {
      res.status(404).json({ error: 'Leave type not found' });
      return;
    }

    // Check if new name conflicts
    if (name && name !== leaveType.name) {
      const existing = await prisma.leaveType.findUnique({
        where: {
          orgId_name: {
            orgId: req.org.id,
            name,
          },
        },
      });

      if (existing) {
        res.status(400).json({ error: 'Leave type with this name already exists' });
        return;
      }
    }

    const updated = await prisma.leaveType.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(maxDays !== undefined && { maxDays }),
        ...(isPaid !== undefined && { isPaid }),
        ...(requiresApproval !== undefined && { requiresApproval }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating leave type:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/hr/leave/types/:id - Delete leave type
router.delete('/types/:id', requirePermission('hr.leave.manage'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const leaveType = await prisma.leaveType.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            leaveRequests: true,
          },
        },
      },
    });

    if (!leaveType) {
      res.status(404).json({ error: 'Leave type not found' });
      return;
    }

    if (leaveType._count.leaveRequests > 0) {
      res.status(400).json({ error: 'Cannot delete leave type with existing requests' });
      return;
    }

    await prisma.leaveType.delete({
      where: { id },
    });

    res.json({ message: 'Leave type deleted successfully' });
  } catch (error) {
    console.error('Error deleting leave type:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// LEAVE REQUESTS
// ============================================

// GET /api/hr/leave/requests - Get all leave requests (supports ?limit=50&offset=0)
router.get('/requests', requirePermission('hr.leave.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, employeeId, limit: qLimit, offset: qOffset, page } = req.query;
    const limit = Math.min(parseInt(String(qLimit || 50), 10) || 50, 200);
    const offset = parseInt(String(qOffset || 0), 10) || 0;
    const pageNum = parseInt(String(page), 10);
    const skip = pageNum >= 1 ? (pageNum - 1) * limit : offset;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) {
      where.status = status;
    }

    if (employeeId) {
      where.employeeId = employeeId;
    }

    const [requests, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              email: true,
              department: true,
            },
          },
          leaveType: true,
          approvedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    res.json({ data: requests, total, limit, offset: skip });
  } catch (error) {
    console.error('Error fetching leave requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/leave/requests/export - Export leave requests as CSV (same filters as list)
router.get('/requests/export', requirePermission('hr.leave.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, employeeId } = req.query;
    const where: any = { orgId: req.org.id };
    if (status) where.status = status as string;
    if (employeeId) where.employeeId = employeeId as string;

    const requests = await prisma.leaveRequest.findMany({
      where,
      include: {
        employee: { select: { fullName: true, email: true, department: true } },
        leaveType: { select: { name: true } },
        approvedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const escape = (v: string | number | null | undefined) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const headers = ['Employee', 'Email', 'Department', 'Leave Type', 'Start Date', 'End Date', 'Days', 'Reason', 'Status', 'Approved By', 'Approved At'];
    const rows = requests.map((r) => [
      r.employee.fullName,
      r.employee.email ?? '',
      r.employee.department ?? '',
      r.leaveType.name,
      r.startDate.toISOString().slice(0, 10),
      r.endDate.toISOString().slice(0, 10),
      r.days,
      r.reason ?? '',
      r.status,
      r.approvedBy?.name ?? r.approvedBy?.email ?? '',
      r.approvedAt ? r.approvedAt.toISOString().slice(0, 10) : '',
    ]);

    const csv =
      headers.map(escape).join(',') +
      '\n' +
      rows.map((row) => row.map(escape).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leave-requests-export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting leave requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/leave/requests - Create leave request
router.post('/requests', requirePermission('hr.leave.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, leaveTypeId, startDate, endDate, reason } = req.body;

    if (!employeeId || !leaveTypeId || !startDate || !endDate) {
      res.status(400).json({ error: 'Employee, leave type, start date, and end date are required' });
      return;
    }

    const result = await submitLeaveRequestForEmployee({
      orgId: req.org.id,
      employeeId,
      leaveTypeId,
      startDate,
      endDate,
      reason,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.status(201).json(result.leaveRequest);
  } catch (error) {
    console.error('Error creating leave request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/leave/requests/:id/approve - Approve leave request
router.put('/requests/:id/approve', requirePermission('hr.leave.approve'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const leaveRequest = await prisma.leaveRequest.findFirst({
      where: {
        id,
        orgId: req.org.id,
        status: 'pending',
      },
      include: {
        leaveType: true,
        employee: { select: { fullName: true, userId: true, email: true } },
      },
    });

    if (!leaveRequest) {
      res.status(404).json({ error: 'Leave request not found or already processed' });
      return;
    }

    // Update leave request
    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: 'approved',
        approvedById: req.user.id,
        approvedAt: new Date(),
      },
    });

    // Update leave balance (create row if missing, same as submit flow)
    const currentYear = new Date(leaveRequest.startDate).getFullYear();
    let leaveBalance = await prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: leaveRequest.employeeId,
          leaveTypeId: leaveRequest.leaveTypeId,
          year: currentYear,
        },
      },
    });

    if (!leaveBalance) {
      leaveBalance = await prisma.leaveBalance.create({
        data: {
          orgId: req.org.id,
          employeeId: leaveRequest.employeeId,
          leaveTypeId: leaveRequest.leaveTypeId,
          year: currentYear,
          totalDays: leaveRequest.leaveType.maxDays || 0,
          remainingDays: leaveRequest.leaveType.maxDays || 0,
        },
      });
    }

    await prisma.leaveBalance.update({
      where: { id: leaveBalance.id },
      data: {
        usedDays: leaveBalance.usedDays + leaveRequest.days,
        remainingDays: Math.max(0, leaveBalance.remainingDays - leaveRequest.days),
      },
    });

    if (leaveRequest.employee.userId) {
      createNotification({
        userId: leaveRequest.employee.userId,
        organizationId: req.org.id,
        type: 'success',
        title: 'Leave request approved',
        message: `Your request for ${leaveRequest.days} day(s) of ${leaveRequest.leaveType.name} was approved.`,
        link: '/dashboard/hr/leave',
      }).catch(() => {});
    }

    if (leaveRequest.employee.email) {
      const { sendEmailQueued } = await import('../../core/email');
      const { leaveApprovedEmail } = await import('../../core/email/operationalEmails');
      const { getOrgEmailBrand } = await import('../../core/auth/magicLink');
      const brand = await getOrgEmailBrand(req.org.id, 'hr');
      const tpl = leaveApprovedEmail({
        employeeName: leaveRequest.employee.fullName,
        days: leaveRequest.days,
        leaveTypeName: leaveRequest.leaveType.name,
        brand,
      });
      sendEmailQueued({ to: leaveRequest.employee.email, subject: tpl.subject, html: tpl.html, priority: 'normal' }).catch(() => {});
    }

    createAuditLog({
      userId: req.user.id,
      organizationId: req.org.id,
      action: 'approve',
      resourceType: 'leave_request',
      resourceId: id,
      details: { leaveRequestId: id, employeeId: leaveRequest.employeeId, days: leaveRequest.days },
      req,
    }).catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error('Error approving leave request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/leave/requests/:id/reject - Reject leave request
router.put('/requests/:id/reject', requirePermission('hr.leave.approve'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { rejectionReason } = req.body;

    const leaveRequest = await prisma.leaveRequest.findFirst({
      where: {
        id,
        orgId: req.org.id,
        status: 'pending',
      },
      include: { employee: { select: { userId: true, fullName: true, email: true } }, leaveType: true },
    });

    if (!leaveRequest) {
      res.status(404).json({ error: 'Leave request not found or already processed' });
      return;
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        approvedById: req.user.id,
        approvedAt: new Date(),
        rejectionReason: rejectionReason || null,
      },
    });

    if (leaveRequest.employee.userId) {
      createNotification({
        userId: leaveRequest.employee.userId,
        organizationId: req.org.id,
        type: 'warning',
        title: 'Leave request rejected',
        message: `Your request for ${leaveRequest.days} day(s) of ${leaveRequest.leaveType.name} was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
        link: '/dashboard/hr/leave',
      }).catch(() => {});
    }

    if (leaveRequest.employee.email) {
      const { sendEmailQueued } = await import('../../core/email');
      const { leaveRejectedEmail } = await import('../../core/email/operationalEmails');
      const { getOrgEmailBrand } = await import('../../core/auth/magicLink');
      const brand = await getOrgEmailBrand(req.org.id, 'hr');
      const tpl = leaveRejectedEmail({
        employeeName: leaveRequest.employee.fullName,
        days: leaveRequest.days,
        leaveTypeName: leaveRequest.leaveType.name,
        reason: rejectionReason,
        brand,
      });
      sendEmailQueued({ to: leaveRequest.employee.email, subject: tpl.subject, html: tpl.html, priority: 'normal' }).catch(() => {});
    }

    createAuditLog({
      userId: req.user.id,
      organizationId: req.org.id,
      action: 'reject',
      resourceType: 'leave_request',
      resourceId: id,
      details: { leaveRequestId: id, rejectionReason: rejectionReason || null },
      req,
    }).catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error('Error rejecting leave request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/leave/requests/:id/cancel - Cancel leave request (pending or approved; refund balance if approved)
router.put('/requests/:id/cancel', requireAnyPermission('hr.leave.create', 'hr.leave.approve'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const leaveRequest = await prisma.leaveRequest.findFirst({
      where: {
        id,
        orgId: req.org.id,
        status: { in: ['pending', 'approved'] },
      },
      include: { leaveType: true },
    });

    if (!leaveRequest) {
      res.status(404).json({ error: 'Leave request not found or already processed' });
      return;
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    // If it was approved, return the days to the leave balance
    if (leaveRequest.status === 'approved') {
      const currentYear = new Date(leaveRequest.startDate).getFullYear();
      const leaveBalance = await prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: leaveRequest.employeeId,
            leaveTypeId: leaveRequest.leaveTypeId,
            year: currentYear,
          },
        },
      });
      if (leaveBalance) {
        await prisma.leaveBalance.update({
          where: { id: leaveBalance.id },
          data: {
            usedDays: Math.max(0, leaveBalance.usedDays - leaveRequest.days),
            remainingDays: leaveBalance.remainingDays + leaveRequest.days,
          },
        });
      }
    }

    createAuditLog({
      userId: req.user?.id ?? null,
      organizationId: req.org.id,
      action: 'cancel',
      resourceType: 'leave_request',
      resourceId: id,
      details: { leaveRequestId: id, previousStatus: leaveRequest.status, refundedDays: leaveRequest.status === 'approved' ? leaveRequest.days : 0 },
      req,
    }).catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error('Error cancelling leave request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/leave/balances - Get leave balances
router.get('/balances', requirePermission('hr.leave.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, year } = req.query;
    const currentYear = year ? parseInt(year as string) : new Date().getFullYear();

    const where: any = {
      orgId: req.org.id,
      year: currentYear,
    };

    if (employeeId) {
      where.employeeId = employeeId;
    }

    const balances = await prisma.leaveBalance.findMany({
      where,
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
      orderBy: {
        employee: {
          fullName: 'asc',
        },
      },
    });

    res.json(balances);
  } catch (error) {
    console.error('Error fetching leave balances:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/leave/balances/initialize - Bulk initialize or roll over leave balances for a year
router.post('/balances/initialize', requirePermission('hr.leave.manage'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { year, carryOverFromPreviousYear } = req.body;
    const targetYear = year ? parseInt(String(year), 10) : new Date().getFullYear();
    if (isNaN(targetYear) || targetYear < 2000 || targetYear > 2100) {
      res.status(400).json({ error: 'Invalid year' });
      return;
    }

    const employees = await prisma.employee.findMany({
      where: { orgId: req.org.id },
      select: { id: true },
    });
    const leaveTypes = await prisma.leaveType.findMany({
      where: { orgId: req.org.id, isActive: true },
      select: { id: true, maxDays: true },
    });

    let created = 0;
    let updated = 0;

    for (const emp of employees) {
      for (const lt of leaveTypes) {
        const existing = await prisma.leaveBalance.findUnique({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: emp.id,
              leaveTypeId: lt.id,
              year: targetYear,
            },
          },
        });

        if (existing) {
          if (carryOverFromPreviousYear && targetYear > 2000) {
            const prev = await prisma.leaveBalance.findUnique({
              where: {
                employeeId_leaveTypeId_year: {
                  employeeId: emp.id,
                  leaveTypeId: lt.id,
                  year: targetYear - 1,
                },
              },
            });
            const carryDays = prev ? Math.min(prev.remainingDays, lt.maxDays ?? 0) : 0;
            const totalDays = (lt.maxDays ?? 0) + carryDays;
            await prisma.leaveBalance.update({
              where: { id: existing.id },
              data: {
                totalDays,
                remainingDays: totalDays - existing.usedDays,
              },
            });
            updated++;
          }
          continue;
        }

        let totalDays = lt.maxDays ?? 0;
        let usedDays = 0;
        if (carryOverFromPreviousYear && targetYear > 2000) {
          const prev = await prisma.leaveBalance.findUnique({
            where: {
              employeeId_leaveTypeId_year: {
                employeeId: emp.id,
                leaveTypeId: lt.id,
                year: targetYear - 1,
              },
            },
          });
          const carryDays = prev ? Math.min(prev.remainingDays, lt.maxDays ?? 0) : 0;
          totalDays = (lt.maxDays ?? 0) + carryDays;
        }

        await prisma.leaveBalance.create({
          data: {
            orgId: req.org.id,
            employeeId: emp.id,
            leaveTypeId: lt.id,
            year: targetYear,
            totalDays,
            usedDays,
            remainingDays: totalDays - usedDays,
          },
        });
        created++;
      }
    }

    res.json({ message: 'Leave balances initialized', created, updated, year: targetYear });
  } catch (error) {
    console.error('Error initializing leave balances:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

