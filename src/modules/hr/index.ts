import { Router } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import { hashPassword } from '../../core/auth/password';
import type { ModuleManifest } from '@cloud-org/shared';

// Import sub-routers
import leaveRouter from './leave';
import attendanceRouter from './attendance';
import payrollRouter from './payroll';
import recruitmentRouter from './recruitment';
import performanceRouter from './performance';
import tasksRouter from './tasks';
import calendarRouter from './calendar';
import decisionsRouter from './decisions';
import announcementsRouter from './announcements';
import complaintsRouter from './complaints';
import requestsRouter from './requests';
import assetsRouter from './assets';
import { formatEmployeeCode, parseEmployeeCode, syncOrgEmployeeCodeSequence } from './employeeCode';

const router = Router();

/** Allocate or validate employee display ID (org-scoped, must end with digits). */
async function resolveNewEmployeeCodeForOrg(
  orgId: string,
  rawInput: unknown
): Promise<{ code: string } | { error: string; status: number }> {
  const trimmed = typeof rawInput === 'string' ? rawInput.trim() : '';
  const orgCodeState = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      employeeCodePrefix: true,
      employeeCodePadLength: true,
      employeeCodeNextSeq: true,
      employeeIdSchemeLocked: true,
    },
  });

  if (orgCodeState?.employeeIdSchemeLocked && trimmed) {
    return {
      error:
        'Employee IDs are set by the organization scheme and cannot be set manually.',
      status: 400,
    };
  }

  if (!trimmed) {
    if (
      orgCodeState?.employeeCodePrefix != null &&
      orgCodeState.employeeCodePadLength != null &&
      orgCodeState.employeeCodeNextSeq != null
    ) {
      let seq = orgCodeState.employeeCodeNextSeq;
      let candidate = formatEmployeeCode(
        orgCodeState.employeeCodePrefix,
        seq,
        orgCodeState.employeeCodePadLength
      );
      for (let attempt = 0; attempt < 120; attempt++) {
        const exists = await prisma.employee.findFirst({
          where: { orgId, employeeCode: candidate },
        });
        if (!exists) return { code: candidate };
        seq += 1;
        candidate = formatEmployeeCode(
          orgCodeState.employeeCodePrefix,
          seq,
          orgCodeState.employeeCodePadLength
        );
      }
      return { error: 'Could not allocate a unique employee ID', status: 500 };
    }
    // No org numbering scheme yet: assign sequential EMP-001, EMP-002, … (ends with digits for validation)
    const existing = await prisma.employee.findMany({
      where: { orgId },
      select: { employeeCode: true },
    });
    const used = new Set(
      existing.map((e) => e.employeeCode).filter((c): c is string => Boolean(c))
    );
    let seq = 1;
    for (let attempt = 0; attempt < 10000; attempt++) {
      const candidate = `EMP-${String(seq).padStart(3, '0')}`;
      if (!used.has(candidate)) {
        return { code: candidate };
      }
      seq += 1;
    }
    return { error: 'Could not allocate a unique employee ID', status: 500 };
  }

  const parsed = parseEmployeeCode(trimmed);
  if (!parsed) {
    return {
      error: 'Employee ID must end with a number (e.g. Emp-01 or Employee - 00001)',
      status: 400,
    };
  }

  const dup = await prisma.employee.findFirst({
    where: { orgId, employeeCode: trimmed },
  });
  if (dup) {
    return { error: 'This employee ID is already in use', status: 409 };
  }

  return { code: trimmed };
}

async function assertOrgOwnerOrAdmin(userId: string, organizationId: string): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId, organizationId },
    },
    include: {
      membershipRoles: { include: { role: true } },
    },
  });
  if (!membership) return false;
  return membership.membershipRoles.some(
    (mr) => mr.role.key === 'owner' || mr.role.key === 'admin'
  );
}

function trimOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function parseOptionalDate(value: unknown): Date | null {
  if (value == null) return null;
  const s = typeof value === 'string' ? value.trim() : '';
  if (s === '') return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Interpret body salary as major currency units (e.g. 3500.50 → cents). */
function parseSalaryCents(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

const EMPLOYEE_PROFILE_KEYS = [
  'photoUrl',
  'phone',
  'hireDate',
  'notes',
  'salary',
  'employmentType',
  'dateOfBirth',
  'nationality',
  'religion',
  'gender',
  'maritalStatus',
  'address',
  'city',
  'country',
  'emergencyContactName',
  'emergencyContactPhone',
  'governmentId',
] as const;

function profileForCreate(body: Record<string, unknown>) {
  return {
    photoUrl: trimOrNull(body.photoUrl),
    phone: trimOrNull(body.phone),
    hireDate: parseOptionalDate(body.hireDate),
    notes: trimOrNull(body.notes),
    salary: parseSalaryCents(body.salary),
    employmentType: trimOrNull(body.employmentType),
    dateOfBirth: parseOptionalDate(body.dateOfBirth),
    nationality: trimOrNull(body.nationality),
    religion: trimOrNull(body.religion),
    gender: trimOrNull(body.gender),
    maritalStatus: trimOrNull(body.maritalStatus),
    address: trimOrNull(body.address),
    city: trimOrNull(body.city),
    country: trimOrNull(body.country),
    emergencyContactName: trimOrNull(body.emergencyContactName),
    emergencyContactPhone: trimOrNull(body.emergencyContactPhone),
    governmentId: trimOrNull(body.governmentId),
  };
}

function patchEmployeeProfile(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EMPLOYEE_PROFILE_KEYS) {
    if (!(k in body)) continue;
    if (k === 'hireDate' || k === 'dateOfBirth') {
      out[k] = parseOptionalDate(body[k]);
    } else if (k === 'salary') {
      out[k] = parseSalaryCents(body[k]);
    } else {
      out[k] = trimOrNull(body[k]);
    }
  }
  return out;
}

// PUT /api/hr/organization/employee-id-scheme — set org code, renumber employees, lock IDs (org admin only)
router.put(
  '/organization/employee-id-scheme',
  requirePermission('hr.employees.edit'),
  async (req, res) => {
    try {
      if (!req.org || !req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const orgId = req.org.id;
      const allowed = await assertOrgOwnerOrAdmin(req.user.id, orgId);
      if (!allowed) {
        res.status(403).json({
          error: 'Only organization owners or admins can configure the employee ID scheme.',
        });
        return;
      }

      const raw =
        typeof req.body.organizationCode === 'string' ? req.body.organizationCode.trim() : '';
      if (!raw) {
        res.status(400).json({ error: 'Organization code is required' });
        return;
      }

      const existing = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { employeeIdSchemeLocked: true },
      });

      if (existing?.employeeIdSchemeLocked) {
        res.status(400).json({
          error:
            'The employee ID scheme is already locked. Contact a platform administrator if you need to change it.',
        });
        return;
      }

      if (!/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(raw) || raw.length > 40) {
        res.status(400).json({
          error:
            'Invalid code. Use letters and numbers, with optional single hyphens between segments (e.g. ACME or ACME-HR).',
        });
        return;
      }

      const prefix = `${raw}-`;

      const employees = await prisma.employee.findMany({
        where: { orgId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      const n = employees.length;
      const padLength = n === 0 ? 4 : Math.max(2, String(n).length);

      await prisma.$transaction(async (tx) => {
        if (n > 0) {
          for (const e of employees) {
            await tx.employee.update({
              where: { id: e.id },
              data: { employeeCode: `TMP:${e.id}` },
            });
          }
          for (let i = 0; i < n; i++) {
            await tx.employee.update({
              where: { id: employees[i].id },
              data: {
                employeeCode: formatEmployeeCode(prefix, i + 1, padLength),
              },
            });
          }
        }

        await tx.organization.update({
          where: { id: orgId },
          data: {
            organizationHrCode: raw,
            employeeCodePrefix: prefix,
            employeeCodePadLength: padLength,
            employeeCodeNextSeq: n + 1,
            employeeIdSchemeLocked: n > 0,
          },
        });
      });

      res.json({
        message:
          n > 0
            ? `Updated ${n} employee ID(s) using ${prefix}… and locked manual edits.`
            : `Organization code saved. New employees will use ${prefix}… numbering.`,
        employeeCount: n,
        employeeIdSchemeLocked: n > 0,
        organizationHrCode: raw,
        employeeCodePrefix: prefix,
        employeeCodePadLength: padLength,
        employeeCodeNextSeq: n + 1,
      });
    } catch (error) {
      console.error('Error applying employee ID scheme:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Module manifest
export const hrManifest: ModuleManifest = {
  key: 'hr',
  name: 'HR & Employees',
  icon: 'users',
  sidebarItems: [
    {
      path: '/hr/employees',
      label: 'Employees',
      permission: 'hr.employees.view',
    },
    {
      path: '/hr/leave',
      label: 'Leave Management',
      permission: 'hr.leave.view',
    },
    {
      path: '/hr/attendance',
      label: 'Attendance',
      permission: 'hr.attendance.view',
    },
    {
      path: '/hr/payroll',
      label: 'Payroll',
      permission: 'hr.payroll.view',
    },
    {
      path: '/hr/recruitment',
      label: 'Recruitment',
      permission: 'hr.recruitment.view',
    },
    {
      path: '/hr/performance',
      label: 'Performance',
      permission: 'hr.performance.view',
    },
    {
      path: '/hr/tasks',
      label: 'Tasks',
      permission: 'hr.employees.view',
    },
    {
      path: '/hr/calendar',
      label: 'Calendar',
      permission: 'hr.employees.view',
    },
    {
      path: '/hr/decisions',
      label: 'Decisions',
      permission: 'hr.decisions.view',
    },
  ],
  dashboardWidgets: [
    {
      id: 'hr-employee-count',
      title: 'Total Employees',
      description: 'Number of employees in your organization',
      apiPath: '/api/hr/widgets/employee-count',
      permission: 'hr.employees.view',
    },
  ],
};

// Register module
export function registerHrModule(routerInstance: Router): void {
  // Register main routes
  routerInstance.use('/api/hr', authMiddleware, requireModuleEnabled('hr'), router);

  // Register sub-routes
  routerInstance.use('/api/hr/leave', authMiddleware, requireModuleEnabled('hr'), leaveRouter);
  routerInstance.use('/api/hr/attendance', authMiddleware, requireModuleEnabled('hr'), attendanceRouter);
  routerInstance.use('/api/hr/payroll', authMiddleware, requireModuleEnabled('hr'), payrollRouter);
  routerInstance.use('/api/hr/recruitment', authMiddleware, requireModuleEnabled('hr'), recruitmentRouter);
  routerInstance.use('/api/hr/performance', authMiddleware, requireModuleEnabled('hr'), performanceRouter);
  routerInstance.use('/api/hr/tasks', authMiddleware, requireModuleEnabled('hr'), tasksRouter);
  routerInstance.use('/api/hr/calendar', authMiddleware, requireModuleEnabled('hr'), calendarRouter);
  routerInstance.use('/api/hr/decisions', authMiddleware, requireModuleEnabled('hr'), decisionsRouter);
  routerInstance.use('/api/hr/announcements', authMiddleware, requireModuleEnabled('hr'), announcementsRouter);
  routerInstance.use('/api/hr/complaints', authMiddleware, requireModuleEnabled('hr'), complaintsRouter);
  routerInstance.use('/api/hr/requests', authMiddleware, requireModuleEnabled('hr'), requestsRouter);
  routerInstance.use('/api/hr/assets', authMiddleware, requireModuleEnabled('hr'), assetsRouter);

  // Register in module registry
  moduleRegistry.register({
    key: 'hr',
    manifest: hrManifest,
    registerRoutes: () => {}, // Already registered above
  });
}

// GET /api/hr/employees (supports ?limit=50&offset=0 or ?page=1&limit=50)
router.get('/employees', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = Math.min(parseInt(String(req.query.limit || 50), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset || 0), 10) || 0;
    const page = parseInt(String(req.query.page), 10);
    const skip = page >= 1 ? (page - 1) * limit : offset;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const where: any = { orgId: req.org.id };
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { position: { contains: search, mode: 'insensitive' } },
        { department: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { nationality: { contains: search, mode: 'insensitive' } },
        { religion: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { country: { contains: search, mode: 'insensitive' } },
        { governmentId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.employee.count({ where }),
    ]);

    res.json({ data: employees, total, limit, offset: skip });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/employees/export - Export employees as CSV (same search as list)
router.get('/employees/export', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const where: any = { orgId: req.org.id };
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { position: { contains: search, mode: 'insensitive' } },
        { department: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { nationality: { contains: search, mode: 'insensitive' } },
        { religion: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { country: { contains: search, mode: 'insensitive' } },
        { governmentId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const employees = await prisma.employee.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const escape = (v: string | number | null | undefined) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const headers = [
      'Employee ID',
      'Full Name',
      'Email',
      'Phone',
      'Position',
      'Department',
      'Employment Type',
      'Hire Date',
      'Date of Birth',
      'Nationality',
      'Religion',
      'Gender',
      'Marital Status',
      'Address',
      'City',
      'Country',
      'Government ID',
      'Emergency Contact',
      'Emergency Phone',
      'Salary (cents)',
      'Notes',
      'Created At',
    ];
    const dStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
    const rows = employees.map((e) => [
      e.employeeCode ?? '',
      e.fullName,
      e.email ?? '',
      e.phone ?? '',
      e.position ?? '',
      e.department ?? '',
      e.employmentType ?? '',
      dStr(e.hireDate),
      dStr(e.dateOfBirth),
      e.nationality ?? '',
      e.religion ?? '',
      e.gender ?? '',
      e.maritalStatus ?? '',
      e.address ?? '',
      e.city ?? '',
      e.country ?? '',
      e.governmentId ?? '',
      e.emergencyContactName ?? '',
      e.emergencyContactPhone ?? '',
      e.salary ?? '',
      e.notes ?? '',
      e.createdAt.toISOString().slice(0, 10),
    ]);

    const csv =
      headers.map(escape).join(',') +
      '\n' +
      rows.map((row) => row.map(escape).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="employees-export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting employees:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/employees/next-employee-code — suggested ID for the add-employee form (must be before /employees/:id)
router.get('/employees/next-employee-code', requirePermission('hr.employees.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const orgId = req.org.id;
    const count = await prisma.employee.count({ where: { orgId } });
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        employeeCodePrefix: true,
        employeeCodePadLength: true,
        employeeCodeNextSeq: true,
        employeeIdSchemeLocked: true,
        organizationHrCode: true,
      },
    });

    const locked = org?.employeeIdSchemeLocked ?? false;
    const orgHrCode = org?.organizationHrCode ?? null;

    if (count === 0) {
      if (
        org?.employeeCodePrefix != null &&
        org.employeeCodePadLength != null &&
        org.employeeCodeNextSeq != null
      ) {
        res.json({
          isFirstEmployee: true,
          patternConfigured: true,
          suggestedCode: formatEmployeeCode(
            org.employeeCodePrefix,
            org.employeeCodeNextSeq,
            org.employeeCodePadLength
          ),
          employeeIdSchemeLocked: locked,
          organizationHrCode: orgHrCode,
        });
        return;
      }
      res.json({
        isFirstEmployee: true,
        suggestedCode: '',
        patternConfigured: false,
        employeeIdSchemeLocked: locked,
        organizationHrCode: orgHrCode,
      });
      return;
    }

    if (
      org?.employeeCodePrefix != null &&
      org.employeeCodePadLength != null &&
      org.employeeCodeNextSeq != null
    ) {
      res.json({
        isFirstEmployee: false,
        patternConfigured: true,
        suggestedCode: formatEmployeeCode(
          org.employeeCodePrefix,
          org.employeeCodeNextSeq,
          org.employeeCodePadLength
        ),
        employeeIdSchemeLocked: locked,
        organizationHrCode: orgHrCode,
      });
      return;
    }

    res.json({
      isFirstEmployee: false,
      patternConfigured: false,
      suggestedCode: '',
      employeeIdSchemeLocked: locked,
      organizationHrCode: orgHrCode,
    });
  } catch (error) {
    console.error('Error resolving next employee code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/employees
router.post('/employees', requirePermission('hr.employees.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { fullName, email, password, position, department, createUserAccount, roleKeys, employeeCode } =
      req.body;
    const profile = profileForCreate(req.body as Record<string, unknown>);

    if (!fullName) {
      res.status(400).json({ error: 'Full name is required' });
      return;
    }

    const orgId = req.org.id;

    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { maxUsers: true, maxEmployees: true },
    });

    // Check employee limit
    if (organization != null && organization.maxEmployees != null && organization.maxEmployees !== undefined) {
      const currentEmployeeCount = await prisma.employee.count({
        where: { orgId },
      });
      if (currentEmployeeCount >= organization.maxEmployees) {
        res.status(403).json({
          error: `Employee limit reached. Maximum ${organization.maxEmployees} employees allowed.`,
          currentCount: currentEmployeeCount,
          maxEmployees: organization.maxEmployees,
        });
        return;
      }
    }

    // Check user limit if creating user account
    if (createUserAccount && email && password) {
      if (organization != null && organization.maxUsers != null && organization.maxUsers !== undefined) {
        const currentUserCount = await prisma.membership.count({
          where: {
            organizationId: req.org.id,
            isActive: true,
          },
        });

        if (currentUserCount >= organization.maxUsers) {
          res.status(403).json({
            error: `User limit reached. Maximum ${organization.maxUsers} users allowed.`,
            currentCount: currentUserCount,
            maxUsers: organization.maxUsers,
          });
          return;
        }
      }
    }

    let userId = null;

    // Create user account if email and password are provided
    if (createUserAccount && email && password) {
      // Check if user already exists
      let user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        const passwordHash = await hashPassword(password);
        user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            name: fullName,
          },
        });
      }

      userId = user.id;

      // Check if user is already a member of this organization
      const existingMembership = await prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: req.org.id,
          },
        },
      });

      if (!existingMembership) {
        // Create membership
        const membership = await prisma.membership.create({
          data: {
            userId: user.id,
            organizationId: req.org.id,
            isActive: true,
          },
        });

        // Assign roles - use provided roleKeys or default to 'member'
        const rolesToAssign = Array.isArray(roleKeys) && roleKeys.length > 0
          ? roleKeys
          : ['member'];

        const roles = await prisma.role.findMany({
          where: {
            key: { in: rolesToAssign },
            OR: [{ organizationId: req.org.id }, { organizationId: null }],
          },
        });

        if (roles.length > 0) {
          await prisma.membershipRole.createMany({
            data: roles.map((role) => ({
              membershipId: membership.id,
              roleId: role.id,
            })),
          });
        }
      } else {
        // If membership exists, update roles if roleKeys provided
        if (Array.isArray(roleKeys) && roleKeys.length > 0) {
          // Clear existing roles
          await prisma.membershipRole.deleteMany({
            where: { membershipId: existingMembership.id },
          });

          // Add new roles
          const roles = await prisma.role.findMany({
            where: {
              key: { in: roleKeys },
              OR: [{ organizationId: req.org.id }, { organizationId: null }],
            },
          });

          if (roles.length > 0) {
            await prisma.membershipRole.createMany({
              data: roles.map((role) => ({
                membershipId: existingMembership.id,
                roleId: role.id,
              })),
            });
          }
        }
      }
    }

    const resolvedCode = await resolveNewEmployeeCodeForOrg(orgId, employeeCode);
    if ('error' in resolvedCode) {
      res.status(resolvedCode.status).json({ error: resolvedCode.error });
      return;
    }
    const codeFinal = resolvedCode.code;

    const employee = await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.create({
        data: {
          orgId,
          fullName,
          email: email || null,
          position: position || null,
          department: department || null,
          userId: userId,
          employeeCode: codeFinal,
          ...profile,
        },
      });

      const orgRow = await tx.organization.findUnique({
        where: { id: orgId },
        select: { employeeCodePrefix: true },
      });

      if (orgRow?.employeeCodePrefix == null) {
        const parsed = parseEmployeeCode(codeFinal);
        if (parsed) {
          await tx.organization.update({
            where: { id: orgId },
            data: {
              employeeCodePrefix: parsed.prefix,
              employeeCodePadLength: parsed.padLength,
            },
          });
        }
      }

      await syncOrgEmployeeCodeSequence(tx, orgId);
      return emp;
    });

    res.status(201).json(employee);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ error: 'This employee ID is already in use' });
      return;
    }
    console.error('Error creating employee:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/employees/:id
router.put('/employees/:id', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { fullName, email, position, department, roleKeys, employeeCode: bodyEmployeeCode } = req.body;
    const profilePatch = patchEmployeeProfile(req.body as Record<string, unknown>);

    const employee = await prisma.employee.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        user: true,
      },
    });

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const orgId = req.org.id;

    const orgPolicy = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { employeeIdSchemeLocked: true },
    });

    let nextEmployeeCode: string | undefined;
    if (bodyEmployeeCode !== undefined) {
      if (orgPolicy?.employeeIdSchemeLocked) {
        res.status(400).json({
          error:
            'Employee ID cannot be changed; the organization uses a fixed numbering scheme.',
        });
        return;
      }
      const trimmed = typeof bodyEmployeeCode === 'string' ? bodyEmployeeCode.trim() : '';
      if (!trimmed) {
        res.status(400).json({ error: 'Employee ID cannot be empty' });
        return;
      }
      const parsed = parseEmployeeCode(trimmed);
      if (!parsed) {
        res.status(400).json({
          error: 'Employee ID must end with a number (e.g. Emp-01 or Employee - 00001)',
        });
        return;
      }
      const dup = await prisma.employee.findFirst({
        where: {
          orgId,
          employeeCode: trimmed,
          NOT: { id },
        },
      });
      if (dup) {
        res.status(409).json({ error: 'This employee ID is already in use' });
        return;
      }
      nextEmployeeCode = trimmed;
    }

    // Update employee data
    const updated = await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.update({
        where: { id },
        data: {
          ...(fullName && { fullName }),
          ...(email !== undefined && { email: email || null }),
          ...(position !== undefined && { position: position || null }),
          ...(department !== undefined && { department: department || null }),
          ...(nextEmployeeCode !== undefined && { employeeCode: nextEmployeeCode }),
          ...profilePatch,
        },
      });
      await syncOrgEmployeeCodeSequence(tx, orgId);
      return emp;
    });

    // Update user roles if employee has a user account and roleKeys provided
    if (employee.userId && Array.isArray(roleKeys)) {
      const membership = await prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: employee.userId,
            organizationId: orgId,
          },
        },
      });

      if (membership) {
        // Clear existing roles
        await prisma.membershipRole.deleteMany({
          where: { membershipId: membership.id },
        });

        // Add new roles
        if (roleKeys.length > 0) {
          const roles = await prisma.role.findMany({
            where: {
              key: { in: roleKeys },
              OR: [{ organizationId: orgId }, { organizationId: null }],
            },
          });

          if (roles.length > 0) {
            await prisma.membershipRole.createMany({
              data: roles.map((role) => ({
                membershipId: membership.id,
                roleId: role.id,
              })),
            });
          }
        } else {
          // If no roles provided, assign default 'member' role
          const memberRole = await prisma.role.findUnique({
            where: { key: 'member' },
          });

          if (memberRole) {
            await prisma.membershipRole.create({
              data: {
                membershipId: membership.id,
                roleId: memberRole.id,
              },
            });
          }
        }
      }
    }

    res.json(updated);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ error: 'This employee ID is already in use' });
      return;
    }
    console.error('Error updating employee:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/hr/employees/:id
router.delete('/employees/:id', requirePermission('hr.employees.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const employee = await prisma.employee.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const orgId = req.org.id;

    await prisma.$transaction(async (tx) => {
      await tx.employee.delete({
        where: { id },
      });
      await syncOrgEmployeeCodeSequence(tx, orgId);
    });

    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/employees/bulk - Bulk create employees from CSV
router.post('/employees/bulk', requirePermission('hr.employees.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employees } = req.body;

    if (!Array.isArray(employees) || employees.length === 0) {
      res.status(400).json({ error: 'Employees array is required' });
      return;
    }

    const orgId = req.org.id;

    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { maxUsers: true, maxEmployees: true },
    });

    // Check employee limit for bulk add
    if (organization != null && organization.maxEmployees != null && organization.maxEmployees !== undefined) {
      const currentEmployeeCount = await prisma.employee.count({
        where: { orgId },
      });
      const wouldBeTotal = currentEmployeeCount + employees.length;
      if (wouldBeTotal > organization.maxEmployees) {
        res.status(403).json({
          error: `Cannot add ${employees.length} employees. Would exceed limit (${organization.maxEmployees}). Current: ${currentEmployeeCount}, available: ${organization.maxEmployees - currentEmployeeCount}.`,
          currentCount: currentEmployeeCount,
          maxEmployees: organization.maxEmployees,
          requested: employees.length,
          available: organization.maxEmployees - currentEmployeeCount,
        });
        return;
      }
    }

    // Check user limit for employees that will create user accounts
    const employeesWithAccounts = employees.filter((emp) => emp.email && emp.password);
    if (employeesWithAccounts.length > 0 && organization != null) {
      if (organization.maxUsers !== null && organization.maxUsers !== undefined) {
        const currentUserCount = await prisma.membership.count({
          where: {
            organizationId: orgId,
            isActive: true,
          },
        });

        // Count how many NEW memberships will actually be created
        const emailsToCheck = employeesWithAccounts.map((emp) => emp.email).filter(Boolean);
        const existingUsers = await prisma.user.findMany({
          where: {
            email: { in: emailsToCheck },
          },
          include: {
            memberships: {
              where: {
                organizationId: orgId,
                isActive: true,
              },
            },
          },
        });

        // Count users that will need NEW memberships
        const usersNeedingMembership = existingUsers.filter(
          (user) => user.memberships.length === 0
        ).length;
        const newUsersNeeded = emailsToCheck.length - existingUsers.length;
        const totalNewMemberships = usersNeedingMembership + newUsersNeeded;

        const availableSlots = organization.maxUsers - currentUserCount;
        if (totalNewMemberships > availableSlots) {
          res.status(403).json({
            error: `Cannot create ${totalNewMemberships} new user accounts. Only ${availableSlots} slots available (limit: ${organization.maxUsers}). ${existingUsers.length - usersNeedingMembership} users already have accounts.`,
            currentCount: currentUserCount,
            maxUsers: organization.maxUsers,
            requested: totalNewMemberships,
            available: availableSlots,
            alreadyMembers: existingUsers.length - usersNeedingMembership,
          });
          return;
        }
      }
    }

    const results = {
      created: 0,
      failed: 0,
      errors: [] as Array<{ row: number; error: string }>,
    };

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      try {
        if (!emp.fullName) {
          results.failed++;
          results.errors.push({ row: i + 1, error: 'Full name is required' });
          continue;
        }

        let userId = null;

        // Create user account if email and password are provided
        if (emp.email && emp.password) {
          // Check if user already exists
          let user = await prisma.user.findUnique({
            where: { email: emp.email },
          });

          if (!user) {
            const passwordHash = await hashPassword(emp.password);
            user = await prisma.user.create({
              data: {
                email: emp.email,
                passwordHash,
                name: emp.fullName,
              },
            });
          }

          userId = user.id;

          // Check if user is already a member of this organization
          const existingMembership = await prisma.membership.findUnique({
            where: {
              userId_organizationId: {
                userId: user.id,
                organizationId: orgId,
              },
            },
          });

          if (!existingMembership) {
            // Create membership
            const membership = await prisma.membership.create({
              data: {
                userId: user.id,
                organizationId: orgId,
                isActive: true,
              },
            });

            // Assign roles - parse from CSV (comma-separated role keys) or default to 'member'
            const roleKeysFromCSV = emp.roles
              ? (typeof emp.roles === 'string' ? emp.roles.split(',').map((r: string) => r.trim()).filter(Boolean) : Array.isArray(emp.roles) ? emp.roles : [])
              : ['member'];

            const roles = await prisma.role.findMany({
              where: {
                key: { in: roleKeysFromCSV },
                OR: [{ organizationId: orgId }, { organizationId: null }],
              },
            });

            if (roles.length > 0) {
              await prisma.membershipRole.createMany({
                data: roles.map((role) => ({
                  membershipId: membership.id,
                  roleId: role.id,
                })),
              });
            }
          } else {
            // If membership exists, update roles if provided
            if (emp.roles) {
              const roleKeysFromCSV = typeof emp.roles === 'string'
                ? emp.roles.split(',').map((r: string) => r.trim()).filter(Boolean)
                : Array.isArray(emp.roles) ? emp.roles : [];

              if (roleKeysFromCSV.length > 0) {
                // Clear existing roles
                await prisma.membershipRole.deleteMany({
                  where: { membershipId: existingMembership.id },
                });

                // Add new roles
                const roles = await prisma.role.findMany({
                  where: {
                    key: { in: roleKeysFromCSV },
                    OR: [{ organizationId: orgId }, { organizationId: null }],
                  },
                });

                if (roles.length > 0) {
                  await prisma.membershipRole.createMany({
                    data: roles.map((role) => ({
                      membershipId: existingMembership.id,
                      roleId: role.id,
                    })),
                  });
                }
              }
            }
          }
        }

        const resolvedBulk = await resolveNewEmployeeCodeForOrg(orgId, emp.employeeCode);
        if ('error' in resolvedBulk) {
          results.failed++;
          results.errors.push({ row: i + 1, error: resolvedBulk.error });
          continue;
        }

        const bulkProfile = profileForCreate(emp as Record<string, unknown>);

        await prisma.$transaction(async (tx) => {
          await tx.employee.create({
            data: {
              orgId,
              fullName: emp.fullName,
              email: emp.email || null,
              position: emp.position || null,
              department: emp.department || null,
              userId: userId,
              employeeCode: resolvedBulk.code,
              ...bulkProfile,
            },
          });
          const orgRow = await tx.organization.findUnique({
            where: { id: orgId },
            select: { employeeCodePrefix: true },
          });
          if (orgRow?.employeeCodePrefix == null) {
            const parsed = parseEmployeeCode(resolvedBulk.code);
            if (parsed) {
              await tx.organization.update({
                where: { id: orgId },
                data: {
                  employeeCodePrefix: parsed.prefix,
                  employeeCodePadLength: parsed.padLength,
                },
              });
            }
          }
          await syncOrgEmployeeCodeSequence(tx, orgId);
        });
        results.created++;
      } catch (error: any) {
        if (error?.code === 'P2002') {
          results.failed++;
          results.errors.push({ row: i + 1, error: 'This employee ID is already in use' });
          continue;
        }
        results.failed++;
        results.errors.push({ row: i + 1, error: error.message || 'Failed to create employee' });
      }
    }

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    console.error('Error bulk creating employees:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/employees/:id - Get single employee with details
router.get('/employees/:id', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const employee = await prisma.employee.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            isActive: true,
          },
        },
        documents: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    res.json(employee);
  } catch (error) {
    console.error('Error fetching employee:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/employees/:id/photo - Update employee photo
router.put('/employees/:id/photo', requirePermission('hr.employees.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { photoUrl } = req.body;

    const employee = await prisma.employee.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: { photoUrl: photoUrl || null },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating employee photo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/employees/:id/documents - Get employee documents
router.get('/employees/:id/documents', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const employee = await prisma.employee.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const documents = await prisma.file.findMany({
      where: {
        employeeId: id,
        organizationId: req.org.id,
      },
      include: {
        user: {
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

    res.json(documents);
  } catch (error) {
    console.error('Error fetching employee documents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/reports/employees - Employee reports/analytics
router.get('/reports/employees', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const totalEmployees = await prisma.employee.count({
      where: { orgId: req.org.id },
    });

    const employeesByDepartment = await prisma.employee.groupBy({
      by: ['department'],
      where: {
        orgId: req.org.id,
        department: { not: null },
      },
      _count: {
        id: true,
      },
    });

    const employeesWithAccounts = await prisma.employee.count({
      where: {
        orgId: req.org.id,
        userId: { not: null },
      },
    });

    const recentHires = await prisma.employee.findMany({
      where: {
        orgId: req.org.id,
        hireDate: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      },
      orderBy: {
        hireDate: 'desc',
      },
      take: 10,
    });

    res.json({
      totalEmployees,
      employeesByDepartment: employeesByDepartment.map((d) => ({
        department: d.department,
        count: d._count.id,
      })),
      employeesWithAccounts,
      employeesWithoutAccounts: totalEmployees - employeesWithAccounts,
      recentHires: recentHires.length,
    });
  } catch (error) {
    console.error('Error fetching employee reports:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Widget endpoint
router.get('/widgets/employee-count', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.employee.count({
      where: {
        orgId: req.org.id,
      },
    });

    res.json({ count });
  } catch (error) {
    console.error('Error fetching employee count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


