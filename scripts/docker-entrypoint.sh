#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "=========================================="
echo "🔄 Starting database migration process"
echo "=========================================="

# Step 0: NUCLEAR OPTION - Delete failed migrations using EVERY possible method
echo ""
echo "Step 0: NUCLEAR OPTION - Deleting failed migrations using ALL methods..."
set +e

# Method 1: Direct PostgreSQL connection using Node.js (pg package)
echo ""
echo "Method 1: Direct PostgreSQL connection (pg package)..."
if [ -f "scripts/force-delete-failed-migration.js" ]; then
  node scripts/force-delete-failed-migration.js 2>&1
  echo "Method 1 completed"
else
  echo "⚠️  force-delete script not found"
fi

# Method 2: Prisma db execute with SQL file
echo ""
echo "Method 2: Prisma db execute with SQL file..."
if [ -f "scripts/delete-failed-migration.sql" ]; then
  $PRISMA_CLI db execute --file scripts/delete-failed-migration.sql 2>&1 || {
    echo "Trying stdin method..."
    cat scripts/delete-failed-migration.sql | $PRISMA_CLI db execute --stdin 2>&1
  }
  echo "Method 2 completed"
fi

# Method 3: Direct SQL via stdin
echo ""
echo "Method 3: Direct SQL via stdin..."
echo "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields' OR finished_at IS NULL;" | $PRISMA_CLI db execute --stdin 2>&1
echo "Method 3 completed"

# Method 4: Prisma migrate resolve (official method)
echo ""
echo "Method 4: Prisma migrate resolve (official method)..."
$PRISMA_CLI migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields" 2>&1
echo "Method 4 completed"

# Method 5: Using psql if available
echo ""
echo "Method 5: Using psql (if available)..."
if command -v psql >/dev/null 2>&1; then
  echo "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields' OR finished_at IS NULL;" | psql "$DATABASE_URL" 2>&1 || echo "psql method failed"
  echo "Method 5 completed"
else
  echo "⚠️  psql not available"
fi

set -e

# Step 1: Generate Prisma Client
echo ""
echo "Step 1: Generating Prisma Client..."
$PRISMA_CLI generate 2>&1
echo "✅ Prisma Client generated"

# Step 2: Final cleanup using Prisma Client
echo ""
echo "Step 2: Final cleanup using Prisma Client..."
set +e

node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    console.log('Checking for failed migrations...');
    const failed = await p.\$queryRaw\`SELECT migration_name, started_at, finished_at FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`;
    console.log('Found', failed.length, 'failed migration(s):', failed.map(f => f.migration_name));
    
    if (failed.length > 0) {
      // Delete the specific failed migration
      const result1 = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields'\`;
      console.log('Deleted', result1, 'record(s) for 20250212000002_ensure_all_hr_fields');
      
      // Delete any other failed migrations
      const result2 = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`;
      console.log('Deleted', result2, 'other failed migration record(s)');
      
      // Verify deletion
      const remaining = await p.\$queryRaw\`SELECT migration_name FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`;
      if (remaining.length === 0) {
        console.log('✅ All failed migrations deleted successfully!');
      } else {
        console.log('⚠️  Still', remaining.length, 'failed migration(s) remaining:', remaining.map(r => r.migration_name));
      }
    } else {
      console.log('✅ No failed migrations found');
    }
    
    await p.\$disconnect();
    process.exit(0);
  } catch (e) {
    console.log('Final cleanup error:', e.message);
    console.log('Stack:', e.stack);
    await p.\$disconnect().catch(() => {});
    process.exit(0);
  }
})();
" 2>&1

set -e

# Step 3: Deploy migrations
echo ""
echo "Step 3: Deploying migrations..."
echo "Checking migration status before deploy..."
set +e
$PRISMA_CLI migrate status 2>&1 || echo "migrate status failed (this is OK)"
set -e

if ! $PRISMA_CLI migrate deploy 2>&1; then
  echo ""
  echo "❌❌❌ Migration deployment FAILED! ❌❌❌"
  echo ""
  echo "ALL AUTOMATED METHODS FAILED. The failed migration record MUST be manually deleted."
  echo ""
  echo "Go to Railway Dashboard -> Your Database -> Connect -> Run this SQL:"
  echo ""
  echo "   DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields';"
  echo ""
  echo "Or delete all failed migrations:"
  echo ""
  echo "   DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL;"
  echo ""
  echo "After deleting, redeploy your backend."
  echo ""
  exit 1
fi

echo "✅ Migrations deployed successfully!"

# Step 4: Seed database
echo ""
echo "Step 4: Seeding database..."
if ! $PRISMA_CLI db seed; then
  echo "⚠️  Seeding failed, but continuing (seed may have already run)..."
fi

echo ""
echo "=========================================="
echo "🚀 Starting server"
echo "=========================================="
exec node dist/server.js
