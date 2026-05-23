import crypto from 'crypto';
import prisma from '../db';

export type EmailBrandModule = 'default' | 'membership' | 'ticketing' | 'pmo' | 'hr';

export interface EmailBrandConfig {
  name?: string;
  tagline?: string;
  primaryColor?: string;
  logoUrl?: string;
}

export async function getOrgEmailBrand(
  orgId: string | null | undefined,
  module: EmailBrandModule = 'default'
): Promise<EmailBrandConfig | null> {
  if (!orgId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, emailBranding: true },
  });
  if (!org) return null;

  const raw = org.emailBranding;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { name: org.name };
  }
  const branding = raw as Record<string, EmailBrandConfig>;
  const specific = branding[module] ?? branding.default;
  if (!specific && org.name) return { name: org.name };
  return {
    name: specific?.name ?? org.name,
    tagline: specific?.tagline,
    primaryColor: specific?.primaryColor,
    logoUrl: specific?.logoUrl,
  };
}

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export async function createMagicLoginToken(params: {
  userId: string;
  orgId?: string | null;
  redirectPath?: string | null;
}): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
  await prisma.magicLoginToken.create({
    data: {
      token,
      userId: params.userId,
      orgId: params.orgId ?? null,
      redirectPath: params.redirectPath ?? null,
      expiresAt,
    },
  });
  return token;
}

export async function consumeMagicLoginToken(token: string): Promise<{
  userId: string;
  orgId: string | null;
  redirectPath: string | null;
} | null> {
  const row = await prisma.magicLoginToken.findUnique({ where: { token } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  await prisma.magicLoginToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  return {
    userId: row.userId,
    orgId: row.orgId,
    redirectPath: row.redirectPath,
  };
}

export function magicLinkUrl(token: string): string {
  const base = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(
    /\/$/,
    ''
  );
  return `${base}/auth/magic?token=${encodeURIComponent(token)}`;
}
