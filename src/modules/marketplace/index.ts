import { Router } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import type { ModuleManifest } from '@cloud-org/shared';

const router = Router();

// Module manifest
export const marketplaceManifest: ModuleManifest = {
  key: 'marketplace',
  name: 'Marketplace',
  icon: 'shopping-cart',
  sidebarItems: [
    {
      path: '/marketplace/products',
      label: 'Products',
      permission: 'marketplace.products.view',
    },
    {
      path: '/marketplace/categories',
      label: 'Categories',
      permission: 'marketplace.categories.view',
    },
    {
      path: '/marketplace/orders',
      label: 'Orders',
      permission: 'marketplace.orders.view',
    },
    {
      path: '/marketplace/storefront',
      label: 'Storefront Settings',
      permission: 'marketplace.products.view',
    },
  ],
  dashboardWidgets: [
    {
      id: 'marketplace-total-products',
      title: 'Total Products',
      description: 'Number of active products',
      apiPath: '/api/marketplace/widgets/product-count',
      permission: 'marketplace.products.view',
    },
    {
      id: 'marketplace-pending-orders',
      title: 'Pending Orders',
      description: 'Number of pending orders',
      apiPath: '/api/marketplace/widgets/pending-orders',
      permission: 'marketplace.orders.view',
    },
  ],
};

// Register module
export function registerMarketplaceModule(routerInstance: Router): void {
  // Register routes
  routerInstance.use('/api/marketplace', authMiddleware, requireModuleEnabled('marketplace'), router);

  // Register in module registry
  moduleRegistry.register({
    key: 'marketplace',
    manifest: marketplaceManifest,
    registerRoutes: () => {}, // Already registered above
  });
}

// ============================================
// PRODUCTS
// ============================================

