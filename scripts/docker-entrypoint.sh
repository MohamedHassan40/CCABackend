#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "🔄 Running database migrations..."

# First, try to resolve any known failed migrations
# This handles the specific case of the failed migration we know about
KNOWN_FAILED_MIGRATION="20250212000002_ensure_all_hr_fields"

echo "🔍 Checking for failed migrations..."
# Temporarily disable exit on error for this command
set +e
$PRISMA_CLI migrate resolve --rolled-back "$KNOWN_FAILED_MIGRATION" 2>&1
RESOLVE_EXIT_CODE=$?
set -e

if [ "$RESOLVE_EXIT_CODE" -eq 0 ]; then
  echo "✅ Successfully resolved failed migration: $KNOWN_FAILED_MIGRATION"
elif [ "$RESOLVE_EXIT_CODE" -eq 1 ]; then
  # If resolve failed, try using SQL directly as a fallback
  echo "⚠️  Prisma resolve command failed, attempting SQL fix..."
  if [ -n "$DATABASE_URL" ]; then
    # Use psql if available, or node to execute SQL
    echo "UPDATE \"_prisma_migrations\" SET rolled_back_at = NOW(), finished_at = NULL, applied_steps_count = 0 WHERE migration_name = '$KNOWN_FAILED_MIGRATION' AND finished_at IS NULL;" | $PRISMA_CLI db execute --stdin 2>/dev/null || {
      echo "⚠️  Could not resolve via SQL either. Manual resolution may be needed."
      echo "   Run: npx prisma migrate resolve --rolled-back \"$KNOWN_FAILED_MIGRATION\""
    }
  fi
else
  echo "⚠️  Migration may already be resolved or not exist"
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
