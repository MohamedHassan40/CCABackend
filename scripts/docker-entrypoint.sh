#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "🔄 Running database migrations..."

# First, try to fix any known failed migrations using our Node.js script
# This directly updates the migration table to mark it as rolled back
echo "🔍 Checking for failed migrations..."
set +e
node scripts/fix-migration.js 2>&1
FIX_EXIT_CODE=$?
set -e

if [ "$FIX_EXIT_CODE" -eq 0 ]; then
  echo "✅ Successfully fixed failed migration"
elif [ "$FIX_EXIT_CODE" -eq 1 ]; then
  echo "⚠️  Migration may already be resolved or not exist. Continuing..."
else
  # Fallback to Prisma's resolve command
  echo "⚠️  Script fix failed, trying Prisma resolve command..."
  set +e
  $PRISMA_CLI migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields" 2>&1
  set -e
fi

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
