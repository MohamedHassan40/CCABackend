import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import prisma from '../src/core/db';
import { cleanDatabase } from './utils/database';

// Clean database before all tests
beforeAll(async () => {
  try {
    await prisma.$connect();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      '\n[tests] Database connection failed.\n' +
        '  1. Copy .env.test.example to .env.test\n' +
        '  2. Start Docker Desktop, then: npm run db:test:setup\n' +
        '  Or set DATABASE_URL in .env.test to a reachable Postgres instance.\n' +
        `  Error: ${message}\n`
    );
    throw error;
  }
  // Initial clean
  await cleanDatabase();
});

// Clean database after each test (not before, to avoid conflicts with test setup)
// Note: We delete without transactions to avoid deadlocks when tests run in parallel
afterEach(async () => {
  // Clean test data but preserve system roles/permissions/modules
  // These are shared and should not be deleted between tests
  // Delete without transaction to avoid deadlocks
  try {
    // Delete in reverse dependency order (children first, then parents)
    await prisma.membershipRole.deleteMany({}).catch(() => {});
    await prisma.rolePermission.deleteMany({}).catch(() => {});
    await prisma.membership.deleteMany({}).catch(() => {});
    await prisma.orgModule.deleteMany({}).catch(() => {});
    await prisma.subscription.deleteMany({}).catch(() => {});
    await prisma.payment.deleteMany({}).catch(() => {});
    await prisma.auditLog.deleteMany({}).catch(() => {});
    await prisma.notification.deleteMany({}).catch(() => {});
    await prisma.file.deleteMany({}).catch(() => {});
    await prisma.cart.deleteMany({}).catch(() => {});
    await prisma.orderItem.deleteMany({}).catch(() => {});
    await prisma.order.deleteMany({}).catch(() => {});
    await prisma.productReview.deleteMany({}).catch(() => {});
    await prisma.product.deleteMany({}).catch(() => {});
    await prisma.productCategory.deleteMany({}).catch(() => {});
    await prisma.ticketComment.deleteMany({}).catch(() => {});
    await prisma.ticket.deleteMany({}).catch(() => {});
    await prisma.ticketCategory.deleteMany({}).catch(() => {});
    await prisma.employee.deleteMany({}).catch(() => {});
    await prisma.leaveRequest.deleteMany({}).catch(() => {});
    await prisma.leaveBalance.deleteMany({}).catch(() => {});
    await prisma.leaveType.deleteMany({}).catch(() => {});
    await prisma.attendanceRecord.deleteMany({}).catch(() => {});
    await prisma.payrollRecord.deleteMany({}).catch(() => {});
    await prisma.jobApplication.deleteMany({}).catch(() => {});
    await prisma.jobPosting.deleteMany({}).catch(() => {});
    await prisma.performanceReview.deleteMany({}).catch(() => {});
    await prisma.goal.deleteMany({}).catch(() => {});
    await prisma.inventoryAssignment.deleteMany({}).catch(() => {});
    await prisma.inventoryReturn.deleteMany({}).catch(() => {});
    await prisma.inventoryDamage.deleteMany({}).catch(() => {});
    await prisma.inventorySwap.deleteMany({}).catch(() => {});
    await prisma.inventoryItem.deleteMany({}).catch(() => {});
    await prisma.inventoryCategory.deleteMany({}).catch(() => {});
    await prisma.organization.deleteMany({}).catch(() => {});
    await prisma.user.deleteMany({}).catch(() => {});
    // DON'T delete: Role, Permission, Module - these are system/shared data
  } catch (error: any) {
    // Ignore cleanup errors - they're non-critical
    // Next test will start fresh anyway
  }
});

// Disconnect after all tests
afterAll(async () => {
  await cleanDatabase(); // Final cleanup
  await prisma.$disconnect();
});

