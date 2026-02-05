import { Router } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import type { ModuleManifest } from '@cloud-org/shared';
import assignmentsRouter from './assignments';
import returnsRouter from './returns';
import damagesRouter from './damages';
import swapsRouter from './swaps';

const router = Router();

// Module manifest
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
      description: 'Number of items in inventory',
      apiPath: '/api/inventory/widgets/item-count',
      permission: 'inventory.items.view',
    },
    {
      id: 'inventory-low-stock',
      title: 'Low Stock Items',
      description: 'Items below minimum quantity',
      apiPath: '/api/inventory/widgets/low-stock',
      permission: 'inventory.items.view',
    },
  ],
};

// Register module
export function registerInventoryModule(routerInstance: Router): void {
  routerInstance.use('/api/inventory', authMiddleware, requireModuleEnabled('inventory'), router);

  // Register sub-routes
  routerInstance.use('/api/inventory/assignments', authMiddleware, requireModuleEnabled('inventory'), assignmentsRouter);
  routerInstance.use('/api/inventory/returns', authMiddleware, requireModuleEnabled('inventory'), returnsRouter);
  routerInstance.use('/api/inventory/damages', authMiddleware, requireModuleEnabled('inventory'), damagesRouter);
  routerInstance.use('/api/inventory/swaps', authMiddleware, requireModuleEnabled('inventory'), swapsRouter);

  moduleRegistry.register({
    key: 'inventory',
    manifest: inventoryManifest,
    registerRoutes: () => {}, // Already registered above
  });
}

// ============================================
// INVENTORY ITEMS
// ============================================

