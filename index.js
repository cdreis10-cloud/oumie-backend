// Oumie Server - Now with Real Database!
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { awardBadge, hasAssignmentBadge, BADGES } = require('./badgeSystem');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// CORS must be FIRST, before any routes
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Allow these origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://oumie-dashboard.vercel.app'
    ];

    // Allow Chrome extensions
    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow all for now during development
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Then JSON parser
app.use(express.json());

// Health check route (for Render deployment)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Homepage route
app.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM students');
        const studentCount = parseInt(result.rows[0].count);
        
        res.json({ 
            message: '🎉 Oumie Server is ALIVE!',
            status: 'Ready to help students succeed',
            totalStudents: studentCount,
            database: 'Connected',
            endpoints: {
                signup: 'POST /signup',
                students: 'GET /students',
                addAssignment: 'POST /assignment',
                calculateTime: 'POST /calculate-time'
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Database error', details: error.message });
    }
});

// Student signup - NOW SAVES TO DATABASE!
app.post('/signup', async (req, res) => {
    const { name, email, university } = req.body;
    
    try {
        // Insert student into database
        const studentResult = await pool.query(
            'INSERT INTO students (name, email, university) VALUES ($1, $2, $3) RETURNING *',
            [name, email, university]
        );
        
        const newStudent = studentResult.rows[0];
        
        // Create default profile for this student
        await pool.query(
            'INSERT INTO student_profiles (student_id) VALUES ($1)',
            [newStudent.id]
        );
        
        res.json({
            message: 'Welcome to Oumie!',
            student: {
                id: newStudent.id,
                name: newStudent.name,
                email: newStudent.email,
                university: newStudent.university,
                signupDate: newStudent.created_at
            }
        });
    } catch (error) {
        if (error.code === '23505') { // Unique violation
            res.status(400).json({ error: 'Email already registered' });
        } else {
            res.status(500).json({ error: 'Failed to create student', details: error.message });
        }
    }
});

