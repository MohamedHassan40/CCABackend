import prisma from '../../src/core/db';

/**
 * Clean all test data from the database
 * This should be called before/after each test to ensure isolation
 * Uses transaction to ensure all-or-nothing cleanup
 */
export async function cleanDatabase() {
  try {
    // Use transaction to ensure atomic cleanup
    // Set isolation level to avoid deadlocks
    await prisma.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await prisma.$transaction(async (tx) => {
      // Delete in order of dependencies (child tables first)
      // Using deleteMany to handle foreign keys - Prisma will handle cascading deletes
      
      await tx.membershipRole.deleteMany({});
      await tx.rolePermission.deleteMany({});
      await tx.membership.deleteMany({});
      await tx.orgModule.deleteMany({});
      await tx.subscription.deleteMany({});
      await tx.payment.deleteMany({});
      await tx.auditLog.deleteMany({});
      await tx.notification.deleteMany({});
      await tx.file.deleteMany({});
      await tx.cart.deleteMany({});
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});
      await tx.productReview.deleteMany({});
      await tx.product.deleteMany({});
      await tx.productCategory.deleteMany({});
      await tx.ticketComment.deleteMany({});
      await tx.ticket.deleteMany({});
      await tx.ticketCategory.deleteMany({});
      await tx.employee.deleteMany({});
      await tx.leaveRequest.deleteMany({});
      await tx.leaveBalance.deleteMany({});
      await tx.leaveType.deleteMany({});
      await tx.attendanceRecord.deleteMany({});
      await tx.payrollRecord.deleteMany({});
      await tx.jobApplication.deleteMany({});
      await tx.jobPosting.deleteMany({});
      await tx.performanceReview.deleteMany({});
      await tx.goal.deleteMany({});
      await tx.inventoryAssignment.deleteMany({});
      await tx.inventoryReturn.deleteMany({});
      await tx.inventoryDamage.deleteMany({});
      await tx.inventorySwap.deleteMany({});
      await tx.inventoryItem.deleteMany({});
      await tx.inventoryCategory.deleteMany({});
      await tx.organization.deleteMany({});
      await tx.role.deleteMany({});
      await tx.permission.deleteMany({});
      await tx.user.deleteMany({});
      await tx.module.deleteMany({});
      await tx.bundle.deleteMany({});
    }, {
      timeout: 10000, // 10 second timeout
    });
  } catch (error: any) {
    // If transaction fails, try individual deletes as fallback
    console.warn('Transaction cleanup failed, trying individual deletes:', error.message);
    
    // Fallback: try individual deletes (order matters here)
    const deleteOperations = [
      () => prisma.membershipRole.deleteMany({}),
      () => prisma.rolePermission.deleteMany({}),
      () => prisma.membership.deleteMany({}),
      () => prisma.orgModule.deleteMany({}),
      () => prisma.subscription.deleteMany({}),
      () => prisma.payment.deleteMany({}),
      () => prisma.auditLog.deleteMany({}),
      () => prisma.notification.deleteMany({}),
      () => prisma.file.deleteMany({}),
      () => prisma.cart.deleteMany({}),
      () => prisma.orderItem.deleteMany({}),
      () => prisma.order.deleteMany({}),
      () => prisma.productReview.deleteMany({}),
      () => prisma.product.deleteMany({}),
      () => prisma.productCategory.deleteMany({}),
      () => prisma.ticketComment.deleteMany({}),
      () => prisma.ticket.deleteMany({}),
      () => prisma.ticketCategory.deleteMany({}),
      () => prisma.employee.deleteMany({}),
      () => prisma.leaveRequest.deleteMany({}),
      () => prisma.leaveBalance.deleteMany({}),
      () => prisma.leaveType.deleteMany({}),
      () => prisma.attendanceRecord.deleteMany({}),
      () => prisma.payrollRecord.deleteMany({}),
      () => prisma.jobApplication.deleteMany({}),
      () => prisma.jobPosting.deleteMany({}),
      () => prisma.performanceReview.deleteMany({}),
      () => prisma.goal.deleteMany({}),
      () => prisma.inventoryAssignment.deleteMany({}),
      () => prisma.inventoryReturn.deleteMany({}),
      () => prisma.inventoryDamage.deleteMany({}),
      () => prisma.inventorySwap.deleteMany({}),
      () => prisma.inventoryItem.deleteMany({}),
      () => prisma.inventoryCategory.deleteMany({}),
      () => prisma.organization.deleteMany({}),
      () => prisma.role.deleteMany({}),
      () => prisma.permission.deleteMany({}),
      () => prisma.user.deleteMany({}),
      () => prisma.module.deleteMany({}),
      () => prisma.bundle.deleteMany({}),
    ];

    for (const operation of deleteOperations) {
      try {
        await operation();
      } catch (err) {
        // Ignore individual errors in fallback mode
      }
    }
  }
}

