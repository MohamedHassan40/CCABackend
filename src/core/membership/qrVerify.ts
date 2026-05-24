import crypto from 'crypto';
import prisma from '../db';
import { config } from '../config';

export function generateQrToken(): string {
  return crypto.randomBytes(12).toString('base64url');
}

/** Public URL embedded in membership card QR codes. */
export function buildMembershipVerifyUrl(qrToken: string): string {
  const base = config.frontendUrl.replace(/\/+$/, '');
  return `${base}/membership/verify/${encodeURIComponent(qrToken)}`;
}

/** Membership is valid through the end of its endDate calendar day (UTC). */
export function isMembershipActiveForVerification(membership: {
  status: string;
  endDate: Date;
}): boolean {
  if (membership.status !== 'active') return false;
  const end = new Date(membership.endDate);
  end.setUTCHours(23, 59, 59, 999);
  return end.getTime() >= Date.now();
}

export type MembershipVerifyReason =
  | 'active'
  | 'expired'
  | 'pending'
  | 'cancelled'
  | 'inactive';

export function membershipVerifyReason(membership: {
  status: string;
  endDate: Date;
}): MembershipVerifyReason {
  if (membership.status === 'pending') return 'pending';
  if (membership.status === 'cancelled') return 'cancelled';
  if (membership.status === 'expired') return 'expired';
  if (membership.status !== 'active') return 'inactive';
  if (!isMembershipActiveForVerification(membership)) return 'expired';
  return 'active';
}

/** Assign a stable QR token once; safe under concurrent card/QR requests. */
export async function ensureMembershipQrToken(membershipId: string): Promise<string> {
  const row = await prisma.memberMembership.findUnique({
    where: { id: membershipId },
    select: { qrToken: true },
  });
  if (!row) {
    throw new Error('Membership not found');
  }
  if (row.qrToken) return row.qrToken;

  const qrToken = generateQrToken();
  const updated = await prisma.memberMembership.updateMany({
    where: { id: membershipId, qrToken: null },
    data: { qrToken },
  });

  if (updated.count === 0) {
    const again = await prisma.memberMembership.findUnique({
      where: { id: membershipId },
      select: { qrToken: true },
    });
    if (again?.qrToken) return again.qrToken;
    throw new Error('Could not assign QR token');
  }

  return qrToken;
}
