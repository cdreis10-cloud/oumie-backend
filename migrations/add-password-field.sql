-- Add password and codename fields to students table
ALTER TABLE students
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
ADD COLUMN IF NOT EXISTS codename VARCHAR(100),
ADD COLUMN IF NOT EXISTS last_login TIMESTAMP,
ADD COLUMN IF NOT EXISTS refresh_token TEXT;

-- Create index on codename for efficient lookups
CREATE INDEX IF NOT EXISTS idx_students_codename ON students(codename);

-- Add a column for account verification (optional for future use)
ALTER TABLE students
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
