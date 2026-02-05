import { Router, Request, Response } from 'express';
import prisma from '../core/db';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// POST /api/onboarding/create-sample-data
router.post('/create-sample-data', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const orgId = req.org.id;

    // Create sample employees
    const sampleEmployees = [
      {
        fullName: 'Ahmed Al-Saud',
        email: 'ahmed@example.com',
        position: 'Software Engineer',
        department: 'Engineering',
        phone: '+966501234567',
        organization: { connect: { id: orgId } },
      },
      {
        fullName: 'Fatima Al-Rashid',
        email: 'fatima@example.com',
        position: 'HR Manager',
        department: 'Human Resources',
        phone: '+966501234568',
        organization: { connect: { id: orgId } },
      },
      {
        fullName: 'Mohammed Al-Zahrani',
        email: 'mohammed@example.com',
        position: 'Sales Manager',
        department: 'Sales',
        phone: '+966501234569',
        organization: { connect: { id: orgId } },
      },
    ];

    const createdEmployees = [];
    for (const emp of sampleEmployees) {
      try {
        const employee = await prisma.employee.create({
          data: emp,
        });
        createdEmployees.push(employee);
      } catch (err: any) {
        // Employee might already exist, skip
        if (err.code !== 'P2002') {
          throw err;
        }
      }
    }

    // Create sample tickets
    const sampleTickets = [
      {
        title: 'Welcome to the Ticketing System',
        description: 'This is a sample ticket to help you get started. You can create, assign, and track tickets here.',
        status: 'open',
        priority: 'medium',
        orgId,
        createdById: req.user.id,
      },
      {
        title: 'Sample High Priority Issue',
        description: 'This is an example of a high priority ticket.',
        status: 'in_progress',
        priority: 'high',
        orgId,
        createdById: req.user.id,
      },
    ];

    const createdTickets = [];
    for (const ticket of sampleTickets) {
      try {
        const created = await prisma.ticket.create({
          data: ticket,
        });
        createdTickets.push(created);
      } catch (err) {
        console.error('Failed to create sample ticket:', err);
      }
    }

    // Create sample products (if marketplace module is enabled)
    const marketplaceModule = await prisma.orgModule.findFirst({
      where: {
        organizationId: orgId,
        module: { key: 'marketplace' },
        isEnabled: true,
      },
    });

    const createdProducts = [];
    if (marketplaceModule) {
      const sampleProducts = [
        {
          name: 'Sample Product 1',
          description: 'This is a sample product to help you get started with the marketplace.',
          priceCents: 9999, // 99.99
          currency: 'SAR',
          sku: 'SAMPLE-001',
          stockQuantity: 100,
          organization: { connect: { id: orgId } },
        },
        {
          name: 'Sample Product 2',
          description: 'Another sample product for your store.',
          priceCents: 14999, // 149.99
          currency: 'SAR',
          sku: 'SAMPLE-002',
          stockQuantity: 50,
          organization: { connect: { id: orgId } },
        },
      ];

      for (const product of sampleProducts) {
        try {
          const created = await prisma.product.create({
            data: product,
          });
          createdProducts.push(created);
        } catch (err) {
          console.error('Failed to create sample product:', err);
        }
      }
    }

    res.json({
      message: 'Sample data created successfully',
      employees: createdEmployees.length,
      tickets: createdTickets.length,
      products: createdProducts.length,
    });
  } catch (error) {
    console.error('Error creating sample data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;






