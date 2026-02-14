-- Delete all failed migrations (finished_at IS NULL)
DELETE FROM "_prisma_migrations" WHERE finished_at IS NULL;

