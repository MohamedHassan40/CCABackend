# CCA Backend

Standalone backend API for the Cloud Org / CCA system. Express + TypeScript + Prisma.

## Prerequisites

- Node.js 18+
- PostgreSQL
- (Optional) Redis for caching

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Environment**
   - Copy `.env.example` to `.env` and fill in values.
   - Required: `DATABASE_URL`, `JWT_SECRET` (min 32 chars).

3. **Database**
   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   npm run prisma:seed   # optional: seed data
   ```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run production build |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run migrations |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run prisma:seed` | Seed database |
| `npm run typecheck` | TypeScript check |
| `npm run test` | Run tests |

## Defaults

- **Port**: 3001  
- **Database**: `postgresql://user:password@localhost:5432/cloud_org`  
- **CORS**: `http://localhost:3000` (override with `CORS_ORIGIN` or `FRONTEND_URL`)

Point the frontend (`NEXT_PUBLIC_API_URL`) to this API URL (e.g. `http://localhost:3001`).

### Production (e.g. Vercel + Railway)

If the browser shows **CORS policy** / **No `Access-Control-Allow-Origin` header** for `/api/me`, the API does not list your **exact** frontend origin. Set on the backend host (e.g. Railway):

- **`CORS_ORIGIN`** = `https://your-app.vercel.app` (HTTPS, no trailing slash), or  
- **`FRONTEND_URL`** = same value (used if `CORS_ORIGIN` is unset).

Multiple environments: `CORS_ORIGIN=https://app.vercel.app,http://localhost:3000`

Redeploy the backend after changing variables.
