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

# Step 2: Clean up failed migrations BEFORE attempting deploy
echo ""
echo "Step 2: Cleaning up any failed migrations..."
set +e

# Delete all failed migrations from the database
# This ensures we start clean
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    const result = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`;
    console.log('Deleted', result, 'failed migration record(s)');
    await p.\$disconnect();
    process.exit(0);
  } catch (e) {
    console.log('Cleanup note:', e.message);
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
  echo "❌ Migration deployment failed!"
  echo ""
  echo "Attempting to resolve using Prisma's official method..."
  set +e
  
  # Try to resolve any failed migrations using Prisma's official command
  # Extract migration name from error or query database
  node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    try {
      const failed = await p.\$queryRaw\`SELECT migration_name FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`;
      if (failed && failed.length > 0) {
        failed.forEach(m => console.log('MIGRATION:' + m.migration_name));
      }
      await p.\$disconnect();
      process.exit(0);
    } catch (e) {
      await p.\$disconnect().catch(() => {});
      process.exit(0);
    }
  })();
  " 2>&1 | grep "^MIGRATION:" | sed 's/^MIGRATION://' | while read -r mig_name; do
    if [ -n "$mig_name" ]; then
      echo "Resolving failed migration: $mig_name"
      $PRISMA_CLI migrate resolve --rolled-back "$mig_name" 2>&1 || echo "⚠️  Could not resolve $mig_name"
    fi
  done
  
  # Also try to delete any remaining failed migrations
  node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`
    .then(() => { console.log('✅ Cleaned up remaining failed migrations'); p.\$disconnect(); process.exit(0); })
    .catch(() => { p.\$disconnect(); process.exit(0); });
  " 2>&1
  
  # Retry migration deploy
  echo ""
  echo "Retrying migration deployment..."
  if ! $PRISMA_CLI migrate deploy 2>&1; then
    echo "❌ Migration still failed after resolution attempts"
    echo ""
    echo "💡 Manual resolution required. The migration may need to be resolved manually:"
    echo "   npx prisma migrate resolve --rolled-back <migration_name>"
    echo "   or if partially applied:"
    echo "   npx prisma migrate resolve --applied <migration_name>"
    exit 1
  fi
  set -e
fi

echo "✅ Migrations deployed successfully"

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
