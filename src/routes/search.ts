import { Router, Request, Response } from 'express';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/search - Global search across modules
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { q, type, limit = 20 } = req.query;

    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }

    const searchTerm = q.trim();
    if (searchTerm.length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters' });
      return;
    }

    const results: any = {
      employees: [],
      tickets: [],
      products: [],
      orders: [],
    };

    // Search employees
    if (!type || type === 'employees' || type === 'all') {
      const employees = await prisma.employee.findMany({
        where: {
          orgId: req.org.id,
          OR: [
            { fullName: { contains: searchTerm, mode: 'insensitive' } },
            { email: { contains: searchTerm, mode: 'insensitive' } },
            { position: { contains: searchTerm, mode: 'insensitive' } },
            { department: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        take: Number(limit),
      });
      results.employees = employees;
    }

    // Search tickets
    if (!type || type === 'tickets' || type === 'all') {
      const tickets = await prisma.ticket.findMany({
        where: {
          orgId: req.org.id,
          OR: [
            { title: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        take: Number(limit),
      });
      results.tickets = tickets;
    }

    // Search products
    if (!type || type === 'products' || type === 'all') {
      const products = await prisma.product.findMany({
        where: {
          orgId: req.org.id,
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } },
            { sku: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        include: {
          category: true,
        },
        take: Number(limit),
      });
      results.products = products;
    }

    // Search orders
    if (!type || type === 'orders' || type === 'all') {
      const orders = await prisma.order.findMany({
        where: {
          orgId: req.org.id,
          OR: [
            { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
            { customerName: { contains: searchTerm, mode: 'insensitive' } },
            { customerEmail: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        take: Number(limit),
      });
      results.orders = orders;
    }

    // Calculate totals
    const total = Object.values(results).reduce((sum: number, arr: any) => sum + arr.length, 0);

    res.json({
      query: searchTerm,
      results,
      total,
    });
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;














