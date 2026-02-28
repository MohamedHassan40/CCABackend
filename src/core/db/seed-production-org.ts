/**
 * Production seed: one organization with users and sample data.
 * Run only when SEED_PRODUCTION_ORG=true. Base seed (modules, roles, permissions) must have run first.
 *
 * Env:
 *   SEED_PRODUCTION_ORG     = "true" to run this script
 *   SEED_ORG_SLUG           = org slug (default: production-demo)
 *   SEED_ORG_NAME           = org display name (default: Production Demo)
 *   SEED_ORG_ADMIN_EMAIL    = owner login email (default: owner@production-demo.com)
 *   SEED_ORG_ADMIN_PASSWORD = owner password (required in production; default for dev only)
 */

import prisma from './index';
import { hashPassword } from '../auth/password';

const REQUIRED_ENV = 'SEED_PRODUCTION_ORG';

async function main() {
  if (process.env[REQUIRED_ENV] !== 'true') {
    console.log(`⏭️  Skipping production org seed (set ${REQUIRED_ENV}=true to run).`);
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const defaultPassword = isProduction ? undefined : 'Demo123!';
  const adminPassword = process.env.SEED_ORG_ADMIN_PASSWORD || defaultPassword;
  if (isProduction && !adminPassword) {
    throw new Error('SEED_ORG_ADMIN_PASSWORD is required when NODE_ENV=production');
  }
  if (!adminPassword) {
    throw new Error('SEED_ORG_ADMIN_PASSWORD or default password required');
  }

  const slug = process.env.SEED_ORG_SLUG || 'production-demo';
  const name = process.env.SEED_ORG_NAME || 'Production Demo';
  const ownerEmail = process.env.SEED_ORG_ADMIN_EMAIL || 'owner@production-demo.com';

  console.log('🌱 Production org seed: creating organization with users and data...\n');

  // Resolve global roles (created by base seed)
  const ownerRole = await prisma.role.findUnique({ where: { key: 'owner' } });
  const adminRole = await prisma.role.findUnique({ where: { key: 'admin' } });
  const memberRole = await prisma.role.findUnique({ where: { key: 'member' } });
  const hrManagerRole = await prisma.role.findUnique({ where: { key: 'hr.manager' } });
  const ticketingAgentRole = await prisma.role.findUnique({ where: { key: 'ticketing.agent' } });
  if (!ownerRole || !adminRole || !memberRole || !hrManagerRole || !ticketingAgentRole) {
    throw new Error('Base seed must be run first (modules, roles, permissions). Run: npm run prisma:seed');
  }

  const modules = await prisma.module.findMany({
    where: { key: { not: 'billing' } },
    orderBy: { key: 'asc' },
  });
  if (modules.length === 0) {
    throw new Error('No modules found. Run base seed first: npm run prisma:seed');
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30);

  // ---------- Organization ----------
  const org = await prisma.organization.upsert({
    where: { slug },
    update: { name, isActive: true, status: 'active' },
    create: {
      name,
      slug,
      isActive: true,
      status: 'active',
      industry: 'Technology',
      companySize: '11-50',
      signupSource: 'admin-created',
    },
  });
  console.log(`✅ Organization: ${org.name} (${org.slug})`);

  const passwordHash = await hashPassword(adminPassword);

  // ---------- Users ----------
  const usersToCreate: { email: string; name: string; roleKey: string }[] = [
    { email: ownerEmail, name: 'Demo Owner', roleKey: 'owner' },
    { email: 'admin@production-demo.com', name: 'Demo Admin', roleKey: 'admin' },
    { email: 'hr@production-demo.com', name: 'HR Manager', roleKey: 'hr.manager' },
    { email: 'support@production-demo.com', name: 'Support Agent', roleKey: 'ticketing.agent' },
    { email: 'member@production-demo.com', name: 'Demo Member', roleKey: 'member' },
  ];

  const roleMap: Record<string, { id: string }> = {
    owner: ownerRole,
    admin: adminRole,
    member: memberRole,
    'hr.manager': hrManagerRole,
    'ticketing.agent': ticketingAgentRole,
  };

  const createdUsers: { id: string; email: string; name: string | null; roleKey: string }[] = [];

  for (const u of usersToCreate) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { passwordHash, name: u.name, isActive: true },
      create: {
        email: u.email,
        passwordHash,
        name: u.name,
        isActive: true,
      },
    });
    const membership = await prisma.membership.upsert({
      where: {
        userId_organizationId: { userId: user.id, organizationId: org.id },
      },
      update: { isActive: true },
      create: {
        userId: user.id,
        organizationId: org.id,
        isActive: true,
      },
    });
    const role = roleMap[u.roleKey];
    if (role) {
      await prisma.membershipRole.upsert({
        where: {
          membershipId_roleId: { membershipId: membership.id, roleId: role.id },
        },
        update: {},
        create: { membershipId: membership.id, roleId: role.id },
      });
    }
    createdUsers.push({ id: user.id, email: user.email, name: user.name, roleKey: u.roleKey });
  }
  console.log(`✅ Users: ${createdUsers.length} (owner, admin, hr, support, member)`);

  // ---------- Org modules ----------
  for (const mod of modules) {
    await prisma.orgModule.upsert({
      where: {
        organizationId_moduleId: { organizationId: org.id, moduleId: mod.id },
      },
      update: { isEnabled: true, plan: 'trial', trialEndsAt },
      create: {
        organizationId: org.id,
        moduleId: mod.id,
        isEnabled: true,
        plan: 'trial',
        trialEndsAt,
      },
    });
  }
  console.log(`✅ Org modules: ${modules.length} enabled (trial)`);

  const ownerUser = createdUsers.find((u) => u.roleKey === 'owner')!;
  const hrUser = createdUsers.find((u) => u.roleKey === 'hr.manager')!;
  const supportUser = createdUsers.find((u) => u.roleKey === 'ticketing.agent')!;

  // Skip sample data if org already has data (idempotent re-run)
  const existingEmployeeCount = await prisma.employee.count({ where: { orgId: org.id } });
  if (existingEmployeeCount > 0) {
    console.log(`✅ Sample data already present (${existingEmployeeCount} employees). Skipping data seed.`);
    console.log('\n🎉 Production org seed completed (users/org only).\n');
    return;
  }

  // ---------- HR: Leave types ----------
  const leaveTypes = await Promise.all([
    prisma.leaveType.upsert({
      where: { orgId_name: { orgId: org.id, name: 'Annual Leave' } },
      update: {},
      create: {
        orgId: org.id,
        name: 'Annual Leave',
        description: 'Paid annual leave',
        maxDays: 21,
        isPaid: true,
        requiresApproval: true,
        isActive: true,
      },
    }),
    prisma.leaveType.upsert({
      where: { orgId_name: { orgId: org.id, name: 'Sick Leave' } },
      update: {},
      create: {
        orgId: org.id,
        name: 'Sick Leave',
        description: 'Paid sick leave',
        maxDays: 10,
        isPaid: true,
        requiresApproval: false,
        isActive: true,
      },
    }),
  ]);
  console.log(`✅ Leave types: ${leaveTypes.length}`);

  // ---------- HR: Employees ----------
  const employeeData = [
    { fullName: 'Sara Ahmed', email: 'sara.ahmed@production-demo.com', position: 'Software Engineer', department: 'Engineering', employmentType: 'full_time' as const },
    { fullName: 'Omar Hassan', email: 'omar.hassan@production-demo.com', position: 'Product Manager', department: 'Product', employmentType: 'full_time' as const },
    { fullName: 'Layla Ibrahim', email: 'layla.ibrahim@production-demo.com', position: 'HR Specialist', department: 'HR', employmentType: 'full_time' as const },
    { fullName: 'Khalid Mansour', email: 'khalid.mansour@production-demo.com', position: 'Support Lead', department: 'Support', employmentType: 'full_time' as const },
  ];

  const employees: { id: string; fullName: string }[] = [];
  for (const emp of employeeData) {
    const e = await prisma.employee.create({
      data: {
        orgId: org.id,
        fullName: emp.fullName,
        email: emp.email,
        position: emp.position,
        department: emp.department,
        employmentType: emp.employmentType,
        hireDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      },
    });
    employees.push({ id: e.id, fullName: e.fullName });
    const year = new Date().getFullYear();
    for (const lt of leaveTypes) {
      const total = lt.maxDays ?? 0;
      await prisma.leaveBalance.upsert({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: e.id,
            leaveTypeId: lt.id,
            year,
          },
        },
        update: {},
        create: {
          orgId: org.id,
          employeeId: e.id,
          leaveTypeId: lt.id,
          year,
          totalDays: total,
          usedDays: 0,
          remainingDays: total,
        },
      });
    }
  }
  console.log(`✅ Employees: ${employees.length} with leave balances`);

  // ---------- Ticketing: categories + tickets ----------
  const catSupport = await prisma.ticketCategory.upsert({
    where: { orgId_name: { orgId: org.id, name: 'Support' } },
    update: {},
    create: { orgId: org.id, name: 'Support', description: 'General support', color: '#3B82F6', isActive: true },
  });
  const catBug = await prisma.ticketCategory.upsert({
    where: { orgId_name: { orgId: org.id, name: 'Bug' } },
    update: {},
    create: { orgId: org.id, name: 'Bug', description: 'Bug reports', color: '#EF4444', isActive: true },
  });

  const ticket1 = await prisma.ticket.create({
    data: {
      orgId: org.id,
      title: 'Login issue on mobile',
      description: 'Users report unable to login from iOS app.',
      status: 'in_progress',
      priority: 'high',
      categoryId: catSupport.id,
      createdById: ownerUser.id,
      assigneeId: supportUser.id,
      tags: ['mobile', 'login'],
    },
  });
  await prisma.ticketComment.create({
    data: {
      ticketId: ticket1.id,
      userId: supportUser.id,
      content: 'Investigating with the mobile team. ETA 2 days.',
      isInternal: false,
    },
  });

  await prisma.ticket.create({
    data: {
      orgId: org.id,
      title: 'Dashboard loading slowly',
      description: 'Dashboard takes more than 10 seconds to load.',
      status: 'open',
      priority: 'medium',
      categoryId: catBug.id,
      createdById: ownerUser.id,
      tags: ['performance'],
    },
  });
  console.log('✅ Ticketing: 2 categories, 2 tickets with 1 comment');

  // ---------- Marketplace: categories + products + order ----------
  const catElectronics = await prisma.productCategory.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'electronics' } },
    update: {},
    create: { orgId: org.id, name: 'Electronics', slug: 'electronics', description: 'Devices and accessories' },
  });
  const catServices = await prisma.productCategory.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'services' } },
    update: {},
    create: { orgId: org.id, name: 'Services', slug: 'services', description: 'Consulting and support' },
  });

  const product1 = await prisma.product.create({
    data: {
      orgId: org.id,
      name: 'Premium Support Pack',
      description: '1-year priority support',
      priceCents: 99900,
      currency: 'SAR',
      categoryId: catServices.id,
      isActive: true,
      stockQuantity: null,
    },
  });
  const product2 = await prisma.product.create({
    data: {
      orgId: org.id,
      name: 'USB-C Hub',
      description: '4-in-1 USB-C hub',
      priceCents: 19900,
      currency: 'SAR',
      categoryId: catElectronics.id,
      isActive: true,
      stockQuantity: 50,
    },
  });

  const orderNumber = `ORD-${org.slug.toUpperCase().slice(0, 4)}-${Date.now().toString(36).toUpperCase()}`;
  const order = await prisma.order.create({
    data: {
      orgId: org.id,
      orderNumber,
      status: 'delivered',
      totalCents: 99900 + 19900 * 2,
      currency: 'SAR',
      customerName: 'Demo Customer',
      customerEmail: 'customer@example.com',
      orderItems: {
        create: [
          { productId: product1.id, quantity: 1, priceCents: 99900, currency: 'SAR' },
          { productId: product2.id, quantity: 2, priceCents: 19900, currency: 'SAR' },
        ],
      },
    },
  });
  console.log(`✅ Marketplace: 2 categories, 2 products, 1 order (${order.orderNumber})`);

  console.log('\n🎉 Production org seed completed.\n');
  console.log('📊 Summary:');
  console.log(`   Organization: ${org.name} (${org.slug})`);
  console.log(`   Users: ${createdUsers.length} (all use password from SEED_ORG_ADMIN_PASSWORD or default)`);
  console.log(`   Owner login: ${ownerEmail}`);
  console.log(`   Employees: ${employees.length}, Leave types: ${leaveTypes.length}`);
  console.log(`   Tickets: 2, Products: 2, Orders: 1`);
}

main()
  .catch((e) => {
    console.error('❌ Production org seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