// GET /api/marketplace/products
router.get('/products', requirePermission('marketplace.products.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { categoryId, search } = req.query;

    const where: any = {
      orgId: req.org.id,
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
        images: {
          where: { isPrimary: true },
          take: 1,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/marketplace/products/:id
router.get('/products/:id', requirePermission('marketplace.products.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const product = await prisma.product.findFirst({
      where: {
        id: req.params.id,
        orgId: req.org.id,
      },
      include: {
        category: true,
        images: {
          orderBy: [
            { isPrimary: 'desc' },
            { sortOrder: 'asc' },
          ],
        },
        reviews: {
          where: { isApproved: true },
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 10,
        },
        _count: {
          select: {
            reviews: {
              where: { isApproved: true },
            },
          },
        },
      },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    res.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/marketplace/products
router.post('/products', requirePermission('marketplace.products.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, priceCents, currency, sku, categoryId, stockQuantity } = req.body;

    if (!name || priceCents === undefined) {
      res.status(400).json({ error: 'Name and price are required' });
      return;
    }

    const product = await prisma.product.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        priceCents: parseInt(priceCents),
        currency: 'SAR', // Only SAR (Saudi Riyal) is supported
        sku: sku || null,
        categoryId: categoryId || null,
        stockQuantity: stockQuantity !== undefined ? parseInt(stockQuantity) : null,
        isActive: true,
      },
      include: {
        category: true,
      },
    });

    res.status(201).json(product);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/marketplace/products/:id
router.put('/products/:id', requirePermission('marketplace.products.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, priceCents, currency, sku, categoryId, stockQuantity, isActive } = req.body;

    const product = await prisma.product.findFirst({
      where: {
        id: req.params.id,
        orgId: req.org.id,
      },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(priceCents !== undefined && { priceCents: parseInt(priceCents) }),
        currency: 'SAR', // Only SAR (Saudi Riyal) is supported - always enforce
        ...(sku !== undefined && { sku }),
        ...(categoryId !== undefined && { categoryId }),
        ...(stockQuantity !== undefined && { stockQuantity: stockQuantity ? parseInt(stockQuantity) : null }),
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        category: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/marketplace/products/:id
router.delete('/products/:id', requirePermission('marketplace.products.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const product = await prisma.product.findFirst({
      where: {
        id: req.params.id,
        orgId: req.org.id,
      },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    await prisma.product.delete({
      where: { id: product.id },
    });

    res.json({ message: 'Product deleted' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// CATEGORIES
// ============================================

// GET /api/marketplace/categories
router.get('/categories', requirePermission('marketplace.categories.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const categories = await prisma.productCategory.findMany({
      where: {
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            products: true,
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

// POST /api/marketplace/categories
router.post('/categories', requirePermission('marketplace.categories.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, slug } = req.body;

    if (!name || !slug) {
      res.status(400).json({ error: 'Name and slug are required' });
      return;
    }

    // Check if slug already exists for this org
    const existing = await prisma.productCategory.findUnique({
      where: {
        orgId_slug: {
          orgId: req.org.id,
          slug,
        },
      },
    });

    if (existing) {
      res.status(400).json({ error: 'Category with this slug already exists' });
      return;
    }

    const category = await prisma.productCategory.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        slug,
      },
    });

    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/marketplace/categories/:id
router.put('/categories/:id', requirePermission('marketplace.categories.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, slug } = req.body;

    const category = await prisma.productCategory.findFirst({
      where: {
        id: req.params.id,
        orgId: req.org.id,
      },
    });

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    // Check if slug already exists for this org (if changed)
    if (slug && slug !== category.slug) {
      const existing = await prisma.productCategory.findUnique({
        where: {
          orgId_slug: {
            orgId: req.org.id,
            slug,
          },
        },
      });

      if (existing) {
        res.status(400).json({ error: 'Category with this slug already exists' });
        return;
      }
    }

    const updated = await prisma.productCategory.update({
      where: { id: category.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(slug && { slug }),
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/marketplace/categories/:id
router.delete('/categories/:id', requirePermission('marketplace.categories.delete'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const category = await prisma.productCategory.findFirst({
      where: {
        id: req.params.id,
        orgId: req.org.id,
      },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    if (!category) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    if (category._count.products > 0) {
      res.status(400).json({ error: 'Cannot delete category with products. Please remove all products first.' });
      return;
    }

    await prisma.productCategory.delete({
      where: { id: category.id },
    });

    res.json({ message: 'Category deleted' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// ORDERS
// ============================================

// GET /api/marketplace/orders
router.get('/orders', requirePermission('marketplace.orders.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, orderNumber } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) {
      where.status = status;
    }

    if (orderNumber) {
      where.orderNumber = { contains: orderNumber as string, mode: 'insensitive' };
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/marketplace/orders/:id
router.get('/orders/:id', requirePermission('marketplace.orders.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id,
        orgId: req.org.id,
      },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/marketplace/orders
router.post('/orders', requirePermission('marketplace.orders.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { items, customerName, customerEmail, customerPhone, shippingAddress } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Order items are required' });
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
          orgId: req.org.id,
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
        orgId: req.org.id,
        orderNumber,
        status: 'pending',
        totalCents,
        currency: 'SAR',
        customerName: customerName || null,
        customerEmail: customerEmail || null,
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
          orgId: req.org.id,
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

    res.status(201).json(order);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/marketplace/orders/:id/status
router.put('/orders/:id/status', requirePermission('marketplace.orders.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status } = req.body;

    if (!status) {
      res.status(400).json({ error: 'Status is required' });
      return;
    }

    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id,
        orgId: req.org.id,
      },
    });

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// WIDGETS
// ============================================

// GET /api/marketplace/widgets/product-count
router.get('/widgets/product-count', requirePermission('marketplace.products.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.product.count({
      where: {
        orgId: req.org.id,
        isActive: true,
      },
    });

    res.json({ count });
  } catch (error) {
    console.error('Error fetching product count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/marketplace/products/:id/images - Get product images
router.get('/products/:id/images', requirePermission('marketplace.products.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const product = await prisma.product.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const images = await prisma.productImage.findMany({
      where: {
        productId: id,
      },
      orderBy: [
        { isPrimary: 'desc' },
        { sortOrder: 'asc' },
      ],
    });

    res.json(images);
  } catch (error) {
    console.error('Error fetching product images:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/marketplace/products/:id/images - Add product image
router.post('/products/:id/images', requirePermission('marketplace.products.edit'), async (req, res) => {
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

    const product = await prisma.product.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    // If this is set as primary, unset other primary images
    if (isPrimary) {
      await prisma.productImage.updateMany({
        where: {
          productId: id,
          isPrimary: true,
        },
        data: {
          isPrimary: false,
        },
      });
    }

    // Get max sortOrder
    const maxSort = await prisma.productImage.findFirst({
      where: { productId: id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const image = await prisma.productImage.create({
      data: {
        productId: id,
        imageUrl,
        altText: altText || null,
        isPrimary: isPrimary === true,
        sortOrder: (maxSort?.sortOrder || 0) + 1,
      },
    });

    res.status(201).json(image);
  } catch (error) {
    console.error('Error creating product image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/marketplace/products/:id/images/:imageId - Delete product image
router.delete('/products/:id/images/:imageId', requirePermission('marketplace.products.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, imageId } = req.params;

    const product = await prisma.product.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    await prisma.productImage.delete({
      where: { id: imageId },
    });

    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting product image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/marketplace/cart - Get user's cart
router.get('/cart', requirePermission('marketplace.orders.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Find or create cart for user
    let cart = await prisma.cart.findFirst({
      where: {
        orgId: req.org.id,
        userId: req.user.id,
        expiresAt: {
          gte: new Date(),
        },
      },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: {
                  where: { isPrimary: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!cart) {
      // Create new cart
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Cart expires in 7 days

      cart = await prisma.cart.create({
        data: {
          orgId: req.org.id,
          userId: req.user.id,
          expiresAt,
        },
        include: {
          items: {
            include: {
              product: {
                include: {
                  images: {
                    where: { isPrimary: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });
    }

    res.json(cart);
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/marketplace/cart/items - Add item to cart
router.post('/cart/items', requirePermission('marketplace.orders.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { productId, quantity } = req.body;

    if (!productId || !quantity || quantity < 1) {
      res.status(400).json({ error: 'Product ID and quantity (>= 1) are required' });
      return;
    }

    // Verify product exists and is active
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        orgId: req.org.id,
        isActive: true,
      },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found or not active' });
      return;
    }

    // Check stock
    if (product.stockQuantity !== null && product.stockQuantity < quantity) {
      res.status(400).json({ error: 'Insufficient stock' });
      return;
    }

    // Get or create cart
    let cart = await prisma.cart.findFirst({
      where: {
        orgId: req.org.id,
        userId: req.user.id,
        expiresAt: {
          gte: new Date(),
        },
      },
    });

    if (!cart) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      cart = await prisma.cart.create({
        data: {
          orgId: req.org.id,
          userId: req.user.id,
          expiresAt,
        },
      });
    }

    // Check if item already exists in cart
    const existingItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
    });

    let cartItem;
    if (existingItem) {
      // Update quantity
      cartItem = await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity },
        include: {
          product: {
            include: {
              images: {
                where: { isPrimary: true },
                take: 1,
              },
            },
          },
        },
      });
    } else {
      // Create new item
      cartItem = await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          quantity,
        },
        include: {
          product: {
            include: {
              images: {
                where: { isPrimary: true },
                take: 1,
              },
            },
          },
        },
      });
    }

    res.status(201).json(cartItem);
  } catch (error) {
    console.error('Error adding item to cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/marketplace/cart/items/:itemId - Update cart item quantity
router.put('/cart/items/:itemId', requirePermission('marketplace.orders.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      res.status(400).json({ error: 'Quantity must be at least 1' });
      return;
    }

    const cartItem = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: {
        cart: true,
        product: true,
      },
    });

    if (!cartItem || cartItem.cart.orgId !== req.org.id || cartItem.cart.userId !== req.user.id) {
      res.status(404).json({ error: 'Cart item not found' });
      return;
    }

    // Check stock
    if (cartItem.product.stockQuantity !== null && cartItem.product.stockQuantity < quantity) {
      res.status(400).json({ error: 'Insufficient stock' });
      return;
    }

    const updated = await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
      include: {
        product: {
          include: {
            images: {
              where: { isPrimary: true },
              take: 1,
            },
          },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating cart item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/marketplace/cart/items/:itemId - Remove item from cart
router.delete('/cart/items/:itemId', requirePermission('marketplace.orders.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId } = req.params;

    const cartItem = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: {
        cart: true,
      },
    });

    if (!cartItem || cartItem.cart.orgId !== req.org.id || cartItem.cart.userId !== req.user.id) {
      res.status(404).json({ error: 'Cart item not found' });
      return;
    }

    await prisma.cartItem.delete({
      where: { id: itemId },
    });

    res.json({ message: 'Item removed from cart' });
  } catch (error) {
    console.error('Error removing cart item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/marketplace/cart/checkout - Checkout cart and create order
router.post('/cart/checkout', requirePermission('marketplace.orders.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { customerName, customerEmail, customerPhone, shippingAddress } = req.body;

    // Get user's cart
    const cart = await prisma.cart.findFirst({
      where: {
        orgId: req.org.id,
        userId: req.user.id,
        expiresAt: {
          gte: new Date(),
        },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      res.status(400).json({ error: 'Cart is empty' });
      return;
    }

    // Validate stock and calculate total
    let totalCents = 0;
    const orderItemsData = [];

    for (const item of cart.items) {
      if (!item.product.isActive) {
        res.status(400).json({ error: `Product ${item.product.name} is no longer available` });
        return;
      }

      if (item.product.stockQuantity !== null && item.product.stockQuantity < item.quantity) {
        res.status(400).json({ error: `Insufficient stock for ${item.product.name}` });
        return;
      }

      const itemTotal = item.product.priceCents * item.quantity;
      totalCents += itemTotal;

      orderItemsData.push({
        productId: item.product.id,
        quantity: item.quantity,
        priceCents: item.product.priceCents,
        currency: item.product.currency,
      });
    }

    // Generate order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create order
    const order = await prisma.order.create({
      data: {
        orgId: req.org.id,
        orderNumber,
        status: 'pending',
        totalCents,
        currency: 'SAR',
        customerName: customerName || (req.user as { name?: string | null }).name || null,
        customerEmail: customerEmail || req.user.email || null,
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
    for (const item of cart.items) {
      if (item.product.stockQuantity !== null) {
        await prisma.product.update({
          where: { id: item.product.id },
          data: {
            stockQuantity: item.product.stockQuantity - item.quantity,
          },
        });
      }
    }

    // Clear cart
    await prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    res.status(201).json(order);
  } catch (error) {
    console.error('Error during checkout:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/marketplace/widgets/pending-orders
router.get('/widgets/pending-orders', requirePermission('marketplace.orders.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await prisma.order.count({
      where: {
        orgId: req.org.id,
        status: 'pending',
      },
    });

    res.json({ count });
  } catch (error) {
    console.error('Error fetching pending orders count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// STOREFRONT SETTINGS
// ============================================

// GET /api/marketplace/storefront/settings
router.get('/storefront/settings', requirePermission('marketplace.products.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const organization = await prisma.organization.findUnique({
      where: { id: req.org.id },
      select: {
        storefrontSettings: true,
      },
    });

    res.json({
      settings: organization?.storefrontSettings || {
        hero: {
          enabled: true,
          title: '',
          subtitle: '',
          ctaText: 'Shop Now',
          ctaLink: '#products',
          backgroundImage: null,
          backgroundColor: '#000063',
          textColor: '#ffffff',
        },
        intro: {
          enabled: true,
          title: 'Welcome to Our Store',
          description: 'Discover amazing products at great prices.',
        },
        featuredProducts: {
          enabled: false,
          productIds: [],
        },
      },
    });
  } catch (error) {
    console.error('Error fetching storefront settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/marketplace/storefront/settings
router.put('/storefront/settings', requirePermission('marketplace.products.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { settings } = req.body;

    if (!settings) {
      res.status(400).json({ error: 'Settings are required' });
      return;
    }

    const organization = await prisma.organization.update({
      where: { id: req.org.id },
      data: {
        storefrontSettings: settings,
      },
      select: {
        storefrontSettings: true,
      },
    });

    res.json({ settings: organization.storefrontSettings });
  } catch (error) {
    console.error('Error updating storefront settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


