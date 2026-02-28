-- CreateTable
CREATE TABLE "MembershipCardDesign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "layout" TEXT NOT NULL DEFAULT 'standard',
    "primaryColor" TEXT NOT NULL DEFAULT '#1e3a5f',
    "secondaryColor" TEXT NOT NULL DEFAULT '#3b82f6',
    "accentColor" TEXT,
    "logoUrl" TEXT,
    "showQR" BOOLEAN NOT NULL DEFAULT true,
    "qrPosition" TEXT NOT NULL DEFAULT 'right',
    "customCss" TEXT,
    "fontFamily" TEXT DEFAULT 'sans-serif',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipCardDesign_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "MemberMembership" ADD COLUMN "qrToken" TEXT,
ADD COLUMN "cardDesignId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MemberMembership_qrToken_key" ON "MemberMembership"("qrToken");

-- CreateIndex
CREATE INDEX "MembershipCardDesign_orgId_idx" ON "MembershipCardDesign"("orgId");

-- CreateIndex
CREATE INDEX "MembershipCardDesign_isDefault_idx" ON "MembershipCardDesign"("isDefault");

-- CreateIndex
CREATE INDEX "MemberMembership_qrToken_idx" ON "MemberMembership"("qrToken");

-- AddForeignKey
ALTER TABLE "MemberMembership" ADD CONSTRAINT "MemberMembership_cardDesignId_fkey" FOREIGN KEY ("cardDesignId") REFERENCES "MembershipCardDesign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipCardDesign" ADD CONSTRAINT "MembershipCardDesign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