// GET /api/inventory/items
router.get('/items', requirePermission('inventory.items.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { categoryId, status, search } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (categoryId) {
      where.categoryId = categoryId as string;
    }

    if (status) {
      where.status = status as string;
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { sku: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        images: {
          orderBy: {
            createdAt: 'asc',
          },
          take: 1, // Just get first image for list view
        },
        _count: {
          select: {
            assignments: {
              where: {
                status: 'active',
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(items);
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inventory/items/:id
router.get('/items/:id', requirePermission('inventory.items.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const item = await prisma.inventoryItem.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        category: true,
        images: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        assignments: {
          where: {
            status: { in: ['pending', 'approved', 'active'] },
          },
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                email: true,
                department: true,
              },
            },
            requestedBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            approvedBy: {
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
        },
        _count: {
          select: {
            assignments: true,
            returns: true,
            damages: true,
            swaps: true,
          },
        },
      },
    });

    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    res.json(item);
  } catch (error) {
    console.error('Error fetching inventory item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory/items
router.post('/items', requirePermission('inventory.items.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      name,
      description,
      sku,
      categoryId,
      quantity,
      minQuantity,
      maxQuantity,
      priceCents,
      currency,
      location,
      supplier,
      condition,
      status,
      notes,
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const item = await prisma.inventoryItem.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        sku: sku || null,
        categoryId: categoryId || null,
        quantity: quantity || 0,
        minQuantity: minQuantity || null,
        maxQuantity: maxQuantity || null,
        priceCents: priceCents || null,
        currency: 'SAR', // Only SAR (Saudi Riyal) is supported
        location: location || null,
        supplier: supplier || null,
        condition: condition || 'new',
        status: status || 'available',
        notes: notes || null,
      },
      include: {
        category: true,
      },
    });

    res.status(201).json(item);
  } catch (error) {
    console.error('Error creating inventory item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory/items/:id
router.put('/items/:id', requirePermission('inventory.items.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      name,
      description,
      sku,
      categoryId,
      quantity,
      minQuantity,
      maxQuantity,
      priceCents,
      currency,
      location,
      supplier,
      condition,
      status,
      notes,
    } = req.body;

    const item = await prisma.inventoryItem.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    const updated = await prisma.inventoryItem.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description: description || null }),
        ...(sku !== undefined && { sku: sku || null }),
        ...(categoryId !== undefined && { categoryId: categoryId || null }),
        ...(quantity !== undefined && { quantity }),
        ...(minQuantity !== undefined && { minQuantity: minQuantity || null }),
        ...(maxQuantity !== undefined && { maxQuantity: maxQuantity || null }),
        ...(priceCents !== undefined && { priceCents: priceCents || null }),
        currency: 'SAR', // Only SAR (Saudi Riyal) is supported - always enforce
        ...(location !== undefined && { location: location || null }),
        ...(supplier !== undefined && { supplier: supplier || null }),
        ...(condition !== undefined && { condition }),
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      include: {
        category: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating inventory item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/inventory/items/:id
router.delete('/items/:id', requirePermission('inventory.items.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const item = await prisma.inventoryItem.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            assignments: {
              where: {
                status: { in: ['pending', 'approved', 'active'] },
              },
            },
          },
        },
      },
    });

    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    if (item._count.assignments > 0) {
      res.status(400).json({
        error: 'Cannot delete item with active assignments. Please return all assignments first.',
      });
      return;
    }

    await prisma.inventoryItem.delete({
      where: { id },
    });

    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory/items/:id/images
router.post('/items/:id/images', requirePermission('inventory.items.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { imageUrl, altText, isPrimary } = req.body;

    if (!imageUrl) {
      res.status(400).json({ error: 'Image URL is required' });
      return;
    }

    const item = await prisma.inventoryItem.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    // If this is marked as primary, unset other primary images
    if (isPrimary) {
      await prisma.file.updateMany({
        where: {
          inventoryItemId: id,
          entityType: 'inventory',
        },
        data: {
          // We'll handle isPrimary through a separate field or logic
        },
      });
    }

    // Create file record for the image
    const file = await prisma.file.create({
      data: {
        organizationId: req.org.id,
        userId: req.user?.id,
        fileName: imageUrl.split('/').pop() || 'image.jpg',
        originalName: imageUrl.split('/').pop() || 'image.jpg',
        mimeType: 'image/jpeg',
        size: 0,
        url: imageUrl,
        storageType: 'local',
        entityType: 'inventory',
        entityId: id,
        inventoryItemId: id,
      },
    });

    res.status(201).json(file);
  } catch (error) {
    console.error('Error adding item image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/inventory/items/:id/images/:imageId
router.delete('/items/:id/images/:imageId', requirePermission('inventory.items.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, imageId } = req.params;

    const file = await prisma.file.findFirst({
      where: {
        id: imageId,
        inventoryItemId: id,
        organizationId: req.org.id,
      },
    });

    if (!file) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    await prisma.file.delete({
      where: { id: imageId },
    });

    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting item image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// INVENTORY CATEGORIES
// ============================================

// GET /api/inventory/categories
router.get('/categories', requirePermission('inventory.categories.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const categories = await prisma.inventoryCategory.findMany({
      where: {
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            items: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory/categories
router.post('/categories', requirePermission('inventory.categories.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    // Check if category with same name exists
    const existing = await prisma.inventoryCategory.findFirst({
      where: {
        orgId: req.org.id,
        name,
      },
    });

    if (existing) {
      res.status(400).json({ error: 'Category with this name already exists' });
      return;
    }

    const category = await prisma.inventoryCategory.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
      },
    });

    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory/categories/:id
router.put('/categories/:id', requirePermission('inventory.categories.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, description, isActive } = req.body;

    const category = await prisma.inventoryCategory.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    // Check if new name conflicts with existing category
    if (name && name !== category.name) {
      const existing = await prisma.inventoryCategory.findFirst({
        where: {
          orgId: req.org.id,
          name,
          id: { not: id },
        },
      });

      if (existing) {
        res.status(400).json({ error: 'Category with this name already exists' });
        return;
      }
    }

    const updated = await prisma.inventoryCategory.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description: description || null }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/inventory/categories/:id
router.delete('/categories/:id', requirePermission('inventory.categories.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const category = await prisma.inventoryCategory.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            items: true,
          },
        },
      },
    });

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    if (category._count.items > 0) {
      res.status(400).json({
        error: 'Cannot delete category with items. Please remove or reassign items first.',
      });
      return;
    }

    await prisma.inventoryCategory.delete({
      where: { id },
    });

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// WIDGETS
// ============================================

router.get('/widgets/item-count', requirePermission('inventory.items.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.inventoryItem.count({
      where: {
        orgId: req.org.id,
      },
    });

    res.json({ count });
  } catch (error) {
    console.error('Error fetching item count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/widgets/low-stock', requirePermission('inventory.items.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const items = await prisma.inventoryItem.findMany({
      where: {
        orgId: req.org.id,
        minQuantity: { not: null },
      },
      select: {
        id: true,
        name: true,
        quantity: true,
        minQuantity: true,
      },
    });

    const lowStockItems = items.filter(
      (item) => item.minQuantity !== null && item.quantity <= item.minQuantity
    );

    res.json({ count: lowStockItems.length, items: lowStockItems });
  } catch (error) {
    console.error('Error fetching low stock items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

