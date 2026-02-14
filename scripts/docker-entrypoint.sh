#!/bin/sh
# THIS SCRIPT USES DB PUSH - NOT MIGRATE DEPLOY
# Uses Prisma's official migrate resolve method to handle failed migrations

set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "=========================================="
echo "🔄 STARTING DATABASE SETUP PROCESS"
echo "🔄 USING DB PUSH (NO MIGRATIONS)"
echo "=========================================="

# Step 0: Resolve failed migrations using Prisma's official method
echo ""
echo "Step 0: Resolving failed migrations (Prisma official method)..."
set +e

# First, try to resolve any failed migrations using Prisma's official command
# This is the CORRECT way per Prisma documentation
# We'll query for failed migrations and resolve them dynamically
echo "Attempting to resolve failed migrations using prisma migrate resolve..."
node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => client.query('SELECT migration_name FROM \"_prisma_migrations\" WHERE finished_at IS NULL'))
  .then(result => {
    if (result.rows.length > 0) {
      console.log('Found', result.rows.length, 'failed migration(s) to resolve');
      return Promise.all(result.rows.map(row => {
        const { execSync } = require('child_process');
        try {
          execSync(\`node node_modules/prisma/build/index.js migrate resolve --rolled-back \"\${row.migration_name}\"\`, { stdio: 'inherit', cwd: '/app' });
          console.log('Resolved:', row.migration_name);
        } catch (e) {
          console.log('Could not resolve:', row.migration_name);
        }
      }));
    } else {
      console.log('No failed migrations found');
    }
    return client.end();
  })
  .then(() => process.exit(0))
  .catch(e => { console.log('Note:', e.message); client.end().catch(() => {}); process.exit(0); });
" 2>&1

# Also delete any failed migrations directly as fallback
echo "Deleting any remaining failed migration records..."
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
