import prisma from '../../core/db';
import {
  createNotification,
  createNotificationForOrgWithPermission,
  getOrgUserEmailsWithPermission,
  getOrgUserIdsWithPermission,
} from '../../core/notifications/helper';
import { emailTemplates } from '../../core/email/templates';
import { sendEmailQueued } from '../../core/email';
import { getOrgEmailBrand } from '../../core/auth/magicLink';
import type { PmoPhase } from './lifecycle-config';

const FE = () => (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '');

function projectLink(projectId: string): string {
  return `/dashboard/pmo/projects/${projectId}`;
}

async function emailProjectStakeholders(
  orgId: string,
  projectId: string,
  subject: string,
  html: string,
  permissionKey = 'pmo.projects.view',
): Promise<void> {
  const emails = await getOrgUserEmailsWithPermission(orgId, permissionKey);
  const managers = await prisma.projectManager.findMany({
    where: { projectId },
    include: { employee: { select: { email: true } } },
  });
  const all = new Set(emails);
  for (const m of managers) {
    if (m.employee.email) all.add(m.employee.email);
  }
  for (const to of all) {
    await sendEmailQueued({ to, subject, html, priority: 'normal' }).catch(() => {});
  }
}

export async function notifyGateReadyForApproval(
  orgId: string,
  projectId: string,
  projectName: string,
  phase: PmoPhase,
): Promise<void> {
  const link = projectLink(projectId);
  const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);
  await createNotificationForOrgWithPermission(orgId, 'pmo.projects.edit', {
    type: 'info',
    title: 'Phase gate ready for approval',
    message: `${projectName}: ${phaseLabel} phase requirements are complete. Sign-off required.`,
    link,
  });

  const brand = await getOrgEmailBrand(orgId, 'pmo');
  const tpl = emailTemplates.pmoGateReady(projectName, phaseLabel, `${FE()}${link}`, brand);
  await emailProjectStakeholders(orgId, projectId, tpl.subject, tpl.html, 'pmo.projects.edit');
}

export async function notifyGateSignoff(
  orgId: string,
  projectId: string,
  projectName: string,
  phase: PmoPhase,
  role: string,
  signerName: string,
  fullyApproved: boolean,
): Promise<void> {
  const link = projectLink(projectId);
  const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);
  const title = fullyApproved ? 'Phase gate approved' : 'Phase gate sign-off received';
  const message = fullyApproved
    ? `${projectName}: ${phaseLabel} phase fully approved. Project advanced to next phase.`
    : `${projectName}: ${signerName} signed off as ${role} for ${phaseLabel} phase.`;

  await createNotificationForOrgWithPermission(orgId, 'pmo.projects.view', {
    type: fullyApproved ? 'success' : 'info',
    title,
    message,
    link,
  });

  const brand = await getOrgEmailBrand(orgId, 'pmo');
  const tpl = emailTemplates.pmoGateSignoff(projectName, phaseLabel, role, signerName, fullyApproved, `${FE()}${link}`, brand);
  await emailProjectStakeholders(orgId, projectId, tpl.subject, tpl.html);
}

export async function notifyGateBlocked(
  orgId: string,
  projectId: string,
  projectName: string,
  phase: PmoPhase,
  actorName: string,
): Promise<void> {
  const link = projectLink(projectId);
  const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);
  await createNotificationForOrgWithPermission(orgId, 'pmo.projects.edit', {
    type: 'warning',
    title: 'Phase gate approval blocked',
    message: `${actorName} attempted to approve ${phaseLabel} gate for ${projectName}, but mandatory requirements are incomplete.`,
    link,
  });
}

export async function notifyChangeRequestSubmitted(
  orgId: string,
  projectId: string,
  projectName: string,
  title: string,
  requesterName: string,
): Promise<void> {
  const link = `${projectLink(projectId)}?tab=changeRequests`;
  await createNotificationForOrgWithPermission(orgId, 'pmo.projects.edit', {
    type: 'info',
    title: 'New change request',
    message: `${requesterName} submitted "${title}" on ${projectName}. Sponsor review required.`,
    link,
  });

  const managerUserIds = await getProjectManagerUserIds(projectId);
  for (const userId of managerUserIds) {
    await createNotification({
      userId,
      organizationId: orgId,
      type: 'info',
      title: 'Change request needs sponsor approval',
      message: `"${title}" on ${projectName}`,
      link,
    });
  }

  const brand = await getOrgEmailBrand(orgId, 'pmo');
  const tpl = emailTemplates.pmoChangeRequest(projectName, title, 'submitted', requesterName, `${FE()}${link}`, brand);
  await emailProjectStakeholders(orgId, projectId, tpl.subject, tpl.html, 'pmo.projects.edit');
}

export async function notifyChangeRequestDecision(
  orgId: string,
  projectId: string,
  projectName: string,
  title: string,
  status: 'sponsor_approved' | 'approved' | 'rejected',
  actorName: string,
  requesterId?: string | null,
): Promise<void> {
  const link = `${projectLink(projectId)}?tab=changeRequests`;
  const labels: Record<string, string> = {
    sponsor_approved: 'Sponsor approved — awaiting PMO approval',
    approved: 'Change request approved',
    rejected: 'Change request rejected',
  };

  await createNotificationForOrgWithPermission(orgId, 'pmo.projects.view', {
    type: status === 'rejected' ? 'warning' : status === 'approved' ? 'success' : 'info',
    title: labels[status] ?? 'Change request updated',
    message: `"${title}" on ${projectName} — ${actorName}`,
    link,
  });

  if (requesterId) {
    await createNotification({
      userId: requesterId,
      organizationId: orgId,
      type: status === 'rejected' ? 'warning' : 'success',
      title: labels[status] ?? 'Change request updated',
      message: `"${title}" on ${projectName}`,
      link,
    });
  }

  const brand = await getOrgEmailBrand(orgId, 'pmo');
  const tpl = emailTemplates.pmoChangeRequest(projectName, title, status, actorName, `${FE()}${link}`, brand);
  await emailProjectStakeholders(orgId, projectId, tpl.subject, tpl.html);
}

async function getProjectManagerUserIds(projectId: string): Promise<string[]> {
  const managers = await prisma.projectManager.findMany({
    where: { projectId },
    include: { employee: { select: { userId: true } } },
  });
  return managers.map((m) => m.employee.userId).filter(Boolean) as string[];
}

export async function isUserProjectSponsor(userId: string, projectId: string): Promise<boolean> {
  const count = await prisma.projectManager.count({
    where: { projectId, employee: { userId } },
  });
  return count > 0;
}
