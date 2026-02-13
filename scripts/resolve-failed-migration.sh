#!/bin/sh
# Script to resolve a failed Prisma migration
# Usage: ./scripts/resolve-failed-migration.sh <migration_name> [--applied|--rolled-back]
# Example: ./scripts/resolve-failed-migration.sh 20250212000002_ensure_all_hr_fields --rolled-back

set -e

MIGRATION_NAME=$1
RESOLVE_TYPE=${2:---rolled-back}

if [ -z "$MIGRATION_NAME" ]; then
    echo "❌ Error: Migration name is required"
    echo "Usage: $0 <migration_name> [--applied|--rolled-back]"
    exit 1
fi

if [ "$RESOLVE_TYPE" != "--applied" ] && [ "$RESOLVE_TYPE" != "--rolled-back" ]; then
    echo "❌ Error: Resolve type must be --applied or --rolled-back"
    exit 1
fi

echo "🔧 Resolving failed migration: $MIGRATION_NAME"
echo "📋 Resolve type: $RESOLVE_TYPE"

PRISMA_CLI="node node_modules/prisma/build/index.js"

if ! $PRISMA_CLI migrate resolve $RESOLVE_TYPE "$MIGRATION_NAME"; then
    echo "❌ Failed to resolve migration"
    exit 1
fi

echo "✅ Migration resolved successfully"
echo "🚀 You can now redeploy to apply the fixed migration"

