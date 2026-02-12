-- Add missing phone column to Employee table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Employee' AND column_name = 'phone'
    ) THEN
        ALTER TABLE "Employee" ADD COLUMN "phone" TEXT;
    END IF;
END $$;

