-- CreateTable
CREATE TABLE "ProjectClientContact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectClientContact_projectId_idx" ON "ProjectClientContact"("projectId");
CREATE INDEX "ProjectClientContact_company_idx" ON "ProjectClientContact"("company");

-- AddForeignKey
ALTER TABLE "ProjectClientContact" ADD CONSTRAINT "ProjectClientContact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
