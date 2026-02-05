import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// ============================================
// PERFORMANCE REVIEWS
// ============================================

// GET /api/hr/performance/reviews - Get all performance reviews
router.get('/reviews', requirePermission('hr.performance.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, status, reviewType } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    if (status) {
      where.status = status;
    }

    if (reviewType) {
      where.reviewType = reviewType;
    }

    const reviews = await prisma.performanceReview.findMany({
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
        reviewer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        reviewPeriodStart: 'desc',
      },
    });

    res.json(reviews);
  } catch (error) {
    console.error('Error fetching performance reviews:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/performance/reviews/:id - Get single review
router.get('/reviews/:id', requirePermission('hr.performance.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const review = await prisma.performanceReview.findFirst({
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
          },
        },
        reviewer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!review) {
      res.status(404).json({ error: 'Performance review not found' });
      return;
    }

    res.json(review);
  } catch (error) {
    console.error('Error fetching performance review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/performance/reviews - Create performance review
router.post('/reviews', requirePermission('hr.performance.create'), async (req, res) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      employeeId,
      reviewPeriodStart,
      reviewPeriodEnd,
      reviewType,
      overallRating,
      strengths,
      areasForImprovement,
      goals,
    } = req.body;

    if (!employeeId || !reviewPeriodStart || !reviewPeriodEnd) {
      res.status(400).json({ error: 'Employee and review period are required' });
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

    const review = await prisma.performanceReview.create({
      data: {
        orgId: req.org.id,
        employeeId,
        reviewPeriodStart: new Date(reviewPeriodStart),
        reviewPeriodEnd: new Date(reviewPeriodEnd),
        reviewType: reviewType || 'annual',
        overallRating: overallRating || null,
        strengths: strengths || null,
        areasForImprovement: areasForImprovement || null,
        goals: goals || null,
        reviewerId: req.user.id,
        status: 'draft',
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        reviewer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json(review);
  } catch (error) {
    console.error('Error creating performance review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/performance/reviews/:id - Update review
router.put('/reviews/:id', requirePermission('hr.performance.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      overallRating,
      strengths,
      areasForImprovement,
      goals,
      status,
      employeeComments,
    } = req.body;

    const review = await prisma.performanceReview.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!review) {
      res.status(404).json({ error: 'Performance review not found' });
      return;
    }

    const updateData: any = {
      ...(overallRating !== undefined && { overallRating }),
      ...(strengths !== undefined && { strengths }),
      ...(areasForImprovement !== undefined && { areasForImprovement }),
      ...(goals !== undefined && { goals }),
      ...(status && { status }),
      ...(employeeComments !== undefined && { employeeComments }),
    };

    if (status === 'completed' && review.status !== 'completed') {
      updateData.reviewedAt = new Date();
    }

    const updated = await prisma.performanceReview.update({
      where: { id },
      data: updateData,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        reviewer: {
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
    console.error('Error updating performance review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GOALS
// ============================================

// GET /api/hr/performance/goals - Get all goals
router.get('/goals', requirePermission('hr.performance.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, status } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (employeeId) {
      where.employeeId = employeeId as string;
    }

    if (status) {
      where.status = status;
    }

    const goals = await prisma.goal.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            department: true,
          },
        },
      },
      orderBy: {
        targetDate: 'asc',
      },
    });

    res.json(goals);
  } catch (error) {
    console.error('Error fetching goals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/performance/goals - Create goal
router.post('/goals', requirePermission('hr.performance.manage'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { employeeId, title, description, targetDate, notes } = req.body;

    if (!employeeId || !title || !targetDate) {
      res.status(400).json({ error: 'Employee, title, and target date are required' });
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

    const goal = await prisma.goal.create({
      data: {
        orgId: req.org.id,
        employeeId,
        title,
        description: description || null,
        targetDate: new Date(targetDate),
        notes: notes || null,
        status: 'not_started',
        progress: 0,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json(goal);
  } catch (error) {
    console.error('Error creating goal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/performance/goals/:id - Update goal
router.put('/goals/:id', requirePermission('hr.performance.manage'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { title, description, targetDate, status, progress, notes } = req.body;

    const goal = await prisma.goal.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }

    const updateData: any = {
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(targetDate && { targetDate: new Date(targetDate) }),
      ...(status && { status }),
      ...(progress !== undefined && { progress: Math.max(0, Math.min(100, progress)) }),
      ...(notes !== undefined && { notes }),
    };

    if (status === 'completed' && goal.status !== 'completed') {
      updateData.completedAt = new Date();
      updateData.progress = 100;
    }

    const updated = await prisma.goal.update({
      where: { id },
      data: updateData,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating goal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/hr/performance/goals/:id - Delete goal
router.delete('/goals/:id', requirePermission('hr.performance.manage'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const goal = await prisma.goal.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }

    await prisma.goal.delete({
      where: { id },
    });

    res.json({ message: 'Goal deleted successfully' });
  } catch (error) {
    console.error('Error deleting goal:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

