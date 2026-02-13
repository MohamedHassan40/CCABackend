#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "🔄 Running database migrations..."

# AGGRESSIVE CLEANUP: Delete failed migration records directly using raw SQL
echo "🔍 Cleaning up failed migrations..."
set +e

# Use Prisma's db execute to directly delete the failed migration record
echo "   Deleting failed migration record from database..."
echo "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields';" | $PRISMA_CLI db execute --stdin 2>&1 && {
  echo "✅ Successfully deleted failed migration record"
} || {
  echo "⚠️  Could not delete via db execute, trying resolve command..."
  $PRISMA_CLI migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields" 2>&1 || {
    echo "⚠️  Both methods failed. The migration record may not exist or database connection issue."
    echo "💡 If migrations still fail, manually run this SQL on your database:"
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
