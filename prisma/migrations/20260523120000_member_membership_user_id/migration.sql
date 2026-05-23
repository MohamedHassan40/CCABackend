-- Link member records to user accounts for member portal login
ALTER TABLE "MemberMembership" ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "MemberMembership_userId_idx" ON "MemberMembership"("userId");

ALTER TABLE "MemberMembership" ADD CONSTRAINT "MemberMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
