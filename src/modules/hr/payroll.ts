import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';
import { createNotification } from '../../core/notifications/helper';
import { createAuditLog } from '../../middleware/audit';

const router = Router();

// GET /api/hr/payroll - Get payroll records (supports ?limit=50&offset=0)
router.get('/', requirePermission('hr.payroll.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, startDate, endDate, status, limit: qLimit, offset: qOffset, page } = req.query;
    const limit = Math.min(parseInt(String(qLimit || 50), 10) || 50, 200);
    const offset = parseInt(String(qOffset || 0), 10) || 0;
    const pageNum = parseInt(String(page), 10);
    const skip = pageNum >= 1 ? (pageNum - 1) * limit : offset;

    const where: any = {
      orgId: req.org.id,
    };

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    if (startDate && endDate) {
      where.payPeriodStart = {
        gte: new Date(startDate as string),
      };
      where.payPeriodEnd = {
        lte: new Date(endDate as string),
      };
    }

    if (status) {
      where.status = status;
    }

    const [records, total] = await Promise.all([
      prisma.payrollRecord.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              email: true,
              department: true,
              position: true,
            },
          },
        },
        orderBy: { payPeriodStart: 'desc' },
        take: limit,
        skip,
      }),
      prisma.payrollRecord.count({ where }),
    ]);

    res.json({ data: records, total, limit, offset: skip });
  } catch (error) {
    console.error('Error fetching payroll records:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/payroll/export - Export payroll records as CSV (same filters as list)
router.get('/export', requirePermission('hr.payroll.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, startDate, endDate, status } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    if (startDate && endDate) {
      where.payPeriodStart = {
        gte: new Date(startDate as string),
      };
      where.payPeriodEnd = {
        lte: new Date(endDate as string),
      };
    }

    if (status) {
      where.status = status;
    }

    const records = await prisma.payrollRecord.findMany({
      where,
      include: {
        employee: {
          select: {
            fullName: true,
            email: true,
            department: true,
            position: true,
          },
        },
      },
      orderBy: { payPeriodStart: 'desc' },
      take: 10000,
    });

    const escape = (v: string | number | null | undefined) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const headers = [
      'Employee',
      'Email',
      'Department',
      'Position',
      'Period Start',
      'Period End',
      'Base Salary',
      'Allowances',
      'Deductions',
      'Tax',
      'Net Salary',
      'Currency',
      'Status',
      'Paid At',
    ];
    const rows = records.map((r) => [
      r.employee.fullName,
      r.employee.email ?? '',
      r.employee.department ?? '',
      r.employee.position ?? '',
      r.payPeriodStart.toISOString().slice(0, 10),
      r.payPeriodEnd.toISOString().slice(0, 10),
      (r.baseSalary / 100).toFixed(2),
      (r.allowances / 100).toFixed(2),
      (r.deductions / 100).toFixed(2),
      (r.taxAmount / 100).toFixed(2),
      (r.netSalary / 100).toFixed(2),
      r.currency,
      r.status,
      r.paidAt ? r.paidAt.toISOString().slice(0, 10) : '',
    ]);

    const csv =
      headers.map(escape).join(',') +
      '\n' +
      rows.map((row) => row.map(escape).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payroll-export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting payroll:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/payroll - Create payroll record
router.post('/', requirePermission('hr.payroll.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      employeeId,
      payPeriodStart,
      payPeriodEnd,
      baseSalary,
      allowances,
      deductions,
      taxAmount,
      currency,
      payslipUrl,
    } = req.body;

    if (!employeeId || !payPeriodStart || !payPeriodEnd || baseSalary === undefined) {
      res.status(400).json({ error: 'Employee, pay period, and base salary are required' });
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

    const base = Number(baseSalary);
    const allow = Number(allowances || 0);
    const deduct = Number(deductions || 0);
    const tax = Number(taxAmount || 0);
    if (base < 0 || allow < 0 || deduct < 0 || tax < 0) {
      res.status(400).json({ error: 'Base salary, allowances, deductions, and tax cannot be negative' });
      return;
    }

    const periodStart = new Date(payPeriodStart);
    const periodEnd = new Date(payPeriodEnd);
    if (periodStart >= periodEnd) {
      res.status(400).json({ error: 'Pay period end must be after pay period start' });
      return;
    }

    const overlapping = await prisma.payrollRecord.findFirst({
      where: {
        employeeId,
        OR: [
          { payPeriodStart: { lte: periodEnd }, payPeriodEnd: { gte: periodStart } },
        ],
      },
    });
    if (overlapping) {
      res.status(400).json({ error: 'Overlapping pay period exists for this employee' });
      return;
    }

    const netSalary = base + allow - deduct - tax;

    const payrollRecord = await prisma.payrollRecord.create({
      data: {
        orgId: req.org.id,
        employeeId,
        payPeriodStart: periodStart,
        payPeriodEnd: periodEnd,
        baseSalary: base,
        allowances: allow,
        deductions: deduct,
        taxAmount: tax,
        netSalary,
        currency: 'SAR',
        status: 'draft',
        ...(payslipUrl !== undefined && payslipUrl !== null && payslipUrl !== '' && { payslipUrl: String(payslipUrl) }),
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json(payrollRecord);
  } catch (error) {
    console.error('Error creating payroll record:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/payroll/:id - Update payroll record
router.put('/:id', requirePermission('hr.payroll.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { baseSalary, allowances, deductions, taxAmount, status, payslipUrl } = req.body;

    const payrollRecord = await prisma.payrollRecord.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: { employee: { select: { userId: true } } },
    });

    if (!payrollRecord) {
      res.status(404).json({ error: 'Payroll record not found' });
      return;
    }

    const base = baseSalary !== undefined ? baseSalary : payrollRecord.baseSalary;
    const allow = allowances !== undefined ? allowances : payrollRecord.allowances;
    const deduct = deductions !== undefined ? deductions : payrollRecord.deductions;
    const tax = taxAmount !== undefined ? taxAmount : payrollRecord.taxAmount;
    const netSalary = base + allow - deduct - tax;

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: {
        ...(baseSalary !== undefined && { baseSalary }),
        ...(allowances !== undefined && { allowances }),
        ...(deductions !== undefined && { deductions }),
        ...(taxAmount !== undefined && { taxAmount }),
        ...(netSalary !== undefined && { netSalary }),
        currency: 'SAR', // Only SAR (Saudi Riyal) is supported - always enforce
        ...(status && { status }),
        ...(payslipUrl !== undefined && { payslipUrl }),
        ...(status === 'paid' && !payrollRecord.paidAt && { paidAt: new Date() }),
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (status === 'paid' && !payrollRecord.paidAt && payrollRecord.employee.userId) {
      createNotification({
        userId: payrollRecord.employee.userId,
        organizationId: req.org!.id,
        type: 'success',
        title: 'Payroll paid',
        message: 'Your payroll has been marked as paid.',
        link: '/dashboard/hr/payroll',
      }).catch(() => {});
    }
    if (status === 'paid' && !payrollRecord.paidAt) {
      createAuditLog({
        userId: req.user?.id ?? null,
        organizationId: req.org!.id,
        action: 'mark_paid',
        resourceType: 'payroll_record',
        resourceId: id,
        details: { payrollRecordId: id, employeeId: payrollRecord.employee.id },
        req,
      }).catch(() => {});
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating payroll record:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/payroll/:id/approve - Approve payroll record
router.put('/:id/approve', requirePermission('hr.payroll.approve'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const payrollRecord = await prisma.payrollRecord.findFirst({
      where: {
        id,
        orgId: req.org.id,
        status: 'draft',
      },
      include: { employee: { select: { id: true, fullName: true, email: true, userId: true } } },
    });

    if (!payrollRecord) {
      res.status(404).json({ error: 'Payroll record not found or already processed' });
      return;
    }

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: {
        status: 'approved',
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (payrollRecord.employee.userId) {
      createNotification({
        userId: payrollRecord.employee.userId,
        organizationId: req.org.id,
        type: 'info',
        title: 'Payroll approved',
        message: 'Your payroll record has been approved.',
        link: '/dashboard/hr/payroll',
      }).catch(() => {});
    }

    createAuditLog({
      userId: req.user?.id ?? null,
      organizationId: req.org.id,
      action: 'approve',
      resourceType: 'payroll_record',
      resourceId: id,
      details: { payrollRecordId: id, employeeId: payrollRecord.employee.id },
      req,
    }).catch(() => {});

    res.json(updated);
  } catch (error) {
    console.error('Error approving payroll record:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/payroll/reports - Get payroll reports
router.get('/reports', requirePermission('hr.payroll.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json({ error: 'Start date and end date are required' });
      return;
    }

    const records = await prisma.payrollRecord.findMany({
      where: {
        orgId: req.org.id,
        payPeriodStart: {
          gte: new Date(startDate as string),
        },
        payPeriodEnd: {
          lte: new Date(endDate as string),
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            department: true,
          },
        },
      },
    });

    const stats = {
      totalRecords: records.length,
      totalBaseSalary: records.reduce((sum, r) => sum + r.baseSalary, 0),
      totalAllowances: records.reduce((sum, r) => sum + r.allowances, 0),
      totalDeductions: records.reduce((sum, r) => sum + r.deductions, 0),
      totalTax: records.reduce((sum, r) => sum + r.taxAmount, 0),
      totalNetSalary: records.reduce((sum, r) => sum + r.netSalary, 0),
      paidRecords: records.filter((r) => r.status === 'paid').length,
    };

    res.json({
      records,
      statistics: stats,
    });
  } catch (error) {
    console.error('Error fetching payroll reports:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

