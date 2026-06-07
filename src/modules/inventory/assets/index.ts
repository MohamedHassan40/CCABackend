import { Router } from 'express';
import prisma from '../../../core/db';
import { requirePermission } from '../../../middleware/permissions';
import assignmentsRouter from './assignments';
import returnsRouter from './returns';
import damagesRouter from './damages';
import swapsRouter from './swaps';

const router = Router();

// Mount sub-routers first (before /:id to avoid capturing path segments)
router.use('/assignments', assignmentsRouter);
router.use('/returns', returnsRouter);
router.use('/damages', damagesRouter);
router.use('/swaps', swapsRouter);

// GET /api/inventory/employees-picker — minimal employee list for assignments (no HR module required)
router.get('/employees-picker', requirePermission('inventory.assignments.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const employees = await prisma.employee.findMany({
      where: { orgId: req.org.id },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
      take: 500,
    });
    res.json(employees);
  } catch (error) {
    console.error('Error fetching employees for inventory:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// INVENTORY ITEMS
// ============================================

// GET /api/inventory
router.get('/', requirePermission('inventory.items.view'), async (req, res) => {
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

    const assets = await prisma.inventoryItem.findMany({
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

    res.json(assets);
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// ASSET CATEGORIES (must be registered before /:id)
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

    if (((category as { _count?: { items: number } })._count?.items ?? 0) > 0) {
      res.status(400).json({
        error: 'Cannot delete category with assets. Please remove or reassign assets first.',
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
// WIDGETS (must be registered before /:id)
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
    console.error('Error fetching asset count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/widgets/low-stock', requirePermission('inventory.items.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const assets = await prisma.inventoryItem.findMany({
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

    const lowStockAssets = assets.filter(
      (asset: { minQuantity: number | null; quantity: number }) =>
        asset.minQuantity !== null && asset.quantity <= asset.minQuantity
    );

    res.json({ count: lowStockAssets.length, assets: lowStockAssets });
  } catch (error) {
    console.error('Error fetching low stock assets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inventory/:id
router.get('/:id', requirePermission('inventory.items.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const asset = await prisma.inventoryItem.findFirst({
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

    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    res.json(asset);
  } catch (error) {
    console.error('Error fetching asset:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory
router.post('/', requirePermission('inventory.items.create'), async (req, res) => {
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

    const asset = await prisma.inventoryItem.create({
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

    res.status(201).json(asset);
  } catch (error) {
    console.error('Error creating inventory item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory/:id
router.put('/:id', requirePermission('inventory.items.edit'), async (req, res) => {
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

    const asset = await prisma.inventoryItem.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
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
    console.error('Error updating asset:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/inventory/:id
router.delete('/:id', requirePermission('inventory.items.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const asset = await prisma.inventoryItem.findFirst({
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

    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    if (asset._count.assignments > 0) {
      res.status(400).json({
        error: 'Cannot delete asset with active assignments. Please return all assignments first.',
      });
      return;
    }

    await prisma.inventoryItem.delete({
      where: { id },
    });

    res.json({ message: 'Asset deleted successfully' });
  } catch (error) {
    console.error('Error deleting asset:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory/:id/images
router.post('/:id/images', requirePermission('inventory.items.edit'), async (req, res) => {
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

    const asset = await prisma.inventoryItem.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
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
        entityType: 'asset',
        entityId: id,
        inventoryItemId: id,
      },
    });

    res.status(201).json(file);
  } catch (error) {
    console.error('Error adding asset image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/inventory/:id/images/:imageId
router.delete('/:id/images/:imageId', requirePermission('inventory.items.edit'), async (req, res) => {
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
    console.error('Error deleting asset image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export sub-routers
export { assignmentsRouter, returnsRouter, damagesRouter, swapsRouter };
export default router;





