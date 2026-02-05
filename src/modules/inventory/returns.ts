import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// GET /api/inventory/returns
router.get('/', requirePermission('inventory.returns.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, itemId, assignmentId } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    if (itemId) {
      where.itemId = itemId as string;
    }

    if (assignmentId) {
      where.assignmentId = assignmentId as string;
    }

    const returns = await prisma.inventoryReturn.findMany({
      where,
      include: {
        item: {
          select: {
            id: true,
            name: true,
            sku: true,
            images: {
              take: 1,
            },
          },
        },
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: true,
          },
        },
        assignment: {
          select: {
            id: true,
            assignedDate: true,
            expectedReturnDate: true,
          },
        },
        processedBy: {
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
    });

    res.json(returns);
  } catch (error) {
    console.error('Error fetching returns:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inventory/returns/:id
router.get('/:id', requirePermission('inventory.returns.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const returnRecord = await prisma.inventoryReturn.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        item: {
          include: {
            category: true,
            images: true,
          },
        },
        employee: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        assignment: {
          include: {
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
        },
        processedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!returnRecord) {
      res.status(404).json({ error: 'Return not found' });
      return;
    }

    res.json(returnRecord);
  } catch (error) {
    console.error('Error fetching return:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory/returns
router.post('/', requirePermission('inventory.returns.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { assignmentId, quantity, returnReason, condition, notes } = req.body;

    if (!assignmentId || !quantity) {
      res.status(400).json({ error: 'Assignment ID and quantity are required' });
      return;
    }

    // Check if assignment exists and is active
    const assignment = await prisma.inventoryAssignment.findFirst({
      where: {
        id: assignmentId,
        orgId: req.org.id,
        status: 'active',
      },
      include: {
        item: true,
        employee: true,
        returns: {
          select: {
            quantity: true,
          },
        },
      },
    });

    if (!assignment) {
      res.status(404).json({ error: 'Active assignment not found' });
      return;
    }

    // Calculate already returned quantity
    const returnedQuantity = assignment.returns.reduce((sum, r) => sum + r.quantity, 0);
    const remainingQuantity = assignment.quantity - returnedQuantity;

    if (quantity > remainingQuantity) {
      res.status(400).json({
        error: `Cannot return more than remaining quantity. Remaining: ${remainingQuantity}, Requested: ${quantity}`,
      });
      return;
    }

    // Create return record
    const returnRecord = await prisma.inventoryReturn.create({
      data: {
        orgId: req.org.id,
        assignmentId,
        itemId: assignment.itemId,
        employeeId: assignment.employeeId,
        quantity,
        returnReason: returnReason || null,
        condition: condition || 'good',
        notes: notes || null,
        processedById: req.user.id,
        processedAt: new Date(),
      },
      include: {
        item: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        assignment: {
          select: {
            id: true,
            assignedDate: true,
          },
        },
        processedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Update assignment status if fully returned
    const newReturnedQuantity = returnedQuantity + quantity;
    if (newReturnedQuantity >= assignment.quantity) {
      await prisma.inventoryAssignment.update({
        where: { id: assignmentId },
        data: {
          status: 'returned',
          returnedAt: new Date(),
          returnNotes: notes || null,
        },
      });
    }

    // Update item quantity if condition is good
    if (condition === 'good') {
      await prisma.inventoryItem.update({
        where: { id: assignment.itemId },
        data: {
          quantity: {
            increment: quantity,
          },
        },
      });
    } else {
      // If damaged, update item condition or create damage record
      await prisma.inventoryItem.update({
        where: { id: assignment.itemId },
        data: {
          condition: 'damaged',
        },
      });
    }

    res.status(201).json(returnRecord);
  } catch (error) {
    console.error('Error creating return:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;














