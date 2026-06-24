-- PMO lifecycle phases, design data, change requests, org settings
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "pmoSettings" JSONB;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "lifecyclePhase" TEXT NOT NULL DEFAULT 'design';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "phaseGateChecklist" JSONB;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "phaseGateApprovals" JSONB;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "designData" JSONB;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "enabledOptionalTools" JSONB;

CREATE INDEX IF NOT EXISTS "Project_lifecyclePhase_idx" ON "Project"("lifecyclePhase");

CREATE TABLE IF NOT EXISTS "ProjectChangeRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "impact" TEXT,
    "requestedById" TEXT,
    "requestedByName" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectChangeRequest_projectId_idx" ON "ProjectChangeRequest"("projectId");
CREATE INDEX IF NOT EXISTS "ProjectChangeRequest_status_idx" ON "ProjectChangeRequest"("status");

ALTER TABLE "ProjectChangeRequest" DROP CONSTRAINT IF EXISTS "ProjectChangeRequest_projectId_fkey";
ALTER TABLE "ProjectChangeRequest" ADD CONSTRAINT "ProjectChangeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
