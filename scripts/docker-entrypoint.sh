#!/bin/sh
# THIS SCRIPT USES DB PUSH - NO MIGRATIONS
# Since the migration table is empty, we use db push which bypasses migrations entirely

set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "=========================================="
echo "🔄 STARTING DATABASE SETUP PROCESS"
echo "🔄 USING DB PUSH (NO MIGRATIONS - TABLE IS EMPTY)"
echo "=========================================="

# Step 1: Generate Prisma Client
echo ""
echo "Step 1: Generating Prisma Client..."
$PRISMA_CLI generate 2>&1
echo "✅ Prisma Client generated"

# Step 2: Use db push (bypasses migration system completely)
# Since the migration table is empty, we don't need to resolve anything
# db push directly applies the schema without checking migration history
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
