#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "=========================================="
echo "🔄 Starting database setup process"
echo "=========================================="

# Step 1: Generate Prisma Client
echo ""
echo "Step 1: Generating Prisma Client..."
$PRISMA_CLI generate 2>&1
echo "✅ Prisma Client generated"

# Step 2: Use db push (bypasses migration system completely)
echo ""
echo "Step 2: Pushing database schema (using db push - no migrations)..."
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
