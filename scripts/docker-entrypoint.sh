#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "🔄 Running database migrations..."

# Clean up any failed migration records before deploying
echo "🔍 Cleaning up failed migrations..."
set +e
# Try to delete the old failed migration record if it exists
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields'\`
  .then(() => { console.log('✅ Cleaned up old failed migration'); process.exit(0); })
  .catch(() => { console.log('⚠️  Old migration not found or already cleaned'); process.exit(0); })
  .finally(() => prisma.\$disconnect());
" 2>&1
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
