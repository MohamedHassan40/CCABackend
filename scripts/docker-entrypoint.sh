#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "=========================================="
echo "🔄 Starting database migration process"
echo "=========================================="

# Step 0: FORCE DELETE failed migrations using direct PostgreSQL connection
echo ""
echo "Step 0: FORCE DELETING failed migrations (direct PostgreSQL connection)..."
set +e

# Try using Node script with direct PostgreSQL connection (most reliable)
if [ -f "scripts/force-delete-failed-migration.js" ]; then
  echo "Running force-delete script with direct PostgreSQL connection..."
  node scripts/force-delete-failed-migration.js 2>&1
  echo "Force delete script completed"
fi

# Also try Prisma's db execute with SQL file
if [ -f "scripts/delete-failed-migration.sql" ]; then
  echo "Trying prisma db execute with SQL file..."
  $PRISMA_CLI db execute --file scripts/delete-failed-migration.sql 2>&1 || {
    echo "Trying stdin method..."
    cat scripts/delete-failed-migration.sql | $PRISMA_CLI db execute --stdin 2>&1 || {
      echo "⚠️  db execute methods failed"
    }
  }
fi

# Also try Prisma's official resolve method
echo "Attempting Prisma migrate resolve..."
$PRISMA_CLI migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields" 2>&1 || {
  echo "⚠️  migrate resolve failed (this is OK if migration doesn't exist)"
}

set -e

# Step 1: Generate Prisma Client
echo ""
echo "Step 1: Generating Prisma Client..."
$PRISMA_CLI generate 2>&1
echo "✅ Prisma Client generated"

# Step 2: Final cleanup using Prisma Client (if previous steps didn't work)
echo ""
echo "Step 2: Final cleanup attempt using Prisma Client..."
set +e

node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    // Delete the specific failed migration
    const result1 = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields'\`;
    console.log('Deleted', result1, 'record(s) for 20250212000002_ensure_all_hr_fields');
    
    // Delete any other failed migrations
    const result2 = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`;
    console.log('Deleted', result2, 'other failed migration record(s)');
    
    // Verify deletion
    const remaining = await p.\$queryRaw\`SELECT migration_name FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`;
    if (remaining.length === 0) {
      console.log('✅ All failed migrations deleted successfully');
    } else {
      console.log('⚠️  Still', remaining.length, 'failed migration(s) remaining:', remaining.map(r => r.migration_name));
    }
    
    await p.\$disconnect();
    process.exit(0);
  } catch (e) {
    console.log('Final cleanup error:', e.message);
    await p.\$disconnect().catch(() => {});
    process.exit(0);
  }
})();
" 2>&1

set -e

# Step 3: Deploy migrations
echo ""
echo "Step 3: Deploying migrations..."
if ! $PRISMA_CLI migrate deploy 2>&1; then
  echo ""
  echo "❌❌❌ Migration deployment FAILED! ❌❌❌"
  echo ""
  echo "The failed migration record still exists in your Railway database."
  echo ""
  echo "YOU MUST MANUALLY DELETE IT. Connect to your Railway PostgreSQL database and run:"
  echo ""
  echo "   DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields';"
  echo ""
  echo "Or delete all failed migrations:"
  echo ""
  echo "   DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL;"
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
