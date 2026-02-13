-- Single comprehensive migration for all database schema
-- This migration uses IF NOT EXISTS to be idempotent and safe to run multiple times

-- Note: This migration assumes the database already has the core tables from previous migrations
-- It focuses on ensuring all HR-related fields and any missing columns exist

-- Add missing columns to Employee table if they don't exist
DO $$ 
BEGIN
    -- hireDate
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Employee' AND column_name = 'hireDate'
    ) THEN
        ALTER TABLE "Employee" ADD COLUMN "hireDate" TIMESTAMP(3);
    END IF;
    
    -- photoUrl
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Employee' AND column_name = 'photoUrl'
    ) THEN
        ALTER TABLE "Employee" ADD COLUMN "photoUrl" TEXT;
    END IF;
    
    -- phone
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Employee' AND column_name = 'phone'
    ) THEN
        ALTER TABLE "Employee" ADD COLUMN "phone" TEXT;
    END IF;
    
    -- salary
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Employee' AND column_name = 'salary'
    ) THEN
        ALTER TABLE "Employee" ADD COLUMN "salary" INTEGER;
    END IF;
    
    -- employmentType
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Employee' AND column_name = 'employmentType'
    ) THEN
        ALTER TABLE "Employee" ADD COLUMN "employmentType" TEXT;
    END IF;
    
    -- notes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Employee' AND column_name = 'notes'
    ) THEN
        ALTER TABLE "Employee" ADD COLUMN "notes" TEXT;
    END IF;
END $$;

-- Create PayrollRecord table if it doesn't exist
CREATE TABLE IF NOT EXISTS "PayrollRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payPeriodStart" TIMESTAMP(3) NOT NULL,
    "payPeriodEnd" TIMESTAMP(3) NOT NULL,
    "baseSalary" INTEGER NOT NULL,
    "allowances" INTEGER NOT NULL DEFAULT 0,
    "deductions" INTEGER NOT NULL DEFAULT 0,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "netSalary" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paidAt" TIMESTAMP(3),
    "payslipUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRecord_pkey" PRIMARY KEY ("id")
);

-- Create indexes for PayrollRecord if they don't exist
CREATE INDEX IF NOT EXISTS "PayrollRecord_orgId_idx" ON "PayrollRecord"("orgId");
CREATE INDEX IF NOT EXISTS "PayrollRecord_employeeId_idx" ON "PayrollRecord"("employeeId");
CREATE INDEX IF NOT EXISTS "PayrollRecord_payPeriod_idx" ON "PayrollRecord"("payPeriodStart", "payPeriodEnd");

-- Add foreign key constraints for PayrollRecord if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'PayrollRecord_orgId_fkey'
    ) THEN
        ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_orgId_fkey" 
            FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'PayrollRecord_employeeId_fkey'
    ) THEN
        ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_employeeId_fkey" 
            FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Create AttendanceRecord table if it doesn't exist
CREATE TABLE IF NOT EXISTS "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clockIn" TIMESTAMP(3),
    "clockOut" TIMESTAMP(3),
    "breakDuration" INTEGER,
    "totalHours" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'present',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- Create indexes for AttendanceRecord if they don't exist
CREATE INDEX IF NOT EXISTS "AttendanceRecord_orgId_idx" ON "AttendanceRecord"("orgId");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_employeeId_idx" ON "AttendanceRecord"("employeeId");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_date_idx" ON "AttendanceRecord"("date");

-- Create unique index for AttendanceRecord if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'AttendanceRecord_employeeId_date_key'
    ) THEN
        CREATE UNIQUE INDEX "AttendanceRecord_employeeId_date_key" ON "AttendanceRecord"("employeeId", "date");
    END IF;
END $$;

-- Add foreign key constraints for AttendanceRecord if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'AttendanceRecord_orgId_fkey'
    ) THEN
        ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_orgId_fkey" 
            FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'AttendanceRecord_employeeId_fkey'
    ) THEN
        ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employeeId_fkey" 
            FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

