-- Demo Data for Oumie
-- Run this to create test students and assignments

-- Clear existing demo data (optional)
-- DELETE FROM time_logs WHERE student_id IN (SELECT id FROM students WHERE email LIKE '%@demo.oumie.com');
-- DELETE FROM assignments WHERE student_id IN (SELECT id FROM students WHERE email LIKE '%@demo.oumie.com');
-- DELETE FROM student_profiles WHERE student_id IN (SELECT id FROM students WHERE email LIKE '%@demo.oumie.com');
-- DELETE FROM students WHERE email LIKE '%@demo.oumie.com';

-- Reset sequences to start from 1
ALTER SEQUENCE students_id_seq RESTART WITH 1;
ALTER SEQUENCE assignments_id_seq RESTART WITH 1;
ALTER SEQUENCE time_logs_id_seq RESTART WITH 1;

-- Insert demo students
INSERT INTO students (name, email, university) VALUES
('Sarah Chen', 'sarah@demo.oumie.com', 'University of Arizona'),
('Mike Rodriguez', 'mike@demo.oumie.com', 'Arizona State University'),
('Emma Watson', 'emma@demo.oumie.com', 'Northern Arizona University')
ON CONFLICT (email) DO NOTHING;

-- Get student IDs
DO $$
DECLARE
    sarah_id INT;
    mike_id INT;
    emma_id INT;
BEGIN
    SELECT id INTO sarah_id FROM students WHERE email = 'sarah@demo.oumie.com';
    SELECT id INTO mike_id FROM students WHERE email = 'mike@demo.oumie.com';
    SELECT id INTO emma_id FROM students WHERE email = 'emma@demo.oumie.com';

    -- Insert student profiles
    INSERT INTO student_profiles (student_id, writing_speed, reading_speed, problem_solving_speed) VALUES
    (sarah_id, 300, 35, 6),
    (mike_id, 200, 25, 8),
    (emma_id, 350, 40, 5)
    ON CONFLICT DO NOTHING;

    -- Insert demo assignments for Sarah
    -- Insert demo assignments for Sarah
INSERT INTO assignments (student_id, title, assignment_type, due_date, estimated_hours, word_count) VALUES
(sarah_id, 'History Essay: WWII Impact', 'essay', NOW() + INTERVAL '3 days', 8.0, 2000),
(sarah_id, 'Calculus Problem Set #5', 'problem_set', NOW() + INTERVAL '2 days', 6.0, NULL),
(sarah_id, 'Biology Lab Report', 'lab_report', NOW() + INTERVAL '5 days', 4.0, NULL);

-- Insert demo assignments for Mike
INSERT INTO assignments (student_id, title, assignment_type, due_date, estimated_hours, word_count) VALUES
(mike_id, 'English Literature Analysis', 'essay', NOW() + INTERVAL '4 days', 10.0, 2500),
(mike_id, 'Chemistry Lab: Titration', 'lab_report', NOW() + INTERVAL '1 day', 3.0, NULL);

-- More realistic college assignments
INSERT INTO assignments (student_id, title, assignment_type, due_date, estimated_hours, word_count) VALUES
(sarah_id, 'Research Paper: Climate Policy', 'essay', NOW() + INTERVAL '7 days', 12.0, 3500),
(sarah_id, 'Midterm Study Guide', 'exam_prep', NOW() + INTERVAL '4 days', 5.0, NULL),
(mike_id, 'Programming Project: Binary Search Tree', 'coding_assignment', NOW() + INTERVAL '10 days', 8.0, NULL),
(mike_id, 'Case Study Analysis: Apple vs Samsung', 'essay', NOW() + INTERVAL '6 days', 6.0, 2000),
(emma_id, 'Statistics Homework Ch. 8', 'problem_set', NOW() + INTERVAL '2 days', 4.0, NULL);

    -- Insert demo time logs (Sarah worked on history essay)
    INSERT INTO time_logs (student_id, assignment_id, session_start, session_end, duration_minutes, is_active) VALUES
    (sarah_id, 
     (SELECT id FROM assignments WHERE student_id = sarah_id AND title LIKE '%History Essay%' LIMIT 1),
     NOW() - INTERVAL '2 hours',
     NOW() - INTERVAL '30 minutes',
     90,
     false);

END $$;

-- Verify data was inserted
SELECT 'Demo students created:' as message;
SELECT id, name, email, university FROM students WHERE email LIKE '%@demo.oumie.com';

SELECT 'Demo assignments created:' as message;
SELECT a.id, s.name as student, a.title, a.assignment_type, a.due_date 
FROM assignments a 
JOIN students s ON a.student_id = s.id 
WHERE s.email LIKE '%@demo.oumie.com'
ORDER BY a.due_date;

SELECT 'Demo time logs created:' as message;
SELECT tl.id, s.name as student, a.title, tl.duration_minutes 
FROM time_logs tl
JOIN students s ON tl.student_id = s.id
JOIN assignments a ON tl.assignment_id = a.id
WHERE s.email LIKE '%@demo.oumie.com';
