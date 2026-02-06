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

# Use entrypoint that sets PATH so prisma CLI is found
COPY scripts/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3001

# Production: migrations, seed, then server (PATH set in script)
CMD ["./docker-entrypoint.sh"]
















