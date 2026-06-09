-- CreateTable ProjectProposal
CREATE TABLE "ProjectProposal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "problemStatement" TEXT,
    "objectives" TEXT,
    "budgetEstimateCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "logicalFramework" JSONB,
    "problemTree" JSONB,
    "dataCollectionPlan" JSONB,
    "projectId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable ProjectLessonLearned
CREATE TABLE "ProjectLessonLearned" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT NOT NULL,
    "recommendation" TEXT,
    "authorName" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectLessonLearned_pkey" PRIMARY KEY ("id")
);

-- CreateTable ProjectClosure
CREATE TABLE "ProjectClosure" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "closureStatus" TEXT NOT NULL DEFAULT 'in_progress',
    "finalReport" TEXT,
    "lessonsSummary" TEXT,
    "certificateNumber" TEXT,
    "certificateGeneratedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "checklist" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectProposal_projectId_key" ON "ProjectProposal"("projectId");
CREATE INDEX "ProjectProposal_orgId_idx" ON "ProjectProposal"("orgId");
CREATE INDEX "ProjectProposal_status_idx" ON "ProjectProposal"("status");
CREATE INDEX "ProjectLessonLearned_projectId_idx" ON "ProjectLessonLearned"("projectId");
CREATE INDEX "ProjectLessonLearned_category_idx" ON "ProjectLessonLearned"("category");
CREATE UNIQUE INDEX "ProjectClosure_projectId_key" ON "ProjectClosure"("projectId");
CREATE INDEX "ProjectClosure_closureStatus_idx" ON "ProjectClosure"("closureStatus");

-- AddForeignKey
ALTER TABLE "ProjectProposal" ADD CONSTRAINT "ProjectProposal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectProposal" ADD CONSTRAINT "ProjectProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectLessonLearned" ADD CONSTRAINT "ProjectLessonLearned_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectClosure" ADD CONSTRAINT "ProjectClosure_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
