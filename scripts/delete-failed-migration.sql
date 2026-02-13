-- Delete the failed migration record from Prisma's migration table
-- This allows Prisma to proceed with new migrations

DELETE FROM "_prisma_migrations"
WHERE migration_name = '20250212000002_ensure_all_hr_fields';

-- Verify deletion
SELECT migration_name, finished_at 
FROM "_prisma_migrations" 
WHERE migration_name = '20250212000002_ensure_all_hr_fields';

