# Delete Failed Migration - IMMEDIATE FIX

## Step 1: Delete the Failed Migration Record from Database

**Run this SQL on your Railway database:**

```sql
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20250212000002_ensure_all_hr_fields';
```

### How to run:
1. Go to Railway → Postgres service → Query/Console
2. Paste and run the SQL above

## Step 2: Redeploy Backend

After deleting the migration record, redeploy your backend service. The new migration `20250213000000_ensure_all_hr_fields` will run automatically.

## What I Did

1. ✅ **Deleted** the old failed migration file: `20250212000002_ensure_all_hr_fields`
2. ✅ **Created** a new migration: `20250213000000_ensure_all_hr_fields` (with the fixed code)
3. ✅ **Updated** the entrypoint script to automatically clean up old failed migrations
4. ✅ **Created** a SQL script to manually delete the failed migration record

## After Running the SQL

Once you delete the migration record and redeploy:
- The new migration will run automatically
- All HR fields and tables will be created
- Your backend will start successfully

The entrypoint script will also try to clean up old failed migrations automatically on future deployments.

