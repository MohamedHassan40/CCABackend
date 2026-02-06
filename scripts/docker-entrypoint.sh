#!/bin/sh
set -e

echo "🔄 Running database migrations..."
npx prisma migrate deploy

echo "🌱 Seeding database..."
node dist/core/db/seed.js

echo "🚀 Starting server..."
exec node dist/server.js
