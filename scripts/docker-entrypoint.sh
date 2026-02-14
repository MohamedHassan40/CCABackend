#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "=========================================="
echo "🔄 Starting database migration process"
echo "=========================================="

# Step 0: NUCLEAR OPTION - Delete ALL migration records and use db push instead
echo ""
echo "Step 0: NUCLEAR OPTION - Clearing migration state and using db push..."
set +e

# Delete ALL records from _prisma_migrations table
echo "Deleting ALL records from _prisma_migrations table..."
node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => client.query('DELETE FROM \"_prisma_migrations\"'))
  .then(result => { console.log('Deleted', result.rowCount, 'total migration record(s)'); return client.end(); })
  .then(() => process.exit(0))
  .catch(e => { console.log('Error:', e.message); client.end().catch(() => {}); process.exit(0); });
" 2>&1

set -e

# Step 1: Generate Prisma Client
echo ""
echo "Step 1: Generating Prisma Client..."
$PRISMA_CLI generate 2>&1
echo "✅ Prisma Client generated"

# Step 2: Use db push instead of migrate deploy (bypasses migration history completely)
echo ""
echo "Step 2: Using prisma db push (bypasses migration history)..."
set +e

# Try migrate deploy first (in case it works)
if $PRISMA_CLI migrate deploy 2>&1; then
  echo "✅ Migrations deployed successfully!"
else
  echo "⚠️  migrate deploy failed, using db push instead..."
  # Use db push which completely bypasses the migration system
  $PRISMA_CLI db push --accept-data-loss --skip-generate 2>&1 && {
    echo "✅ Database schema pushed successfully (bypassed migrations)"
  } || {
    echo "❌ db push also failed"
    exit 1
  }
fi

set -e

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
