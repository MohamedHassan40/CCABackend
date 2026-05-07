-- Org-wide membership number scheme + per-membership sequence

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "membershipNumberPrefix" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "membershipNumberPadLength" INTEGER DEFAULT 5;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "membershipNumberNextSeq" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "MemberMembership" ADD COLUMN IF NOT EXISTS "membershipSeq" INTEGER;

-- Assign sequential numbers per organization (existing rows)
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "orgId" ORDER BY "createdAt" ASC) AS rn
  FROM "MemberMembership"
)
UPDATE "MemberMembership" m
SET "membershipSeq" = numbered.rn
FROM numbered
WHERE m.id = numbered.id;

ALTER TABLE "MemberMembership" ALTER COLUMN "membershipSeq" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "MemberMembership_orgId_membershipSeq_idx" ON "MemberMembership"("orgId", "membershipSeq");

-- Next seq = max(seq)+1 per org (organizations with no members keep default 1)
UPDATE "Organization" o
SET "membershipNumberNextSeq" = COALESCE(
  (SELECT MAX(mm."membershipSeq") + 1 FROM "MemberMembership" mm WHERE mm."orgId" = o.id),
  1
);
