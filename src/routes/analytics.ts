import { Router, Request, Response } from 'express';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/permissions';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/analytics/overview - Platform overview analytics (Super Admin only)
router.get('/overview', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { period = '30' } = req.query;
    const days = parseInt(period as string, 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Organization growth over time
    const orgGrowth = await prisma.organization.findMany({
      where: {
        createdAt: { gte: startDate },
      },
      select: {
        createdAt: true,
        status: true,
        isActive: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // User growth over time
    const userGrowth = await prisma.user.findMany({
      where: {
        createdAt: { gte: startDate },
      },
      select: {
        createdAt: true,
        isActive: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Module adoption
    const moduleAdoption = await prisma.orgModule.groupBy({
      by: ['moduleId'],
      where: {
        isEnabled: true,
        organization: {
          createdAt: { gte: startDate },
        },
      },
      _count: {
        id: true,
      },
    });

    const moduleDetails = await prisma.module.findMany({
      where: {
        id: { in: moduleAdoption.map((m) => m.moduleId) },
      },
    });

    const moduleAdoptionWithNames = moduleAdoption.map((ma) => {
      const module = moduleDetails.find((m) => m.id === ma.moduleId);
      return {
        moduleKey: module?.key || 'unknown',
        moduleName: module?.name || 'Unknown',
        count: ma._count.id,
      };
    });

    // Revenue analytics (from subscriptions)
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: 'active',
        createdAt: { gte: startDate },
      },
      include: {
        module: true,
        payments: {
          where: {
            status: 'paid',
            createdAt: { gte: startDate },
          },
        },
      },
    });

    const revenueByMonth: Record<string, number> = {};
    subscriptions.forEach((sub) => {
      sub.payments.forEach((payment) => {
        const month = payment.createdAt.toISOString().substring(0, 7); // YYYY-MM
        revenueByMonth[month] = (revenueByMonth[month] || 0) + payment.amountCents;
      });
    });

    // Organization status distribution
    const orgStatusCounts = await prisma.organization.groupBy({
      by: ['status'],
      _count: {
        id: true,
      },
    });

    // Daily signups
    const dailySignups: Record<string, { orgs: number; users: number }> = {};
    orgGrowth.forEach((org) => {
      const date = org.createdAt.toISOString().split('T')[0];
      if (!dailySignups[date]) {
        dailySignups[date] = { orgs: 0, users: 0 };
      }
      dailySignups[date].orgs++;
    });

    userGrowth.forEach((user) => {
      const date = user.createdAt.toISOString().split('T')[0];
      if (!dailySignups[date]) {
        dailySignups[date] = { orgs: 0, users: 0 };
      }
      dailySignups[date].users++;
    });

    // Active vs inactive organizations
    const activeOrgs = await prisma.organization.count({
      where: { isActive: true },
    });
    const inactiveOrgs = await prisma.organization.count({
      where: { isActive: false },
    });

    // Trial vs paid
    const now = new Date();
    const trialOrgs = await prisma.orgModule.count({
      where: {
        isEnabled: true,
        trialEndsAt: { gte: now },
      },
    });

    const paidOrgs = await prisma.subscription.count({
      where: {
        status: 'active',
      },
    });

    res.json({
      period: days,
      organizationGrowth: orgGrowth.length,
      userGrowth: userGrowth.length,
      moduleAdoption: moduleAdoptionWithNames,
      revenueByMonth: Object.entries(revenueByMonth).map(([month, amount]) => ({
        month,
        amount: amount / 100, // Convert cents to currency
      })),
      organizationStatusDistribution: orgStatusCounts.map((osc) => ({
        status: osc.status,
        count: osc._count.id,
      })),
      dailySignups: Object.entries(dailySignups)
        .map(([date, counts]) => ({ date, ...counts }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      activeVsInactive: {
        active: activeOrgs,
        inactive: inactiveOrgs,
      },
      trialVsPaid: {
        trial: trialOrgs,
        paid: paidOrgs,
      },
      totalRevenue: Object.values(revenueByMonth).reduce((sum, amount) => sum + amount, 0) / 100,
      mrr: subscriptions.reduce((sum, sub) => {
        const modulePrice = sub.module?.modulePrices?.[0];
        if (modulePrice && sub.plan === modulePrice.plan) {
          return sum + (modulePrice.priceCents / 100);
        }
        return sum;
      }, 0),
    });
  } catch (error) {
    console.error('Error fetching analytics overview:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/modules - Module-specific analytics
router.get('/modules', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const modules = await prisma.module.findMany({
      where: { isActive: true },
      include: {
        orgModules: {
          where: { isEnabled: true },
          include: {
            organization: {
              select: {
                id: true,
                name: true,
                status: true,
                isActive: true,
                createdAt: true,
              },
            },
          },
        },
        subscriptions: {
          where: { status: 'active' },
          include: {
            payments: {
              where: { status: 'paid' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        modulePrices: true,
      },
    });

    const now = new Date();
    const totalOrgs = await prisma.organization.count();
    
    const result = modules.map((module) => {
      const activeOrgs = module.orgModules.filter((om) => {
        if (om.expiresAt && om.expiresAt < now) return false;
        if (om.trialEndsAt && om.trialEndsAt < now) return false;
        return true;
      });

      const trialOrgs = module.orgModules.filter(
        (om) => om.trialEndsAt && om.trialEndsAt >= now
      );

      const revenue = module.subscriptions.reduce((sum, sub) => {
        return sum + (sub.payments[0]?.amountCents || 0);
      }, 0);

      // Adoption rate (active orgs / total orgs)
      const adoptionRate = totalOrgs > 0 ? (activeOrgs.length / totalOrgs) * 100 : 0;

      return {
        moduleKey: module.key,
        moduleName: module.name,
        totalEnabledOrgs: module.orgModules.length,
        activeOrgs: activeOrgs.length,
        trialOrgs: trialOrgs.length,
        activeSubscriptions: module.subscriptions.length,
        revenue: revenue / 100,
        adoptionRate: adoptionRate.toFixed(2),
        organizations: activeOrgs.map((om) => ({
          id: om.organization.id,
          name: om.organization.name,
          status: om.organization.status,
          isActive: om.organization.isActive,
          joinedAt: om.organization.createdAt,
        })),
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching module analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/organizations - Organization analytics
router.get('/organizations', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { limit = '10' } = req.query;
    const limitNum = parseInt(limit as string, 10);

    // Top organizations by user count
    const topByUsers = await prisma.organization.findMany({
      include: {
        memberships: {
          where: { isActive: true },
        },
        orgModules: {
          where: { isEnabled: true },
          include: { module: true },
        },
      },
      orderBy: {
        memberships: {
          _count: 'desc',
        },
      },
      take: limitNum,
    });

    // Top organizations by module count
    const topByModules = await prisma.organization.findMany({
      include: {
        memberships: {
          where: { isActive: true },
        },
        orgModules: {
          where: { isEnabled: true },
          include: { module: true },
        },
      },
      orderBy: {
        orgModules: {
          _count: 'desc',
        },
      },
      take: limitNum,
    });

    // Organizations by industry
    const byIndustry = await prisma.organization.groupBy({
      by: ['industry'],
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
    });

    // Organizations by size
    const bySize = await prisma.organization.groupBy({
      by: ['companySize'],
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
    });

    res.json({
      topByUsers: topByUsers.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        userCount: org.memberships.length,
        moduleCount: org.orgModules.length,
        status: org.status,
        isActive: org.isActive,
      })),
      topByModules: topByModules.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        userCount: org.memberships.length,
        moduleCount: org.orgModules.length,
        status: org.status,
        isActive: org.isActive,
      })),
      byIndustry: byIndustry.map((bi) => ({
        industry: bi.industry || 'Unknown',
        count: bi._count.id,
      })),
      bySize: bySize.map((bs) => ({
        size: bs.companySize || 'Unknown',
        count: bs._count.id,
      })),
    });
  } catch (error) {
    console.error('Error fetching organization analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/revenue - Revenue analytics
router.get('/revenue', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { period = '30' } = req.query;
    const days = parseInt(period as string, 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const payments = await prisma.payment.findMany({
      where: {
        status: 'paid',
        createdAt: { gte: startDate },
      },
      include: {
        subscription: {
          include: {
            module: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Revenue by month
    const revenueByMonth: Record<string, number> = {};
    payments.forEach((payment) => {
      const month = payment.createdAt.toISOString().substring(0, 7);
      revenueByMonth[month] = (revenueByMonth[month] || 0) + payment.amountCents;
    });

    // Revenue by module
    const revenueByModule: Record<string, number> = {};
    payments.forEach((payment) => {
      const moduleKey = payment.subscription?.module?.key || 'unknown';
      revenueByModule[moduleKey] = (revenueByModule[moduleKey] || 0) + payment.amountCents;
    });

    // MRR calculation
    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'active',
      },
      include: {
        module: {
          include: {
            modulePrices: true,
          },
        },
      },
    });

    const mrr = activeSubscriptions.reduce((sum, sub) => {
      const price = sub.module.modulePrices.find(
        (p) => p.plan === sub.plan && p.billingPeriod === 'monthly'
      );
      if (price) {
        return sum + price.priceCents / 100;
      }
      return sum;
    }, 0);

    // ARR (Annual Recurring Revenue)
    const arr = activeSubscriptions.reduce((sum, sub) => {
      const price = sub.module.modulePrices.find(
        (p) => p.plan === sub.plan && p.billingPeriod === 'yearly'
      );
      if (price) {
        return sum + price.priceCents / 100;
      }
      // If monthly, multiply by 12
      const monthlyPrice = sub.module.modulePrices.find(
        (p) => p.plan === sub.plan && p.billingPeriod === 'monthly'
      );
      if (monthlyPrice) {
        return sum + (monthlyPrice.priceCents / 100) * 12;
      }
      return sum;
    }, 0);

    const totalRevenue = payments.reduce((sum, p) => sum + p.amountCents, 0) / 100;

    res.json({
      period: days,
      totalRevenue,
      mrr,
      arr,
      revenueByMonth: Object.entries(revenueByMonth)
        .map(([month, amount]) => ({
          month,
          amount: amount / 100,
        }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      revenueByModule: Object.entries(revenueByModule).map(([moduleKey, amount]) => ({
        moduleKey,
        amount: amount / 100,
      })),
      paymentCount: payments.length,
      averagePayment: payments.length > 0 ? totalRevenue / payments.length : 0,
    });
  } catch (error) {
    console.error('Error fetching revenue analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

