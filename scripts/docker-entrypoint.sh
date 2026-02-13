#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

# CRITICAL: Delete failed migration record BEFORE Prisma checks
echo "🔍 FORCE DELETING failed migration record..."
set +e

# Generate Prisma Client first if needed
if [ ! -f "node_modules/.prisma/client/index.js" ]; then
  echo "   Generating Prisma Client..."
  $PRISMA_CLI generate 2>&1 || echo "⚠️  Generate failed, continuing..."
fi

# Delete the failed migration record using Prisma
echo "   Deleting failed migration: 20250212000002_ensure_all_hr_fields..."
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20250212000002_ensure_all_hr_fields'\`
  .then(r => { 
    console.log('✅ Successfully deleted failed migration record (' + r + ' row(s))'); 
    p.\$disconnect(); 
    process.exit(0); 
  })
  .catch(e => { 
    console.log('⚠️  Delete failed (may not exist):', e.message); 
    p.\$disconnect(); 
    process.exit(0); 
  });
" 2>&1

set -e

echo "🔄 Running database migrations..."

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
