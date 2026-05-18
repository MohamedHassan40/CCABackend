import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';
import { requireModuleEnabled } from '../middleware/modules';
import { submitLeaveRequestForEmployee } from '../modules/hr/leaveRequestSubmit';
import { getUserPermissionKeys } from '../core/permissions/membershipPermissions';

const router = Router();

const frontendUrl = () => process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';

function generateQrToken(): string {
  return crypto.randomBytes(12).toString('base64url');
}

function formatMembershipNumber(
  prefix: string | null | undefined,
  padLength: number | null | undefined,
  seq: number | null | undefined
): string | null {
  if (seq == null) return null;
  const pad = Math.min(Math.max(padLength ?? 5, 1), 12);
  const num = String(seq).padStart(pad, '0');
  const p = (prefix ?? '').trim();
  if (!p) return num;
  return `${p}-${num}`;
}

function applicantEmails(employeeEmail: string | null | undefined, userEmail: string | null | undefined) {
  return [
    ...new Set(
      [employeeEmail, userEmail]
        .map((e) => (typeof e === 'string' ? e.trim() : ''))
        .filter(Boolean)
    ),
  ];
}

function daysUntil(date: Date): number {
  const ms = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

async function requireHrSelfService(req: Request, res: Response): Promise<boolean> {
  if (!req.user || !req.org) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (req.user.isSuperAdmin) return true;
  const keys = await getUserPermissionKeys(req.user.id, req.org.id);
  if (keys.has('hr.self_service')) return true;
  // Legacy: linked employee with any HR admin permission
  if (
    keys.has('hr.leave.create') ||
    keys.has('hr.requests.create') ||
    keys.has('hr.employees.view')
  ) {
    return true;
  }
  res.status(403).json({
    error: 'HR employee self-service role required (assign HR Employee role)',
  });
  return false;
}

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
        phone: true,
        hireDate: true,
        salary: true,
        employmentType: true,
        department: true,
        departmentRef: { select: { id: true, name: true, nameAr: true } },
        reportsTo: { select: { id: true, fullName: true, employeeCode: true } },
      },
    });

    if (!employee) {
      res.json({
        employee: null,
        leaveRequests: [],
        employeeRequests: [],
        jobApplications: [],
        tickets: [],
        leaveBalances: [],
        stats: null,
        membership: null,
        recentPayroll: null,
      });
      return;
    }

    const applicantMatch = applicantEmails(employee.email, req.user.email);
    const currentYear = new Date().getFullYear();
    const ticketWhere = {
      orgId: req.org.id,
      OR: [
        { assigneeId: req.user.id },
        { createdById: req.user.id },
        ...applicantMatch.map((email) => ({
          submittedByEmail: { equals: email, mode: 'insensitive' as const },
        })),
      ],
    };

    const [
      leaveRequests,
      employeeRequests,
      jobApplications,
      tickets,
      leaveBalances,
      ticketTotal,
      ticketOpen,
      pendingLeaveCount,
      pendingRequestCount,
      activeAssetCount,
      recentPayroll,
      membershipRecord,
    ] = await Promise.all([
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
        where: ticketWhere,
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
      prisma.leaveBalance.findMany({
        where: { orgId: req.org.id, employeeId: employee.id, year: currentYear },
        include: { leaveType: { select: { id: true, name: true, isPaid: true } } },
        orderBy: { leaveType: { name: 'asc' } },
      }),
      prisma.ticket.count({ where: ticketWhere }),
      prisma.ticket.count({
        where: {
          ...ticketWhere,
          status: { in: ['open', 'in_progress', 'pending'] },
        },
      }),
      prisma.leaveRequest.count({
        where: { orgId: req.org.id, employeeId: employee.id, status: 'pending' },
      }),
      prisma.employeeRequest.count({
        where: { orgId: req.org.id, employeeId: employee.id, status: 'pending' },
      }),
      prisma.inventoryAssignment.count({
        where: { orgId: req.org.id, employeeId: employee.id, status: 'active' },
      }),
      prisma.payrollRecord.findFirst({
        where: { orgId: req.org.id, employeeId: employee.id, status: { in: ['paid', 'approved'] } },
        orderBy: { payPeriodEnd: 'desc' },
        select: {
          id: true,
          payPeriodStart: true,
          payPeriodEnd: true,
          netSalary: true,
          currency: true,
          status: true,
          paidAt: true,
        },
      }),
      applicantMatch.length > 0
        ? prisma.memberMembership.findFirst({
            where: {
              orgId: req.org.id,
              status: { in: ['active', 'pending'] },
              OR: applicantMatch.map((email) => ({
                memberEmail: { equals: email, mode: 'insensitive' as const },
              })),
            },
            orderBy: { endDate: 'desc' },
            include: {
              membershipType: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve(null),
    ]);

    const vacationDaysRemaining = leaveBalances.reduce((sum, b) => sum + b.remainingDays, 0);

    const membership = membershipRecord
      ? {
          id: membershipRecord.id,
          memberName: membershipRecord.memberName,
          status: membershipRecord.status,
          membershipTypeName: membershipRecord.membershipType.name,
          startDate: membershipRecord.startDate,
          endDate: membershipRecord.endDate,
          daysRemaining: daysUntil(membershipRecord.endDate),
        }
      : null;

    res.json({
      employee,
      leaveRequests,
      employeeRequests,
      jobApplications,
      tickets,
      leaveBalances,
      stats: {
        vacationDaysRemaining,
        pendingLeaveRequests: pendingLeaveCount,
        pendingEmployeeRequests: pendingRequestCount,
        ticketCount: ticketTotal,
        openTicketCount: ticketOpen,
        activeAssetCount,
      },
      membership,
      recentPayroll,
    });
  } catch (error) {
    console.error('Error in GET /api/me/workspace:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/me/membership-card — own digital membership card (matched by employee/user email)
router.get('/membership-card', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { orgId: req.org.id, userId: req.user.id },
      select: { email: true },
    });
    const emails = applicantEmails(employee?.email, req.user.email);
    if (emails.length === 0) {
      res.status(404).json({ error: 'No membership linked to your account email' });
      return;
    }

    const membership = await prisma.memberMembership.findFirst({
      where: {
        orgId: req.org.id,
        status: { in: ['active', 'pending'] },
        OR: emails.map((email) => ({
          memberEmail: { equals: email, mode: 'insensitive' as const },
        })),
      },
      orderBy: { endDate: 'desc' },
      include: {
        membershipType: { include: { cardDesign: true } },
        cardDesign: true,
        organization: {
          select: {
            name: true,
            slug: true,
            membershipNumberPrefix: true,
            membershipNumberPadLength: true,
          },
        },
      },
    });

    if (!membership) {
      res.status(404).json({ error: 'No membership linked to your account email' });
      return;
    }

    const membershipNumberDisplay = formatMembershipNumber(
      membership.organization.membershipNumberPrefix,
      membership.organization.membershipNumberPadLength,
      membership.membershipSeq
    );

    let qrToken = membership.qrToken;
    if (!qrToken) {
      qrToken = generateQrToken();
      await prisma.memberMembership.update({
        where: { id: membership.id },
        data: { qrToken },
      });
    }

    let design =
      membership.membershipType.cardDesign ?? membership.cardDesign ?? null;
    if (!design) {
      design = await prisma.membershipCardDesign.findFirst({
        where: { orgId: req.org.id, isDefault: true },
      });
    }
    if (!design) {
      design = await prisma.membershipCardDesign.findFirst({
        where: { orgId: req.org.id },
      });
    }

    const verifyUrl = `${frontendUrl()}/verify/membership/${qrToken}`;

    res.json({
      membership: {
        id: membership.id,
        memberName: membership.memberName,
        memberEmail: membership.memberEmail,
        memberPhone: membershipNumberDisplay ? null : membership.memberPhone,
        membershipNumberDisplay,
        status: membership.status,
        startDate: membership.startDate,
        endDate: membership.endDate,
        qrToken,
        membershipType: membership.membershipType,
        organization: membership.organization,
      },
      design: design
        ? {
            id: design.id,
            name: design.name,
            layout: design.layout,
            primaryColor: design.primaryColor,
            secondaryColor: design.secondaryColor,
            accentColor: design.accentColor,
            logoUrl: design.logoUrl,
            showQR: design.showQR,
            qrPosition: design.qrPosition,
            showMemberId: design.showMemberId,
            memberIdPrefix: design.memberIdPrefix,
            fontFamily: design.fontFamily,
          }
        : {
            name: 'Default',
            layout: 'standard',
            primaryColor: '#1e3a5f',
            secondaryColor: '#3b82f6',
            accentColor: null,
            logoUrl: null,
            showQR: true,
            qrPosition: 'right',
            showMemberId: true,
            memberIdPrefix: null,
            fontFamily: 'sans-serif',
          },
      verifyUrl,
    });
  } catch (error) {
    console.error('Error in GET /api/me/membership-card:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/me/membership-card/qr — QR image for own membership card
router.get('/membership-card/qr', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { orgId: req.org.id, userId: req.user.id },
      select: { email: true },
    });
    const emails = applicantEmails(employee?.email, req.user.email);
    if (emails.length === 0) {
      res.status(404).json({ error: 'No membership linked to your account email' });
      return;
    }

    const membership = await prisma.memberMembership.findFirst({
      where: {
        orgId: req.org.id,
        status: { in: ['active', 'pending'] },
        OR: emails.map((email) => ({
          memberEmail: { equals: email, mode: 'insensitive' as const },
        })),
      },
      orderBy: { endDate: 'desc' },
      select: { id: true, qrToken: true },
    });

    if (!membership) {
      res.status(404).json({ error: 'No membership linked to your account email' });
      return;
    }

    let qrToken = membership.qrToken;
    if (!qrToken) {
      qrToken = generateQrToken();
      await prisma.memberMembership.update({
        where: { id: membership.id },
        data: { qrToken },
      });
    }

    const verifyUrl = `${frontendUrl()}/membership/verify/${qrToken}`;
    const pngBuffer = await QRCode.toBuffer(verifyUrl, { type: 'png', width: 256, margin: 2 });

    res.set('Content-Type', 'image/png');
    res.send(pngBuffer);
  } catch (error: any) {
    console.error('Error in GET /api/me/membership-card/qr:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// --- Self-service HR (linked employee only; HR module must be enabled for org) ---

router.get('/hr-self/leave-types', authMiddleware, requireModuleEnabled('hr'), async (req: Request, res: Response) => {
  try {
    if (!(await requireHrSelfService(req, res))) return;
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
    if (!(await requireHrSelfService(req, res))) return;
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
    if (!(await requireHrSelfService(req, res))) return;
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
    if (!(await requireHrSelfService(req, res))) return;
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
    if (!(await requireHrSelfService(req, res))) return;
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
