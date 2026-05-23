import { sendEmailQueued, emailTemplates } from '../email';

function baseUrl(): string {
  return (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function memberPortalUrl(orgSlug: string): string {
  return `${baseUrl()}/membership/${orgSlug}/account`;
}

export function memberTrackUrl(orgSlug: string, membershipId: string, email: string): string {
  const qs = new URLSearchParams({ membershipId, email });
  return `${baseUrl()}/membership/${orgSlug}/track?${qs.toString()}`;
}

export function memberPayUrl(orgSlug: string, membershipId: string, email: string): string {
  const qs = new URLSearchParams({ membershipId, email });
  return `${baseUrl()}/membership/${orgSlug}/pay?${qs.toString()}`;
}

export async function sendMembershipRegisteredEmail(params: {
  to: string;
  memberName: string;
  orgName: string;
  orgSlug: string;
  membershipTypeName: string;
  membershipNumber: string;
  membershipId: string;
  requiresPayment: boolean;
}): Promise<void> {
  const tpl = emailTemplates.membershipRegistered(
    params.memberName,
    params.orgName,
    params.membershipTypeName,
    params.membershipNumber,
    memberTrackUrl(params.orgSlug, params.membershipId, params.to),
    memberPortalUrl(params.orgSlug),
    params.requiresPayment
  );
  await sendEmailQueued({
    to: params.to,
    subject: tpl.subject,
    html: tpl.html,
    priority: 'high',
  });
}

export async function sendMembershipPaymentConfirmedEmail(params: {
  to: string;
  memberName: string;
  orgName: string;
  orgSlug: string;
  membershipTypeName: string;
  endDate: Date;
}): Promise<void> {
  const validUntil = params.endDate.toISOString().slice(0, 10);
  const tpl = emailTemplates.membershipPaymentConfirmed(
    params.memberName,
    params.orgName,
    params.membershipTypeName,
    validUntil,
    memberPortalUrl(params.orgSlug)
  );
  await sendEmailQueued({
    to: params.to,
    subject: tpl.subject,
    html: tpl.html,
    priority: 'high',
  });
}

export async function sendMembershipExpiringEmail(params: {
  to: string;
  memberName: string;
  orgName: string;
  orgSlug: string;
  daysRemaining: number;
  endDate: Date;
}): Promise<void> {
  const end = params.endDate.toISOString().slice(0, 10);
  const tpl = emailTemplates.membershipExpiringSoon(
    params.memberName,
    params.orgName,
    params.daysRemaining,
    end,
    memberPortalUrl(params.orgSlug)
  );
  await sendEmailQueued({
    to: params.to,
    subject: tpl.subject,
    html: tpl.html,
    priority: 'normal',
  });
}

export async function sendMembershipExpiredEmail(params: {
  to: string;
  memberName: string;
  orgName: string;
  orgSlug: string;
}): Promise<void> {
  const tpl = emailTemplates.membershipExpired(
    params.memberName,
    params.orgName,
    memberPortalUrl(params.orgSlug)
  );
  await sendEmailQueued({
    to: params.to,
    subject: tpl.subject,
    html: tpl.html,
    priority: 'normal',
  });
}
