import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// GET /api/hr/attendance - Get attendance records
router.get('/', requirePermission('hr.attendance.view'), async (req, res) => {
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
      where.date = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      };
    }

    if (status) {
      where.status = status;
    }

    const records = await prisma.attendanceRecord.findMany({
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
      },
      orderBy: {
        date: 'desc',
      },
    });

    res.json(records);
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/attendance - Create/update attendance record
router.post('/', requirePermission('hr.attendance.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, date, clockIn, clockOut, breakDuration, status, notes } = req.body;

    if (!employeeId || !date) {
      res.status(400).json({ error: 'Employee ID and date are required' });
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

    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    // Calculate total hours if clock in/out provided
    let totalHours: number | null = null;
    if (clockIn && clockOut) {
      const clockInTime = new Date(clockIn);
      const clockOutTime = new Date(clockOut);
      const diffMs = clockOutTime.getTime() - clockInTime.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      const breakHours = breakDuration ? breakDuration / 60 : 0;
      totalHours = Math.max(0, diffHours - breakHours);
    }

    // Upsert attendance record
    const record = await prisma.attendanceRecord.upsert({
      where: {
        employeeId_date: {
          employeeId,
          date: attendanceDate,
        },
      },
      update: {
        ...(clockIn && { clockIn: new Date(clockIn) }),
        ...(clockOut && { clockOut: new Date(clockOut) }),
        ...(breakDuration !== undefined && { breakDuration }),
        ...(totalHours !== null && { totalHours }),
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
      },
      create: {
        orgId: req.org.id,
        employeeId,
        date: attendanceDate,
        clockIn: clockIn ? new Date(clockIn) : null,
        clockOut: clockOut ? new Date(clockOut) : null,
        breakDuration: breakDuration || null,
        totalHours,
        status: status || 'present',
        notes: notes || null,
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

    res.status(201).json(record);
  } catch (error) {
    console.error('Error creating attendance record:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/attendance/clock-in - Clock in
router.post('/clock-in', requirePermission('hr.attendance.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId } = req.body;

    // Find employee by user ID if employeeId not provided
    let employee;
    if (employeeId) {
      employee = await prisma.employee.findFirst({
        where: {
          id: employeeId,
          orgId: req.org.id,
        },
      });
    } else {
      employee = await prisma.employee.findFirst({
        where: {
          userId: req.user.id,
          orgId: req.org.id,
        },
      });
    }

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const record = await prisma.attendanceRecord.upsert({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today,
        },
      },
      update: {
        clockIn: new Date(),
        status: 'present',
      },
      create: {
        orgId: req.org.id,
        employeeId: employee.id,
        date: today,
        clockIn: new Date(),
        status: 'present',
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });

    res.json(record);
  } catch (error) {
    console.error('Error clocking in:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/attendance/clock-out - Clock out
router.post('/clock-out', requirePermission('hr.attendance.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, breakDuration } = req.body;

    // Find employee by user ID if employeeId not provided
    let employee;
    if (employeeId) {
      employee = await prisma.employee.findFirst({
        where: {
          id: employeeId,
          orgId: req.org.id,
        },
      });
    } else {
      employee = await prisma.employee.findFirst({
        where: {
          userId: req.user.id,
          orgId: req.org.id,
        },
      });
    }

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.attendanceRecord.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today,
        },
      },
    });

    if (!existing || !existing.clockIn) {
      res.status(400).json({ error: 'Must clock in before clocking out' });
      return;
    }

    const clockOutTime = new Date();
    const clockInTime = existing.clockIn;
    const diffMs = clockOutTime.getTime() - clockInTime.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const breakHours = breakDuration ? breakDuration / 60 : 0;
    const totalHours = Math.max(0, diffHours - breakHours);

    const record = await prisma.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        clockOut: clockOutTime,
        breakDuration: breakDuration || null,
        totalHours,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });

    res.json(record);
  } catch (error) {
    console.error('Error clocking out:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/attendance/reports - Get attendance reports
router.get('/reports', requirePermission('hr.attendance.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate, employeeId } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json({ error: 'Start date and end date are required' });
      return;
    }

    const where: any = {
      orgId: req.org.id,
      date: {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      },
    };

    if (employeeId) {
      where.employeeId = employeeId;
    }

    const records = await prisma.attendanceRecord.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            department: true,
          },
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    // Calculate statistics
    const stats = {
      totalDays: records.length,
      presentDays: records.filter((r) => r.status === 'present').length,
      absentDays: records.filter((r) => r.status === 'absent').length,
      lateDays: records.filter((r) => r.status === 'late').length,
      totalHours: records.reduce((sum, r) => sum + (r.totalHours || 0), 0),
      averageHours: 0,
    };

    const presentRecords = records.filter((r) => r.totalHours !== null);
    if (presentRecords.length > 0) {
      stats.averageHours = stats.totalHours / presentRecords.length;
    }

    res.json({
      records,
      statistics: stats,
    });
  } catch (error) {
    console.error('Error fetching attendance reports:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