// Get all students
app.get('/students', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.*, 
                   sp.writing_speed, 
                   sp.procrastination_factor,
                   COUNT(a.id) as assignment_count
            FROM students s
            LEFT JOIN student_profiles sp ON s.id = sp.student_id
            LEFT JOIN assignments a ON s.id = a.student_id
            GROUP BY s.id, sp.id
            ORDER BY s.created_at DESC
        `);
        
        res.json({
            totalStudents: result.rows.length,
            students: result.rows
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch students', details: error.message });
    }
});

// Get single student with their profile
app.get('/student/:id', async (req, res) => {
    const studentId = req.params.id;
    
    try {
        const result = await pool.query(`
            SELECT s.*, sp.* 
            FROM students s
            LEFT JOIN student_profiles sp ON s.id = sp.student_id
            WHERE s.id = $1
        `, [studentId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        res.json({ student: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch student', details: error.message });
    }
});

// Add assignment for a student
app.post('/assignment', async (req, res) => {
    const { studentId, title, description, assignmentType, dueDate, estimatedHours, wordCount } = req.body;
    
    try {
        // Check if student exists
        const studentCheck = await pool.query('SELECT * FROM students WHERE id = $1', [studentId]);
        
        if (studentCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        // Insert assignment
        const result = await pool.query(`
            INSERT INTO assignments 
            (student_id, title, description, assignment_type, due_date, estimated_hours, word_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [studentId, title, description, assignmentType, dueDate, estimatedHours, wordCount]);
        
        const assignment = result.rows[0];
        
        res.json({
            message: 'Assignment added successfully!',
            assignment: {
                id: assignment.id,
                title: assignment.title,
                dueDate: assignment.due_date,
                estimatedHours: assignment.estimated_hours,
                studentName: studentCheck.rows[0].name
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create assignment', details: error.message });
    }
});

// Get all assignments for a student
app.get('/student/:id/assignments', async (req, res) => {
    const studentId = req.params.id;
    
    try {
        const result = await pool.query(`
            SELECT * FROM assignments 
            WHERE student_id = $1 
            ORDER BY due_date ASC
        `, [studentId]);
        
        res.json({
            studentId: studentId,
            assignmentCount: result.rows.length,
            assignments: result.rows
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch assignments', details: error.message });
    }
});

// Calculate personalized time estimate (SMART FEATURE!)
app.post('/calculate-time', async (req, res) => {
    const { studentId, assignmentType, wordCount, problemCount, pageCount } = req.body;
    
    try {
        // Get student's profile
        const profileResult = await pool.query(`
            SELECT * FROM student_profiles WHERE student_id = $1
        `, [studentId]);
        
        if (profileResult.rows.length === 0) {
            return res.status(404).json({ error: 'Student profile not found' });
        }
        
        const profile = profileResult.rows[0];
        let estimatedHours = 0;
        let breakdown = {};
        
        // Calculate based on assignment type
        if (assignmentType === 'essay' && wordCount) {
            const writingHours = wordCount / profile.writing_speed;
            const researchBuffer = writingHours * 0.3; // 30% extra for research
            const editingBuffer = writingHours * 0.2; // 20% extra for editing
            
            estimatedHours = writingHours + researchBuffer + editingBuffer;
            breakdown = {
                writing: writingHours.toFixed(2),
                research: researchBuffer.toFixed(2),
                editing: editingBuffer.toFixed(2),
                yourWritingSpeed: profile.writing_speed
            };
        } else if (assignmentType === 'problem_set' && problemCount) {
            estimatedHours = problemCount / profile.problem_solving_speed;
            breakdown = {
                problems: problemCount,
                yourSpeed: `${profile.problem_solving_speed} problems/hour`,
                baseTime: estimatedHours.toFixed(2)
            };
        } else if (assignmentType === 'reading' && pageCount) {
            estimatedHours = pageCount / profile.reading_speed;
            breakdown = {
                pages: pageCount,
                yourSpeed: `${profile.reading_speed} pages/hour`,
                baseTime: estimatedHours.toFixed(2)
            };
        }
        
        // Apply procrastination factor
        const finalHours = estimatedHours * profile.procrastination_factor;
        
        res.json({
            estimatedHours: finalHours.toFixed(2),
            breakdown: breakdown,
            procrastinationBuffer: `${((profile.procrastination_factor - 1) * 100).toFixed(0)}%`,
            recommendation: finalHours > 3 
                ? 'Start this assignment TODAY - it will take multiple sessions'
                : 'You can complete this in one focused session',
            peakProductivityHours: `${profile.peak_hour_start}:00 - ${profile.peak_hour_end}:00`
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to calculate time', details: error.message });
    }
});

// Mark assignment as complete (and track actual time spent)
app.post('/assignment/:id/complete', async (req, res) => {
    const assignmentId = req.params.id;
    const { actualHours } = req.body;
    
    try {
        const result = await pool.query(`
            UPDATE assignments 
            SET is_completed = true, 
                completed_at = NOW(),
                actual_hours = $1
            WHERE id = $2
            RETURNING *
        `, [actualHours, assignmentId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        
        const assignment = result.rows[0];

    // Check for badges!
    const earnedBadges = [];
    
    // Get student ID from assignment
    const studentId = assignment.student_id;
    
    // Check Speed Demon badge
    if (actualHours < assignment.estimated_hours * 0.7) {
      const alreadyHas = await hasAssignmentBadge(pool, studentId, 'speed_demon', assignmentId);
      if (!alreadyHas) {
        const badge = await awardBadge(pool, studentId, 'speed_demon');
        if (badge) earnedBadges.push(badge);
      }
    }
    
    // Check Early Bird badge
    const daysEarly = (new Date(assignment.due_date) - new Date()) / (1000 * 60 * 60 * 24);
    if (daysEarly >= 2) {
      const alreadyHas = await hasAssignmentBadge(pool, studentId, 'early_bird', assignmentId);
      if (!alreadyHas) {
        const badge = await awardBadge(pool, studentId, 'early_bird');
        if (badge) earnedBadges.push(badge);
      }
    }
    
    // Check First Assignment badge
    const completedCount = await pool.query(
      'SELECT COUNT(*) FROM assignments WHERE student_id = $1 AND is_completed = true',
      [studentId]
    );
    if (parseInt(completedCount.rows[0].count) === 1) {
      const badge = await awardBadge(pool, studentId, 'first_assignment');
      if (badge) earnedBadges.push(badge);
    }
        
        // Calculate accuracy
        const accuracy = assignment.estimated_hours 
            ? ((actualHours / assignment.estimated_hours) * 100).toFixed(0)
            : 0;
        
        res.json({
      message: 'Assignment marked complete!',
      assignment: assignment,
      accuracy: `${accuracy}% accurate`,
      wasEstimate: accuracy > 90 && accuracy < 110 ? 'Very accurate!' :
                   accuracy < 90 ? 'Took less time than expected' :
                   'Took more time than expected',
      badges: earnedBadges
    });
    } catch (error) {
        res.status(500).json({ error: 'Failed to complete assignment', details: error.message });
    }
});

// Update student profile (manual adjustment)
app.put('/student/:id/profile', async (req, res) => {
    const studentId = req.params.id;
    const { writingSpeed, readingSpeed, problemSolvingSpeed, procrastinationFactor } = req.body;
    
    try {
        const result = await pool.query(`
            UPDATE student_profiles 
            SET writing_speed = COALESCE($1, writing_speed),
                reading_speed = COALESCE($2, reading_speed),
                problem_solving_speed = COALESCE($3, problem_solving_speed),
                procrastination_factor = COALESCE($4, procrastination_factor)
            WHERE student_id = $5
            RETURNING *
        `, [writingSpeed, readingSpeed, problemSolvingSpeed, procrastinationFactor, studentId]);
        
        res.json({
            message: 'Profile updated!',
            profile: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update profile', details: error.message });
    }
});

// ============================================
// BROWSER EXTENSION ENDPOINTS
// ============================================

// Start time tracking session
app.post('/time-log/start', async (req, res) => {
    const { studentId, assignmentTitle, assignmentUrl, startTime } = req.body;
    
    try {
        // Find or create assignment
        let assignment = await pool.query(
            'SELECT * FROM assignments WHERE student_id = $1 AND canvas_url = $2',
            [studentId, assignmentUrl]
        );
        
        let assignmentId;
        if (assignment.rows.length === 0) {
            // Create new assignment automatically
            const newAssignment = await pool.query(`
                INSERT INTO assignments 
                (student_id, title, due_date, canvas_url, estimated_hours)
                VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, 5.0)
                RETURNING id
            `, [studentId, assignmentTitle, assignmentUrl]);
            assignmentId = newAssignment.rows[0].id;
        } else {
            assignmentId = assignment.rows[0].id;
        }
        
        // Create time log entry
        const result = await pool.query(`
            INSERT INTO time_logs 
            (student_id, assignment_id, session_start, is_active)
            VALUES ($1, $2, $3, true)
            RETURNING *
        `, [studentId, assignmentId, startTime]);
        
        res.json({
            message: 'Session started',
            log: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start session', details: error.message });
    }
});

// End time tracking session
app.post('/time-log/end', async (req, res) => {
    const { studentId, durationMinutes } = req.body;
    
    try {
        // Find and end active session
        const result = await pool.query(`
            UPDATE time_logs 
            SET session_end = NOW(),
                duration_minutes = $1,
                is_active = false
            WHERE student_id = $2 
              AND is_active = true
            RETURNING *
        `, [durationMinutes, studentId]);
        
        if (result.rows.length > 0) {
            res.json({
                message: 'Session ended',
                log: result.rows[0]
            });
        } else {
            res.status(404).json({ error: 'No active session found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to end session', details: error.message });
    }
});

// Get student stats
app.get('/student/:id/stats', async (req, res) => {
    const studentId = req.params.id;
    
    try {
        // Today's hours
        const todayResult = await pool.query(`
            SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as hours
            FROM time_logs
            WHERE student_id = $1
              AND DATE(session_start) = CURRENT_DATE
        `, [studentId]);
        
        // This week's hours
        const weekResult = await pool.query(`
            SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as hours
            FROM time_logs
            WHERE student_id = $1
              AND session_start >= DATE_TRUNC('week', CURRENT_DATE)
        `, [studentId]);
        
        res.json({
            todayHours: parseFloat(todayResult.rows[0].hours) || 0,
            weekHours: parseFloat(weekResult.rows[0].hours) || 0
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get stats', details: error.message });
    }
});

// Get current assignment progress (for active tracking)
app.get('/assignment/:assignmentId/progress', async (req, res) => {
    const assignmentId = req.params.assignmentId;
    
    try {
        // Get assignment details
        const assignmentResult = await pool.query(`
            SELECT 
                a.id,
                a.title,
                a.due_date,
                a.estimated_hours,
                COALESCE(SUM(tl.duration_minutes), 0) / 60.0 as hours_tracked
            FROM assignments a
            LEFT JOIN time_logs tl ON a.id = tl.assignment_id
            WHERE a.id = $1
            GROUP BY a.id
        `, [assignmentId]);
        
        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        
        const assignment = assignmentResult.rows[0];
        const hoursTracked = parseFloat(assignment.hours_tracked) || 0;
        const estimatedHours = parseFloat(assignment.estimated_hours) || 5;
        const progressPercent = Math.min((hoursTracked / estimatedHours) * 100, 100);
        
        // Calculate days until due
        const daysUntilDue = Math.ceil((new Date(assignment.due_date) - new Date()) / (1000 * 60 * 60 * 24));
        
        // Determine status color
        let status = 'on-track'; // green
        if (progressPercent < 50 && daysUntilDue <= 2) {
            status = 'behind'; // red
        } else if (progressPercent < 75 && daysUntilDue <= 3) {
            status = 'warning'; // yellow
        }
        
        res.json({
             assignmentId: assignment.id,
            assignmentTitle: assignment.title,
            hoursTracked: hoursTracked.toFixed(1),
            estimatedHours: estimatedHours.toFixed(1),
            hoursRemaining: Math.max(0, estimatedHours - hoursTracked).toFixed(1),
            progressPercent: progressPercent.toFixed(0),
            daysUntilDue: daysUntilDue,
            dueDate: assignment.due_date,
            status: status
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get progress', details: error.message });
    }
});

// Get all assignments for a student
app.get('/student/:studentId/assignments', async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const result = await pool.query(
      `SELECT 
        id,
        title,
        assignment_type,
        due_date,
        estimated_hours,
        created_at
       FROM assignments 
       WHERE student_id = $1 
       ORDER BY due_date ASC`,
      [studentId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Create new assignment for a student
app.post('/student/:studentId/assignments', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { title, assignment_type, due_date, estimated_hours } = req.body;
    
    // Validate required fields
    if (!title || !assignment_type || !due_date || !estimated_hours) {
      return res.status(400).json({ 
        error: 'Missing required fields: title, assignment_type, due_date, estimated_hours' 
      });
    }
    
    const result = await pool.query(
      `INSERT INTO assignments (student_id, title, assignment_type, due_date, estimated_hours)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [studentId, title, assignment_type, due_date, estimated_hours]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating assignment:', error);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

// Delete assignment
app.delete('/assignment/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete associated time logs first (foreign key constraint)
    await pool.query('DELETE FROM time_logs WHERE assignment_id = $1', [id]);
    
    // Delete assignment
    const result = await pool.query('DELETE FROM assignments WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    
    res.json({ message: 'Assignment deleted successfully', assignment: result.rows[0] });
  } catch (error) {
    console.error('Error deleting assignment:', error);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ================================');
    console.log('✅ Oumie Server is RUNNING!');
    console.log(`📍 Server running on port ${PORT}`);
    console.log('🗄️  Database: PostgreSQL');
    console.log('🔌 Extension endpoints ready!');
    console.log('================================\n');

    // Test database connection after server starts
    pool.query('SELECT NOW()', (err, res) => {
        if (err) {
            console.error('❌ Database connection failed:', err);
        } else {
            console.log('✅ Database connected successfully!');
        }
    });
});
