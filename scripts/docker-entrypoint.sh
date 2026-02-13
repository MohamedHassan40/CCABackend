#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "🔄 Running database migrations..."

# AGGRESSIVE CLEANUP: Delete failed migration records using Node.js script
echo "🔍 Cleaning up failed migrations..."
set +e

# First, generate Prisma Client if needed
if [ ! -f "node_modules/.prisma/client/index.js" ]; then
  echo "   Generating Prisma Client..."
  $PRISMA_CLI generate 2>&1 || echo "⚠️  Prisma generate failed, continuing..."
fi

# Run cleanup script
if [ -f "scripts/cleanup-failed-migrations.js" ]; then
  echo "   Running cleanup script..."
  node scripts/cleanup-failed-migrations.js 2>&1 || {
    echo "⚠️  Cleanup script failed, trying direct SQL..."
    # Fallback: Try direct SQL via Prisma
    echo "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields';" | $PRISMA_CLI db execute --stdin 2>&1 || {
      echo "⚠️  Direct SQL also failed. Manual cleanup may be needed."
    }
  }
else
  echo "⚠️  Cleanup script not found, trying direct SQL..."
  echo "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields';" | $PRISMA_CLI db execute --stdin 2>&1 || echo "⚠️  SQL execution failed"
fi

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
