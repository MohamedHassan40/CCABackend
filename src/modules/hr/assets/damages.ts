import { Router } from 'express';
import prisma from '../../../core/db';
import { requirePermission } from '../../../middleware/permissions';

const router = Router();

// GET /api/hr/assets/damages
router.get('/', requirePermission('hr.assets.damages.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, assetId, employeeId } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) {
      where.status = status as string;
    }

    if (assetId) {
      where.assetId = assetId as string;
    }

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    const damages = await prisma.assetDamage.findMany({
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
          },
        },
        assignment: {
          select: {
            id: true,
            assignedDate: true,
          },
        },
        reportedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        reviewedBy: {
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

    res.json(damages);
  } catch (error) {
    console.error('Error fetching damages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/assets/damages/:id
router.get('/:id', requirePermission('hr.assets.damages.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const damage = await prisma.assetDamage.findFirst({
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
        reportedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!damage) {
      res.status(404).json({ error: 'Damage record not found' });
      return;
    }

    res.json(damage);
  } catch (error) {
    console.error('Error fetching damage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/assets/damages
router.post('/', requirePermission('hr.assets.damages.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      assetId,
      employeeId,
      assignmentId,
      damageType,
      severity,
      description,
      estimatedRepairCostCents,
      currency,
    } = req.body;

    if (!assetId || !damageType || !severity) {
      res.status(400).json({ error: 'Asset ID, damage type, and severity are required' });
      return;
    }

    // Check if asset exists
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

    // Check if employee exists (if provided)
    if (employeeId) {
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
    }

    // Check if assignment exists (if provided)
    if (assignmentId) {
      const assignment = await prisma.assetAssignment.findFirst({
        where: {
          id: assignmentId,
          orgId: req.org.id,
        },
      });

      if (!assignment) {
        res.status(404).json({ error: 'Assignment not found' });
        return;
      }
    }

    const damage = await prisma.assetDamage.create({
      data: {
        orgId: req.org.id,
        assetId,
        employeeId: employeeId || null,
        assignmentId: assignmentId || null,
        damageType,
        severity,
        description: description || null,
        estimatedRepairCostCents: estimatedRepairCostCents || null,
        currency: 'SAR', // Only SAR (Saudi Riyal) is supported
        reportedById: req.user.id,
        status: 'reported',
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
        reportedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Update asset condition if severe damage
    if (severity === 'severe' || severity === 'total') {
      await prisma.employeeAsset.update({
        where: { id: assetId },
        data: {
          condition: 'damaged',
          status: severity === 'total' ? 'retired' : 'maintenance',
        },
      });
    }

    res.status(201).json(damage);
  } catch (error) {
    console.error('Error creating damage record:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/assets/damages/:id/review
router.put('/:id/review', requirePermission('hr.assets.damages.review'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { status, resolutionNotes } = req.body;

    if (!status) {
      res.status(400).json({ error: 'Status is required' });
      return;
    }

    const validStatuses = ['under_review', 'repairing', 'repaired', 'written_off'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const damage = await prisma.assetDamage.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        asset: true,
      },
    });

    if (!damage) {
      res.status(404).json({ error: 'Damage record not found' });
      return;
    }

    const updated = await prisma.assetDamage.update({
      where: { id },
      data: {
        status,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        resolutionNotes: resolutionNotes || null,
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
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Update asset status based on damage resolution
    if (status === 'repaired') {
      await prisma.employeeAsset.update({
        where: { id: damage.assetId },
        data: {
          condition: 'refurbished',
          status: 'available',
        },
      });
    } else if (status === 'written_off') {
      await prisma.employeeAsset.update({
        where: { id: damage.assetId },
        data: {
          condition: 'damaged',
          status: 'retired',
        },
      });
    }

    res.json(updated);
  } catch (error) {
    console.error('Error reviewing damage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;





