-- CreateTable (Bundle and BundleModule - may be missing from DB created by old migrations)
CREATE TABLE IF NOT EXISTS "Bundle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "billingPeriod" TEXT NOT NULL DEFAULT 'monthly',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "discountPercentage" INTEGER,
    "maxUsers" INTEGER,
    "maxEmployees" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BundleModule" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BundleModule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent: CREATE INDEX IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "BundleModule_bundleId_idx" ON "BundleModule"("bundleId");
CREATE INDEX IF NOT EXISTS "BundleModule_moduleId_idx" ON "BundleModule"("moduleId");
CREATE UNIQUE INDEX IF NOT EXISTS "BundleModule_bundleId_moduleId_key" ON "BundleModule"("bundleId", "moduleId");

-- AddForeignKey (only if not exists - check and add)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BundleModule_bundleId_fkey'
    ) THEN
        ALTER TABLE "BundleModule" ADD CONSTRAINT "BundleModule_bundleId_fkey" 
        FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BundleModule_moduleId_fkey'
    ) THEN
        ALTER TABLE "BundleModule" ADD CONSTRAINT "BundleModule_moduleId_fkey" 
        FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
