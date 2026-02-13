#!/usr/bin/env node
/**
 * Script to fix failed Prisma migrations by directly updating the migration table
 * This bypasses Prisma's resolve command which may not work in all environments
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const KNOWN_FAILED_MIGRATION = '20250212000002_ensure_all_hr_fields';

async function fixMigration() {
  try {
    console.log(`🔍 Checking for failed migration: ${KNOWN_FAILED_MIGRATION}`);
    
    // Check current state
    const migration = await prisma.$queryRaw`
      SELECT migration_name, finished_at, applied_steps_count, rolled_back_at 
      FROM "_prisma_migrations" 
      WHERE migration_name = ${KNOWN_FAILED_MIGRATION}
    `;
    
    if (Array.isArray(migration) && migration.length > 0) {
      const mig = migration[0];
      console.log('Current state:', {
        migration_name: mig.migration_name,
        finished_at: mig.finished_at,
        applied_steps_count: mig.applied_steps_count,
        rolled_back_at: mig.rolled_back_at,
      });
      
      // Only fix if it's actually failed (finished_at is NULL)
      if (!mig.finished_at) {
        console.log('⚠️  Migration is in failed state. Fixing...');
        
        await prisma.$executeRaw`
          UPDATE "_prisma_migrations"
          SET 
              rolled_back_at = NOW(),
              finished_at = NULL,
              applied_steps_count = 0
          WHERE migration_name = ${KNOWN_FAILED_MIGRATION}
            AND finished_at IS NULL
        `;
        
        console.log('✅ Migration marked as rolled back. Prisma will retry it.');
        return true;
      } else {
        console.log('✅ Migration is already finished. No action needed.');
        return false;
      }
    } else {
      console.log('⚠️  Migration not found in database. It may have been deleted or never applied.');
      return false;
    }
  } catch (error) {
    console.error('❌ Error fixing migration:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

fixMigration()
  .then((fixed) => {
    process.exit(fixed ? 0 : 1);
  })
  .catch((error) => {
    console.error('Failed to fix migration:', error);
    process.exit(1);
  });

