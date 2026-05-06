-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailOtpCode" TEXT,
ADD COLUMN "emailOtpExpiresAt" TIMESTAMP(3);
