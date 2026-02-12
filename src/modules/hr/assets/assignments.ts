import { Router } from 'express';
import prisma from '../../../core/db';
import { requirePermission } from '../../../middleware/permissions';

const router = Router();

// GET /api/hr/assets/assignments
router.get('/', requirePermission('hr.assets.assignments.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, employeeId, assetId } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) {
      where.status = status as string;
    }

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    if (assetId) {
      where.assetId = assetId as string;
    }

    const assignments = await prisma.assetAssignment.findMany({
      where,
      include: {
        asset: {
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

// GET /api/hr/assets/assignments/:id
router.get('/:id', requirePermission('hr.assets.assignments.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const assignment = await prisma.assetAssignment.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        asset: {
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

// POST /api/hr/assets/assignments
router.post('/', requirePermission('hr.assets.assignments.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { assetId, employeeId, quantity, expectedReturnDate, reason } = req.body;

    if (!assetId || !employeeId || !quantity) {
      res.status(400).json({ error: 'Asset ID, employee ID, and quantity are required' });
      return;
    }

    // Check if asset exists and has enough quantity
    const asset = await prisma.employeeAsset.findFirst({
      where: {
        id: assetId,
        orgId: req.org.id,
      },
    });

    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    // Check available quantity (total - assigned)
    const activeAssignments = await prisma.assetAssignment.aggregate({
      where: {
        assetId,
        status: { in: ['approved', 'active'] },
      },
      _sum: {
        quantity: true,
      },
    });

    const assignedQuantity = activeAssignments._sum.quantity || 0;
    const availableQuantity = asset.quantity - assignedQuantity;

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

    const assignment = await prisma.assetAssignment.create({
      data: {
        orgId: req.org.id,
        assetId,
        employeeId,
        quantity,
        expectedReturnDate: expectedReturnDate ? new Date(expectedReturnDate) : null,
        reason: reason || null,
        requestedById: req.user.id,
        status: 'pending', // Requires approval
      },
      include: {
        asset: {
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

// PUT /api/hr/assets/assignments/:id/approve
router.put('/:id/approve', requirePermission('hr.assets.assignments.approve'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const assignment = await prisma.assetAssignment.findFirst({
      where: {
        id,
        orgId: req.org.id,
        status: 'pending',
      },
      include: {
        asset: true,
      },
    });

    if (!assignment) {
      res.status(404).json({ error: 'Assignment not found or already processed' });
      return;
    }

    // Check available quantity again
    const activeAssignments = await prisma.assetAssignment.aggregate({
      where: {
        assetId: assignment.assetId,
        status: { in: ['approved', 'active'] },
        id: { not: id },
      },
      _sum: {
        quantity: true,
      },
    });

    const assignedQuantity = activeAssignments._sum.quantity || 0;
    const availableQuantity = assignment.asset.quantity - assignedQuantity;

    if (assignment.quantity > availableQuantity) {
      res.status(400).json({
        error: `Insufficient quantity. Available: ${availableQuantity}, Requested: ${assignment.quantity}`,
      });
      return;
    }

    const updated = await prisma.assetAssignment.update({
      where: { id },
      data: {
        status: 'active',
        approvedById: req.user.id,
        approvedAt: new Date(),
      },
      include: {
        asset: {
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

// PUT /api/hr/assets/assignments/:id/reject
router.put('/:id/reject', requirePermission('hr.assets.assignments.approve'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { rejectionReason } = req.body;

    const assignment = await prisma.assetAssignment.findFirst({
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

    const updated = await prisma.assetAssignment.update({
      where: { id },
      data: {
        status: 'rejected',
        approvedById: req.user.id,
        approvedAt: new Date(),
        rejectionReason: rejectionReason || null,
      },
      include: {
        asset: {
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

// PUT /api/hr/assets/assignments/:id/cancel
router.put('/:id/cancel', requirePermission('hr.assets.assignments.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const assignment = await prisma.assetAssignment.findFirst({
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

    const updated = await prisma.assetAssignment.update({
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


