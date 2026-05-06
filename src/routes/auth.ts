import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../core/db';
import { hashPassword, verifyPassword } from '../core/auth/password';
import { signToken } from '../core/auth/jwt';
import { config } from '../core/config';
import { authRateLimiter, passwordResetRateLimiter, emailOtpRateLimiter } from '../middleware/security';
import { validateInput, validators } from '../middleware/validation';
import type { AuthResponse } from '@cloud-org/shared';

const router = Router();

const EMAIL_OTP_VALID_MINUTES = 10;

function otpCodesEqual(stored: string, provided: string): boolean {
  const a = Buffer.from(String(stored).trim(), 'utf8');
  const b = Buffer.from(String(provided).trim(), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

// Helper to create slug from name
function createSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, organizationName } = req.body;

    if (!email || !password || !organizationName) {
      res.status(400).json({ error: 'Email, password, and organization name are required' });
      return;
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.status(400).json({ error: 'User with this email already exists' });
      return;
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: name || null,
      },
    });

    // Create organization
    const slug = createSlug(organizationName);
    const existingOrg = await prisma.organization.findUnique({
      where: { slug },
    });

    if (existingOrg) {
      // If slug exists, append a number
      let counter = 1;
      let newSlug = `${slug}-${counter}`;
      while (await prisma.organization.findUnique({ where: { slug: newSlug } })) {
        counter++;
        newSlug = `${slug}-${counter}`;
      }
      const org = await prisma.organization.create({
        data: {
          name: organizationName,
          slug: newSlug,
        },
      });

      // Create membership with OWNER role
      await createMembershipWithRole(user.id, org.id, 'owner');

      // Seed default modules with trial
      await seedDefaultModules(org.id);

      const { sendEmailQueued, emailTemplates } = await import('../core/email');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const loginUrl = `${frontendUrl}/auth/login`;
      const reg = emailTemplates.registrationComplete(user.name || 'User', org.name, loginUrl);
      sendEmailQueued({
        to: user.email,
        subject: reg.subject,
        html: reg.html,
        priority: 'high',
      }).catch((err) => {
        console.error('Failed to queue registration email:', err);
      });

      const token = createAuthToken(user, org.id);
      const response: AuthResponse = {
        accessToken: token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.isSuperAdmin,
        },
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
        },
      };

      res.status(201).json(response);
      return;
    }

    const org = await prisma.organization.create({
      data: {
        name: organizationName,
        slug,
      },
    });

    // Create membership with OWNER role
    await createMembershipWithRole(user.id, org.id, 'owner');

    // Seed default modules with trial
    await seedDefaultModules(org.id);

    const { sendEmailQueued, emailTemplates } = await import('../core/email');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const loginUrl = `${frontendUrl}/auth/login`;
    const reg = emailTemplates.registrationComplete(user.name || 'User', org.name, loginUrl);
    sendEmailQueued({
      to: user.email,
      subject: reg.subject,
      html: reg.html,
      priority: 'high',
    }).catch((err) => {
      console.error('Failed to queue registration email:', err);
    });

    const token = createAuthToken(user, org.id);
    const response: AuthResponse = {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', 
  authRateLimiter,
  validateInput({
    body: {
      email: (v) => validators.required(v) && validators.email(v),
      password: validators.required,
    },
  }),
  async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Super admin: no organization - platform-level access only
    if (user.isSuperAdmin) {
      const membership = await prisma.membership.findFirst({
        where: { userId: user.id, isActive: true },
      });
      // Super admin with no membership = pure platform admin
      if (!membership) {
        const token = createAuthToken(user, null);
        res.json({
          accessToken: token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            isSuperAdmin: user.isSuperAdmin,
          },
          organization: null,
        });
        return;
      }
    }

    // Get user's first active organization
    const membership = await prisma.membership.findFirst({
      where: {
        userId: user.id,
        isActive: true,
      },
      include: {
        organization: true,
      },
    });

    if (!membership) {
      res.status(403).json({ error: 'User has no active organization' });
      return;
    }

    const org = membership.organization;

    // Check if organization is approved
    if (org.status === 'pending') {
      res.status(403).json({ 
        error: 'Your organization is pending approval. You will receive an email once it\'s approved.' 
      });
      return;
    }

    if (org.status === 'rejected' || !org.isActive) {
      res.status(403).json({ 
        error: 'Your organization has been deactivated. Please contact support.' 
      });
      return;
    }

    // Check organization-level expiry
    const orgExpiresAt = (org as { expiresAt?: Date | null }).expiresAt;
    if (orgExpiresAt && new Date(orgExpiresAt) < new Date()) {
      res.status(403).json({
        error: 'Your organization subscription has expired. Please contact your administrator.',
      });
      return;
    }

    const token = createAuthToken(user, org.id);

    const response: AuthResponse = {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', 
  passwordResetRateLimiter,
  validateInput({
    body: {
      email: (v) => validators.required(v) && validators.email(v),
    },
  }),
  async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Don't reveal if user exists (security best practice)
    if (!user) {
      res.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1); // Token expires in 1 hour

    // Save token to user
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
      },
    });

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${resetToken}`;

    const { sendEmail, emailTemplates } = await import('../core/email');
    const resetTpl = emailTemplates.passwordReset(user.name || 'User', resetUrl);
    await sendEmail({
      to: user.email,
      subject: resetTpl.subject,
      html: resetTpl.html,
    });

    res.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', 
  passwordResetRateLimiter,
  validateInput({
    body: {
      token: validators.required,
      password: validators.password,
    },
  }),
  async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      res.status(400).json({ error: 'Token and password are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }

    // Find user with valid token
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: {
          gt: new Date(), // Token not expired
        },
      },
    });

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    // Update password and clear reset token
    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/email-otp/send — email a short-lived verification code (e.g. MFA / step-up)
router.post(
  '/email-otp/send',
  emailOtpRateLimiter,
  validateInput({
    body: {
      email: (v) => validators.required(v) && validators.email(v),
    },
  }),
  async (req: Request, res: Response) => {
    try {
      const email = String(req.body.email).toLowerCase().trim();
      const generic = {
        message: 'If an account exists for this email, a verification code has been sent.',
      };

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user?.isActive) {
        res.json(generic);
        return;
      }

      const code = String(crypto.randomInt(100000, 1000000));
      const expiresAt = new Date(Date.now() + EMAIL_OTP_VALID_MINUTES * 60 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailOtpCode: code,
          emailOtpExpiresAt: expiresAt,
        },
      });

      const { sendEmail, emailTemplates } = await import('../core/email');
      const displayName = user.name?.trim() || user.email.split('@')[0] || 'User';
      const tpl = emailTemplates.emailOtp(displayName, code, EMAIL_OTP_VALID_MINUTES);

      await sendEmail({
        to: user.email,
        subject: tpl.subject,
        html: tpl.html,
      });

      res.json(generic);
    } catch (error) {
      console.error('Email OTP send error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/auth/email-otp/verify — validate code (clears OTP on success)
router.post(
  '/email-otp/verify',
  emailOtpRateLimiter,
  validateInput({
    body: {
      email: (v) => validators.required(v) && validators.email(v),
      code: (v) => validators.required(v),
    },
  }),
  async (req: Request, res: Response) => {
    try {
      const email = String(req.body.email).toLowerCase().trim();
      const code = String(req.body.code).trim();

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (
        !user?.emailOtpCode ||
        !user.emailOtpExpiresAt ||
        user.emailOtpExpiresAt < new Date()
      ) {
        res.status(400).json({ error: 'Invalid or expired code' });
        return;
      }

      if (!otpCodesEqual(user.emailOtpCode, code)) {
        res.status(400).json({ error: 'Invalid or expired code' });
        return;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          emailOtpCode: null,
          emailOtpExpiresAt: null,
        },
      });

      res.json({ verified: true });
    } catch (error) {
      console.error('Email OTP verify error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/auth/switch-organization - Switch to a different organization
router.post('/switch-organization', authRateLimiter, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { organizationId } = req.body;

    if (!organizationId) {
      res.status(400).json({ error: 'Organization ID is required' });
      return;
    }

    // Check if user has membership in this organization
    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: req.user.id,
          organizationId,
        },
      },
      include: {
        organization: true,
      },
    });

    if (!membership || !membership.isActive) {
      res.status(403).json({ error: 'You do not have access to this organization' });
      return;
    }

    // Check if organization is approved
    if (membership.organization.status === 'pending') {
      res.status(403).json({ 
        error: 'This organization is pending approval' 
      });
      return;
    }

    if (membership.organization.status === 'rejected' || !membership.organization.isActive) {
      res.status(403).json({ 
        error: 'This organization has been deactivated' 
      });
      return;
    }

    // Create new token with new organization
    const token = createAuthToken(req.user, organizationId);

    const response: AuthResponse = {
      accessToken: token,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name ?? null,
        isSuperAdmin: req.user.isSuperAdmin,
      },
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Switch organization error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions
async function createMembershipWithRole(userId: string, orgId: string, roleKey: string) {
  // Find or create role
  let role = await prisma.role.findUnique({
    where: { key: roleKey },
  });

  if (!role) {
    role = await prisma.role.create({
      data: {
        key: roleKey,
        name: roleKey.charAt(0).toUpperCase() + roleKey.slice(1),
      },
    });
  }

  // Create membership
  const membership = await prisma.membership.create({
    data: {
      userId,
      organizationId: orgId,
    },
  });

  // Link role to membership
  await prisma.membershipRole.create({
    data: {
      membershipId: membership.id,
      roleId: role.id,
    },
  });
}

export async function seedDefaultModules(orgId: string) {
  // Find HR, Ticketing, and Marketplace modules
  const hrModule = await prisma.module.findUnique({ where: { key: 'hr' } });
  const ticketingModule = await prisma.module.findUnique({ where: { key: 'ticketing' } });
  const marketplaceModule = await prisma.module.findUnique({ where: { key: 'marketplace' } });

  if (hrModule) {
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7); // 1-week trial

    await prisma.orgModule.upsert({
      where: {
        organizationId_moduleId: {
          organizationId: orgId,
          moduleId: hrModule.id,
        },
      },
      create: {
        organizationId: orgId,
        moduleId: hrModule.id,
        isEnabled: true,
        plan: 'trial',
        trialEndsAt,
      },
      update: {},
    });
  }

  if (ticketingModule) {
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7); // 1-week trial

    await prisma.orgModule.upsert({
      where: {
        organizationId_moduleId: {
          organizationId: orgId,
          moduleId: ticketingModule.id,
        },
      },
      create: {
        organizationId: orgId,
        moduleId: ticketingModule.id,
        isEnabled: true,
        plan: 'trial',
        trialEndsAt,
      },
      update: {},
    });
  }

  if (marketplaceModule) {
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7); // 1-week trial

    await prisma.orgModule.upsert({
      where: {
        organizationId_moduleId: {
          organizationId: orgId,
          moduleId: marketplaceModule.id,
        },
      },
      create: {
        organizationId: orgId,
        moduleId: marketplaceModule.id,
        isEnabled: true,
        plan: 'trial',
        trialEndsAt,
      },
      update: {},
    });
  }
}

function createAuthToken(user: { id: string; email: string; isSuperAdmin: boolean }, orgId: string | null): string {
  return signToken({
    sub: user.id,
    email: user.email,
    orgId: orgId ?? null,
    isSuperAdmin: user.isSuperAdmin,
    roleKeys: [],
    permissionKeys: [],
  });
}

export default router;


