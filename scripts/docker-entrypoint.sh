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

# Step 2: FORCE RESOLVE the failed migration BEFORE anything else
echo ""
echo "Step 2: FORCE RESOLVING failed migration (Prisma official method)..."
set +e

# First, try Prisma's official migrate resolve command
echo "Attempting: prisma migrate resolve --rolled-back 20250212000002_ensure_all_hr_fields"
$PRISMA_CLI migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields" 2>&1
RESOLVE_EXIT=$?

if [ "$RESOLVE_EXIT" -ne 0 ]; then
  echo "⚠️  migrate resolve failed (exit code: $RESOLVE_EXIT)"
  echo "Trying direct SQL deletion as fallback..."
  
  # Fallback: Direct SQL deletion using Node script
  node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    try {
      // Delete the specific failed migration
      const result1 = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields'\`;
      console.log('Deleted', result1, 'record(s) for 20250212000002_ensure_all_hr_fields');
      
      // Also delete any other failed migrations
      const result2 = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`;
      console.log('Deleted', result2, 'other failed migration record(s)');
      
      await p.\$disconnect();
      process.exit(0);
    } catch (e) {
      console.log('SQL deletion error:', e.message);
      await p.\$disconnect().catch(() => {});
      process.exit(0);
    }
  })();
  " 2>&1
fi

set -e

# Step 3: Deploy migrations
echo ""
echo "Step 3: Deploying migrations..."
if ! $PRISMA_CLI migrate deploy 2>&1; then
  echo ""
  echo "❌❌❌ Migration deployment FAILED! ❌❌❌"
  echo ""
  echo "The failed migration record still exists in your database."
  echo ""
  echo "YOU MUST MANUALLY RESOLVE THIS. Choose one option:"
  echo ""
  echo "Option 1 (Recommended - Prisma official method):"
  echo "   npx prisma migrate resolve --rolled-back 20250212000002_ensure_all_hr_fields"
  echo ""
  echo "Option 2 (Direct SQL - if Option 1 doesn't work):"
  echo "   Connect to your Railway database and run:"
  echo "   DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields';"
  echo ""
  echo "Option 3 (Nuclear option - delete ALL failed migrations):"
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
