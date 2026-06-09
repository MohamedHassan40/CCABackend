-- CreateTable EmployeeComplaint
CREATE TABLE "EmployeeComplaint" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeComplaint_pkey" PRIMARY KEY ("id")
);

-- AlterTable File (complaint attachments)
ALTER TABLE "File" ADD COLUMN "employeeComplaintId" TEXT;

-- CreateIndex
CREATE INDEX "EmployeeComplaint_orgId_idx" ON "EmployeeComplaint"("orgId");
CREATE INDEX "EmployeeComplaint_employeeId_idx" ON "EmployeeComplaint"("employeeId");
CREATE INDEX "EmployeeComplaint_status_idx" ON "EmployeeComplaint"("status");
CREATE INDEX "EmployeeComplaint_priority_idx" ON "EmployeeComplaint"("priority");
CREATE INDEX "File_employeeComplaintId_idx" ON "File"("employeeComplaintId");

-- AddForeignKey
ALTER TABLE "EmployeeComplaint" ADD CONSTRAINT "EmployeeComplaint_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeComplaint" ADD CONSTRAINT "EmployeeComplaint_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeComplaint" ADD CONSTRAINT "EmployeeComplaint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeComplaint" ADD CONSTRAINT "EmployeeComplaint_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "File" ADD CONSTRAINT "File_employeeComplaintId_fkey" FOREIGN KEY ("employeeComplaintId") REFERENCES "EmployeeComplaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
