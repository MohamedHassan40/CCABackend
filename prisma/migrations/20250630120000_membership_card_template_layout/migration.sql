-- AlterTable
ALTER TABLE "MembershipCardDesign" ADD COLUMN "templateUrl" TEXT,
ADD COLUMN "templateWidth" INTEGER DEFAULT 856,
ADD COLUMN "templateHeight" INTEGER DEFAULT 540,
ADD COLUMN "elementLayout" JSONB;
