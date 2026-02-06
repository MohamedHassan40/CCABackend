import { Router, Request, Response } from 'express';
import prisma from '../core/db';

const router = Router();

// GET /api/public/modules - Public endpoint to get available modules with pricing
router.get('/modules', async (req: Request, res: Response) => {
  try {
    const modules = await prisma.module.findMany({
      where: {
        isActive: true,
      },
      include: {
        modulePrices: {
          orderBy: [
            { plan: 'asc' },
            { billingPeriod: 'asc' },
          ],
        },
      },
    });

    res.json(
      modules.map((m) => ({
        id: m.id,
        key: m.key,
        name: m.name,
        description: m.description,
        prices: m.modulePrices.map((mp) => ({
          plan: mp.plan,
          priceCents: mp.priceCents,
          currency: mp.currency,
          billingPeriod: mp.billingPeriod,
        })),
      }))
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error fetching public modules:', message, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/public/bundles - Public endpoint to get active bundles with pricing
router.get('/bundles', async (req: Request, res: Response) => {
  try {
    const bundles = await prisma.bundle.findMany({
      where: {
        isActive: true,
      },
      include: {
        bundleModules: {
          include: {
            module: true,
          },
        },
      },
      orderBy: {
        priceCents: 'asc',
      },
    });

    res.json(
      bundles.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        priceCents: b.priceCents,
        currency: b.currency,
        billingPeriod: b.billingPeriod,
        discountPercentage: b.discountPercentage,
        modules: b.bundleModules.map((bm) => ({
          moduleId: bm.moduleId,
          moduleKey: bm.module.key,
          moduleName: bm.module.name,
          plan: bm.plan,
        })),
      }))
    );
  } catch (error) {
    console.error('Error fetching public bundles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// PUBLIC STOREFRONT ENDPOINTS
// ============================================

// GET /api/public/store/:orgSlug - Get organization info for storefront
router.get('/store/:orgSlug', async (req: Request, res: Response) => {
  try {
    const { orgSlug } = req.params;

    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        status: true,
        storefrontSettings: true,
      },
    });

    if (!organization) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    if (!organization.isActive || organization.status !== 'active') {
      res.status(404).json({ error: 'Store is not available' });
      return;
    }

    // Check if marketplace module is enabled
    const marketplaceModule = await prisma.module.findUnique({
      where: { key: 'marketplace' },
    });

    if (!marketplaceModule) {
      res.status(404).json({ error: 'Marketplace module not found' });
      return;
    }

    const orgModule = await prisma.orgModule.findUnique({
      where: {
        organizationId_moduleId: {
          organizationId: organization.id,
          moduleId: marketplaceModule.id,
        },
      },
    });

    if (!orgModule || !orgModule.isEnabled) {
      res.status(404).json({ error: 'Store is not available' });
      return;
    }

    res.json({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    });
  } catch (error) {
    console.error('Error fetching store info:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/public/store/:orgSlug/products - Get products for public storefront
router.get('/store/:orgSlug/products', async (req: Request, res: Response) => {
  try {
    const { orgSlug } = req.params;
    const { categoryId, search } = req.query;

    // Get organization
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
    });

    if (!organization || !organization.isActive || organization.status !== 'active') {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    // Check if marketplace is enabled
    const marketplaceModule = await prisma.module.findUnique({
      where: { key: 'marketplace' },
    });

    if (!marketplaceModule) {
      res.status(404).json({ error: 'Marketplace not available' });
      return;
    }

    const orgModule = await prisma.orgModule.findUnique({
      where: {
        organizationId_moduleId: {
          organizationId: organization.id,
          moduleId: marketplaceModule.id,
        },
      },
    });

    if (!orgModule || !orgModule.isEnabled) {
      res.status(404).json({ error: 'Store is not available' });
      return;
    }

    const where: any = {
      orgId: organization.id,
      isActive: true, // Only show active products
    };

    if (categoryId) {
      where.categoryId = categoryId as string;
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
        { sku: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const products = await prisma.product.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(products);
  } catch (error) {
    console.error('Error fetching public products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/public/store/:orgSlug/products/:id - Get single product for public storefront
router.get('/store/:orgSlug/products/:id', async (req: Request, res: Response) => {
  try {
    const { orgSlug, id } = req.params;

    // Get organization
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
    });

    if (!organization || !organization.isActive || organization.status !== 'active') {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    const product = await prisma.product.findFirst({
      where: {
        id,
        orgId: organization.id,
        isActive: true,
      },
      include: {
        category: true,
      },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    res.json(product);
  } catch (error) {
    console.error('Error fetching public product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/public/store/:orgSlug/categories - Get categories for public storefront
router.get('/store/:orgSlug/categories', async (req: Request, res: Response) => {
  try {
    const { orgSlug } = req.params;

    // Get organization
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
    });

    if (!organization || !organization.isActive || organization.status !== 'active') {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    const categories = await prisma.productCategory.findMany({
      where: {
        orgId: organization.id,
      },
      include: {
        _count: {
          select: {
            products: {
              where: {
                isActive: true,
              },
            },
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json(categories);
  } catch (error) {
    console.error('Error fetching public categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/public/store/:orgSlug/orders - Create order (public, no auth required)
router.post('/store/:orgSlug/orders', async (req: Request, res: Response) => {
  try {
    const { orgSlug } = req.params;
    const { items, customerName, customerEmail, customerPhone, shippingAddress } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Order items are required' });
      return;
    }

    if (!customerName || !customerEmail) {
      res.status(400).json({ error: 'Customer name and email are required' });
      return;
    }

    // Get organization
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
    });

    if (!organization || !organization.isActive || organization.status !== 'active') {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    // Check if marketplace is enabled
    const marketplaceModule = await prisma.module.findUnique({
      where: { key: 'marketplace' },
    });

    if (!marketplaceModule) {
      res.status(404).json({ error: 'Marketplace not available' });
      return;
    }

    const orgModule = await prisma.orgModule.findUnique({
      where: {
        organizationId_moduleId: {
          organizationId: organization.id,
          moduleId: marketplaceModule.id,
        },
      },
    });

    if (!orgModule || !orgModule.isEnabled) {
      res.status(404).json({ error: 'Store is not available' });
      return;
    }

    // Generate order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Calculate total and validate products
    let totalCents = 0;
    const orderItemsData = [];

    for (const item of items) {
      const product = await prisma.product.findFirst({
        where: {
          id: item.productId,
          orgId: organization.id,
          isActive: true,
        },
      });

      if (!product) {
        res.status(400).json({ error: `Product ${item.productId} not found` });
        return;
      }

      // Check stock if applicable
      if (product.stockQuantity !== null && product.stockQuantity < item.quantity) {
        res.status(400).json({ error: `Insufficient stock for product ${product.name}` });
        return;
      }

      const itemTotal = product.priceCents * item.quantity;
      totalCents += itemTotal;

      orderItemsData.push({
        productId: product.id,
        quantity: item.quantity,
        priceCents: product.priceCents,
        currency: product.currency,
      });
    }

    // Create order with items
    const order = await prisma.order.create({
      data: {
        orgId: organization.id,
        orderNumber,
        status: 'pending',
        totalCents,
        currency: 'SAR',
        customerName,
        customerEmail,
        customerPhone: customerPhone || null,
        shippingAddress: shippingAddress || null,
        orderItems: {
          create: orderItemsData,
        },
      },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
      },
    });

    // Update product stock
    for (const item of items) {
      const product = await prisma.product.findFirst({
        where: {
          id: item.productId,
          orgId: organization.id,
        },
      });

      if (product && product.stockQuantity !== null) {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            stockQuantity: product.stockQuantity - item.quantity,
          },
        });
      }
    }

    res.status(201).json({
      orderNumber: order.orderNumber,
      status: order.status,
      totalCents: order.totalCents,
      currency: order.currency,
      message: 'Order placed successfully',
    });
  } catch (error) {
    console.error('Error creating public order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;


