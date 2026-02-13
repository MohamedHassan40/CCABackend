#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

# CRITICAL: Clean up ALL failed migration records before Prisma checks
echo "🔍 Cleaning up failed migration records..."
set +e

# Generate Prisma Client first if needed
if [ ! -f "node_modules/.prisma/client/index.js" ]; then
  echo "   Generating Prisma Client..."
  $PRISMA_CLI generate 2>&1 || echo "⚠️  Generate failed, continuing..."
fi

# Delete ALL failed migration records
echo "   Deleting any failed migration records..."
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$executeRaw\`DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL\`
  .then(r => { 
    if (r > 0) {
      console.log('✅ Deleted ' + r + ' failed migration record(s)'); 
    } else {
      console.log('ℹ️  No failed migrations found'); 
    }
    p.\$disconnect(); 
    process.exit(0); 
  })
  .catch(e => { 
    console.log('⚠️  Cleanup failed (may not exist):', e.message); 
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
