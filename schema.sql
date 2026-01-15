-- Oumie Database Schema
-- Updated for browser extension support

-- Students table
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    university VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Student profiles
CREATE TABLE IF NOT EXISTS student_profiles (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    writing_speed INTEGER DEFAULT 250,
    reading_speed INTEGER DEFAULT 30,
    problem_solving_speed INTEGER DEFAULT 5,
    procrastination_factor FLOAT DEFAULT 1.0,
    peak_hour_start INTEGER DEFAULT 10,
    peak_hour_end INTEGER DEFAULT 14,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Assignments table
CREATE TABLE IF NOT EXISTS assignments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    assignment_type VARCHAR(100),
    course_name VARCHAR(255),
    due_date TIMESTAMP NOT NULL,
    estimated_hours FLOAT,
    actual_hours FLOAT,
    is_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP,
    word_count INTEGER,
    problem_count INTEGER,
    page_count INTEGER,
    canvas_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Time logs for browser extension
CREATE TABLE IF NOT EXISTS time_logs (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
    session_start TIMESTAMP NOT NULL,
    session_end TIMESTAMP,
    duration_minutes INTEGER,
    was_focused BOOLEAN DEFAULT true,
    activity_type VARCHAR(50),
    url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Assignment type seeds
CREATE TABLE IF NOT EXISTS assignment_type_seeds (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) NOT NULL,
    subcategory VARCHAR(100),
    subject_area VARCHAR(100),
    estimated_hours_min DECIMAL(5,2) NOT NULL,
    estimated_hours_max DECIMAL(5,2) NOT NULL,
    difficulty_factors JSONB,
    description TEXT,
    source VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Learning patterns
CREATE TABLE IF NOT EXISTS learning_patterns (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    pattern_type VARCHAR(50),
    pattern_key VARCHAR(100),
    pattern_value FLOAT,
    confidence_score FLOAT DEFAULT 0,
    sample_size INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    notification_type VARCHAR(50),
    scheduled_for TIMESTAMP NOT NULL,
    sent_at TIMESTAMP,
    was_sent BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);
CREATE INDEX IF NOT EXISTS idx_assignments_student ON assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_assignments_due ON assignments(due_date);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_student ON learning_patterns(student_id);
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON notifications(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_time_logs_student ON time_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_time_logs_assignment ON time_logs(assignment_id);
CREATE INDEX IF NOT EXISTS idx_time_logs_active ON time_logs(is_active);

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_student_profiles_updated_at 
    BEFORE UPDATE ON student_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assignments_updated_at 
    BEFORE UPDATE ON assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_learning_patterns_updated_at 
    BEFORE UPDATE ON learning_patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed data
INSERT INTO assignment_type_seeds (category, subcategory, subject_area, estimated_hours_min, estimated_hours_max, difficulty_factors, description, source) VALUES
('essay', 'reflection', 'general', 2.5, 5.0, '{"pages": 5}', '5-page reflective essay', 'Rice CTE'),
('essay', 'argumentative', 'general', 5.0, 12.5, '{"pages": 5}', '5-page argumentative essay', 'Rice CTE'),
('essay', 'research_paper', 'general', 20.0, 50.0, '{"pages": 10}', '10-page research paper', 'Rice CTE'),
('problem_set', 'calculus', 'STEM', 5.0, 10.0, '{"problems": 15}', '15-problem calculus set', 'Survey 2023'),
('reading', 'survey', 'general', 0.5, 2.0, '{"pages": 50}', '50 pages survey reading', 'Rice CTE'),
('lab_report', 'general', 'STEM', 1.0, 3.0, '{"pages": 5}', 'General lab report', 'Survey 2023'),
('presentation', 'short', 'general', 2.0, 4.0, '{"duration": 10}', '10-minute presentation', 'Academic');
