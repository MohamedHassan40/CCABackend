-- CreateTable
CREATE TABLE "ProjectStakeholder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT,
    "role" TEXT,
    "type" TEXT NOT NULL DEFAULT 'internal',
    "influence" TEXT NOT NULL DEFAULT 'medium',
    "interest" TEXT NOT NULL DEFAULT 'medium',
    "engagementStrategy" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectStakeholder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCharter" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "objectives" TEXT,
    "scope" TEXT,
    "outOfScope" TEXT,
    "assumptions" TEXT,
    "constraints" TEXT,
    "successCriteria" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'draft',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCharter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectStakeholder_projectId_idx" ON "ProjectStakeholder"("projectId");
CREATE INDEX "ProjectStakeholder_type_idx" ON "ProjectStakeholder"("type");
CREATE UNIQUE INDEX "ProjectCharter_projectId_key" ON "ProjectCharter"("projectId");
CREATE INDEX "ProjectCharter_projectId_idx" ON "ProjectCharter"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectStakeholder" ADD CONSTRAINT "ProjectStakeholder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectCharter" ADD CONSTRAINT "ProjectCharter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
