#!/bin/sh
set -e
cd /app

# Run Prisma CLI via node (no reliance on PATH or prisma binary)
PRISMA_CLI="node node_modules/prisma/build/index.js"

echo "🔄 Running database migrations..."
$PRISMA_CLI migrate deploy

echo "🌱 Seeding database..."
$PRISMA_CLI db seed

echo "🚀 Starting server..."
exec node dist/server.js
