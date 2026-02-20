import { Router } from 'express';
import prisma from '../../../core/db';
import { requirePermission } from '../../../middleware/permissions';

const router = Router();

// GET /api/hr/assets/swaps
router.get('/', requirePermission('hr.assets.swaps.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, employeeId, fromItemId, toItemId } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) {
      where.status = status as string;
    }

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    if (fromItemId) {
      where.fromItemId = fromItemId as string;
    }

    if (toItemId) {
      where.toItemId = toItemId as string;
    }

    const swaps = await prisma.inventorySwap.findMany({
      where,
      include: {
        fromItem: {
          select: {
            id: true,
            name: true,
            sku: true,
            images: {
              take: 1,
            },
          },
        },
        toItem: {
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
        fromAssignment: {
          select: {
            id: true,
            assignedDate: true,
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

    res.json(swaps);
  } catch (error) {
    console.error('Error fetching swaps:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/assets/swaps/:id
router.get('/:id', requirePermission('hr.assets.swaps.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const swap = await prisma.inventorySwap.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        fromItem: {
          include: {
            category: true,
            images: true,
          },
        },
        toItem: {
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
        fromAssignment: {
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
    });

    if (!swap) {
      res.status(404).json({ error: 'Swap not found' });
      return;
    }

    res.json(swap);
  } catch (error) {
    console.error('Error fetching swap:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/assets/swaps
router.post('/', requirePermission('hr.assets.swaps.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { fromItemId, toItemId, employeeId, fromAssignmentId, quantity, reason } = req.body;

    if (!fromItemId || !toItemId || !employeeId || !quantity) {
      res.status(400).json({ error: 'From asset ID, to asset ID, employee ID, and quantity are required' });
      return;
    }

    // Check if assets exist
    const fromItem = await prisma.inventoryItem.findFirst({
      where: {
        id: fromItemId,
        orgId: req.org.id,
      },
    });

    const toItem = await prisma.inventoryItem.findFirst({
      where: {
        id: toItemId,
        orgId: req.org.id,
      },
    });

    if (!fromItem || !toItem) {
      res.status(404).json({ error: 'One or both assets not found' });
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

    // Check if fromAssignment exists (if provided)
    if (fromAssignmentId) {
      const assignment = await prisma.inventoryAssignment.findFirst({
        where: {
          id: fromAssignmentId,
          orgId: req.org.id,
          employeeId,
          status: 'active',
        },
      });

      if (!assignment) {
        res.status(404).json({ error: 'Active assignment not found' });
        return;
      }

      // Check if assignment has enough quantity
      const returnedQuantity = await prisma.inventoryReturn.aggregate({
        where: {
          assignmentId: fromAssignmentId,
        },
        _sum: {
          quantity: true,
        },
      });

      const remainingQuantity = assignment.quantity - (returnedQuantity._sum.quantity || 0);
      if (quantity > remainingQuantity) {
        res.status(400).json({
          error: `Cannot swap more than remaining quantity. Remaining: ${remainingQuantity}, Requested: ${quantity}`,
        });
        return;
      }
    }

    // Check available quantity for toItem
    const activeAssignments = await prisma.inventoryAssignment.aggregate({
      where: {
        itemId: toItemId,
        status: { in: ['approved', 'active'] },
      },
      _sum: {
        quantity: true,
      },
    });

    const assignedQuantity = activeAssignments._sum?.quantity ?? 0;
    const availableQuantity = toItem.quantity - assignedQuantity;

    if (quantity > availableQuantity) {
      res.status(400).json({
        error: `Insufficient quantity in target asset. Available: ${availableQuantity}, Requested: ${quantity}`,
      });
      return;
    }

    const swap = await prisma.inventorySwap.create({
      data: {
        orgId: req.org.id,
        fromItemId: fromItemId,
        toItemId: toItemId,
        employeeId,
        fromAssignmentId: fromAssignmentId || null,
        quantity,
        reason: reason || null,
        requestedById: req.user.id,
        status: 'pending', // Requires approval
      },
      include: {
        fromItem: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        toItem: {
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

    res.status(201).json(swap);
  } catch (error) {
    console.error('Error creating swap:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/assets/swaps/:id/approve
router.put('/:id/approve', requirePermission('hr.assets.swaps.approve'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const swap = await prisma.inventorySwap.findFirst({
      where: {
        id,
        orgId: req.org.id,
        status: 'pending',
      },
      include: {
        fromItem: true,
        toItem: true,
        fromAssignment: true,
      },
    });

    if (!swap) {
      res.status(404).json({ error: 'Swap not found or already processed' });
      return;
    }

    // Check available quantity for toItem again
    const activeAssignments = await prisma.inventoryAssignment.aggregate({
      where: {
        itemId: swap.toItemId,
        status: { in: ['approved', 'active'] },
      },
      _sum: {
        quantity: true,
      },
    });

    const assignedQuantity = activeAssignments._sum?.quantity ?? 0;
    const availableQuantity = swap.toItem.quantity - assignedQuantity;

    if (swap.quantity > availableQuantity) {
      res.status(400).json({
        error: `Insufficient quantity in target asset. Available: ${availableQuantity}, Requested: ${swap.quantity}`,
      });
      return;
    }

    // Update swap status
    const updated = await prisma.inventorySwap.update({
      where: { id },
      data: {
        status: 'approved',
        approvedById: req.user.id,
        approvedAt: new Date(),
      },
    });

    // If there's a fromAssignment, create a return for it
    if (swap.fromAssignmentId) {
      await prisma.inventoryReturn.create({
        data: {
          orgId: req.org.id,
          assignmentId: swap.fromAssignmentId,
          itemId: swap.fromItemId,
          employeeId: swap.employeeId,
          quantity: swap.quantity,
          returnReason: `Swapped for ${swap.toItem.name}`,
          condition: 'good',
          processedById: req.user.id,
          processedAt: new Date(),
        },
      });

      // Update assignment if fully swapped
      const assignment = await prisma.inventoryAssignment.findFirst({
        where: { id: swap.fromAssignmentId },
        include: {
          returns: {
            select: {
              quantity: true,
            },
          },
        },
      });

      if (assignment) {
        const returnedQuantity = assignment.returns.reduce((sum: number, r: { quantity: number }) => sum + r.quantity, 0);
        if (returnedQuantity >= assignment.quantity) {
          await prisma.inventoryAssignment.update({
            where: { id: swap.fromAssignmentId },
            data: {
              status: 'returned',
              returnedAt: new Date(),
            },
          });
        }
      }

      // Update fromItem quantity
      await prisma.inventoryItem.update({
        where: { id: swap.fromItemId },
        data: {
          quantity: {
            increment: swap.quantity,
          },
        },
      });
    }

    // Create new assignment for toItem
    const newAssignment = await prisma.inventoryAssignment.create({
      data: {
        orgId: req.org.id,
        itemId: swap.toItemId,
        employeeId: swap.employeeId,
        quantity: swap.quantity,
        reason: `Swapped from ${swap.fromItem.name}`,
        requestedById: req.user.id,
        approvedById: req.user.id,
        approvedAt: new Date(),
        status: 'active',
      },
    });

    // Update toItem quantity
    await prisma.inventoryItem.update({
      where: { id: swap.toItemId },
      data: {
        quantity: {
          decrement: swap.quantity,
        },
      },
    });

    // Mark swap as completed
    await prisma.inventorySwap.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    const finalSwap = await prisma.inventorySwap.findFirst({
      where: { id },
      include: {
        fromItem: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        toItem: {
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

    res.json(finalSwap);
  } catch (error) {
    console.error('Error approving swap:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/assets/swaps/:id/reject
router.put('/:id/reject', requirePermission('hr.assets.swaps.approve'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { rejectionReason } = req.body;

    const swap = await prisma.inventorySwap.findFirst({
      where: {
        id,
        orgId: req.org.id,
        status: 'pending',
      },
    });

    if (!swap) {
      res.status(404).json({ error: 'Swap not found or already processed' });
      return;
    }

    const updated = await prisma.inventorySwap.update({
      where: { id },
      data: {
        status: 'rejected',
        approvedById: req.user.id,
        approvedAt: new Date(),
        rejectionReason: rejectionReason || null,
      },
      include: {
        fromItem: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        toItem: {
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
    console.error('Error rejecting swap:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;





