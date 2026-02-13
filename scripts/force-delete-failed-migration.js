#!/usr/bin/env node
/**
 * FORCE DELETE failed migration - uses Prisma Client
 * This script MUST run before migrate deploy
 */

const FAILED_MIGRATION = '20250212000002_ensure_all_hr_fields';

async function forceDelete() {
  try {
    // Try to require Prisma Client
    let PrismaClient;
    try {
      PrismaClient = require('@prisma/client').PrismaClient;
    } catch (err) {
      console.error('❌ Prisma Client not found. Generating...');
      const { execSync } = require('child_process');
      execSync('node node_modules/prisma/build/index.js generate', { stdio: 'inherit' });
      PrismaClient = require('@prisma/client').PrismaClient;
    }

    const prisma = new PrismaClient();

    try {
      console.log(`🔍 Deleting failed migration: ${FAILED_MIGRATION}`);
      
      // Delete the failed migration record
      const result = await prisma.$executeRaw`
        DELETE FROM "_prisma_migrations" 
        WHERE migration_name = ${FAILED_MIGRATION}
      `;
      
      if (result > 0) {
        console.log(`✅ Successfully deleted failed migration record (${result} row(s))`);
      } else {
        console.log('ℹ️  Migration record not found (may have been already deleted)');
      }
      
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      console.error('❌ Error deleting failed migration:', error.message);
      await prisma.$disconnect().catch(() => {});
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

forceDelete();

