-- Email verifications table
CREATE TABLE IF NOT EXISTS email_verifications (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  code VARCHAR(10) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add university fields to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS university_domain VARCHAR(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS university_id INTEGER;
ALTER TABLE students ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_students_university_domain ON students(university_domain);
CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);
