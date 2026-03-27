-- CreateTable
CREATE TABLE "ProjectClient" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectClient_pkey" PRIMARY KEY ("id")
);

-- Add projectClientId to ClientProjectManager
ALTER TABLE "ClientProjectManager" ADD COLUMN "projectClientId" TEXT;

-- Add projectClientId to ProjectClientContact
ALTER TABLE "ProjectClientContact" ADD COLUMN "projectClientId" TEXT;

-- CreateIndex
CREATE INDEX "ProjectClient_projectId_idx" ON "ProjectClient"("projectId");

-- CreateIndex
CREATE INDEX "ClientProjectManager_projectClientId_idx" ON "ClientProjectManager"("projectClientId");

-- CreateIndex
CREATE INDEX "ProjectClientContact_projectClientId_idx" ON "ProjectClientContact"("projectClientId");

-- AddForeignKey
ALTER TABLE "ProjectClient" ADD CONSTRAINT "ProjectClient_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProjectManager" ADD CONSTRAINT "ClientProjectManager_projectClientId_fkey" FOREIGN KEY ("projectClientId") REFERENCES "ProjectClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectClientContact" ADD CONSTRAINT "ProjectClientContact_projectClientId_fkey" FOREIGN KEY ("projectClientId") REFERENCES "ProjectClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
