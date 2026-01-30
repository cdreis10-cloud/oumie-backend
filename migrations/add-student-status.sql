-- Student status tracking
-- Adds intelligent detection for when students graduate
-- Zero friction - runs entirely in background

-- Add status columns to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) DEFAULT 'active';
-- Values: 'active', 'graduated_suspected', 'graduated_confirmed', 'inactive', 'dormant'

ALTER TABLE students ADD COLUMN IF NOT EXISTS status_confidence INTEGER DEFAULT 100;
-- 0-100 confidence score that they're still a student

ALTER TABLE students ADD COLUMN IF NOT EXISTS last_lms_activity TIMESTAMP;
-- Last time they visited Canvas/Blackboard

ALTER TABLE students ADD COLUMN IF NOT EXISTS last_active TIMESTAMP DEFAULT NOW();
-- Last time extension sent any data

ALTER TABLE students ADD COLUMN IF NOT EXISTS graduation_signals JSONB DEFAULT '{}';
-- Stores detection signals: {"no_lms": true, "work_patterns": true, etc.}

-- Index for filtering active students
CREATE INDEX IF NOT EXISTS idx_students_status ON students(account_status);
CREATE INDEX IF NOT EXISTS idx_students_last_active ON students(last_active);

-- Add columns to time_logs for better detection
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS site_name VARCHAR(100);
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS assignment_title VARCHAR(255);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_time_logs_student_created ON time_logs(student_id, created_at DESC);
