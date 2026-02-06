#!/bin/sh
set -e

# Ensure Prisma CLI is on PATH (Alpine/Railway may not include node_modules/.bin)
export PATH="/app/node_modules/.bin:$PATH"

echo "🔄 Running database migrations..."
prisma migrate deploy

echo "🌱 Seeding database..."
prisma db seed

echo "🚀 Starting server..."
exec node dist/server.js
