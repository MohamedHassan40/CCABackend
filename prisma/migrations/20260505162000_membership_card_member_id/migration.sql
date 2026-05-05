-- AlterTable
ALTER TABLE "MembershipCardDesign"
ADD COLUMN "showMemberId" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "memberIdPrefix" TEXT;
