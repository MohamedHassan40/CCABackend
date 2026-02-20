import { Router } from 'express';
import prisma from '../../../core/db';
import { requirePermission } from '../../../middleware/permissions';
import assignmentsRouter from './assignments';
import returnsRouter from './returns';
import damagesRouter from './damages';
import swapsRouter from './swaps';

const router = Router();

// ============================================
// EMPLOYEE ASSETS
// ============================================

// GET /api/hr/assets
router.get('/', requirePermission('hr.assets.view'), async (req, res) => {
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

    const assets = await prisma.employeeAsset.findMany({
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
    console.error('Error fetching assets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/assets/:id
router.get('/:id', requirePermission('hr.assets.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const asset = await prisma.employeeAsset.findFirst({
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

// POST /api/hr/assets
router.post('/', requirePermission('hr.assets.create'), async (req, res) => {
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

    const asset = await prisma.employeeAsset.create({
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
    console.error('Error creating asset:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/assets/:id
router.put('/:id', requirePermission('hr.assets.edit'), async (req, res) => {
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

    const asset = await prisma.employeeAsset.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    const updated = await prisma.employeeAsset.update({
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

// DELETE /api/hr/assets/:id
router.delete('/:id', requirePermission('hr.assets.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const asset = await prisma.employeeAsset.findFirst({
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

    await prisma.employeeAsset.delete({
      where: { id },
    });

    res.json({ message: 'Asset deleted successfully' });
  } catch (error) {
    console.error('Error deleting asset:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/assets/:id/images
router.post('/:id/images', requirePermission('hr.assets.edit'), async (req, res) => {
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

    const asset = await prisma.employeeAsset.findFirst({
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
        assetId: id,
      },
    });

    res.status(201).json(file);
  } catch (error) {
    console.error('Error adding asset image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/hr/assets/:id/images/:imageId
router.delete('/:id/images/:imageId', requirePermission('hr.assets.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, imageId } = req.params;

    const file = await prisma.file.findFirst({
      where: {
        id: imageId,
        assetId: id,
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

// ============================================
// ASSET CATEGORIES
// ============================================

// GET /api/hr/assets/categories
router.get('/categories', requirePermission('hr.assets.categories.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const categories = await prisma.assetCategory.findMany({
      where: {
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            assets: true,
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

// POST /api/hr/assets/categories
router.post('/categories', requirePermission('hr.assets.categories.create'), async (req, res) => {
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
    const existing = await prisma.assetCategory.findFirst({
      where: {
        orgId: req.org.id,
        name,
      },
    });

    if (existing) {
      res.status(400).json({ error: 'Category with this name already exists' });
      return;
    }

    const category = await prisma.assetCategory.create({
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

// PUT /api/hr/assets/categories/:id
router.put('/categories/:id', requirePermission('hr.assets.categories.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, description, isActive } = req.body;

    const category = await prisma.assetCategory.findFirst({
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
      const existing = await prisma.assetCategory.findFirst({
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

    const updated = await prisma.assetCategory.update({
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

// DELETE /api/hr/assets/categories/:id
router.delete('/categories/:id', requirePermission('hr.assets.categories.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const category = await prisma.assetCategory.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            assets: true,
          },
        },
      },
    });

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    if (category._count.assets > 0) {
      res.status(400).json({
        error: 'Cannot delete category with assets. Please remove or reassign assets first.',
      });
      return;
    }

    await prisma.assetCategory.delete({
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

router.get('/widgets/asset-count', requirePermission('hr.assets.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.employeeAsset.count({
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

router.get('/widgets/low-stock', requirePermission('hr.assets.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const assets = await prisma.employeeAsset.findMany({
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
      (asset) => asset.minQuantity !== null && asset.quantity <= asset.minQuantity
    );

    res.json({ count: lowStockAssets.length, assets: lowStockAssets });
  } catch (error) {
    console.error('Error fetching low stock assets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export sub-routers
export { assignmentsRouter, returnsRouter, damagesRouter, swapsRouter };
export default router;





