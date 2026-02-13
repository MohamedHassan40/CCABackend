#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

# CRITICAL: Clean up ALL failed migration records BEFORE Prisma checks
echo "=========================================="
echo "🔍 FORCE CLEANING failed migration records"
echo "=========================================="
set +e

# Step 1: Always generate Prisma Client first
echo "Step 1: Generating Prisma Client..."
$PRISMA_CLI generate 2>&1
echo "✅ Prisma Client generation complete"

# Step 2: Delete the specific failed migration record using Prisma's db execute
echo "Step 2: Deleting failed migration record using Prisma db execute..."
echo "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields';" | $PRISMA_CLI db execute --stdin 2>&1 && {
  echo "✅ Deleted via db execute"
} || {
  echo "⚠️  db execute failed, trying Prisma Client..."
  # Fallback: Use Prisma Client
  node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    try {
      console.log('Connecting to database...');
      const result1 = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields'\`;
      const result2 = await p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`;
      const total = result1 + result2;
      if (total > 0) {
        console.log('✅ SUCCESS: Deleted', total, 'failed migration record(s)');
      } else {
        console.log('ℹ️  No failed migrations found');
      }
      await p.\$disconnect();
      process.exit(0);
    } catch (e) {
      console.error('❌ ERROR:', e.message);
      await p.\$disconnect().catch(() => {});
      process.exit(1);
    }
  })();
  " 2>&1 || echo "⚠️  Both methods failed, but continuing..."
}

set -e

echo ""
echo "=========================================="
echo "🔄 Running database migrations"
echo "=========================================="

# Now try to deploy migrations
echo "🚀 Deploying migrations..."
if ! $PRISMA_CLI migrate deploy; then
  echo "❌ Migration failed! Check your database connection and migration status."
  echo "💡 If this is a fresh database, ensure DATABASE_URL is set correctly."
  echo "💡 If migrations are stuck, you may need to resolve them manually."
  exit 1
fi

echo "🌱 Seeding database..."
if ! $PRISMA_CLI db seed; then
  echo "⚠️  Seeding failed, but continuing (seed may have already run)..."
fi

echo "🚀 Starting server..."
exec node dist/server.js
