#!/usr/bin/env node
/**
 * Standalone script to resolve failed migrations
 * Run this manually if the entrypoint script doesn't work
 */

const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');

const prisma = new PrismaClient();

async function resolveFailedMigrations() {
  try {
    console.log('Checking for failed migrations...');
    
    // Check for failed migrations
    const failed = await prisma.$queryRaw`
      SELECT migration_name, started_at, finished_at 
      FROM "_prisma_migrations" 
      WHERE finished_at IS NULL
    `;
    
    if (!failed || failed.length === 0) {
      console.log('✅ No failed migrations found');
      return;
    }
    
    console.log(`Found ${failed.length} failed migration(s):`);
    failed.forEach(m => {
      console.log(`  - ${m.migration_name} (started: ${m.started_at})`);
    });
    
    // Try Prisma's official resolve command first
    for (const migration of failed) {
      const migrationName = migration.migration_name;
      console.log(`\nAttempting to resolve: ${migrationName}`);
      
      try {
        execSync(`npx prisma migrate resolve --rolled-back "${migrationName}"`, {
          stdio: 'inherit',
          cwd: process.cwd()
        });
        console.log(`✅ Successfully resolved ${migrationName} using Prisma's official method`);
      } catch (error) {
        console.log(`⚠️  Prisma resolve failed, trying direct SQL deletion...`);
        
        // Fallback: Direct SQL deletion
        const result = await prisma.$executeRaw`
          DELETE FROM "_prisma_migrations" 
          WHERE migration_name = ${migrationName}
        `;
        console.log(`✅ Deleted ${result} record(s) for ${migrationName}`);
      }
    }
    
    console.log('\n✅ All failed migrations resolved!');
    
  } catch (error) {
    console.error('❌ Error resolving migrations:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resolveFailedMigrations();

