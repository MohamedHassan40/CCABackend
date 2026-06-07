import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { moduleRegistry } from '../../core/modules/registry';
import type { ModuleManifest } from '@cloud-org/shared';
import inventoryRouter from './assets';

export const inventoryManifest: ModuleManifest = {
  key: 'inventory',
  name: 'Inventory Management',
  icon: 'package',
  sidebarItems: [
    {
      path: '/inventory/items',
      label: 'Items',
      permission: 'inventory.items.view',
    },
    {
      path: '/inventory/categories',
      label: 'Categories',
      permission: 'inventory.categories.view',
    },
    {
      path: '/inventory/assignments',
      label: 'Assignments',
      permission: 'inventory.assignments.view',
    },
    {
      path: '/inventory/returns',
      label: 'Returns',
      permission: 'inventory.returns.view',
    },
    {
      path: '/inventory/damages',
      label: 'Damages',
      permission: 'inventory.damages.view',
    },
    {
      path: '/inventory/swaps',
      label: 'Swaps',
      permission: 'inventory.swaps.view',
    },
  ],
  dashboardWidgets: [
    {
      id: 'inventory-item-count',
      title: 'Total Items',
      description: 'Number of inventory items',
      apiPath: '/api/inventory/widgets/item-count',
      permission: 'inventory.items.view',
    },
    {
      id: 'inventory-low-stock',
      title: 'Low Stock Items',
      description: 'Items at or below minimum quantity',
      apiPath: '/api/inventory/widgets/low-stock',
      permission: 'inventory.items.view',
    },
  ],
};

export function registerInventoryModule(routerInstance: Router): void {
  routerInstance.use('/api/inventory', authMiddleware, requireModuleEnabled('inventory'), inventoryRouter);

  moduleRegistry.register({
    key: 'inventory',
    manifest: inventoryManifest,
    registerRoutes: () => {},
  });
}
