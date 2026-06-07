-- Deliverable quantity and cost fields for budget allocation
ALTER TABLE "Deliverable" ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Deliverable" ADD COLUMN IF NOT EXISTS "unitCostCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Deliverable" ADD COLUMN IF NOT EXISTS "totalCostCents" INTEGER NOT NULL DEFAULT 0;
