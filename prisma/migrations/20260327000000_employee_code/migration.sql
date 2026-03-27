-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "employeeCodePrefix" TEXT,
ADD COLUMN     "employeeCodePadLength" INTEGER,
ADD COLUMN     "employeeCodeNextSeq" INTEGER;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "employeeCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Employee_orgId_employeeCode_key" ON "Employee"("orgId", "employeeCode");
