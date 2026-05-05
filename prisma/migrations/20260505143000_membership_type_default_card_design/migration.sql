-- AlterTable
ALTER TABLE "MembershipType" ADD COLUMN "cardDesignId" TEXT;

-- CreateIndex
CREATE INDEX "MembershipType_cardDesignId_idx" ON "MembershipType"("cardDesignId");

-- AddForeignKey
ALTER TABLE "MembershipType" ADD CONSTRAINT "MembershipType_cardDesignId_fkey" FOREIGN KEY ("cardDesignId") REFERENCES "MembershipCardDesign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
