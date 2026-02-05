import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// GET /api/inventory/assignments
router.get('/', requirePermission('inventory.assignments.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, employeeId, itemId } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) {
      where.status = status as string;
    }

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    if (itemId) {
      where.itemId = itemId as string;
    }

    const assignments = await prisma.inventoryAssignment.findMany({
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
            position: true,
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
    });

    res.json(assignments);
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inventory/assignments/:id
router.get('/:id', requirePermission('inventory.assignments.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const assignment = await prisma.inventoryAssignment.findFirst({
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
        returns: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!assignment) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }

    res.json(assignment);
  } catch (error) {
    console.error('Error fetching assignment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory/assignments
router.post('/', requirePermission('inventory.assignments.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId, employeeId, quantity, expectedReturnDate, reason } = req.body;

    if (!itemId || !employeeId || !quantity) {
      res.status(400).json({ error: 'Item ID, employee ID, and quantity are required' });
      return;
    }

    // Check if item exists and has enough quantity
    const item = await prisma.inventoryItem.findFirst({
      where: {
        id: itemId,
        orgId: req.org.id,
      },
    });

    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    // Check available quantity (total - assigned)
    const activeAssignments = await prisma.inventoryAssignment.aggregate({
      where: {
        itemId,
        status: { in: ['approved', 'active'] },
      },
      _sum: {
        quantity: true,
      },
    });

    const assignedQuantity = activeAssignments._sum.quantity || 0;
    const availableQuantity = item.quantity - assignedQuantity;

    if (quantity > availableQuantity) {
      res.status(400).json({
        error: `Insufficient quantity. Available: ${availableQuantity}, Requested: ${quantity}`,
      });
      return;
    }

    // Check if employee exists
    const employee = await prisma.employee.findFirst({
      where: {
        id: employeeId,
        orgId: req.org.id,
      },
    });

    if (!employee) {
      res.status(404).json({ error: 'Employee not found' });
      return;
    }

    const assignment = await prisma.inventoryAssignment.create({
      data: {
        orgId: req.org.id,
        itemId,
        employeeId,
        quantity,
        expectedReturnDate: expectedReturnDate ? new Date(expectedReturnDate) : null,
        reason: reason || null,
        requestedById: req.user.id,
        status: 'pending', // Requires approval
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
        requestedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json(assignment);
  } catch (error) {
    console.error('Error creating assignment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory/assignments/:id/approve
router.put('/:id/approve', requirePermission('inventory.assignments.approve'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const assignment = await prisma.inventoryAssignment.findFirst({
      where: {
        id,
        orgId: req.org.id,
        status: 'pending',
      },
      include: {
        item: true,
      },
    });

    if (!assignment) {
      res.status(404).json({ error: 'Assignment not found or already processed' });
      return;
    }

    // Check available quantity again
    const activeAssignments = await prisma.inventoryAssignment.aggregate({
      where: {
        itemId: assignment.itemId,
        status: { in: ['approved', 'active'] },
        id: { not: id },
      },
      _sum: {
        quantity: true,
      },
    });

    const assignedQuantity = activeAssignments._sum.quantity || 0;
    const availableQuantity = assignment.item.quantity - assignedQuantity;

    if (assignment.quantity > availableQuantity) {
      res.status(400).json({
        error: `Insufficient quantity. Available: ${availableQuantity}, Requested: ${assignment.quantity}`,
      });
      return;
    }

    const updated = await prisma.inventoryAssignment.update({
      where: { id },
      data: {
        status: 'active',
        approvedById: req.user.id,
        approvedAt: new Date(),
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
        approvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error approving assignment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory/assignments/:id/reject
router.put('/:id/reject', requirePermission('inventory.assignments.approve'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { rejectionReason } = req.body;

    const assignment = await prisma.inventoryAssignment.findFirst({
      where: {
        id,
        orgId: req.org.id,
        status: 'pending',
      },
    });

    if (!assignment) {
      res.status(404).json({ error: 'Assignment not found or already processed' });
      return;
    }

    const updated = await prisma.inventoryAssignment.update({
      where: { id },
      data: {
        status: 'rejected',
        approvedById: req.user.id,
        approvedAt: new Date(),
        rejectionReason: rejectionReason || null,
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
        approvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error rejecting assignment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory/assignments/:id/cancel
router.put('/:id/cancel', requirePermission('inventory.assignments.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const assignment = await prisma.inventoryAssignment.findFirst({
      where: {
        id,
        orgId: req.org.id,
        status: { in: ['pending', 'approved', 'active'] },
      },
    });

    if (!assignment) {
      res.status(404).json({ error: 'Assignment not found or cannot be cancelled' });
      return;
    }

    const updated = await prisma.inventoryAssignment.update({
      where: { id },
      data: {
        status: 'cancelled',
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error cancelling assignment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;














