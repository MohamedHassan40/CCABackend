-- AlterTable
ALTER TABLE "File" ADD COLUMN     "inventoryItemId" TEXT;

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "categoryId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER,
    "maxQuantity" INTEGER,
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "location" TEXT,
    "supplier" TEXT,
    "condition" TEXT NOT NULL DEFAULT 'new',
    "status" TEXT NOT NULL DEFAULT 'available',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCategory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAssignment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "assignedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedReturnDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReturn" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "returnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnReason" TEXT,
    "condition" TEXT NOT NULL DEFAULT 'good',
    "notes" TEXT,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryDamage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "employeeId" TEXT,
    "assignmentId" TEXT,
    "damageDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "damageType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'minor',
    "description" TEXT,
    "estimatedRepairCostCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "status" TEXT NOT NULL DEFAULT 'reported',
    "reportedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryDamage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySwap" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fromItemId" TEXT NOT NULL,
    "toItemId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromAssignmentId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "swapDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySwap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_orgId_idx" ON "InventoryItem"("orgId");

-- CreateIndex
CREATE INDEX "InventoryItem_categoryId_idx" ON "InventoryItem"("categoryId");

-- CreateIndex
CREATE INDEX "InventoryItem_status_idx" ON "InventoryItem"("status");

-- CreateIndex
CREATE INDEX "InventoryItem_sku_idx" ON "InventoryItem"("sku");

-- CreateIndex
CREATE INDEX "InventoryCategory_orgId_idx" ON "InventoryCategory"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCategory_orgId_name_key" ON "InventoryCategory"("orgId", "name");

-- CreateIndex
CREATE INDEX "InventoryAssignment_orgId_idx" ON "InventoryAssignment"("orgId");

-- CreateIndex
CREATE INDEX "InventoryAssignment_itemId_idx" ON "InventoryAssignment"("itemId");

-- CreateIndex
CREATE INDEX "InventoryAssignment_employeeId_idx" ON "InventoryAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "InventoryAssignment_status_idx" ON "InventoryAssignment"("status");

-- CreateIndex
CREATE INDEX "InventoryAssignment_assignedDate_idx" ON "InventoryAssignment"("assignedDate");

-- CreateIndex
CREATE INDEX "InventoryReturn_orgId_idx" ON "InventoryReturn"("orgId");

-- CreateIndex
CREATE INDEX "InventoryReturn_assignmentId_idx" ON "InventoryReturn"("assignmentId");

-- CreateIndex
CREATE INDEX "InventoryReturn_itemId_idx" ON "InventoryReturn"("itemId");

-- CreateIndex
CREATE INDEX "InventoryReturn_employeeId_idx" ON "InventoryReturn"("employeeId");

-- CreateIndex
CREATE INDEX "InventoryReturn_returnDate_idx" ON "InventoryReturn"("returnDate");

-- CreateIndex
CREATE INDEX "InventoryDamage_orgId_idx" ON "InventoryDamage"("orgId");

-- CreateIndex
CREATE INDEX "InventoryDamage_itemId_idx" ON "InventoryDamage"("itemId");

-- CreateIndex
CREATE INDEX "InventoryDamage_employeeId_idx" ON "InventoryDamage"("employeeId");

-- CreateIndex
CREATE INDEX "InventoryDamage_status_idx" ON "InventoryDamage"("status");

-- CreateIndex
CREATE INDEX "InventoryDamage_damageDate_idx" ON "InventoryDamage"("damageDate");

-- CreateIndex
CREATE INDEX "InventorySwap_orgId_idx" ON "InventorySwap"("orgId");

-- CreateIndex
CREATE INDEX "InventorySwap_fromItemId_idx" ON "InventorySwap"("fromItemId");

-- CreateIndex
CREATE INDEX "InventorySwap_toItemId_idx" ON "InventorySwap"("toItemId");

-- CreateIndex
CREATE INDEX "InventorySwap_employeeId_idx" ON "InventorySwap"("employeeId");

-- CreateIndex
CREATE INDEX "InventorySwap_status_idx" ON "InventorySwap"("status");

-- CreateIndex
CREATE INDEX "InventorySwap_swapDate_idx" ON "InventorySwap"("swapDate");

-- CreateIndex
CREATE INDEX "File_inventoryItemId_idx" ON "File"("inventoryItemId");

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InventoryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCategory" ADD CONSTRAINT "InventoryCategory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReturn" ADD CONSTRAINT "InventoryReturn_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReturn" ADD CONSTRAINT "InventoryReturn_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "InventoryAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReturn" ADD CONSTRAINT "InventoryReturn_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReturn" ADD CONSTRAINT "InventoryReturn_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReturn" ADD CONSTRAINT "InventoryReturn_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDamage" ADD CONSTRAINT "InventoryDamage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDamage" ADD CONSTRAINT "InventoryDamage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDamage" ADD CONSTRAINT "InventoryDamage_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDamage" ADD CONSTRAINT "InventoryDamage_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "InventoryAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDamage" ADD CONSTRAINT "InventoryDamage_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDamage" ADD CONSTRAINT "InventoryDamage_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySwap" ADD CONSTRAINT "InventorySwap_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySwap" ADD CONSTRAINT "InventorySwap_fromItemId_fkey" FOREIGN KEY ("fromItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySwap" ADD CONSTRAINT "InventorySwap_toItemId_fkey" FOREIGN KEY ("toItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySwap" ADD CONSTRAINT "InventorySwap_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySwap" ADD CONSTRAINT "InventorySwap_fromAssignmentId_fkey" FOREIGN KEY ("fromAssignmentId") REFERENCES "InventoryAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySwap" ADD CONSTRAINT "InventorySwap_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySwap" ADD CONSTRAINT "InventorySwap_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
