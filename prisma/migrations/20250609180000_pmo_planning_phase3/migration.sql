-- AlterTable Deliverable (WBS)
ALTER TABLE "Deliverable" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Deliverable" ADD COLUMN "wbsCode" TEXT;
ALTER TABLE "Deliverable" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Deliverable" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "Deliverable" ADD COLUMN "estimatedHours" INTEGER;

-- AlterTable ProjectTask (dependencies + schedule)
ALTER TABLE "ProjectTask" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN "predecessorTaskId" TEXT;
ALTER TABLE "ProjectTask" ADD COLUMN "dependencyType" TEXT DEFAULT 'FS';

-- CreateTable ProjectRaciEntry
CREATE TABLE "ProjectRaciEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityKey" TEXT NOT NULL,
    "deliverableId" TEXT,
    "activityName" TEXT,
    "personId" TEXT NOT NULL,
    "personType" TEXT NOT NULL,
    "raciRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRaciEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable ProjectPlan
CREATE TABLE "ProjectPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "planType" TEXT NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deliverable_parentId_idx" ON "Deliverable"("parentId");
CREATE INDEX "Deliverable_sortOrder_idx" ON "Deliverable"("sortOrder");
CREATE INDEX "ProjectTask_predecessorTaskId_idx" ON "ProjectTask"("predecessorTaskId");
CREATE UNIQUE INDEX "ProjectRaciEntry_projectId_activityKey_personId_personType_raciRole_key" ON "ProjectRaciEntry"("projectId", "activityKey", "personId", "personType", "raciRole");
CREATE INDEX "ProjectRaciEntry_projectId_idx" ON "ProjectRaciEntry"("projectId");
CREATE INDEX "ProjectRaciEntry_deliverableId_idx" ON "ProjectRaciEntry"("deliverableId");
CREATE INDEX "ProjectPlan_projectId_idx" ON "ProjectPlan"("projectId");
CREATE INDEX "ProjectPlan_planType_idx" ON "ProjectPlan"("planType");

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_predecessorTaskId_fkey" FOREIGN KEY ("predecessorTaskId") REFERENCES "ProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectRaciEntry" ADD CONSTRAINT "ProjectRaciEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectRaciEntry" ADD CONSTRAINT "ProjectRaciEntry_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectPlan" ADD CONSTRAINT "ProjectPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
