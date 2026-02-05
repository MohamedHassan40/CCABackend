import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

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

// GET /api/hr/leave/requests - Get all leave requests
router.get('/requests', requirePermission('hr.leave.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, employeeId } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) {
      where.status = status;
    }

    if (employeeId) {
      where.employeeId = employeeId;
    }

    const requests = await prisma.leaveRequest.findMany({
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
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(requests);
  } catch (error) {
    console.error('Error fetching leave requests:', error);
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

    // Verify employee belongs to org
    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        orgId: req.org.id,
      },
    });

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    // Verify leave type
    const leaveType = await prisma.leaveType.findFirst({
      where: {
        id: leaveTypeId,
        orgId: req.org.id,
        isActive: true,
      },
    });

    if (!leaveType) {
      res.status(404).json({ error: 'Leave type not found' });
      return;
    }

    // Calculate days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    if (days < 1) {
      res.status(400).json({ error: 'End date must be after start date' });
      return;
    }

    // Check leave balance
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
      // Create initial balance
      leaveBalance = await prisma.leaveBalance.create({
        data: {
          orgId: req.org.id,
          employeeId,
          leaveTypeId,
          year: currentYear,
          totalDays: leaveType.maxDays || 0,
          remainingDays: leaveType.maxDays || 0,
        },
      });
    }

    if (leaveType.maxDays && leaveBalance.remainingDays < days) {
      res.status(400).json({
        error: `Insufficient leave balance. Available: ${leaveBalance.remainingDays} days, Requested: ${days} days`,
      });
      return;
    }

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        orgId: req.org.id,
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

    // If auto-approved, update balance
    if (!leaveType.requiresApproval) {
      await prisma.leaveBalance.update({
        where: { id: leaveBalance.id },
        data: {
          usedDays: leaveBalance.usedDays + days,
          remainingDays: leaveBalance.remainingDays - days,
        },
      });
    }

    res.status(201).json(leaveRequest);
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

    // Update leave balance
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
          usedDays: leaveBalance.usedDays + leaveRequest.days,
          remainingDays: leaveBalance.remainingDays - leaveRequest.days,
        },
      });
    }

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

    res.json(updated);
  } catch (error) {
    console.error('Error rejecting leave request:', error);
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

export default router;

