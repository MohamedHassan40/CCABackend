# Resolve Failed Migration

## Current Issue

The migration `20250212000002_ensure_all_hr_fields` failed because it tried to create an index that already exists. The migration file has been fixed, but Prisma won't retry it until you resolve the failed migration status.

## Quick Fix

You need to mark the failed migration as "rolled back" so Prisma will retry it with the fixed version.

### Option 1: Using Railway CLI (Recommended)

1. Install Railway CLI if you haven't: https://docs.railway.app/develop/cli
2. Run this command:

```bash
railway run --service backend npx prisma migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields"
```

### Option 2: Using Railway Console

1. Go to your Railway project
2. Open the backend service
3. Click on "Deployments" → "View Logs" or use the "Console" tab
4. Run:

```bash
npx prisma migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields"
```

### Option 3: From Your Local Machine

1. Get your Railway database URL:
   - Go to Railway → Your Postgres service → Variables
   - Copy the `DATABASE_URL`

2. Set it and run the resolve command:

```bash
cd cca_backend

# Windows PowerShell:
$env:DATABASE_URL="postgresql://..."

# Windows CMD:
set DATABASE_URL=postgresql://...

# macOS/Linux:
export DATABASE_URL="postgresql://..."

# Then resolve:
npx prisma migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields"
```

## After Resolving

Once you've resolved the migration, redeploy your backend service. The fixed migration will run automatically and complete successfully.

The entrypoint script has been updated to automatically handle failed migrations in the future, so this shouldn't happen again.

## Alternative: Mark as Applied

If you're confident the migration partially succeeded (e.g., the index already exists from a previous migration), you can mark it as applied instead:

```bash
npx prisma migrate resolve --applied "20250212000002_ensure_all_hr_fields"
```

This will skip retrying the migration, but you should only do this if you're sure everything else in the migration succeeded.

