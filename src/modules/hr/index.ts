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

const router = Router();

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

  // Register in module registry
  moduleRegistry.register({
    key: 'hr',
    manifest: hrManifest,
    registerRoutes: () => {}, // Already registered above
  });
}

// GET /api/hr/employees
router.get('/employees', requirePermission('hr.employees.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const employees = await prisma.employee.findMany({
      where: {
        orgId: req.org.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(employees);
  } catch (error) {
    console.error('Error fetching employees:', error);
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

    const { fullName, email, password, position, department, createUserAccount, roleKeys } = req.body;

    if (!fullName) {
      res.status(400).json({ error: 'Full name is required' });
      return;
    }

    const organization = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: { maxUsers: true, maxEmployees: true },
    });

    // Check employee limit
    if (organization?.maxEmployees !== null && organization.maxEmployees !== undefined) {
      const currentEmployeeCount = await prisma.employee.count({
        where: { orgId: req.org.id },
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
      if (organization?.maxUsers !== null && organization.maxUsers !== undefined) {
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

    const employee = await prisma.employee.create({
      data: {
        orgId: req.org.id,
        fullName,
        email: email || null,
        position: position || null,
        department: department || null,
        userId: userId,
      },
    });

    res.status(201).json(employee);
  } catch (error) {
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
    const { fullName, email, position, department, roleKeys } = req.body;

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

    // Update employee data
    const updated = await prisma.employee.update({
      where: { id },
      data: {
        ...(fullName && { fullName }),
        ...(email !== undefined && { email: email || null }),
        ...(position !== undefined && { position: position || null }),
        ...(department !== undefined && { department: department || null }),
      },
    });

    // Update user roles if employee has a user account and roleKeys provided
    if (employee.userId && Array.isArray(roleKeys)) {
      const membership = await prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: employee.userId,
            organizationId: req.org.id,
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
  } catch (error) {
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

    await prisma.employee.delete({
      where: { id },
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

    const organization = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: { maxUsers: true, maxEmployees: true },
    });

    // Check employee limit for bulk add
    if (organization?.maxEmployees !== null && organization.maxEmployees !== undefined) {
      const currentEmployeeCount = await prisma.employee.count({
        where: { orgId: req.org.id },
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
    if (employeesWithAccounts.length > 0 && organization) {
      if (organization.maxUsers !== null && organization.maxUsers !== undefined) {
        const currentUserCount = await prisma.membership.count({
          where: {
            organizationId: req.org.id,
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
                organizationId: req.org.id,
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

            // Assign roles - parse from CSV (comma-separated role keys) or default to 'member'
            const roleKeysFromCSV = emp.roles
              ? (typeof emp.roles === 'string' ? emp.roles.split(',').map((r: string) => r.trim()).filter(Boolean) : Array.isArray(emp.roles) ? emp.roles : [])
              : ['member'];

            const roles = await prisma.role.findMany({
              where: {
                key: { in: roleKeysFromCSV },
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
        }

        await prisma.employee.create({
          data: {
            orgId: req.org.id,
            fullName: emp.fullName,
            email: emp.email || null,
            position: emp.position || null,
            department: emp.department || null,
            userId: userId,
          },
        });
        results.created++;
      } catch (error: any) {
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


