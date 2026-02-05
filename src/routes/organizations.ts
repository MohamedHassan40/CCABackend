import { Router, Request, Response } from 'express';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/permissions';
import { hashPassword } from '../core/auth/password';
import { sendEmail, emailTemplates } from '../core/email';
import { config } from '../core/config';

const router = Router();

// Helper to create slug from name
function createSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// POST /api/organizations/create - Create organization (Super Admin or public)
router.post('/create', async (req: Request, res: Response) => {
  try {
    const {
      name,
      slug,
      adminEmail,
      adminName,
      adminPassword,
      modules, // [{ moduleKey, plan, trialDays }]
      industry,
      companySize,
    } = req.body;

    if (!name || !adminEmail) {
      res.status(400).json({ error: 'Organization name and admin email are required' });
      return;
    }

    // Check if organization slug already exists
    const finalSlug = slug || createSlug(name);
    const existingOrg = await prisma.organization.findUnique({
      where: { slug: finalSlug },
    });

    if (existingOrg) {
      res.status(400).json({ error: 'Organization with this slug already exists' });
      return;
    }

    // Check if admin user already exists
    let adminUser = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!adminUser) {
      if (!adminPassword) {
        res.status(400).json({ error: 'Admin password is required for new users' });
        return;
      }

      const passwordHash = await hashPassword(adminPassword);
      adminUser = await prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          name: adminName || null,
        },
      });
    }

    // Create organization
    // If created by super admin, set to active. Otherwise, set to pending for approval
    const isSuperAdmin = req.user?.isSuperAdmin || false;
    const organization = await prisma.organization.create({
      data: {
        name,
        slug: finalSlug,
        industry: industry || null,
        companySize: companySize || null,
        signupSource: isSuperAdmin ? 'admin-created' : 'self-service',
        status: isSuperAdmin ? 'active' : 'pending', // Only active if approved by super admin
        isActive: isSuperAdmin, // Only active if approved by super admin
      },
    });

    // Create membership with OWNER role
    const ownerRole = await prisma.role.findUnique({
      where: { key: 'owner' },
    });

    if (ownerRole) {
      const membership = await prisma.membership.create({
        data: {
          userId: adminUser.id,
          organizationId: organization.id,
        },
      });

      await prisma.membershipRole.create({
        data: {
          membershipId: membership.id,
          roleId: ownerRole.id,
        },
      });
    }

    // Enable modules
    if (modules && Array.isArray(modules)) {
      for (const moduleConfig of modules) {
        const module = await prisma.module.findUnique({
          where: { key: moduleConfig.moduleKey },
        });

        if (module) {
          const trialDays = moduleConfig.trialDays || 14;
          const trialEndsAt = new Date();
          trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

          await prisma.orgModule.upsert({
            where: {
              organizationId_moduleId: {
                organizationId: organization.id,
                moduleId: module.id,
              },
            },
            create: {
              organizationId: organization.id,
              moduleId: module.id,
              isEnabled: true,
              plan: moduleConfig.plan || 'trial',
              trialEndsAt: moduleConfig.plan === 'trial' ? trialEndsAt : null,
            },
            update: {
              isEnabled: true,
              plan: moduleConfig.plan || 'trial',
              trialEndsAt: moduleConfig.plan === 'trial' ? trialEndsAt : null,
            },
          });
        }
      }
    }

    // Send email based on status
    try {
      if (isSuperAdmin) {
        // Super admin created - send welcome email immediately
        const loginUrl = `${config.corsOrigin}/auth/login`;
        const email = emailTemplates.organizationCreated(organization.name, adminEmail, loginUrl);
        await sendEmail({
          to: adminEmail,
          subject: email.subject,
          html: email.html,
        });
      } else {
        // Self-service signup - send pending approval email
        const email = emailTemplates.organizationPendingApproval(organization.name, adminEmail);
        await sendEmail({
          to: adminEmail,
          subject: email.subject,
          html: email.html,
        });
      }
    } catch (emailError) {
      console.error('Failed to send email:', emailError);
    }

    res.status(201).json({
      message: isSuperAdmin
        ? 'Organization created successfully'
        : 'Organization registration submitted. Please wait for approval.',
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
      },
    });
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/organizations/:id/modules/trial - Extend/add trial
router.post('/:id/modules/trial', authMiddleware, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { moduleKey, days } = req.body;

    if (!moduleKey || !days) {
      res.status(400).json({ error: 'Module key and days are required' });
      return;
    }

    const organization = await prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const module = await prisma.module.findUnique({
      where: { key: moduleKey },
    });

    if (!module) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }

    const orgModule = await prisma.orgModule.findUnique({
      where: {
        organizationId_moduleId: {
          organizationId: id,
          moduleId: module.id,
        },
      },
    });

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + parseInt(days));

    if (orgModule) {
      // Extend existing trial
      await prisma.orgModule.update({
        where: {
          organizationId_moduleId: {
            organizationId: id,
            moduleId: module.id,
          },
        },
        data: {
          trialEndsAt,
          plan: 'trial',
        },
      });
    } else {
      // Create new trial
      await prisma.orgModule.create({
        data: {
          organizationId: id,
          moduleId: module.id,
          isEnabled: true,
          plan: 'trial',
          trialEndsAt,
        },
      });
    }

    res.json({ message: 'Trial extended successfully', trialEndsAt });
  } catch (error) {
    console.error('Error extending trial:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/organizations/:id/approve - Approve organization (Super Admin only)
router.post('/:id/approve', authMiddleware, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const organization = await prisma.organization.findUnique({
      where: { id },
      include: {
        memberships: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    if (organization.status === 'active') {
      res.status(400).json({ error: 'Organization is already approved' });
      return;
    }

    // Update organization status
    const updated = await prisma.organization.update({
      where: { id },
      data: {
        status: 'active',
        isActive: true,
      },
    });

    // Enable default modules if none are enabled
    const existingModules = await prisma.orgModule.findMany({
      where: { organizationId: id },
    });

    if (existingModules.length === 0) {
      // Enable default modules (HR, Ticketing, Marketplace) with 14-day trial
      const hrModule = await prisma.module.findUnique({ where: { key: 'hr' } });
      const ticketingModule = await prisma.module.findUnique({ where: { key: 'ticketing' } });
      const marketplaceModule = await prisma.module.findUnique({ where: { key: 'marketplace' } });

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14); // 14-day trial

      for (const module of [hrModule, ticketingModule, marketplaceModule].filter(Boolean)) {
        if (module) {
          await prisma.orgModule.upsert({
            where: {
              organizationId_moduleId: {
                organizationId: id,
                moduleId: module.id,
              },
            },
            create: {
              organizationId: id,
              moduleId: module.id,
              isEnabled: true,
              plan: 'trial',
              trialEndsAt,
            },
            update: {
              isEnabled: true,
            },
          });
        }
      }
    }

    // Send approval email to admin
    try {
      const adminMembership = organization.memberships.find((m) => m.isActive);
      if (adminMembership) {
        const loginUrl = `${config.corsOrigin}/auth/login`;
        const email = emailTemplates.organizationApproved(organization.name, adminMembership.user.email, loginUrl);
        await sendEmail({
          to: adminMembership.user.email,
          subject: email.subject,
          html: email.html,
        });
      }
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
    }

    res.json({
      message: 'Organization approved successfully',
      organization: updated,
    });
  } catch (error) {
    console.error('Error approving organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/organizations/:id/reject - Reject organization (Super Admin only)
router.post('/:id/reject', authMiddleware, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const organization = await prisma.organization.findUnique({
      where: { id },
      include: {
        memberships: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    if (organization.status === 'rejected') {
      res.status(400).json({ error: 'Organization is already rejected' });
      return;
    }

    // Update organization status
    const updated = await prisma.organization.update({
      where: { id },
      data: {
        status: 'rejected',
        isActive: false,
      },
    });

    // Send rejection email to admin
    try {
      const adminMembership = organization.memberships.find((m) => m.isActive);
      if (adminMembership) {
        const email = emailTemplates.organizationRejected(organization.name, adminMembership.user.email, reason);
        await sendEmail({
          to: adminMembership.user.email,
          subject: email.subject,
          html: email.html,
        });
      }
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
    }

    res.json({
      message: 'Organization rejected successfully',
      organization: updated,
    });
  } catch (error) {
    console.error('Error rejecting organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/organizations/:id - Update organization (Owner/Admin only)
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, industry, companySize } = req.body;

    if (!req.org || req.org.id !== id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    // Check if user has permission (owner or admin)
    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: req.user!.id,
          organizationId: id,
        },
      },
      include: {
        membershipRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!membership) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const isOwner = membership.membershipRoles.some((mr) => mr.role.key === 'owner');
    const isAdmin = membership.membershipRoles.some((mr) => mr.role.key === 'admin');
    const isSuperAdmin = req.user?.isSuperAdmin;

    if (!isOwner && !isAdmin && !isSuperAdmin) {
      res.status(403).json({ error: 'Only organization owners and admins can update the organization' });
      return;
    }

    const updated = await prisma.organization.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(industry !== undefined && { industry }),
        ...(companySize !== undefined && { companySize }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/organizations/:id - Delete organization (Owner only)
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!req.org || req.org.id !== id) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    // Check if user is owner
    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: req.user!.id,
          organizationId: id,
        },
      },
      include: {
        membershipRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!membership) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const isOwner = membership.membershipRoles.some((mr) => mr.role.key === 'owner');

    if (!isOwner && !req.user?.isSuperAdmin) {
      res.status(403).json({ error: 'Only organization owners can delete the organization' });
      return;
    }

    const organization = await prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    // Soft delete - set status to suspended and isActive to false
    await prisma.organization.update({
      where: { id },
      data: {
        status: 'suspended',
        isActive: false,
      },
    });

    res.json({
      message: 'Organization deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
