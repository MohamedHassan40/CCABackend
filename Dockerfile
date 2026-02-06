FROM node:20-alpine

# Install OpenSSL and other required libraries for Prisma
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma client and build
RUN npx prisma generate && npm run build

# Entrypoint script: run Prisma via node (no prisma binary on PATH)
RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -e' \
  'cd /app' \
  'echo "Running database migrations..."' \
  'node node_modules/prisma/build/index.js migrate deploy' \
  'echo "Seeding database..."' \
  'node node_modules/prisma/build/index.js db seed' \
  'echo "Starting server..."' \
  'exec node dist/server.js' \
  > docker-entrypoint.sh && chmod +x docker-entrypoint.sh

EXPOSE 3001

# ENTRYPOINT runs even when Railway overrides start command (override becomes args, we ignore them)
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD []
















