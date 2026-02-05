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

From the **cca_backend** folder:

```bash
cd cca_backend
npm install
npx prisma generate
npx prisma migrate deploy
```

- **`prisma generate`** – generates the Prisma client.
- **`prisma migrate deploy`** – applies all migrations and creates/updates tables (use this in production or when DB already exists).

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

## Re-running seed

Seed uses `upsert`: safe to run multiple times. Existing super admin user will be updated (e.g. password reset to `SUPER_ADMIN_PASSWORD` or default). To only reset the super admin password, run the seed again with the desired `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`.
