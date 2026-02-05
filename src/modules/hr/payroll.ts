import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// GET /api/hr/payroll - Get payroll records
router.get('/', requirePermission('hr.payroll.view'), async (req, res) => {
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
            id: true,
            fullName: true,
            email: true,
            department: true,
            position: true,
          },
        },
      },
      orderBy: {
        payPeriodStart: 'desc',
      },
    });

    res.json(records);
  } catch (error) {
    console.error('Error fetching payroll records:', error);
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

    const netSalary = baseSalary + (allowances || 0) - (deductions || 0) - (taxAmount || 0);

    const payrollRecord = await prisma.payrollRecord.create({
      data: {
        orgId: req.org.id,
        employeeId,
        payPeriodStart: new Date(payPeriodStart),
        payPeriodEnd: new Date(payPeriodEnd),
        baseSalary,
        allowances: allowances || 0,
        deductions: deductions || 0,
        taxAmount: taxAmount || 0,
        netSalary,
        currency: 'SAR', // Only SAR (Saudi Riyal) is supported
        status: 'draft',
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

