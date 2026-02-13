#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "🔄 Running database migrations..."

# First, try to resolve any known failed migrations
# This handles the specific case of the failed migration we know about
KNOWN_FAILED_MIGRATION="20250212000002_ensure_all_hr_fields"

echo "🔍 Attempting to resolve failed migration: $KNOWN_FAILED_MIGRATION"
# Temporarily disable exit on error for this command
set +e
$PRISMA_CLI migrate resolve --rolled-back "$KNOWN_FAILED_MIGRATION" 2>&1
RESOLVE_EXIT_CODE=$?
set -e

if [ "$RESOLVE_EXIT_CODE" -eq 0 ]; then
  echo "✅ Successfully resolved failed migration"
else
  echo "⚠️  Could not resolve migration (it may already be resolved, not exist, or already applied)"
  echo "   Continuing with migration deployment..."
fi

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
