import { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// GET /api/hr/complaints - List all complaints
router.get('/', requirePermission('hr.complaints.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, priority, employeeId, category } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) {
      where.status = status;
    }

    if (priority) {
      where.priority = priority;
    }

    if (employeeId) {
      where.employeeId = employeeId;
    }

    if (category) {
      where.category = category;
    }

    const complaints = await prisma.employeeComplaint.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: true,
            position: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            url: true,
            mimeType: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(complaints);
  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/complaints/:id - Get single complaint
router.get('/:id', requirePermission('hr.complaints.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const complaint = await prisma.employeeComplaint.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: true,
            position: true,
            photoUrl: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            originalName: true,
            url: true,
            mimeType: true,
            size: true,
            createdAt: true,
          },
        },
      },
    });

    if (!complaint) {
      res.status(404).json({ error: 'Complaint not found' });
      return;
    }

    res.json(complaint);
  } catch (error) {
    console.error('Error fetching complaint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/complaints - Create complaint
router.post('/', requirePermission('hr.complaints.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, title, description, category, priority, isAnonymous } = req.body;

    if (!employeeId || !title || !description) {
      res.status(400).json({ error: 'Employee, title, and description are required' });
      return;
    }

    // Verify employee belongs to org
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

    const complaint = await prisma.employeeComplaint.create({
      data: {
        orgId: req.org.id,
        employeeId,
        title,
        description,
        category: category || null,
        priority: priority || 'medium',
        isAnonymous: isAnonymous || false,
        createdById: req.user.id,
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
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json(complaint);
  } catch (error) {
    console.error('Error creating complaint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/complaints/:id - Update complaint
router.put('/:id', requirePermission('hr.complaints.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { status, priority, resolution, resolvedById } = req.body;

    const complaint = await prisma.employeeComplaint.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!complaint) {
      res.status(404).json({ error: 'Complaint not found' });
      return;
    }

    const updateData: any = {};

    if (status !== undefined) {
      updateData.status = status;
      if (status === 'resolved' || status === 'closed') {
        updateData.resolvedAt = new Date();
        updateData.resolvedById = resolvedById || req.user.id;
      }
    }

    if (priority !== undefined) {
      updateData.priority = priority;
    }

    if (resolution !== undefined) {
      updateData.resolution = resolution;
    }

    const updated = await prisma.employeeComplaint.update({
      where: { id },
      data: updateData,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        resolvedBy: {
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
    console.error('Error updating complaint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/hr/complaints/:id - Delete complaint
router.delete('/:id', requirePermission('hr.complaints.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const complaint = await prisma.employeeComplaint.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!complaint) {
      res.status(404).json({ error: 'Complaint not found' });
      return;
    }

    await prisma.employeeComplaint.delete({
      where: { id },
    });

    res.json({ message: 'Complaint deleted successfully' });
  } catch (error) {
    console.error('Error deleting complaint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;





