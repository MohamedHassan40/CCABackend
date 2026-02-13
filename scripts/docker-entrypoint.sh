#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "🔄 Running database migrations..."

# Clean up any failed migration records before deploying
echo "🔍 Cleaning up failed migrations..."
set +e

# Try to resolve/delete the failed migration using Prisma's resolve command
echo "   Attempting to resolve failed migration..."
$PRISMA_CLI migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields" 2>&1 || {
  echo "   Resolve command failed, trying to delete migration record directly..."
  # Use Prisma's db execute to delete the failed migration record
  echo "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields' AND finished_at IS NULL;" | $PRISMA_CLI db execute --stdin 2>&1 || {
    echo "⚠️  Could not automatically clean up failed migration"
    echo "💡 You may need to manually delete it from the database:"
    echo "   DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields';"
  }
}

set -e

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
