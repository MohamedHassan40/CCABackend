-- AlterTable Organization: add maxEmployees and currentBundleId
ALTER TABLE "Organization" ADD COLUMN "maxEmployees" INTEGER;
ALTER TABLE "Organization" ADD COLUMN "currentBundleId" TEXT;

-- AlterTable Bundle: add maxUsers and maxEmployees
ALTER TABLE "Bundle" ADD COLUMN "maxUsers" INTEGER;
ALTER TABLE "Bundle" ADD COLUMN "maxEmployees" INTEGER;

-- AddForeignKey Organization.currentBundleId -> Bundle.id
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_currentBundleId_fkey" FOREIGN KEY ("currentBundleId") REFERENCES "Bundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex for currentBundleId
CREATE INDEX "Organization_currentBundleId_idx" ON "Organization"("currentBundleId");
