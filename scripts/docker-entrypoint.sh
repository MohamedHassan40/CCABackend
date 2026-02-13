#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "🔄 Running database migrations..."

# Function to resolve failed migrations
resolve_failed_migration() {
  MIGRATION_NAME=$1
  if [ -z "$MIGRATION_NAME" ]; then
    echo "❌ Migration name not provided"
    return 1
  fi
  
  echo "🔧 Resolving failed migration: $MIGRATION_NAME"
  echo "   Marking as rolled back so it can be retried with the fixed version..."
  
  if $PRISMA_CLI migrate resolve --rolled-back "$MIGRATION_NAME"; then
    echo "✅ Migration resolved. Retrying deployment..."
    return 0
  else
    echo "❌ Could not resolve migration automatically."
    return 1
  fi
}

# Try to deploy migrations
MIGRATE_OUTPUT=$($PRISMA_CLI migrate deploy 2>&1) || MIGRATE_EXIT_CODE=$?

if [ "$MIGRATE_EXIT_CODE" != "0" ]; then
  # Check if the error is about a failed migration (P3009)
  if echo "$MIGRATE_OUTPUT" | grep -q "P3009" || echo "$MIGRATE_OUTPUT" | grep -q "failed migrations"; then
    echo ""
    echo "⚠️  Detected failed migration. Attempting to resolve..."
    
    # Extract the failed migration name - look for pattern: The `migration_name` migration
    FAILED_MIGRATION=$(echo "$MIGRATE_OUTPUT" | grep -o "The \`[^']*\`" | sed "s/The \`//" | sed "s/\`//" | head -1)
    
    if [ -n "$FAILED_MIGRATION" ]; then
      if resolve_failed_migration "$FAILED_MIGRATION"; then
        # Retry the migration
        if $PRISMA_CLI migrate deploy; then
          echo "✅ Migrations applied successfully!"
        else
          echo "❌ Migration still failed after resolution. Check the error above."
          exit 1
        fi
      else
        echo "💡 You may need to resolve it manually:"
        echo "   npx prisma migrate resolve --rolled-back \"$FAILED_MIGRATION\""
        echo "   or if the migration partially succeeded:"
        echo "   npx prisma migrate resolve --applied \"$FAILED_MIGRATION\""
        exit 1
      fi
    else
      echo "❌ Could not identify failed migration name from error message."
      echo "💡 Please check Railway logs and resolve manually using:"
      echo "   npx prisma migrate resolve --rolled-back <migration_name>"
      exit 1
    fi
  else
    echo "$MIGRATE_OUTPUT"
    echo "❌ Migration failed! Check your database connection and migration status."
    echo "💡 If this is a fresh database, ensure DATABASE_URL is set correctly."
    exit 1
  fi
fi

echo "🌱 Seeding database..."
if ! $PRISMA_CLI db seed; then
  echo "⚠️  Seeding failed, but continuing (seed may have already run)..."
fi

echo "🚀 Starting server..."
exec node dist/server.js
