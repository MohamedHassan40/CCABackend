#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "=========================================="
echo "🔄 Starting database migration process"
echo "=========================================="

# Step 0: NUCLEAR OPTION - Clear ALL migration state
echo ""
echo "Step 0: NUCLEAR OPTION - Clearing ALL migration state..."
set +e

# Delete ALL records from _prisma_migrations table (nuclear option)
echo "Deleting ALL records from _prisma_migrations table..."
node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => client.query('DELETE FROM \"_prisma_migrations\"'))
  .then(result => { console.log('Deleted', result.rowCount, 'total migration record(s)'); return client.end(); })
  .then(() => process.exit(0))
  .catch(e => { console.log('Error:', e.message); client.end().catch(() => {}); process.exit(0); });
" 2>&1

# Also try Prisma's methods
echo "Trying Prisma migrate resolve --applied (mark as applied instead of rolled back)..."
$PRISMA_CLI migrate resolve --applied "20250212000002_ensure_all_hr_fields" 2>&1 || {
  echo "Trying --rolled-back..."
  $PRISMA_CLI migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields" 2>&1 || echo "Both resolve methods failed"
}

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
    // Delete ALL migration records (nuclear option)
    const result = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\"\`;
    console.log('Deleted ALL', result, 'migration record(s) from database');
    
    // Verify
    const remaining = await p.\$queryRaw\`SELECT COUNT(*) as count FROM \"_prisma_migrations\"\`;
    console.log('Remaining migration records:', remaining[0].count);
    
    await p.\$disconnect();
    process.exit(0);
  } catch (e) {
    console.log('Cleanup error:', e.message);
    await p.\$disconnect().catch(() => {});
    process.exit(0);
  }
})();
" 2>&1

set -e

# Step 3: Deploy migrations (this will recreate the migration history)
echo ""
echo "Step 3: Deploying migrations (will recreate migration history)..."
if ! $PRISMA_CLI migrate deploy 2>&1; then
  echo ""
  echo "❌ Migration deployment failed even after clearing all records!"
  echo ""
  echo "Trying alternative: prisma db push (bypasses migration history)..."
  set +e
  $PRISMA_CLI db push --accept-data-loss --skip-generate 2>&1 || {
    echo ""
    echo "❌❌❌ ALL MIGRATION METHODS FAILED! ❌❌❌"
    echo ""
    echo "The database migration system is in an inconsistent state."
    echo ""
    echo "You may need to:"
    echo "1. Manually verify the _prisma_migrations table is empty"
    echo "2. Check if there are any migration files that shouldn't exist"
    echo "3. Consider using 'prisma db push' instead of migrations"
    echo ""
    exit 1
  }
  set -e
  echo "✅ Database schema pushed successfully (bypassed migrations)"
else
  echo "✅ Migrations deployed successfully!"
fi

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
