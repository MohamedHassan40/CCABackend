#!/usr/bin/env node
/**
 * Force delete failed migrations using direct PostgreSQL connection
 * This runs BEFORE Prisma Client generation and doesn't depend on Prisma
 */

const { Client } = require('pg');

async function forceDeleteFailedMigrations() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable not set');
    process.exit(0);
  }

  console.log('Connecting to database...');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // First, check what failed migrations exist
    const checkResult = await client.query(
      `SELECT migration_name, started_at, finished_at FROM "_prisma_migrations" WHERE finished_at IS NULL`
    );
    console.log(`Found ${checkResult.rows.length} failed migration(s):`, checkResult.rows.map(r => r.migration_name));

    // Delete all failed migrations (finished_at IS NULL)
    const result = await client.query(
      `DELETE FROM "_prisma_migrations" WHERE finished_at IS NULL`
    );
    console.log(`✅ Deleted ${result.rowCount} failed migration record(s)`);

    // Verify cleanup
    const remaining = await client.query(
      `SELECT migration_name, started_at FROM "_prisma_migrations" WHERE finished_at IS NULL`
    );
    
    if (remaining.rows.length === 0) {
      console.log('✅ All failed migrations deleted successfully!');
    } else {
      console.log(`⚠️  Still ${remaining.rows.length} failed migration(s) remaining:`, remaining.rows.map(r => r.migration_name));
    }

    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error deleting failed migrations:', error.message);
    console.error('Stack:', error.stack);
    try {
      await client.end();
    } catch (e) {
      // Ignore
    }
    // Don't exit with error - let the migration process continue
    process.exit(0);
  }
}

forceDeleteFailedMigrations();

