-- SQL script to manually resolve the failed migration
-- This marks the migration as rolled back so Prisma can retry it

-- First, check the current state
SELECT migration_name, finished_at, applied_steps_count, rolled_back_at 
FROM "_prisma_migrations" 
WHERE migration_name = '20250212000002_ensure_all_hr_fields';

-- Mark the migration as rolled back
-- This tells Prisma that the migration was rolled back and can be retried
UPDATE "_prisma_migrations"
SET 
    rolled_back_at = NOW(),
    finished_at = NULL,
    applied_steps_count = 0
WHERE migration_name = '20250212000002_ensure_all_hr_fields'
  AND finished_at IS NULL;

-- Verify the update
SELECT migration_name, finished_at, applied_steps_count, rolled_back_at 
FROM "_prisma_migrations" 
WHERE migration_name = '20250212000002_ensure_all_hr_fields';