/**
 * Create a test user
 */
export async function createTestUser(data?: {
  email?: string;
  password?: string;
  name?: string;
  isSuperAdmin?: boolean;
}) {
  const { hashPassword } = await import('../../src/core/auth/password');
  
  // Generate unique email with timestamp and random number
  const email = data?.email || `test-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
  const passwordHash = await hashPassword(data?.password || 'Test123!@#');
  
  // Check if user already exists (shouldn't happen but just in case)
  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    // If exists, generate a new one
    const newEmail = `test-${Date.now()}-${Math.random().toString(36).substring(7)}-${Math.random().toString(36).substring(7)}@example.com`;
    return await prisma.user.create({
      data: {
        email: newEmail,
        passwordHash,
        name: data?.name || 'Test User',
        isSuperAdmin: data?.isSuperAdmin || false,
      },
    });
  }
  
  return await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: data?.name || 'Test User',
      isSuperAdmin: data?.isSuperAdmin || false,
    },
  });
}

/**
 * Create a test organization
 */
export async function createTestOrganization(data?: {
  name?: string;
  slug?: string;
  status?: string;
}) {
  const name = data?.name || `Test Org ${Date.now()}`;
  const slug = data?.slug || `test-org-${Date.now()}`;
  
  return await prisma.organization.create({
    data: {
      name,
      slug,
      status: data?.status || 'active',
    },
  });
}

/**
 * Create a test membership (user in organization)
 */
export async function createTestMembership(
  userId: string,
  organizationId: string,
  data?: {
    isActive?: boolean;
    roleKeys?: string[];
  }
) {
  // Ensure default roles exist (roles are global, orgId not needed)
  await ensureDefaultRoles();
  
  // Verify user and organization exist before creating membership
  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
  ]);

  if (!user) {
    throw new Error(`User ${userId} does not exist. Create user first with createTestUser().`);
  }
  
  if (!org) {
    throw new Error(`Organization ${organizationId} does not exist. Create org first with createTestOrganization().`);
  }
  
  // Use upsert to handle race conditions
  let membership;
  try {
    membership = await prisma.membership.upsert({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      update: {
        isActive: data?.isActive !== false,
      },
      create: {
        userId,
        organizationId,
        isActive: data?.isActive !== false,
      },
    });
  } catch (error: any) {
    // If foreign key error, retry after a brief delay (data might be committing)
    if (error.code === 'P2003') {
      await new Promise(resolve => setTimeout(resolve, 100));
      membership = await prisma.membership.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
        update: {
          isActive: data?.isActive !== false,
        },
        create: {
          userId,
          organizationId,
          isActive: data?.isActive !== false,
        },
      });
    } else {
      throw error;
    }
  }

  // Assign roles
  if (data?.roleKeys && data.roleKeys.length > 0) {
    const roles = await prisma.role.findMany({
      where: {
        key: { in: data.roleKeys },
        OR: [{ organizationId }, { organizationId: null }],
      },
    });

    if (roles.length > 0) {
      // Use createMany with skipDuplicates to handle race conditions
      try {
        await prisma.membershipRole.createMany({
          data: roles.map((role) => ({
            membershipId: membership.id,
            roleId: role.id,
          })),
          skipDuplicates: true,
        });
      } catch (error: any) {
        // If foreign key error, roles might have been deleted - re-fetch and try again
        if (error.code === 'P2003') {
          const membershipExists = await prisma.membership.findUnique({
            where: { id: membership.id },
          });
          if (membershipExists) {
            await prisma.membershipRole.createMany({
              data: roles.map((role) => ({
                membershipId: membership.id,
                roleId: role.id,
              })),
              skipDuplicates: true,
            });
          }
        } else {
          throw error;
        }
      }
    }
  }

  return membership;
}

/**
 * Ensure default roles exist (owner, admin, member)
 * Note: Role model only has 'key' as unique, not a composite key
 * Uses findUnique + create with try-catch to handle concurrent access safely
 * organizationId parameter is unused (roles are global) but kept for backwards compatibility
 */
export async function ensureDefaultRoles(organizationId?: string) {
  const defaultRoles = [
    { key: 'owner', name: 'Owner' },
    { key: 'admin', name: 'Admin' },
    { key: 'member', name: 'Member' },
  ];

  // Process roles sequentially to avoid race conditions
  // Use upsert to handle both creation and existence checking atomically
  for (const roleData of defaultRoles) {
    try {
      // Use upsert - this is atomic and handles race conditions better
      await prisma.role.upsert({
        where: { key: roleData.key },
        update: {
          // Update name if it changed (shouldn't happen, but safe)
          name: roleData.name,
        },
        create: {
          key: roleData.key,
          name: roleData.name,
          organizationId: null, // System roles
        },
      });
    } catch (error: any) {
      // If unique constraint error, role was created by another test - that's fine
      // For any other error, log but don't fail (non-critical)
      if (error.code !== 'P2002') {
        // Try one more time with findUnique + create pattern if upsert fails
        try {
          const existing = await prisma.role.findUnique({
            where: { key: roleData.key },
          });
          if (!existing) {
            await prisma.role.create({
              data: {
                key: roleData.key,
                name: roleData.name,
                organizationId: null,
              },
            });
          }
        } catch (retryError: any) {
          // Ignore - role likely exists now
          if (retryError.code !== 'P2002') {
            console.warn(`Error ensuring default role ${roleData.key}:`, retryError.message);
          }
        }
      }
    }
  }
}

/**
 * Create a test module
 * If a key is provided and module exists, returns existing module
 */
export async function createTestModule(data?: {
  key?: string;
  name?: string;
  isActive?: boolean;
}) {
  const key = data?.key || `test-module-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const name = data?.name || `Test Module ${Date.now()}`;
  
  // If key is provided, use upsert to handle existing modules
  if (data?.key) {
    return await prisma.module.upsert({
      where: { key },
      update: {
        isActive: data?.isActive !== false,
        ...(data?.name && { name }),
      },
      create: {
        key,
        name,
        isActive: data?.isActive !== false,
      },
    });
  }
  
  // For random keys, just create
  return await prisma.module.create({
    data: {
      key,
      name,
      isActive: data?.isActive !== false,
    },
  });
}

/**
 * Enable a module for an organization
 */
export async function enableModuleForOrg(
  organizationId: string,
  moduleId: string,
  data?: {
    plan?: string;
    seats?: number;
  }
) {
  // Verify organization exists
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  
  if (!org) {
    throw new Error(`Organization ${organizationId} does not exist`);
  }

  // Use upsert to handle race conditions
  return await prisma.orgModule.upsert({
    where: {
      organizationId_moduleId: {
        organizationId,
        moduleId,
      },
    },
    update: {
      isEnabled: true,
      plan: data?.plan || null,
      seats: data?.seats || null,
    },
    create: {
      organizationId,
      moduleId,
      isEnabled: true,
      plan: data?.plan || null,
      seats: data?.seats || null,
    },
  });
}

