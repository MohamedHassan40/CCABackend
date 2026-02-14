-- Delete the specific failed migration
DELETE FROM "_prisma_migrations" WHERE migration_name = '20250212000002_ensure_all_hr_fields';

-- Also delete any other failed migrations (finished_at IS NULL)
DELETE FROM "_prisma_migrations" WHERE finished_at IS NULL;

