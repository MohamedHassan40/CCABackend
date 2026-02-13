#!/usr/bin/env node
/**
 * Script to clean up failed Prisma migrations
 * This runs before migrations to ensure failed records are removed
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FAILED_MIGRATION = '20250212000002_ensure_all_hr_fields';

async function cleanup() {
  console.log(`🔍 Cleaning up failed migration: ${FAILED_MIGRATION}`);
  
  try {
    // Check if Prisma Client is available
    const prismaClientPath = path.join(process.cwd(), 'node_modules', '@prisma', 'client');
    
    if (!fs.existsSync(prismaClientPath)) {
      console.log('⚠️  Prisma Client not found, generating...');
      try {
        execSync('node node_modules/prisma/build/index.js generate', { stdio: 'inherit' });
      } catch (err) {
        console.log('⚠️  Could not generate Prisma Client, will try direct SQL');
        return false;
      }
    }
    
    // Try using Prisma Client
    try {
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();
      
      const result = await prisma.$executeRaw`
        DELETE FROM "_prisma_migrations" 
        WHERE migration_name = ${FAILED_MIGRATION}
      `;
      
      await prisma.$disconnect();
      
      if (result > 0) {
        console.log(`✅ Successfully deleted failed migration record (${result} row(s))`);
        return true;
      } else {
        console.log('ℹ️  Migration record not found (may have been already deleted)');
        return true;
      }
    } catch (err) {
      console.log('⚠️  Prisma Client method failed:', err.message);
      return false;
    }
  } catch (error) {
    console.error('❌ Error cleaning up migration:', error.message);
    return false;
  }
}

// Run cleanup
cleanup()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

