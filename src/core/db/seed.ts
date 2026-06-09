import prisma from './index';

async function main() {
  console.log('🌱 Starting database seeding...\n');

  // ============================================
  // CREATE ALL MODULES
  // ============================================
  console.log('📦 Creating modules...');
  
  const hrModule = await prisma.module.upsert({
    where: { key: 'hr' },
    update: {},
    create: {
      key: 'hr',
      name: 'HR & Employees',
      description:
        'Human resources and employee management including attendance, leave, payroll, recruitment, and performance reviews',
      isActive: true,
    },
  });

  const ticketingModule = await prisma.module.upsert({
    where: { key: 'ticketing' },
    update: {},
    create: {
      key: 'ticketing',
      name: 'Ticketing System',
      description: 'Support ticket management and customer service',
      isActive: true,
    },
  });

  const billingModule = await prisma.module.upsert({
    where: { key: 'billing' },
    update: {
      name: 'Billing',
      description: 'Customer invoices and receivables for your organization (optional module)',
    },
    create: {
      key: 'billing',
      name: 'Billing',
      description: 'Customer invoices and receivables for your organization (optional module)',
      isActive: true,
    },
  });

  const marketplaceModule = await prisma.module.upsert({
    where: { key: 'marketplace' },
    update: {},
    create: {
      key: 'marketplace',
      name: 'Marketplace',
      description: 'E-commerce marketplace with products, categories, and orders',
      isActive: true,
    },
  });

  const pmoModule = await prisma.module.upsert({
    where: { key: 'pmo' },
    update: {},
    create: {
      key: 'pmo',
      name: 'PMO Portal',
      description: 'Project Management Office portal for managing projects, deliverables, budget, risks, and issues',
      isActive: true,
    },
  });

  const documentsModule = await prisma.module.upsert({
    where: { key: 'documents' },
    update: {},
    create: {
      key: 'documents',
      name: 'Document Management',
      description: 'Document library, folders, sharing, and categories',
      isActive: true,
    },
  });

  const salesModule = await prisma.module.upsert({
    where: { key: 'sales' },
    update: {},
    create: {
      key: 'sales',
      name: 'Sales & CRM',
      description: 'Sales pipeline, leads, opportunities, contacts, accounts, quotes, and activities',
      isActive: true,
    },
  });

  const membershipModule = await prisma.module.upsert({
    where: { key: 'membership' },
    update: {},
    create: {
      key: 'membership',
      name: 'Membership Management',
      description: 'Membership types, members, announcements, and messaging',
      isActive: true,
    },
  });

  const inventoryModule = await prisma.module.upsert({
    where: { key: 'inventory' },
    update: {
      isActive: true,
      name: 'Inventory Management',
      description:
        'Stock and asset inventory: items, categories, assignments, returns, damages, and swaps (independent from HR module)',
    },
    create: {
      key: 'inventory',
      name: 'Inventory Management',
      description:
        'Stock and asset inventory: items, categories, assignments, returns, damages, and swaps (independent from HR module)',
      isActive: true,
    },
  });

  console.log('✅ Created 9 modules\n');

  // ============================================
  // CREATE ROLES
  // ============================================
  console.log('👥 Creating roles...');

  const ownerRole = await prisma.role.upsert({
    where: { key: 'owner' },
    update: {},
    create: {
      key: 'owner',
      name: 'Owner',
      description: 'Organization owner with full access',
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { key: 'admin' },
    update: {},
    create: {
      key: 'admin',
      name: 'Administrator',
      description: 'Organization administrator',
    },
  });

  const memberRole = await prisma.role.upsert({
    where: { key: 'member' },
    update: {},
    create: {
      key: 'member',
      name: 'Member',
      description: 'Basic access to assigned modules',
    },
  });

  // Module-specific roles
  const hrManagerRole = await prisma.role.upsert({
    where: { key: 'hr.manager' },
    update: {},
    create: {
      key: 'hr.manager',
      name: 'HR Manager',
      description: 'Full access to HR module',
    },
  });

  const hrViewerRole = await prisma.role.upsert({
    where: { key: 'hr.viewer' },
    update: {},
    create: {
      key: 'hr.viewer',
      name: 'HR Viewer',
      description: 'Read-only access to HR module',
    },
  });

  const ticketingAgentRole = await prisma.role.upsert({
    where: { key: 'ticketing.agent' },
    update: {},
    create: {
      key: 'ticketing.agent',
      name: 'Support Agent',
      description: 'Can view and manage tickets',
    },
  });

  const ticketingViewerRole = await prisma.role.upsert({
    where: { key: 'ticketing.viewer' },
    update: {},
    create: {
      key: 'ticketing.viewer',
      name: 'Ticketing Viewer',
      description: 'Read-only access to tickets',
    },
  });

  const ticketingEmployeeRole = await prisma.role.upsert({
    where: { key: 'ticketing.employee' },
    update: {},
    create: {
      key: 'ticketing.employee',
      name: 'Ticketing Employee',
      description: 'Submit and track own support tickets',
    },
  });

  const hrEmployeeRole = await prisma.role.upsert({
    where: { key: 'hr.employee' },
    update: {},
    create: {
      key: 'hr.employee',
      name: 'HR Employee',
      description: 'Self-service: leave, time off, and employee requests (linked HR profile required)',
    },
  });

  const marketplaceManagerRole = await prisma.role.upsert({
    where: { key: 'marketplace.manager' },
    update: {},
    create: {
      key: 'marketplace.manager',
      name: 'Marketplace Manager',
      description: 'Full access to marketplace',
    },
  });

  const marketplaceViewerRole = await prisma.role.upsert({
    where: { key: 'marketplace.viewer' },
    update: {},
    create: {
      key: 'marketplace.viewer',
      name: 'Marketplace Viewer',
      description: 'Read-only access to marketplace',
    },
  });

  const pmoManagerRole = await prisma.role.upsert({
    where: { key: 'pmo.manager' },
    update: {},
    create: {
      key: 'pmo.manager',
      name: 'PMO Manager',
      description: 'Full access to PMO',
    },
  });

  const pmoViewerRole = await prisma.role.upsert({
    where: { key: 'pmo.viewer' },
    update: {},
    create: {
      key: 'pmo.viewer',
      name: 'PMO Viewer',
      description: 'Read-only access to PMO',
    },
  });

  const pmoClientManagerRole = await prisma.role.upsert({
    where: { key: 'pmo.client_manager' },
    update: {},
    create: {
      key: 'pmo.client_manager',
      name: 'Client Project Manager',
      description: 'Client project manager with access to assigned projects',
    },
  });

  const documentsManagerRole = await prisma.role.upsert({
    where: { key: 'documents.manager' },
    update: {},
    create: {
      key: 'documents.manager',
      name: 'Document Manager',
      description: 'Full access to document library, folders, and sharing',
    },
  });

  const documentsViewerRole = await prisma.role.upsert({
    where: { key: 'documents.viewer' },
    update: {},
    create: {
      key: 'documents.viewer',
      name: 'Document Viewer',
      description: 'Read-only access to documents and folders',
    },
  });

  const salesManagerRole = await prisma.role.upsert({
    where: { key: 'sales.manager' },
    update: {},
    create: {
      key: 'sales.manager',
      name: 'Sales Manager',
      description: 'Full access to CRM: leads, opportunities, contacts, accounts, quotes, activities',
    },
  });

  const salesViewerRole = await prisma.role.upsert({
    where: { key: 'sales.viewer' },
    update: {},
    create: {
      key: 'sales.viewer',
      name: 'Sales Viewer',
      description: 'Read-only access to sales pipeline and CRM data',
    },
  });

  const membershipManagerRole = await prisma.role.upsert({
    where: { key: 'membership.manager' },
    update: {},
    create: {
      key: 'membership.manager',
      name: 'Membership Manager',
      description: 'Full access to membership types, members, announcements, and messages',
    },
  });

  const membershipViewerRole = await prisma.role.upsert({
    where: { key: 'membership.viewer' },
    update: {},
    create: {
      key: 'membership.viewer',
      name: 'Membership Viewer',
      description: 'Read-only access to members and announcements',
    },
  });

  const inventoryManagerRole = await prisma.role.upsert({
    where: { key: 'inventory.manager' },
    update: {},
    create: {
      key: 'inventory.manager',
      name: 'Inventory Manager',
      description: 'Full access to inventory module',
    },
  });

  const inventoryViewerRole = await prisma.role.upsert({
    where: { key: 'inventory.viewer' },
    update: {},
    create: {
      key: 'inventory.viewer',
      name: 'Inventory Viewer',
      description: 'Read-only access to inventory',
    },
  });

  await prisma.role.upsert({
    where: { key: 'membership.member' },
    update: {
      name: 'Membership Member',
      description: 'Member portal: view card, announcements, and renew membership',
    },
    create: {
      key: 'membership.member',
      name: 'Membership Member',
      description: 'Member portal: view card, announcements, and renew membership',
    },
  });

  console.log('✅ Created roles\n');

  // ============================================
  // CREATE PERMISSIONS
  // ============================================
  console.log('🔐 Creating permissions...');

  const permissions = [
    // User management
    { key: 'users.view', name: 'View Users' },
    { key: 'users.create', name: 'Create Users' },
    { key: 'users.manage', name: 'Manage Users' },
    { key: 'users.delete', name: 'Delete Users' },
    // Organization management
    { key: 'organizations.update', name: 'Update Organization' },
    { key: 'organizations.delete', name: 'Delete Organization' },
    // HR permissions
    { key: 'hr.employees.view', name: 'View Employees' },
    { key: 'hr.employees.create', name: 'Create Employees' },
    { key: 'hr.employees.edit', name: 'Edit Employees' },
    { key: 'hr.employees.delete', name: 'Delete Employees' },
    { key: 'hr.leave.view', name: 'View Leave Requests' },
    { key: 'hr.leave.create', name: 'Create Leave Requests' },
    { key: 'hr.leave.edit', name: 'Edit Leave Requests' },
    { key: 'hr.leave.approve', name: 'Approve Leave Requests' },
    { key: 'hr.leave.manage', name: 'Manage Leave Types' },
    { key: 'hr.attendance.view', name: 'View Attendance' },
    { key: 'hr.attendance.create', name: 'Record Attendance' },
    { key: 'hr.attendance.edit', name: 'Edit Attendance' },
    { key: 'hr.attendance.manage', name: 'Manage Attendance' },
    { key: 'hr.payroll.view', name: 'View Payroll' },
    { key: 'hr.payroll.create', name: 'Create Payroll Records' },
    { key: 'hr.payroll.edit', name: 'Edit Payroll Records' },
    { key: 'hr.payroll.approve', name: 'Approve Payroll' },
    { key: 'hr.recruitment.view', name: 'View Recruitment' },
    { key: 'hr.recruitment.create', name: 'Create Job Postings' },
    { key: 'hr.recruitment.edit', name: 'Edit Job Postings' },
    { key: 'hr.recruitment.manage', name: 'Manage Applications' },
    { key: 'hr.performance.view', name: 'View Performance Reviews' },
    { key: 'hr.performance.create', name: 'Create Performance Reviews' },
    { key: 'hr.performance.edit', name: 'Edit Performance Reviews' },
    { key: 'hr.performance.manage', name: 'Manage Goals' },
    { key: 'hr.decisions.view', name: 'View HR Decisions' },
    { key: 'hr.decisions.create', name: 'Create Deduction Decisions' },
    { key: 'hr.announcements.view', name: 'View HR Announcements' },
    { key: 'hr.announcements.create', name: 'Create HR Announcements' },
    { key: 'hr.announcements.edit', name: 'Edit HR Announcements' },
    { key: 'hr.announcements.delete', name: 'Delete HR Announcements' },
    { key: 'hr.complaints.view', name: 'View Employee Complaints' },
    { key: 'hr.complaints.create', name: 'Create Employee Complaints' },
    { key: 'hr.complaints.edit', name: 'Edit Employee Complaints' },
    { key: 'hr.complaints.delete', name: 'Delete Employee Complaints' },
    { key: 'hr.requests.view', name: 'View Employee Requests' },
    { key: 'hr.requests.create', name: 'Create Employee Requests' },
    { key: 'hr.requests.edit', name: 'Edit Employee Requests' },
    { key: 'hr.requests.delete', name: 'Delete Employee Requests' },
    // Ticketing permissions
    { key: 'ticketing.tickets.view', name: 'View Tickets' },
    { key: 'ticketing.tickets.view_own', name: 'View Own Tickets' },
    { key: 'ticketing.tickets.create', name: 'Create Tickets' },
    { key: 'ticketing.tickets.edit', name: 'Edit Tickets' },
    { key: 'ticketing.tickets.delete', name: 'Delete Tickets' },
    // HR self-service (employee portal; no HR admin screens)
    { key: 'hr.self_service', name: 'HR Employee Self-Service' },
    { key: 'hr.assets.view', name: 'View Employee Assets' },
    { key: 'hr.assets.create', name: 'Create Employee Assets' },
    { key: 'hr.assets.edit', name: 'Edit Employee Assets' },
    { key: 'hr.assets.delete', name: 'Delete Employee Assets' },
    { key: 'hr.assets.categories.view', name: 'View Asset Categories' },
    { key: 'hr.assets.categories.create', name: 'Create Asset Categories' },
    { key: 'hr.assets.categories.edit', name: 'Edit Asset Categories' },
    { key: 'hr.assets.categories.delete', name: 'Delete Asset Categories' },
    { key: 'hr.assets.assignments.view', name: 'View Asset Assignments' },
    { key: 'hr.assets.assignments.create', name: 'Create Asset Assignments' },
    { key: 'hr.assets.assignments.edit', name: 'Edit Asset Assignments' },
    { key: 'hr.assets.assignments.approve', name: 'Approve Asset Assignments' },
    { key: 'hr.assets.returns.view', name: 'View Asset Returns' },
    { key: 'hr.assets.returns.create', name: 'Create Asset Returns' },
    { key: 'hr.assets.damages.view', name: 'View Asset Damages' },
    { key: 'hr.assets.damages.create', name: 'Create Asset Damage Records' },
    { key: 'hr.assets.damages.review', name: 'Review Asset Damages' },
    { key: 'hr.assets.swaps.view', name: 'View Asset Swaps' },
    { key: 'hr.assets.swaps.create', name: 'Create Asset Swaps' },
    { key: 'hr.assets.swaps.approve', name: 'Approve Asset Swaps' },
    // Platform subscriptions (CCA module licensing — not the org Billing module)
    { key: 'subscriptions.view', name: 'View Platform Subscriptions' },
    { key: 'subscriptions.manage', name: 'Manage Platform Subscriptions' },
    // Org Billing module (optional)
    { key: 'billing.workspace.view', name: 'View Organization Billing Workspace' },
    // Marketplace permissions
    { key: 'marketplace.products.view', name: 'View Products' },
    { key: 'marketplace.products.create', name: 'Create Products' },
    { key: 'marketplace.products.edit', name: 'Edit Products' },
    { key: 'marketplace.products.delete', name: 'Delete Products' },
    { key: 'marketplace.categories.view', name: 'View Categories' },
    { key: 'marketplace.categories.create', name: 'Create Categories' },
    { key: 'marketplace.categories.edit', name: 'Edit Categories' },
    { key: 'marketplace.categories.delete', name: 'Delete Categories' },
    { key: 'marketplace.orders.view', name: 'View Orders' },
    { key: 'marketplace.orders.create', name: 'Create Orders' },
    { key: 'marketplace.orders.edit', name: 'Edit Orders' },
    // PMO permissions
    { key: 'pmo.projects.view', name: 'View Projects' },
    { key: 'pmo.projects.create', name: 'Create Projects' },
    { key: 'pmo.projects.edit', name: 'Edit Projects' },
    { key: 'pmo.projects.delete', name: 'Delete Projects' },
    { key: 'pmo.deliverables.view', name: 'View Deliverables' },
    { key: 'pmo.deliverables.create', name: 'Create Deliverables' },
    { key: 'pmo.deliverables.edit', name: 'Edit Deliverables' },
    { key: 'pmo.deliverables.delete', name: 'Delete Deliverables' },
    { key: 'pmo.budget.view', name: 'View Budget' },
    { key: 'pmo.budget.create', name: 'Create Budget' },
    { key: 'pmo.budget.edit', name: 'Edit Budget' },
    { key: 'pmo.budget.delete', name: 'Delete Budget' },
    { key: 'pmo.risks.view', name: 'View Risks' },
    { key: 'pmo.risks.create', name: 'Create Risks' },
    { key: 'pmo.risks.edit', name: 'Edit Risks' },
    { key: 'pmo.risks.delete', name: 'Delete Risks' },
    { key: 'pmo.issues.view', name: 'View Issues' },
    { key: 'pmo.issues.create', name: 'Create Issues' },
    { key: 'pmo.issues.edit', name: 'Edit Issues' },
    { key: 'pmo.issues.delete', name: 'Delete Issues' },
    { key: 'pmo.client_managers.view', name: 'View Client Managers' },
    { key: 'pmo.client_managers.create', name: 'Create Client Managers' },
    { key: 'pmo.client_managers.edit', name: 'Edit Client Managers' },
    { key: 'pmo.client_managers.delete', name: 'Delete Client Managers' },
    { key: 'pmo.tasks.view', name: 'View Project Tasks' },
    { key: 'pmo.tasks.create', name: 'Create Project Tasks' },
    { key: 'pmo.tasks.edit', name: 'Edit Project Tasks' },
    { key: 'pmo.tasks.delete', name: 'Delete Project Tasks' },
    // Documents permissions
    { key: 'documents.view', name: 'View Documents' },
    { key: 'documents.create', name: 'Create Documents' },
    { key: 'documents.edit', name: 'Edit Documents' },
    { key: 'documents.delete', name: 'Delete Documents' },
    { key: 'documents.folders.view', name: 'View Folders' },
    { key: 'documents.folders.create', name: 'Create Folders' },
    { key: 'documents.folders.edit', name: 'Edit Folders' },
    { key: 'documents.folders.delete', name: 'Delete Folders' },
    { key: 'documents.categories.view', name: 'View Categories' },
    { key: 'documents.categories.create', name: 'Create Categories' },
    { key: 'documents.categories.edit', name: 'Edit Categories' },
    { key: 'documents.categories.delete', name: 'Delete Categories' },
    { key: 'documents.share', name: 'Share Documents' },
    // Sales permissions
    { key: 'sales.leads.view', name: 'View Leads' },
    { key: 'sales.leads.create', name: 'Create Leads' },
    { key: 'sales.leads.edit', name: 'Edit Leads' },
    { key: 'sales.leads.delete', name: 'Delete Leads' },
    { key: 'sales.opportunities.view', name: 'View Opportunities' },
    { key: 'sales.opportunities.create', name: 'Create Opportunities' },
    { key: 'sales.opportunities.edit', name: 'Edit Opportunities' },
    { key: 'sales.opportunities.delete', name: 'Delete Opportunities' },
    { key: 'sales.contacts.view', name: 'View Contacts' },
    { key: 'sales.contacts.create', name: 'Create Contacts' },
    { key: 'sales.contacts.edit', name: 'Edit Contacts' },
    { key: 'sales.contacts.delete', name: 'Delete Contacts' },
    { key: 'sales.accounts.view', name: 'View Accounts' },
    { key: 'sales.accounts.create', name: 'Create Accounts' },
    { key: 'sales.accounts.edit', name: 'Edit Accounts' },
    { key: 'sales.accounts.delete', name: 'Delete Accounts' },
    { key: 'sales.quotes.view', name: 'View Quotes' },
    { key: 'sales.quotes.create', name: 'Create Quotes' },
    { key: 'sales.quotes.edit', name: 'Edit Quotes' },
    { key: 'sales.quotes.delete', name: 'Delete Quotes' },
    { key: 'sales.activities.view', name: 'View Activities' },
    { key: 'sales.activities.create', name: 'Create Activities' },
    { key: 'sales.activities.edit', name: 'Edit Activities' },
    // Membership permissions
    { key: 'membership.types.view', name: 'View Membership Types' },
    { key: 'membership.types.create', name: 'Create Membership Types' },
    { key: 'membership.types.edit', name: 'Edit Membership Types' },
    { key: 'membership.types.delete', name: 'Delete Membership Types' },
    { key: 'membership.members.view', name: 'View Members' },
    { key: 'membership.members.create', name: 'Create Members' },
    { key: 'membership.members.edit', name: 'Edit Members' },
    { key: 'membership.members.delete', name: 'Delete Members' },
    { key: 'membership.announcements.view', name: 'View Announcements' },
    { key: 'membership.announcements.create', name: 'Create Announcements' },
    { key: 'membership.announcements.edit', name: 'Edit Announcements' },
    { key: 'membership.announcements.delete', name: 'Delete Announcements' },
    { key: 'membership.messages.view', name: 'View Messages' },
    { key: 'membership.messages.create', name: 'Create Messages' },
    { key: 'membership.messages.edit', name: 'Edit Messages' },
    { key: 'membership.messages.delete', name: 'Delete Messages' },
    // Inventory module (independent from HR)
    { key: 'inventory.items.view', name: 'View Inventory Items' },
    { key: 'inventory.items.create', name: 'Create Inventory Items' },
    { key: 'inventory.items.edit', name: 'Edit Inventory Items' },
    { key: 'inventory.items.delete', name: 'Delete Inventory Items' },
    { key: 'inventory.categories.view', name: 'View Inventory Categories' },
    { key: 'inventory.categories.create', name: 'Create Inventory Categories' },
    { key: 'inventory.categories.edit', name: 'Edit Inventory Categories' },
    { key: 'inventory.categories.delete', name: 'Delete Inventory Categories' },
    { key: 'inventory.assignments.view', name: 'View Inventory Assignments' },
    { key: 'inventory.assignments.create', name: 'Create Inventory Assignments' },
    { key: 'inventory.assignments.edit', name: 'Edit Inventory Assignments' },
    { key: 'inventory.assignments.approve', name: 'Approve Inventory Assignments' },
    { key: 'inventory.returns.view', name: 'View Inventory Returns' },
    { key: 'inventory.returns.create', name: 'Create Inventory Returns' },
    { key: 'inventory.damages.view', name: 'View Inventory Damages' },
    { key: 'inventory.damages.create', name: 'Create Inventory Damage Records' },
    { key: 'inventory.damages.review', name: 'Review Inventory Damages' },
    { key: 'inventory.swaps.view', name: 'View Inventory Swaps' },
    { key: 'inventory.swaps.create', name: 'Create Inventory Swaps' },
    { key: 'inventory.swaps.approve', name: 'Approve Inventory Swaps' },
  ];

  const createdPermissions: { id: string; key: string }[] = [];
  for (const perm of permissions) {
    const p = await prisma.permission.upsert({
      where: { key: perm.key },
      update: {},
      create: perm,
    });
    createdPermissions.push(p);
  }

  console.log(`✅ Created ${createdPermissions.length} permissions\n`);

  // Assign all permissions to owner role
  for (const perm of createdPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: ownerRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: ownerRole.id,
        permissionId: perm.id,
      },
    });
  }

  // Assign most permissions to admin role (except platform subscription management)
  for (const perm of createdPermissions) {
    if (perm.key !== 'subscriptions.manage') {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: adminRole.id,
          permissionId: perm.id,
        },
      });
    }
  }

  // Assign module-specific permissions to module roles
  const assignModulePermissions = async (role: any, prefix: string) => {
    const modulePerms = createdPermissions.filter((p) => p.key.startsWith(prefix));
    for (const perm of modulePerms) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: perm.id,
        },
      });
    }
  };

  await assignModulePermissions(hrManagerRole, 'hr.');
  await assignModulePermissions(ticketingAgentRole, 'ticketing.');
  await assignModulePermissions(marketplaceManagerRole, 'marketplace.');
  await assignModulePermissions(pmoManagerRole, 'pmo.');
  await assignModulePermissions(documentsManagerRole, 'documents.');
  await assignModulePermissions(salesManagerRole, 'sales.');
  await assignModulePermissions(membershipManagerRole, 'membership.');
  await assignModulePermissions(inventoryManagerRole, 'inventory.');

  // View-only roles: assign all *.view permissions per module to viewer roles
  const hrViewPerms = createdPermissions.filter((p) => p.key.startsWith('hr.') && p.key.endsWith('.view'));
  for (const perm of hrViewPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: hrViewerRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: hrViewerRole.id,
        permissionId: perm.id,
      },
    });
  }

  const ticketingViewPerm = createdPermissions.find((p) => p.key === 'ticketing.tickets.view');
  if (ticketingViewPerm) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: ticketingViewerRole.id,
          permissionId: ticketingViewPerm.id,
        },
      },
      update: {},
      create: {
        roleId: ticketingViewerRole.id,
        permissionId: ticketingViewPerm.id,
      },
    });
  }

  const ticketingEmployeePerms = createdPermissions.filter((p) =>
    ['ticketing.tickets.create', 'ticketing.tickets.view_own'].includes(p.key)
  );
  for (const perm of ticketingEmployeePerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: ticketingEmployeeRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: ticketingEmployeeRole.id,
        permissionId: perm.id,
      },
    });
  }

  const hrSelfServicePerm = createdPermissions.find((p) => p.key === 'hr.self_service');
  if (hrSelfServicePerm) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: hrEmployeeRole.id,
          permissionId: hrSelfServicePerm.id,
        },
      },
      update: {},
      create: {
        roleId: hrEmployeeRole.id,
        permissionId: hrSelfServicePerm.id,
      },
    });
  }

  // Marketplace, PMO, Inventory viewers
  const viewOnlyPerms = createdPermissions.filter((p) =>
    (p.key.startsWith('marketplace.') || p.key.startsWith('pmo.') || p.key.startsWith('inventory.')) &&
    p.key.endsWith('.view')
  );
  for (const perm of viewOnlyPerms) {
    let roleId = null;
    if (perm.key.startsWith('marketplace.')) roleId = marketplaceViewerRole.id;
    if (perm.key.startsWith('pmo.')) roleId = pmoViewerRole.id;
    if (perm.key.startsWith('inventory.')) roleId = inventoryViewerRole.id;

    if (roleId) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId,
          permissionId: perm.id,
        },
      });
    }
  }

  // Client project manager: view projects (filtered by API to assigned only), view + create tasks
  const clientManagerTaskPerms = createdPermissions.filter(
    (p) =>
      p.key === 'pmo.projects.view' ||
      p.key === 'pmo.tasks.view' ||
      p.key === 'pmo.tasks.create'
  );
  for (const perm of clientManagerTaskPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: pmoClientManagerRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: pmoClientManagerRole.id,
        permissionId: perm.id,
      },
    });
  }

  // Documents viewer: documents.view + documents.*.view
  const documentsViewPerms = createdPermissions.filter(
    (p) => p.key.startsWith('documents.') && (p.key === 'documents.view' || p.key.endsWith('.view'))
  );
  for (const perm of documentsViewPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: documentsViewerRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: documentsViewerRole.id,
        permissionId: perm.id,
      },
    });
  }

  // Sales viewer: all sales.*.view
  const salesViewPerms = createdPermissions.filter((p) => p.key.startsWith('sales.') && p.key.endsWith('.view'));
  for (const perm of salesViewPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: salesViewerRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: salesViewerRole.id,
        permissionId: perm.id,
      },
    });
  }

  // Membership viewer: all membership.*.view
  const membershipViewPerms = createdPermissions.filter(
    (p) => p.key.startsWith('membership.') && p.key.endsWith('.view')
  );
  for (const perm of membershipViewPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: membershipViewerRole.id,
          permissionId: perm.id,
        },
      },
      update: {},
      create: {
        roleId: membershipViewerRole.id,
        permissionId: perm.id,
      },
    });
  }

  console.log('✅ Assigned permissions to roles\n');

  // Org "member" is a basic login role only — use ticketing.employee / hr.employee for staff self-service.
  const ticketingCreateOnMember = createdPermissions.find((p) => p.key === 'ticketing.tickets.create');
  if (ticketingCreateOnMember) {
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: memberRole.id,
        permissionId: ticketingCreateOnMember.id,
      },
    });
  }

  // ============================================
  // CREATE MODULE PRICES
  // ============================================
  console.log('💰 Creating module prices...');

  const seedModulePrices = async (
    module: any,
    proPriceMonthly: number,
    proPriceYearly: number,
    ultraPriceMonthly: number,
    ultraPriceYearly: number,
    basicMaxSeats: number = 3,
    proMaxSeats: number = 10,
    ultraMaxSeats: number | null = null
  ) => {
    // Basic Plan - FREE
    await prisma.modulePrice.upsert({
      where: {
        moduleId_plan_billingPeriod: {
          moduleId: module.id,
          plan: 'basic',
          billingPeriod: 'monthly',
        },
      },
      update: {},
      create: {
        moduleId: module.id,
        plan: 'basic',
        priceCents: 0,
        currency: 'SAR',
        billingPeriod: 'monthly',
        maxSeats: basicMaxSeats,
      },
    });

    await prisma.modulePrice.upsert({
      where: {
        moduleId_plan_billingPeriod: {
          moduleId: module.id,
          plan: 'basic',
          billingPeriod: 'yearly',
        },
      },
      update: {},
      create: {
        moduleId: module.id,
        plan: 'basic',
        priceCents: 0,
        currency: 'SAR',
        billingPeriod: 'yearly',
        maxSeats: basicMaxSeats,
      },
    });

    // Pro Plan - PAID
    await prisma.modulePrice.upsert({
      where: {
        moduleId_plan_billingPeriod: {
          moduleId: module.id,
          plan: 'pro',
          billingPeriod: 'monthly',
        },
      },
      update: {},
      create: {
        moduleId: module.id,
        plan: 'pro',
        priceCents: proPriceMonthly,
        currency: 'SAR',
        billingPeriod: 'monthly',
        maxSeats: proMaxSeats,
      },
    });

    await prisma.modulePrice.upsert({
      where: {
        moduleId_plan_billingPeriod: {
          moduleId: module.id,
          plan: 'pro',
          billingPeriod: 'yearly',
        },
      },
      update: {},
      create: {
        moduleId: module.id,
        plan: 'pro',
        priceCents: proPriceYearly,
        currency: 'SAR',
        billingPeriod: 'yearly',
        maxSeats: proMaxSeats,
      },
    });

    // Ultra Plan - PAID
    await prisma.modulePrice.upsert({
      where: {
        moduleId_plan_billingPeriod: {
          moduleId: module.id,
          plan: 'ultra',
          billingPeriod: 'monthly',
        },
      },
      update: {},
      create: {
        moduleId: module.id,
        plan: 'ultra',
        priceCents: ultraPriceMonthly,
        currency: 'SAR',
        billingPeriod: 'monthly',
        maxSeats: ultraMaxSeats,
      },
    });

    await prisma.modulePrice.upsert({
      where: {
        moduleId_plan_billingPeriod: {
          moduleId: module.id,
          plan: 'ultra',
          billingPeriod: 'yearly',
        },
      },
      update: {},
      create: {
        moduleId: module.id,
        plan: 'ultra',
        priceCents: ultraPriceYearly,
        currency: 'SAR',
        billingPeriod: 'yearly',
        maxSeats: ultraMaxSeats,
      },
    });
  };

  // Seed prices for all modules
  await seedModulePrices(hrModule, 9900, 99000, 19900, 199000); // HR: Pro 99/month, Ultra 199/month
  await seedModulePrices(ticketingModule, 14900, 149000, 29900, 299000); // Ticketing: Pro 149/month, Ultra 299/month
  await seedModulePrices(marketplaceModule, 19900, 199000, 39900, 399000); // Marketplace: Pro 199/month, Ultra 399/month
  await seedModulePrices(pmoModule, 24900, 249000, 49900, 499000); // PMO: Pro 249/month, Ultra 499/month
  await seedModulePrices(documentsModule, 9900, 99000, 19900, 199000); // Documents: Pro 99/month, Ultra 199/month
  await seedModulePrices(salesModule, 19900, 199000, 39900, 399000); // Sales: Pro 199/month, Ultra 399/month
  await seedModulePrices(membershipModule, 9900, 99000, 19900, 199000); // Membership: Pro 99/month, Ultra 199/month
  await seedModulePrices(billingModule, 0, 0, 0, 0); // Billing: Free for all plans
  await seedModulePrices(inventoryModule, 9900, 99000, 19900, 199000); // Inventory: Pro 99/month, Ultra 199/month

  console.log('✅ Created module prices (Basic: 3 users free, Pro: 10 users paid, Ultra: unlimited paid)\n');

  // ============================================
  // CREATE BUNDLES
  // ============================================
  console.log('📦 Creating bundles...');

  const starterBundle = await prisma.bundle.findFirst({ where: { name: 'Starter Bundle' } })
    ?? await prisma.bundle.create({
      data: {
        name: 'Starter Bundle',
        description: 'HR + Ticketing for small teams. Perfect to get started.',
        priceCents: 19900, // 199 SAR/month
        currency: 'SAR',
        billingPeriod: 'monthly',
        isActive: true,
        discountPercentage: 15,
        maxUsers: 10,
        maxEmployees: 25,
      },
    });
  if (starterBundle) {
    await prisma.bundle.update({
      where: { id: starterBundle.id },
      data: { maxUsers: 10, maxEmployees: 25 },
    });
  }

  const businessBundle = await prisma.bundle.findFirst({ where: { name: 'Business Bundle' } })
    ?? await prisma.bundle.create({
      data: {
        name: 'Business Bundle',
        description: 'HR, Ticketing, and Marketplace. Complete business suite.',
        priceCents: 49900, // 499 SAR/month
        currency: 'SAR',
        billingPeriod: 'monthly',
        isActive: true,
        discountPercentage: 25,
        maxUsers: 50,
        maxEmployees: 200,
      },
    });
  if (businessBundle) {
    await prisma.bundle.update({
      where: { id: businessBundle.id },
      data: { maxUsers: 50, maxEmployees: 200 },
    });
  }

  const enterpriseBundle = await prisma.bundle.findFirst({ where: { name: 'Enterprise Bundle' } })
    ?? await prisma.bundle.create({
      data: {
        name: 'Enterprise Bundle',
        description: 'All modules included. Full platform access.',
        priceCents: 99900, // 999 SAR/month
        currency: 'SAR',
        billingPeriod: 'monthly',
        isActive: true,
        discountPercentage: 35,
        maxUsers: null, // unlimited
        maxEmployees: null, // unlimited
      },
    });
  if (enterpriseBundle) {
    await prisma.bundle.update({
      where: { id: enterpriseBundle.id },
      data: { maxUsers: null, maxEmployees: null },
    });
  }

  // Link modules to bundles
  const bundleModuleLinks = [
    { bundle: starterBundle, module: hrModule, plan: 'pro' },
    { bundle: starterBundle, module: ticketingModule, plan: 'pro' },
    { bundle: businessBundle, module: hrModule, plan: 'pro' },
    { bundle: businessBundle, module: ticketingModule, plan: 'pro' },
    { bundle: businessBundle, module: marketplaceModule, plan: 'pro' },
    { bundle: businessBundle, module: inventoryModule, plan: 'pro' },
    { bundle: enterpriseBundle, module: hrModule, plan: 'ultra' },
    { bundle: enterpriseBundle, module: ticketingModule, plan: 'ultra' },
    { bundle: enterpriseBundle, module: marketplaceModule, plan: 'ultra' },
    { bundle: enterpriseBundle, module: pmoModule, plan: 'ultra' },
    { bundle: enterpriseBundle, module: documentsModule, plan: 'ultra' },
    { bundle: enterpriseBundle, module: salesModule, plan: 'ultra' },
    { bundle: enterpriseBundle, module: membershipModule, plan: 'ultra' },
    { bundle: enterpriseBundle, module: inventoryModule, plan: 'ultra' },
  ];

  for (const link of bundleModuleLinks) {
    await prisma.bundleModule.upsert({
      where: {
        bundleId_moduleId: {
          bundleId: link.bundle.id,
          moduleId: link.module.id,
        },
      },
      update: { plan: link.plan },
      create: {
        bundleId: link.bundle.id,
        moduleId: link.module.id,
        plan: link.plan,
      },
    });
  }

  console.log('✅ Created 3 bundles: Starter, Business, Enterprise\n');

  // ============================================
  // CREATE SUPER ADMIN USER (no organization - platform-level only)
  // ============================================
  console.log('👤 Creating super admin user...');

  const { hashPassword } = await import('../auth/password');
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'info@cloud.org.sa';
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || '123456';
  const superAdminPasswordHash = await hashPassword(superAdminPassword);

  const superAdmin = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {
      isSuperAdmin: true,
      isActive: true,
      passwordHash: superAdminPasswordHash,
    },
    create: {
      email: superAdminEmail,
      passwordHash: superAdminPasswordHash,
      name: 'Platform Admin',
      isSuperAdmin: true,
      isActive: true,
    },
  });

  // Remove any existing membership for super admin (they must have NO organization)
  await prisma.membershipRole.deleteMany({
    where: {
      membership: {
        userId: superAdmin.id,
      },
    },
  });
  await prisma.membership.deleteMany({
    where: { userId: superAdmin.id },
  });

  console.log('✅ Created super admin (no organization):');
  console.log(`   Email: ${superAdminEmail}`);
  console.log('   Password: (set via SUPER_ADMIN_PASSWORD env, or default 123456)');
  console.log('   Role: Platform-level control (pricing, bundles, organizations, modules)\n');

  // ============================================
  // CREATE 2 ORGANIZATIONS WITH ADMIN USERS
  // ============================================
  console.log('🏢 Creating organizations with admin users...');

  const org1 = await prisma.organization.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      name: 'Acme Corporation',
      slug: 'acme-corp',
      isActive: true,
      status: 'active',
      industry: 'Technology',
      companySize: '11-50',
    },
  });

  const org2 = await prisma.organization.upsert({
    where: { slug: 'tech-startup-sa' },
    update: {},
    create: {
      name: 'Tech Startup SA',
      slug: 'tech-startup-sa',
      isActive: true,
      status: 'active',
      industry: 'Software',
      companySize: '1-10',
    },
  });

  const allModules = [
    hrModule,
    ticketingModule,
    marketplaceModule,
    pmoModule,
    documentsModule,
    salesModule,
    membershipModule,
    inventoryModule,
  ];
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 7); // 1-week trial

  // Org 1 admin (the one who "registered" / created Acme)
  const acmeAdminPassword = await hashPassword('admin123');
  const acmeAdmin = await prisma.user.upsert({
    where: { email: 'admin@acme.com' },
    update: {},
    create: {
      email: 'admin@acme.com',
      passwordHash: acmeAdminPassword,
      name: 'Acme Admin',
      isActive: true,
    },
  });
  const acmeMembership = await prisma.membership.upsert({
    where: {
      userId_organizationId: { userId: acmeAdmin.id, organizationId: org1.id },
    },
    update: {},
    create: {
      userId: acmeAdmin.id,
      organizationId: org1.id,
      isActive: true,
    },
  });
  await prisma.membershipRole.upsert({
    where: {
      membershipId_roleId: { membershipId: acmeMembership.id, roleId: ownerRole.id },
    },
    update: {},
    create: { membershipId: acmeMembership.id, roleId: ownerRole.id },
  });
  for (const module of allModules) {
    await prisma.orgModule.upsert({
      where: {
        organizationId_moduleId: { organizationId: org1.id, moduleId: module.id },
      },
      update: {},
      create: {
        organizationId: org1.id,
        moduleId: module.id,
        isEnabled: true,
        plan: 'trial',
        trialEndsAt,
      },
    });
  }

  // Org 2 admin
  const techAdminPassword = await hashPassword('admin123');
  const techAdmin = await prisma.user.upsert({
    where: { email: 'admin@techstartup.com' },
    update: {},
    create: {
      email: 'admin@techstartup.com',
      passwordHash: techAdminPassword,
      name: 'Tech Startup Admin',
      isActive: true,
    },
  });
  const techMembership = await prisma.membership.upsert({
    where: {
      userId_organizationId: { userId: techAdmin.id, organizationId: org2.id },
    },
    update: {},
    create: {
      userId: techAdmin.id,
      organizationId: org2.id,
      isActive: true,
    },
  });
  await prisma.membershipRole.upsert({
    where: {
      membershipId_roleId: { membershipId: techMembership.id, roleId: ownerRole.id },
    },
    update: {},
    create: { membershipId: techMembership.id, roleId: ownerRole.id },
  });
  for (const module of allModules) {
    await prisma.orgModule.upsert({
      where: {
        organizationId_moduleId: { organizationId: org2.id, moduleId: module.id },
      },
      update: {},
      create: {
        organizationId: org2.id,
        moduleId: module.id,
        isEnabled: true,
        plan: 'trial',
        trialEndsAt,
      },
    });
  }

  console.log('✅ Organizations with admins:');
  console.log('   - Acme Corporation: admin@acme.com / admin123 (owner)');
  console.log('   - Tech Startup SA: admin@techstartup.com / admin123 (owner)\n');

  console.log('🎉 Seeding completed successfully!\n');
  console.log('📊 Summary:');
  console.log(`   - ${allModules.length + 1} modules (including billing)`);
  console.log(`   - ${createdPermissions.length} permissions`);
  console.log(`   - 3 bundles (Starter, Business, Enterprise)`);
  console.log(`   - Super admin: admin@cca.com (no org)`);
  console.log(`   - 2 organizations with admin users`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
