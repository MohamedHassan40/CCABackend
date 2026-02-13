# Quick Fix for Failed Migration

## Option 1: Run SQL Directly (Fastest - Recommended)

Connect to your Railway database and run this SQL:

```sql
UPDATE "_prisma_migrations"
SET 
    rolled_back_at = NOW(),
    finished_at = NULL,
    applied_steps_count = 0
WHERE migration_name = '20250212000002_ensure_all_hr_fields'
  AND finished_at IS NULL;
```

### How to run this:

**Via Railway Dashboard:**
1. Go to Railway → Your Postgres service
2. Click "Query" or "Connect" 
3. Paste the SQL above and run it

**Via Railway CLI:**
```bash
railway connect postgres
# Then paste the SQL
```

**Via psql (if you have connection string):**
```bash
psql "your-database-url" -c "UPDATE \"_prisma_migrations\" SET rolled_back_at = NOW(), finished_at = NULL, applied_steps_count = 0 WHERE migration_name = '20250212000002_ensure_all_hr_fields' AND finished_at IS NULL;"
```

## Option 2: Use Prisma Migrate Resolve

**Via Railway Console:**
1. Go to Railway → Backend service → Console
2. Run:
```bash
npx prisma migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields"
```

**Via Railway CLI:**
```bash
railway run --service backend npx prisma migrate resolve --rolled-back "20250212000002_ensure_all_hr_fields"
```

## Option 3: Delete the Migration Record (Last Resort)

⚠️ **Only if Options 1 & 2 don't work**

```sql
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20250212000002_ensure_all_hr_fields'
  AND finished_at IS NULL;
```

Then delete the migration file:
```bash
rm -rf cca_backend/prisma/migrations/20250212000002_ensure_all_hr_fields
```

And recreate it (but this is more complex).

---

## After Fixing

Once you've resolved the migration using Option 1 or 2:
1. **Redeploy your backend** - The fixed migration will run automatically
2. The migration should complete successfully this time

## Why This Happened

The migration failed because it tried to create an index that already existed. The migration file has been fixed to check for existing indexes before creating them, so this won't happen again.

