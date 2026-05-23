import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../core/db';
import { publicTicketRateLimiter } from '../middleware/security';

const router = Router();

function frontendUrl(): string {
  return (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '');
}

async function resolveOrg(orgSlug: string) {
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug, isActive: true },
    select: { id: true, name: true, slug: true },
  });
  if (!org) return null;
  const pmoModule = await prisma.module.findUnique({ where: { key: 'pmo' } });
  if (!pmoModule) return null;
  const orgModule = await prisma.orgModule.findUnique({
    where: { organizationId_moduleId: { organizationId: org.id, moduleId: pmoModule.id } },
  });
  if (!orgModule?.isEnabled) return null;
  return org;
}

async function emailCanAccessProject(projectId: string, email: string): Promise<boolean> {
  const em = email.trim().toLowerCase();
  const [cpm, contact] = await Promise.all([
    prisma.clientProjectManager.findFirst({
      where: { projectId, email: { equals: em, mode: 'insensitive' }, isActive: true },
    }),
    prisma.projectClientContact.findFirst({
      where: { projectId, email: { equals: em, mode: 'insensitive' } },
    }),
  ]);
  return !!(cpm || contact);
}

// GET /api/public/pmo/:orgSlug/project-status?projectId=&email=
router.get('/:orgSlug/project-status', async (req: Request, res: Response) => {
  try {
    const org = await resolveOrg(req.params.orgSlug);
    if (!org) {
      res.status(404).json({ error: 'PMO portal not available' });
      return;
    }
    const projectId = String(req.query.projectId || '').trim();
    const email = String(req.query.email || '').trim();
    if (!projectId || !email) {
      res.status(400).json({ error: 'projectId and email are required' });
      return;
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId: org.id },
      include: {
        milestones: { orderBy: { targetDate: 'asc' }, take: 20 },
        deliverables: { orderBy: { dueDate: 'asc' }, take: 20 },
        issues: { where: { status: { not: 'closed' } }, take: 10 },
      },
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!(await emailCanAccessProject(project.id, email))) {
      res.status(403).json({ error: 'Email is not authorized for this project' });
      return;
    }

    const budgetUsedPct =
      project.budgetCents && project.budgetCents > 0
        ? Math.round((project.spentCents / project.budgetCents) * 100)
        : null;

    res.json({
      organization: { name: org.name, slug: org.slug },
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        progress: project.progress,
        startDate: project.startDate,
        endDate: project.endDate,
        budgetCents: project.budgetCents,
        spentCents: project.spentCents,
        currency: project.currency,
        budgetUsedPct,
      },
      milestones: project.milestones,
      deliverables: project.deliverables,
      openIssues: project.issues,
    });
  } catch (error) {
    console.error('GET public pmo project-status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/public/pmo/:orgSlug/project-by-token?token=
router.get('/:orgSlug/project-by-token', async (req: Request, res: Response) => {
  try {
    const org = await resolveOrg(req.params.orgSlug);
    if (!org) {
      res.status(404).json({ error: 'PMO portal not available' });
      return;
    }
    const token = String(req.query.token || '').trim();
    if (!token) {
      res.status(400).json({ error: 'token is required' });
      return;
    }
    const project = await prisma.project.findFirst({
      where: { orgId: org.id, portalToken: token },
      select: { id: true, name: true, status: true, progress: true, endDate: true },
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json({ projectId: project.id, name: project.name, status: project.status });
  } catch (error) {
    console.error('GET public pmo project-by-token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export function ensureProjectPortalToken(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export default router;
