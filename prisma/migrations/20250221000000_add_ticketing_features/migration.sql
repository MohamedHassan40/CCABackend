-- AlterTable: Add new columns to Ticket
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "responseDueAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "resolveBy" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "slaPausedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "firstResponseAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "parentTicketId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;

-- CreateTable TicketTimeEntry
CREATE TABLE IF NOT EXISTS "TicketTimeEntry" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable TicketHistory
CREATE TABLE IF NOT EXISTS "TicketHistory" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "fieldName" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable TicketTemplate
CREATE TABLE IF NOT EXISTS "TicketTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable CannedReply
CREATE TABLE IF NOT EXISTS "CannedReply" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "shortcut" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CannedReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ticket_parentTicketId_idx" ON "Ticket"("parentTicketId");
CREATE INDEX IF NOT EXISTS "Ticket_mergedIntoId_idx" ON "Ticket"("mergedIntoId");
CREATE INDEX IF NOT EXISTS "Ticket_dueDate_idx" ON "Ticket"("dueDate");
CREATE INDEX IF NOT EXISTS "Ticket_resolveBy_idx" ON "Ticket"("resolveBy");
CREATE INDEX IF NOT EXISTS "TicketTimeEntry_ticketId_idx" ON "TicketTimeEntry"("ticketId");
CREATE INDEX IF NOT EXISTS "TicketTimeEntry_userId_idx" ON "TicketTimeEntry"("userId");
CREATE INDEX IF NOT EXISTS "TicketHistory_ticketId_idx" ON "TicketHistory"("ticketId");
CREATE INDEX IF NOT EXISTS "TicketHistory_userId_idx" ON "TicketHistory"("userId");
CREATE INDEX IF NOT EXISTS "TicketHistory_createdAt_idx" ON "TicketHistory"("createdAt");
CREATE INDEX IF NOT EXISTS "TicketTemplate_orgId_idx" ON "TicketTemplate"("orgId");
CREATE INDEX IF NOT EXISTS "CannedReply_orgId_idx" ON "CannedReply"("orgId");

-- AddForeignKey (run only if not exists - Prisma may have already added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_parentTicketId_fkey'
  ) THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_parentTicketId_fkey"
      FOREIGN KEY ("parentTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_mergedIntoId_fkey'
  ) THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_mergedIntoId_fkey"
      FOREIGN KEY ("mergedIntoId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TicketTimeEntry_ticketId_fkey'
  ) THEN
    ALTER TABLE "TicketTimeEntry" ADD CONSTRAINT "TicketTimeEntry_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TicketTimeEntry_userId_fkey'
  ) THEN
    ALTER TABLE "TicketTimeEntry" ADD CONSTRAINT "TicketTimeEntry_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TicketHistory_ticketId_fkey'
  ) THEN
    ALTER TABLE "TicketHistory" ADD CONSTRAINT "TicketHistory_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TicketHistory_userId_fkey'
  ) THEN
    ALTER TABLE "TicketHistory" ADD CONSTRAINT "TicketHistory_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TicketTemplate_orgId_fkey'
  ) THEN
    ALTER TABLE "TicketTemplate" ADD CONSTRAINT "TicketTemplate_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TicketTemplate_categoryId_fkey'
  ) THEN
    ALTER TABLE "TicketTemplate" ADD CONSTRAINT "TicketTemplate_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CannedReply_orgId_fkey'
  ) THEN
    ALTER TABLE "CannedReply" ADD CONSTRAINT "CannedReply_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
