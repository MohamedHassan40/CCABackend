-- AlterTable: add missing Organization columns (from old partial migrations)
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "maxEmployees" INTEGER;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "currentBundleId" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "storefrontSettings" JSONB;

-- AddForeignKey for currentBundleId (only if not exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Organization_currentBundleId_fkey') THEN
        ALTER TABLE "Organization" ADD CONSTRAINT "Organization_currentBundleId_fkey" 
        FOREIGN KEY ("currentBundleId") REFERENCES "Bundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateIndex for currentBundleId (only if not exists)
CREATE INDEX IF NOT EXISTS "Organization_currentBundleId_idx" ON "Organization"("currentBundleId");
