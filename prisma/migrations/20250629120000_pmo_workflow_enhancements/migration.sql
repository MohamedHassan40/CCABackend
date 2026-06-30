-- Change request workflow fields
ALTER TABLE "ProjectChangeRequest" ADD COLUMN IF NOT EXISTS "budgetImpactCents" INTEGER;
ALTER TABLE "ProjectChangeRequest" ADD COLUMN IF NOT EXISTS "scopeImpact" TEXT;
ALTER TABLE "ProjectChangeRequest" ADD COLUMN IF NOT EXISTS "scheduleImpactDays" INTEGER;
ALTER TABLE "ProjectChangeRequest" ADD COLUMN IF NOT EXISTS "sponsorApprovedAt" TIMESTAMP(3);
ALTER TABLE "ProjectChangeRequest" ADD COLUMN IF NOT EXISTS "sponsorApprovedById" TEXT;
ALTER TABLE "ProjectChangeRequest" ADD COLUMN IF NOT EXISTS "sponsorApprovedByName" TEXT;
ALTER TABLE "ProjectChangeRequest" ADD COLUMN IF NOT EXISTS "pmoApprovedAt" TIMESTAMP(3);
ALTER TABLE "ProjectChangeRequest" ADD COLUMN IF NOT EXISTS "pmoApprovedById" TEXT;
ALTER TABLE "ProjectChangeRequest" ADD COLUMN IF NOT EXISTS "pmoApprovedByName" TEXT;
