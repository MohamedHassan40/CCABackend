import { Router } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import type { ModuleManifest } from '@cloud-org/shared';

const router = Router();

/** Optional org module: customer invoicing / AR — not platform SaaS checkout. */
export const billingManifest: ModuleManifest = {
  key: 'billing',
  name: 'Billing',
  icon: 'credit-card',
  sidebarItems: [
    {
      path: '/billing',
      label: 'Overview',
      permission: 'billing.workspace.view',
    },
  ],
  dashboardWidgets: [],
};

export function registerBillingModule(routerInstance: Router): void {
  routerInstance.use('/api/billing', authMiddleware, requireModuleEnabled('billing'), router);

  moduleRegistry.register({
    key: 'billing',
    manifest: billingManifest,
    registerRoutes: () => {},
  });
}

// GET /api/billing/workspace — placeholder until org invoicing APIs exist
router.get('/workspace', requirePermission('billing.workspace.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    res.json({
      organizationId: req.org.id,
      message: 'Organization billing workspace. Customer invoices and AR features will appear here.',
      comingSoon: true,
    });
  } catch (error) {
    console.error('Error in billing workspace:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
