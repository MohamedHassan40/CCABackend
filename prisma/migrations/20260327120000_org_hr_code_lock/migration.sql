-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "organizationHrCode" TEXT,
ADD COLUMN     "employeeIdSchemeLocked" BOOLEAN NOT NULL DEFAULT false;
