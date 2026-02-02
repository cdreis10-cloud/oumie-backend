-- Add missing columns to time_logs table for extension tracking
ALTER TABLE time_logs
ADD COLUMN IF NOT EXISTS site_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS assignment_title VARCHAR(500);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_time_logs_site_name ON time_logs(site_name);
