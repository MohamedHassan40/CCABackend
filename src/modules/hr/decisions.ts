import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// GET /api/hr/decisions/deductions - List absence/delay deduction decisions
router.get('/deductions', requirePermission('hr.decisions.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, startDate, endDate, reason } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (employeeId && typeof employeeId === 'string') {
      where.employeeId = employeeId;
    }
    if (reason && typeof reason === 'string') {
      where.reason = reason;
    }
    if (startDate && typeof startDate === 'string') {
      where.decisionDate = { ...where.decisionDate, gte: new Date(startDate) };
    }
    if (endDate && typeof endDate === 'string') {
      where.decisionDate = { ...where.decisionDate, lte: new Date(endDate) };
    }

    const decisions = await prisma.absenceDeductionDecision.findMany({
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
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        decisionDate: 'desc',
      },
    });

    res.json(decisions);
  } catch (error) {
    console.error('Error fetching deduction decisions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/decisions/deductions - Create absence/delay deduction decision
router.post('/deductions', requirePermission('hr.decisions.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, decisionDate, reason } = req.body;

    if (!employeeId || !decisionDate) {
      res.status(400).json({
        error: 'Employee and date are required',
      });
      return;
    }

    const validReasons = ['absence', 'attendance_violation'];
    const finalReason = validReasons.includes(reason) ? reason : 'absence';

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

    const date = new Date(decisionDate);
    if (isNaN(date.getTime())) {
      res.status(400).json({ error: 'Invalid date' });
      return;
    }

    const decision = await prisma.absenceDeductionDecision.create({
      data: {
        orgId: req.org.id,
        employeeId,
        decisionDate: date,
        reason: finalReason,
        createdById: req.user?.id ?? null,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json(decision);
  } catch (error) {
    console.error('Error creating deduction decision:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
