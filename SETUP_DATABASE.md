# Database setup: create tables and super admin

## 1. Set your database URL

Ensure `DATABASE_URL` is set (in `.env` or your environment):

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
```

Example for local Postgres:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/cloud_org?schema=public
```

For Railway: use the `DATABASE_URL` from your Postgres service.

---

## 2. Create database tables (run migrations)

There is a **single migration** (`0_init`) that creates the full schema from scratch.

From the **cca_backend** folder:

```bash
cd cca_backend
npm install
npx prisma generate
npx prisma migrate deploy
```

- **`prisma generate`** – generates the Prisma client.
- **`prisma migrate deploy`** – applies the migration and creates all tables.

**If your database already has tables or old migration history** (e.g. from previous multi-migration setup): run `migrate deploy` only on a **fresh** database, or clear the DB (drop all tables and the `_prisma_migrations` table) first. The single migration assumes an empty database.

If you are in **development** and want to create the database and apply migrations in one go:

```bash
npx prisma migrate dev
```

---

## 3. Seed data (modules, roles, permissions, super admin)

```bash
npm run prisma:seed
```

Or:

```bash
npx prisma db seed
```

This will:

- Create modules (HR, Ticketing, Marketplace, etc.), roles, permissions, module prices, and bundles.
- Create the **super admin** user:
  - **Email:** `info@cloud.org.sa` (or `SUPER_ADMIN_EMAIL` if set).
  - **Password:** `123456` (or `SUPER_ADMIN_PASSWORD` if set).
- Create two sample organizations with admin users (`admin@acme.com`, `admin@techstartup.com` / `admin123`).

### Optional: custom super admin (env vars)

Before running the seed you can set:

```env
SUPER_ADMIN_EMAIL=info@cloud.org.sa
SUPER_ADMIN_PASSWORD=123456
```

If unset, the seed uses `info@cloud.org.sa` and `123456` by default.

---

## One-time full setup (local or server)

```bash
cd cca_backend
npm install
export DATABASE_URL="postgresql://..."   # or set in .env
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
```

Then log in at your frontend with **info@cloud.org.sa** / **123456** and you will have super admin access (pricing, bundles, organizations, modules).

---

## Railway (production)

On **Railway**, the backend must run migrations and seed so the `Module` and `ModulePrice` tables exist and are populated. Otherwise `/api/public/modules` returns 500.

**Option A – Recommended:** Use the start script that runs migrations and seed before starting the server.

1. In your Railway **backend** service → **Settings** → **Deploy**.
2. Set **Start Command** to:
   ```bash
   npm run start:with-db
   ```
3. Redeploy. Each deploy will run `prisma migrate deploy`, then `prisma db seed`, then start the server. Seed is idempotent (upsert), so this is safe.

**Option B – Manual one-time setup:** Keep Start Command as `npm start`. Then run migrations and seed once (e.g. via Railway CLI or a one-off job):
   ```bash
   npx prisma migrate deploy
   npx prisma db seed
   ```

If you see **500 on `/api/public/modules`**, check Railway logs for the line `Error fetching public modules: ...`; the message will indicate DB connection or missing tables. Fix by running migrations and seed as above.

---

## Troubleshooting: P3009 failed migration

If you see:

```text
Error: P3009
migrate found failed migrations in the target database...
The `20250204000000_add_organization_expires_at` migration started at ... failed
```

Prisma has recorded a migration as failed, so it will not apply new migrations until you resolve it.

**Step 1 – Mark the failed migration as rolled back** (so Prisma will try it again):

From your machine, in **cca_backend**, set `DATABASE_URL` to your **Railway** Postgres URL (copy from Railway → Postgres service → Variables → `DATABASE_URL`), then run:

```bash
cd cca_backend
set DATABASE_URL=postgresql://...   # Windows: set; macOS/Linux: export DATABASE_URL=...
npx prisma migrate resolve --rolled-back "20250204000000_add_organization_expires_at"
```

**Step 2 – Redeploy the backend** on Railway (or run `npm run start:with-db` again). `prisma migrate deploy` will re-run that migration, then apply any later ones, then seed and start.

If Step 2 fails with an error like **column "expiresAt" already exists**, the migration had actually applied before failing. Then mark it as applied instead and deploy again:

```bash
npx prisma migrate resolve --applied "20250204000000_add_organization_expires_at"
```

Then redeploy so later migrations and seed can run.

---

## Re-running seed

Seed uses `upsert`: safe to run multiple times. Existing super admin user will be updated (e.g. password reset to `SUPER_ADMIN_PASSWORD` or default). To only reset the super admin password, run the seed again with the desired `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`.
