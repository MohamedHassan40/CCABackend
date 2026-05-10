import { Router, Request, Response } from 'express';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';
import { requireModuleEnabled } from '../middleware/modules';
import { submitLeaveRequestForEmployee } from '../modules/hr/leaveRequestSubmit';

const router = Router();

async function requireLinkedEmployee(req: Request, res: Response) {
  if (!req.user || !req.org) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const employee = await prisma.employee.findFirst({
    where: {
      orgId: req.org.id,
      userId: req.user.id,
    },
    select: {
      id: true,
      orgId: true,
      fullName: true,
      email: true,
    },
  });
  if (!employee) {
    res.status(403).json({ error: 'No employee profile linked to this account' });
    return null;
  }
  return employee;
}

// GET /api/me/workspace — aggregated view for the signed-in employee (no HR permission required)
router.get('/workspace', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: {
        orgId: req.org.id,
        userId: req.user.id,
      },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        position: true,
        photoUrl: true,
        email: true,
        department: true,
        departmentRef: { select: { id: true, name: true, nameAr: true } },
      },
    });

    if (!employee) {
      res.json({
        employee: null,
        leaveRequests: [],
        employeeRequests: [],
        jobApplications: [],
        tickets: [],
      });
      return;
    }

    const applicantMatch = [
      ...new Set(
        [employee.email, req.user.email]
          .map((e) => (typeof e === 'string' ? e.trim() : ''))
          .filter(Boolean)
      ),
    ];

    const [leaveRequests, employeeRequests, jobApplications, tickets] = await Promise.all([
      prisma.leaveRequest.findMany({
        where: { orgId: req.org.id, employeeId: employee.id },
        take: 25,
        orderBy: { createdAt: 'desc' },
        include: {
          leaveType: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.employeeRequest.findMany({
        where: { orgId: req.org.id, employeeId: employee.id },
        take: 25,
        orderBy: { createdAt: 'desc' },
        include: {
          approvedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.jobApplication.findMany({
        where: {
          orgId: req.org.id,
          OR: [
            { employeeId: employee.id },
            ...applicantMatch.map((email) => ({
              applicantEmail: { equals: email, mode: 'insensitive' as const },
            })),
          ],
        },
        take: 25,
        orderBy: { createdAt: 'desc' },
        include: {
          jobPosting: { select: { id: true, title: true, status: true } },
        },
      }),
      prisma.ticket.findMany({
        where: {
          orgId: req.org.id,
          OR: [
            { assigneeId: req.user.id },
            { createdById: req.user.id },
            ...applicantMatch.map((email) => ({
              submittedByEmail: { equals: email, mode: 'insensitive' as const },
            })),
          ],
        },
        take: 25,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          description: true,
          submittedByEmail: true,
          assigneeId: true,
          createdById: true,
          updatedAt: true,
          createdAt: true,
          category: { select: { id: true, name: true, color: true } },
        },
      }),
    ]);

    res.json({
      employee,
      leaveRequests,
      employeeRequests,
      jobApplications,
      tickets,
    });
  } catch (error) {
    console.error('Error in GET /api/me/workspace:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Self-service HR (linked employee only; HR module must be enabled for org) ---

router.get('/hr-self/leave-types', authMiddleware, requireModuleEnabled('hr'), async (req: Request, res: Response) => {
  try {
    const emp = await requireLinkedEmployee(req, res);
    if (!emp) return;

    const types = await prisma.leaveType.findMany({
      where: { orgId: req.org!.id, isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json(types);
  } catch (error) {
    console.error('Error in GET /api/me/hr-self/leave-types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/hr-self/leave-requests', authMiddleware, requireModuleEnabled('hr'), async (req: Request, res: Response) => {
  try {
    const emp = await requireLinkedEmployee(req, res);
    if (!emp) return;

    const rows = await prisma.leaveRequest.findMany({
      where: { orgId: req.org!.id, employeeId: emp.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        leaveType: true,
        approvedBy: { select: { id: true, name: true, email: true } },
      },
    });
    res.json(rows);
  } catch (error) {
    console.error('Error in GET /api/me/hr-self/leave-requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/hr-self/leave-requests', authMiddleware, requireModuleEnabled('hr'), async (req: Request, res: Response) => {
  try {
    const emp = await requireLinkedEmployee(req, res);
    if (!emp) return;

    const { leaveTypeId, startDate, endDate, reason } = req.body;
    if (!leaveTypeId || !startDate || !endDate) {
      res.status(400).json({ error: 'Leave type, start date, and end date are required' });
      return;
    }

    const result = await submitLeaveRequestForEmployee({
      orgId: req.org!.id,
      employeeId: emp.id,
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
    console.error('Error in POST /api/me/hr-self/leave-requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/hr-self/employee-requests', authMiddleware, requireModuleEnabled('hr'), async (req: Request, res: Response) => {
  try {
    const emp = await requireLinkedEmployee(req, res);
    if (!emp) return;

    const rows = await prisma.employeeRequest.findMany({
      where: { orgId: req.org!.id, employeeId: emp.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        approvedBy: { select: { id: true, name: true, email: true } },
        attachments: { select: { id: true, fileName: true, url: true, mimeType: true } },
      },
    });
    res.json(rows);
  } catch (error) {
    console.error('Error in GET /api/me/hr-self/employee-requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/hr-self/employee-requests', authMiddleware, requireModuleEnabled('hr'), async (req: Request, res: Response) => {
  try {
    const emp = await requireLinkedEmployee(req, res);
    if (!emp || !req.user) return;

    const { requestType, title, description, priority } = req.body;
    if (!requestType || !title || !description) {
      res.status(400).json({ error: 'Request type, title, and description are required' });
      return;
    }

    const created = await prisma.employeeRequest.create({
      data: {
        orgId: req.org!.id,
        employeeId: emp.id,
        requestType: String(requestType),
        title: String(title),
        description: String(description),
        priority: priority || 'medium',
        createdById: req.user.id,
      },
      include: {
        approvedBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Error in POST /api/me/hr-self/employee-requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
