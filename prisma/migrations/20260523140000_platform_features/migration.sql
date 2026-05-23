-- Magic link login tokens
CREATE TABLE IF NOT EXISTS "MagicLoginToken" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orgId" TEXT,
  "redirectPath" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MagicLoginToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MagicLoginToken_token_key" ON "MagicLoginToken"("token");
CREATE INDEX IF NOT EXISTS "MagicLoginToken_userId_idx" ON "MagicLoginToken"("userId");
CREATE INDEX IF NOT EXISTS "MagicLoginToken_expiresAt_idx" ON "MagicLoginToken"("expiresAt");

ALTER TABLE "MagicLoginToken" ADD CONSTRAINT "MagicLoginToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MagicLoginToken" ADD CONSTRAINT "MagicLoginToken_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Org-scoped email branding (JSON per module)
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "emailBranding" JSONB;

-- PMO client portal share token
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "portalToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Project_portalToken_key" ON "Project"("portalToken");
