import { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// GET /api/hr/requests - List all employee requests
router.get('/', requirePermission('hr.requests.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, priority, employeeId, requestType } = req.query;

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

    if (requestType) {
      where.requestType = requestType;
    }

    const requests = await prisma.employeeRequest.findMany({
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
        approvedBy: {
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

    res.json(requests);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/requests/:id - Get single request
router.get('/:id', requirePermission('hr.requests.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const request = await prisma.employeeRequest.findFirst({
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
        approvedBy: {
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

    if (!request) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    res.json(request);
  } catch (error) {
    console.error('Error fetching request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/requests - Create request
router.post('/', requirePermission('hr.requests.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, requestType, title, description, priority } = req.body;

    if (!employeeId || !requestType || !title || !description) {
      res.status(400).json({ error: 'Employee, request type, title, and description are required' });
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

    const request = await prisma.employeeRequest.create({
      data: {
        orgId: req.org.id,
        employeeId,
        requestType,
        title,
        description,
        priority: priority || 'medium',
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

    res.status(201).json(request);
  } catch (error) {
    console.error('Error creating request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/requests/:id - Update request
router.put('/:id', requirePermission('hr.requests.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { status, priority, notes, approvedById, rejectionReason } = req.body;

    const request = await prisma.employeeRequest.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!request) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const updateData: any = {};

    if (status !== undefined) {
      updateData.status = status;
      if (status === 'approved') {
        updateData.approvedAt = new Date();
        updateData.approvedById = approvedById || req.user.id;
      } else if (status === 'rejected') {
        updateData.rejectedAt = new Date();
        if (rejectionReason) {
          updateData.rejectionReason = rejectionReason;
        }
      } else if (status === 'completed') {
        updateData.completedAt = new Date();
      }
    }

    if (priority !== undefined) {
      updateData.priority = priority;
    }

    if (notes !== undefined) {
      updateData.notes = notes;
    }

    const updated = await prisma.employeeRequest.update({
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
    console.error('Error updating request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/hr/requests/:id - Delete request
router.delete('/:id', requirePermission('hr.requests.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const request = await prisma.employeeRequest.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!request) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    await prisma.employeeRequest.delete({
      where: { id },
    });

    res.json({ message: 'Request deleted successfully' });
  } catch (error) {
    console.error('Error deleting request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;





