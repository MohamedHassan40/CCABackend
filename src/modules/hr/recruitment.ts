import { Router } from 'express';
import prisma from '../../core/db';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

// ============================================
// JOB POSTINGS
// ============================================

// GET /api/hr/recruitment/jobs - Get all job postings
router.get('/jobs', requirePermission('hr.recruitment.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) {
      where.status = status;
    }

    const jobs = await prisma.jobPosting.findMany({
      where,
      include: {
        _count: {
          select: {
            applications: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(jobs);
  } catch (error) {
    console.error('Error fetching job postings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/hr/recruitment/jobs/:id - Get single job posting
router.get('/jobs/:id', requirePermission('hr.recruitment.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const job = await prisma.jobPosting.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        applications: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        _count: {
          select: {
            applications: true,
          },
        },
      },
    });

    if (!job) {
      res.status(404).json({ error: 'Job posting not found' });
      return;
    }

    res.json(job);
  } catch (error) {
    console.error('Error fetching job posting:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/recruitment/jobs - Create job posting
router.post('/jobs', requirePermission('hr.recruitment.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      title,
      description,
      department,
      position,
      location,
      employmentType,
      salaryRange,
      requirements,
      status,
    } = req.body;

    if (!title) {
      res.status(400).json({ error: 'Job title is required' });
      return;
    }

    const job = await prisma.jobPosting.create({
      data: {
        orgId: req.org.id,
        title,
        description: description || null,
        department: department || null,
        position: position || null,
        location: location || null,
        employmentType: employmentType || null,
        salaryRange: salaryRange || null,
        requirements: requirements || null,
        status: status || 'draft',
        ...(status === 'published' && { publishedAt: new Date() }),
      },
    });

    res.status(201).json(job);
  } catch (error) {
    console.error('Error creating job posting:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/recruitment/jobs/:id - Update job posting
router.put('/jobs/:id', requirePermission('hr.recruitment.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const {
      title,
      description,
      department,
      position,
      location,
      employmentType,
      salaryRange,
      requirements,
      status,
    } = req.body;

    const job = await prisma.jobPosting.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!job) {
      res.status(404).json({ error: 'Job posting not found' });
      return;
    }

    const updateData: any = {
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(department !== undefined && { department }),
      ...(position !== undefined && { position }),
      ...(location !== undefined && { location }),
      ...(employmentType !== undefined && { employmentType }),
      ...(salaryRange !== undefined && { salaryRange }),
      ...(requirements !== undefined && { requirements }),
      ...(status && { status }),
    };

    // Set publishedAt if status changes to published
    if (status === 'published' && job.status !== 'published') {
      updateData.publishedAt = new Date();
    }

    // Set closedAt if status changes to closed
    if (status === 'closed' && job.status !== 'closed') {
      updateData.closedAt = new Date();
    }

    const updated = await prisma.jobPosting.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating job posting:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/hr/recruitment/jobs/:id - Delete job posting
router.delete('/jobs/:id', requirePermission('hr.recruitment.edit'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const job = await prisma.jobPosting.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!job) {
      res.status(404).json({ error: 'Job posting not found' });
      return;
    }

    await prisma.jobPosting.delete({
      where: { id },
    });

    res.json({ message: 'Job posting deleted successfully' });
  } catch (error) {
    console.error('Error deleting job posting:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// JOB APPLICATIONS
// ============================================

// GET /api/hr/recruitment/applications - Get all applications
router.get('/applications', requirePermission('hr.recruitment.view'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { jobPostingId, status } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (jobPostingId) {
      where.jobPostingId = jobPostingId as string;
    }

    if (status) {
      where.status = status;
    }

    const applications = await prisma.jobApplication.findMany({
      where,
      include: {
        jobPosting: {
          select: {
            id: true,
            title: true,
          },
        },
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(applications);
  } catch (error) {
    console.error('Error fetching job applications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/hr/recruitment/applications - Create job application
router.post('/applications', requirePermission('hr.recruitment.create'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      jobPostingId,
      employeeId,
      applicantName,
      applicantEmail,
      applicantPhone,
      resumeUrl,
      coverLetter,
    } = req.body;

    if (!jobPostingId || !applicantName || !applicantEmail) {
      res.status(400).json({ error: 'Job posting, applicant name, and email are required' });
      return;
    }

    // Verify job posting exists and is published
    const jobPosting = await prisma.jobPosting.findFirst({
      where: {
        id: jobPostingId,
        orgId: req.org.id,
        status: 'published',
      },
    });

    if (!jobPosting) {
      res.status(404).json({ error: 'Job posting not found or not published' });
      return;
    }

    // Verify employee if provided
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

    const application = await prisma.jobApplication.create({
      data: {
        orgId: req.org.id,
        jobPostingId,
        employeeId: employeeId || null,
        applicantName,
        applicantEmail,
        applicantPhone: applicantPhone || null,
        resumeUrl: resumeUrl || null,
        coverLetter: coverLetter || null,
        status: 'applied',
      },
      include: {
        jobPosting: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    res.status(201).json(application);
  } catch (error) {
    console.error('Error creating job application:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/hr/recruitment/applications/:id - Update application
router.put('/applications/:id', requirePermission('hr.recruitment.manage'), async (req, res) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { status, interviewDate, interviewNotes, rating, notes } = req.body;

    const application = await prisma.jobApplication.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
    });

    if (!application) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    const updated = await prisma.jobApplication.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(interviewDate !== undefined && { interviewDate: interviewDate ? new Date(interviewDate) : null }),
        ...(interviewNotes !== undefined && { interviewNotes }),
        ...(rating !== undefined && { rating }),
        ...(notes !== undefined && { notes }),
      },
      include: {
        jobPosting: {
          select: {
            id: true,
            title: true,
          },
        },
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
    console.error('Error updating application:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

