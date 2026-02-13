#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "=========================================="
echo "🔄 Starting database migration process"
echo "=========================================="

# Step 1: Generate Prisma Client
echo "Step 1: Generating Prisma Client..."
$PRISMA_CLI generate 2>&1
echo "✅ Prisma Client generated"

# Step 2: NUCLEAR OPTION - Clear ALL migration records if table is empty or has issues
echo ""
echo "Step 2: Checking and cleaning migration records..."
set +e

node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    // Check current state
    const allRecords = await p.\$queryRaw\`SELECT migration_name, finished_at, rolled_back_at FROM \"_prisma_migrations\" ORDER BY started_at DESC LIMIT 10\`;
    console.log('Current migration records:', JSON.stringify(allRecords, null, 2));
    
    // Delete the specific failed migration
    const result1 = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields'\`;
    console.log('Deleted specific failed migration:', result1, 'row(s)');
    
    // Delete ALL failed migrations (finished_at IS NULL)
    const result2 = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`;
    console.log('Deleted other failed migrations:', result2, 'row(s)');
    
    // If table is empty or only has the failed one, we're good
    const finalCount = await p.\$queryRaw\`SELECT COUNT(*) as count FROM \"_prisma_migrations\"\`;
    console.log('Remaining migration records:', finalCount[0].count);
    
    await p.\$disconnect();
    process.exit(0);
  } catch (e) {
    console.log('⚠️  Cleanup check:', e.message);
    // If table doesn't exist or has issues, that's actually fine - Prisma will create it
    await p.\$disconnect().catch(() => {});
    process.exit(0);
  }
})();
" 2>&1

set -e

# Step 3: Deploy migrations with retry logic
echo ""
echo "Step 3: Deploying migrations..."
MIGRATE_ATTEMPTS=0
MAX_ATTEMPTS=3

while [ $MIGRATE_ATTEMPTS -lt $MAX_ATTEMPTS ]; do
  if $PRISMA_CLI migrate deploy 2>&1; then
    echo "✅ Migrations deployed successfully"
    break
  else
    MIGRATE_ATTEMPTS=$((MIGRATE_ATTEMPTS + 1))
    if [ $MIGRATE_ATTEMPTS -lt $MAX_ATTEMPTS ]; then
      echo ""
      echo "⚠️  Migration failed, attempting cleanup and retry ($MIGRATE_ATTEMPTS/$MAX_ATTEMPTS)..."
      set +e
      
      # Try to resolve
      $PRISMA_CLI migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields" 2>&1 || {
        # If resolve fails, try direct deletion
        node -e "
        const { PrismaClient } = require('@prisma/client');
        const p = new PrismaClient();
        p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields' OR finished_at IS NULL\`
          .then(() => { console.log('✅ Cleaned up'); p.\$disconnect(); process.exit(0); })
          .catch(e => { console.log('⚠️  Cleanup failed:', e.message); p.\$disconnect(); process.exit(0); });
        " 2>&1
      }
      
      set -e
      sleep 2
    else
      echo ""
      echo "❌ Migration failed after $MAX_ATTEMPTS attempts"
      echo "💡 The _prisma_migrations table may need to be manually cleared"
      exit 1
    fi
  fi
done

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
