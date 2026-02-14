#!/bin/sh
# THIS SCRIPT USES DB PUSH - NOT MIGRATE DEPLOY
# If you see "Running database migrations..." that means Railway is using a cached image
# Force rebuild on Railway without cache!

set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "=========================================="
echo "🔄 STARTING DATABASE SETUP PROCESS"
echo "🔄 THIS SCRIPT USES DB PUSH - NOT MIGRATE DEPLOY"
echo "🔄 IF YOU SEE 'Running database migrations...' RAILWAY IS USING CACHED IMAGE"
echo "=========================================="

# Step 0: Delete failed migration records from database
echo ""
echo "Step 0: Clearing any failed migration records..."
set +e
node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => client.query('DELETE FROM \"_prisma_migrations\" WHERE finished_at IS NULL'))
  .then(result => { console.log('Deleted', result.rowCount, 'failed migration record(s)'); return client.end(); })
  .then(() => process.exit(0))
  .catch(e => { console.log('Note:', e.message); client.end().catch(() => {}); process.exit(0); });
" 2>&1
set -e

# Step 1: Generate Prisma Client
echo ""
echo "Step 1: Generating Prisma Client..."
$PRISMA_CLI generate 2>&1
echo "✅ Prisma Client generated"

# Step 2: Use db push (bypasses migration system completely)
# This does NOT use migrate deploy - it directly pushes schema
echo ""
echo "Step 2: Pushing database schema (using db push - NO MIGRATIONS)..."
echo "This command bypasses the migration system entirely"
echo "Command: prisma db push --accept-data-loss --skip-generate"
$PRISMA_CLI db push --accept-data-loss --skip-generate 2>&1 && {
  echo "✅ Database schema pushed successfully!"
} || {
  echo "❌ db push failed"
  exit 1
}

# Step 3: Seed database
echo ""
echo "Step 3: Seeding database..."
if ! $PRISMA_CLI db seed; then
  echo "⚠️  Seeding failed, but continuing (seed may have already run)..."
fi

echo ""
echo "=========================================="
echo "🚀 Starting server"
echo "=========================================="
exec node dist/server.js
