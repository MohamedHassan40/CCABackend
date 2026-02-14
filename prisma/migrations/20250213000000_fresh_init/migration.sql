-- This is a fresh migration that matches the current schema state
-- Since we're using db push, this migration is essentially a no-op
-- It exists only to satisfy Prisma's migration system

-- The actual schema is managed via db push, not migrations
-- This file ensures migrate deploy doesn't fail

SELECT 1;

