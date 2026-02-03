// Oumie Server - Now with Real Database!
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { awardBadge, hasAssignmentBadge, BADGES } = require('./badgeSystem');
const StudentStatusDetector = require('./services/studentStatusDetector');
const {
  authLimiter,
  generateCodename,
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticateToken,
  validatePassword,
  validateEmail
} = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// University domain mapping
const universityDomains = {
  'umontana.edu': { name: 'University of Montana', shortName: 'UMontana', id: 1 },
  'umt.edu': { name: 'University of Montana', shortName: 'UMontana', id: 1 },
  'ucla.edu': { name: 'University of California, Los Angeles', shortName: 'UCLA', id: 2 },
  'berkeley.edu': { name: 'UC Berkeley', shortName: 'Berkeley', id: 3 },
  'stanford.edu': { name: 'Stanford University', shortName: 'Stanford', id: 4 },
  'harvard.edu': { name: 'Harvard University', shortName: 'Harvard', id: 5 },
  'mit.edu': { name: 'Massachusetts Institute of Technology', shortName: 'MIT', id: 6 },
  'utexas.edu': { name: 'University of Texas at Austin', shortName: 'UT Austin', id: 7 },
  'umich.edu': { name: 'University of Michigan', shortName: 'UMich', id: 8 },
  'unc.edu': { name: 'University of North Carolina', shortName: 'UNC', id: 9 },
  'nyu.edu': { name: 'New York University', shortName: 'NYU', id: 10 },
};

// Helper: extract university info from email
function getUniversityFromEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  if (universityDomains[domain]) {
    return universityDomains[domain];
  }

  if (domain.endsWith('.edu')) {
    const name = domain.replace('.edu', '').split('.').pop();
    const formattedName = name.charAt(0).toUpperCase() + name.slice(1);
    return {
      name: `${formattedName} University`,
      shortName: formattedName,
      id: null,
      domain: domain
    };
  }

  return null;
}

// Helper: check if email is .edu
function isEduEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain?.endsWith('.edu') || false;
}

// Helper: generate 6-digit verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Initialize status detector with database connection
const statusDetector = new StudentStatusDetector(pool);

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

// ============================================
// EMAIL VERIFICATION ENDPOINTS
// ============================================

// Check if email is a valid .edu address
app.post('/auth/check-email', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const isEdu = isEduEmail(email);
  const university = getUniversityFromEmail(email);

  res.json({
    isValid: isEdu,
    isEdu: isEdu,
    university: university,
    message: isEdu
      ? `Great! We detected you're from ${university?.name || 'a university'}`
      : 'Please use your university .edu email address'
  });
});

// Send verification code to .edu email
app.post('/auth/send-verification', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (!isEduEmail(email)) {
    return res.status(400).json({ error: 'Please use a valid .edu email address' });
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  try {
    await pool.query(`
      INSERT INTO email_verifications (email, code, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (email)
      DO UPDATE SET code = $2, expires_at = $3, verified = false
    `, [email.toLowerCase(), code, expiresAt]);

    // In production, send actual email here using SendGrid, AWS SES, etc.
    console.log(`Verification code for ${email}: ${code}`);

    // DEV ONLY - include code in response so signup page can auto-fill
    // REMOVE devCode in production
    res.json({
      success: true,
      message: 'Verification code sent to your email',
      devCode: process.env.NODE_ENV === 'production' ? undefined : code
    });
  } catch (error) {
    console.error('Send verification error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// Verify the 6-digit code
app.post('/auth/verify-code', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  try {
    const result = await pool.query(`
      SELECT * FROM email_verifications
      WHERE email = $1 AND code = $2 AND expires_at > NOW()
    `, [email.toLowerCase(), code]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    // Mark as verified
    await pool.query(`
      UPDATE email_verifications SET verified = true WHERE email = $1
    `, [email.toLowerCase()]);

    const university = getUniversityFromEmail(email);

    res.json({
      success: true,
      verified: true,
      university: university
    });
  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

// Signup endpoint with password
app.post('/auth/signup', authLimiter, async (req, res) => {
    const { name, email, password, university, universityDomain } = req.body;

    try {
        // Validate input
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        // Validate email format
        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Validate password strength
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
            return res.status(400).json({
                error: 'Password does not meet requirements',
                details: passwordValidation.errors
            });
        }

        // Check if email already exists
        const existingUser = await pool.query(
            'SELECT id FROM students WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Check if email was verified through the verification flow
        const verificationRecord = await pool.query(
            'SELECT verified FROM email_verifications WHERE email = $1',
            [email.toLowerCase()]
        );
        const emailVerified = verificationRecord.rows.length > 0 && verificationRecord.rows[0].verified;

        // Extract university info from email domain
        const detectedUniversity = getUniversityFromEmail(email);
        const resolvedUniversity = university || detectedUniversity?.name || null;
        const resolvedDomain = universityDomain || email.split('@')[1]?.toLowerCase() || null;
        const resolvedUniversityId = detectedUniversity?.id || null;

        // Hash password
        const passwordHash = await hashPassword(password);

        // Generate unique codename
        let codename = generateCodename();
        let codenameExists = true;

        // Ensure codename is unique
        while (codenameExists) {
            const check = await pool.query(
                'SELECT id FROM students WHERE codename = $1',
                [codename]
            );
            if (check.rows.length === 0) {
                codenameExists = false;
            } else {
                codename = generateCodename();
            }
        }

        // Insert student into database
        const studentResult = await pool.query(
            `INSERT INTO students (name, email, password_hash, university, codename, email_verified, university_domain, university_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, name, email, university, codename, created_at`,
            [name, email, passwordHash, resolvedUniversity, codename, emailVerified, resolvedDomain, resolvedUniversityId]
        );

        const newStudent = studentResult.rows[0];

        // Create default profile for this student
        await pool.query(
            'INSERT INTO student_profiles (student_id) VALUES ($1)',
            [newStudent.id]
        );

        // Generate tokens
        const token = generateAccessToken(newStudent.id, newStudent.email, false);
        const refreshToken = generateRefreshToken(newStudent.id, newStudent.email);

        // Store refresh token
        await pool.query(
            'UPDATE students SET refresh_token = $1, last_login = NOW() WHERE id = $2',
            [refreshToken, newStudent.id]
        );

        res.status(201).json({
            message: 'Account created successfully',
            token,
            refreshToken,
            user: {
                id: newStudent.id,
                name: newStudent.name,
                email: newStudent.email,
                university: newStudent.university,
                codename: newStudent.codename
            }
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Failed to create account', details: error.message });
    }
});

// Login endpoint
app.post('/auth/login', authLimiter, async (req, res) => {
    const { email, password, rememberMe } = req.body;

    try {
        // Validate input
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user by email
        const result = await pool.query(
            'SELECT id, name, email, password_hash, university, codename FROM students WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];

        // Check if password hash exists (for backward compatibility with old accounts)
        if (!user.password_hash) {
            return res.status(401).json({
                error: 'Account not set up with password. Please contact support or create a new account.'
            });
        }

        // Compare password
        const isPasswordValid = await comparePassword(password, user.password_hash);

        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Generate tokens (with longer expiry if rememberMe is true)
        const token = generateAccessToken(user.id, user.email, rememberMe);
        const refreshToken = generateRefreshToken(user.id, user.email);

        // Store refresh token and update last login
        await pool.query(
            'UPDATE students SET refresh_token = $1, last_login = NOW() WHERE id = $2',
            [refreshToken, user.id]
        );

        res.json({
            message: 'Login successful',
            token,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                university: user.university,
                codename: user.codename
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed', details: error.message });
    }
});

// Refresh token endpoint
app.post('/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token required' });
    }

    try {
        // Verify refresh token
        const decoded = verifyRefreshToken(refreshToken);

        if (!decoded) {
            return res.status(403).json({ error: 'Invalid or expired refresh token' });
        }

        // Check if token exists in database
        const result = await pool.query(
            'SELECT id, email, name, university, codename FROM students WHERE id = $1 AND refresh_token = $2',
            [decoded.userId, refreshToken]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'Invalid refresh token' });
        }

        const user = result.rows[0];

        // Generate new access token
        const newAccessToken = generateAccessToken(user.id, user.email, false);

        res.json({
            token: newAccessToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                university: user.university,
                codename: user.codename
            }
        });
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({ error: 'Failed to refresh token' });
    }
});

// Logout endpoint
app.post('/auth/logout', authenticateToken, async (req, res) => {
    try {
        // Clear refresh token from database
        await pool.query(
            'UPDATE students SET refresh_token = NULL WHERE id = $1',
            [req.user.userId]
        );

        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// Get current user info (protected route example)
app.get('/auth/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, email, university, codename, created_at FROM students WHERE id = $1',
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

// ============================================
// LEGACY ENDPOINTS (for backward compatibility)
// ============================================

// Student signup - OLD VERSION (kept for backward compatibility)
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
    const { studentId, assignmentTitle, assignmentUrl, startTime, siteName } = req.body;

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

        // Create time log entry with site_name and assignment_title for detection
        const result = await pool.query(`
            INSERT INTO time_logs
            (student_id, assignment_id, session_start, is_active, site_name, assignment_title)
            VALUES ($1, $2, $3, true, $4, $5)
            RETURNING *
        `, [studentId, assignmentId, startTime, siteName, assignmentTitle]);

        // Record LMS activity for status detection
        if (siteName) {
            await statusDetector.recordLMSActivity(studentId, siteName);
        }

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

        // Yesterday's hours (for comparison)
        const yesterdayResult = await pool.query(`
            SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as hours
            FROM time_logs
            WHERE student_id = $1
              AND DATE(session_start) = CURRENT_DATE - INTERVAL '1 day'
        `, [studentId]);

        // This week's hours
        const weekResult = await pool.query(`
            SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as hours
            FROM time_logs
            WHERE student_id = $1
              AND session_start >= DATE_TRUNC('week', CURRENT_DATE)
        `, [studentId]);

        // Last week's hours (for comparison)
        const lastWeekResult = await pool.query(`
            SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as hours
            FROM time_logs
            WHERE student_id = $1
              AND session_start >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'
              AND session_start < DATE_TRUNC('week', CURRENT_DATE)
        `, [studentId]);

        // Total hours all time
        const totalResult = await pool.query(`
            SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as hours
            FROM time_logs
            WHERE student_id = $1
        `, [studentId]);

        // Current streak (consecutive days with study time)
        const streakResult = await pool.query(`
            WITH daily_activity AS (
                SELECT DISTINCT DATE(session_start) as study_date
                FROM time_logs
                WHERE student_id = $1
                  AND session_start >= CURRENT_DATE - INTERVAL '30 days'
                ORDER BY study_date DESC
            ),
            streak_calc AS (
                SELECT
                    study_date,
                    study_date - ROW_NUMBER() OVER (ORDER BY study_date DESC)::int as streak_group
                FROM daily_activity
            )
            SELECT COUNT(*) as streak
            FROM streak_calc
            WHERE streak_group = (
                SELECT streak_group
                FROM streak_calc
                LIMIT 1
            )
        `, [studentId]);

        // Assignments count
        const assignmentsResult = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE is_completed = false) as active,
                COUNT(*) FILTER (WHERE is_completed = false AND due_date <= CURRENT_DATE + INTERVAL '7 days') as due_this_week
            FROM assignments
            WHERE student_id = $1
        `, [studentId]);

        // Focus score (percentage of sessions that weren't paused)
        const focusResult = await pool.query(`
            SELECT
                CASE
                    WHEN COUNT(*) = 0 THEN 0
                    ELSE ROUND((COUNT(*) FILTER (WHERE was_focused IS NULL OR was_focused = true)::float / COUNT(*)) * 100)
                END as focus_score
            FROM time_logs
            WHERE student_id = $1
              AND session_start >= CURRENT_DATE - INTERVAL '7 days'
        `, [studentId]);

        // Weekly breakdown (last 7 days)
        const weeklyDataResult = await pool.query(`
            SELECT
                TO_CHAR(date_series.day, 'Dy') as day,
                COALESCE(SUM(tl.duration_minutes), 0) / 60.0 as hours
            FROM (
                SELECT generate_series(
                    DATE_TRUNC('week', CURRENT_DATE),
                    DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '6 days',
                    '1 day'::interval
                )::date as day
            ) date_series
            LEFT JOIN time_logs tl ON DATE(tl.session_start) = date_series.day AND tl.student_id = $1
            GROUP BY date_series.day
            ORDER BY date_series.day
        `, [studentId]);

        // Recent activity (last 5 sessions)
        const recentActivityResult = await pool.query(`
            SELECT
                a.title,
                a.assignment_type,
                tl.duration_minutes / 60.0 as hours,
                tl.session_start
            FROM time_logs tl
            LEFT JOIN assignments a ON tl.assignment_id = a.id
            WHERE tl.student_id = $1
              AND tl.duration_minutes > 0
            ORDER BY tl.session_start DESC
            LIMIT 5
        `, [studentId]);

        const todayHours = parseFloat(todayResult.rows[0].hours) || 0;
        const yesterdayHours = parseFloat(yesterdayResult.rows[0].hours) || 0;
        const weekHours = parseFloat(weekResult.rows[0].hours) || 0;
        const lastWeekHours = parseFloat(lastWeekResult.rows[0].hours) || 0;

        res.json({
            todayHours: todayHours,
            yesterdayHours: yesterdayHours,
            todayChange: todayHours - yesterdayHours,
            weekHours: weekHours,
            lastWeekHours: lastWeekHours,
            weekChange: lastWeekHours > 0 ? ((weekHours - lastWeekHours) / lastWeekHours * 100) : 0,
            totalHours: parseFloat(totalResult.rows[0].hours) || 0,
            currentStreak: parseInt(streakResult.rows[0]?.streak) || 0,
            assignments: {
                total: parseInt(assignmentsResult.rows[0]?.active) || 0,
                dueThisWeek: parseInt(assignmentsResult.rows[0]?.due_this_week) || 0
            },
            focusScore: parseInt(focusResult.rows[0]?.focus_score) || 0,
            weeklyData: weeklyDataResult.rows.map(row => ({
                day: row.day,
                hours: parseFloat(row.hours) || 0
            })),
            recentActivity: recentActivityResult.rows.map(row => ({
                title: row.title || 'Study Session',
                hours: parseFloat(row.hours) || 0,
                when: formatTimeAgo(row.session_start),
                icon: getIconForType(row.assignment_type)
            }))
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get stats', details: error.message });
    }
});

// Helper function to format time ago
function formatTimeAgo(date) {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    return 'Just now';
}

// Helper function to get icon for assignment type
function getIconForType(type) {
    const icons = {
        'essay': '📝',
        'research_paper': '📚',
        'lab_report': '🧪',
        'problem_set': '📐',
        'reading': '📖',
        'exam_prep': '✏️',
        'presentation': '🎤',
        'coding_assignment': '💻'
    };
    return icons[type] || '📄';
}

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

// ============================================
// STUDENT STATUS DETECTION ENDPOINTS
// ============================================

// Manually trigger detection for all students (admin only, for testing)
app.post('/admin/detect-graduated', async (req, res) => {
  try {
    const results = await statusDetector.analyzeAllStudents();
    res.json({
      success: true,
      message: `Analyzed students, found ${results.length} status changes`,
      changes: results
    });
  } catch (error) {
    console.error('Detection error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check single student status
app.get('/student/:id/status', async (req, res) => {
  try {
    const result = await statusDetector.analyzeStudent(parseInt(req.params.id));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get university status summary
app.get('/university/:id/student-status-summary', async (req, res) => {
  try {
    const summary = await statusDetector.getUniversityStatusSummary(parseInt(req.params.id));
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// NEW DASHBOARD ENDPOINTS
// ============================================

// Learning Fingerprint - analyze study patterns
app.get('/student/:id/learning-fingerprint', async (req, res) => {
  const studentId = req.params.id;

  try {
    // Get hour-by-hour productivity
    const hourlyData = await pool.query(`
      SELECT
        EXTRACT(HOUR FROM session_start) as hour,
        COUNT(*) as session_count,
        AVG(duration_minutes) as avg_duration,
        SUM(duration_minutes) as total_minutes
      FROM time_logs
      WHERE student_id = $1 AND duration_minutes > 0
      GROUP BY EXTRACT(HOUR FROM session_start)
      ORDER BY total_minutes DESC
    `, [studentId]);

    // Get day-of-week productivity
    const dayData = await pool.query(`
      SELECT
        EXTRACT(DOW FROM session_start) as day_num,
        COUNT(*) as session_count,
        AVG(duration_minutes) as avg_duration,
        SUM(duration_minutes) as total_minutes
      FROM time_logs
      WHERE student_id = $1 AND duration_minutes > 0
      GROUP BY EXTRACT(DOW FROM session_start)
      ORDER BY total_minutes DESC
    `, [studentId]);

    // Average session length
    const avgSession = await pool.query(`
      SELECT AVG(duration_minutes) as avg_minutes
      FROM time_logs
      WHERE student_id = $1 AND duration_minutes > 0
    `, [studentId]);

    // Map day numbers to names
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const peakHours = hourlyData.rows.slice(0, 3).map(row => ({
      hour: parseInt(row.hour),
      displayHour: `${parseInt(row.hour) % 12 || 12}${parseInt(row.hour) < 12 ? 'AM' : 'PM'}`,
      totalMinutes: parseFloat(row.total_minutes),
      sessionCount: parseInt(row.session_count)
    }));

    const mostProductiveDay = dayData.rows.length > 0 ? {
      day: dayNames[parseInt(dayData.rows[0].day_num)],
      totalMinutes: parseFloat(dayData.rows[0].total_minutes),
      sessionCount: parseInt(dayData.rows[0].session_count)
    } : null;

    res.json({
      peakHours,
      mostProductiveDay,
      averageSessionLength: parseFloat(avgSession.rows[0].avg_minutes || 0),
      hourlyBreakdown: hourlyData.rows.map(row => ({
        hour: parseInt(row.hour),
        displayHour: `${parseInt(row.hour) % 12 || 12}${parseInt(row.hour) < 12 ? 'AM' : 'PM'}`,
        totalHours: (parseFloat(row.total_minutes) / 60).toFixed(1)
      })),
      weeklyBreakdown: dayData.rows.map(row => ({
        day: dayNames[parseInt(row.day_num)],
        totalHours: (parseFloat(row.total_minutes) / 60).toFixed(1)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch learning fingerprint', details: error.message });
  }
});

// Academic DNA - subject breakdown and deep work analysis
app.get('/student/:id/academic-dna', async (req, res) => {
  const studentId = req.params.id;

  try {
    // Get subjects ranked by time spent
    const subjectData = await pool.query(`
      SELECT
        a.subject,
        COUNT(DISTINCT a.id) as assignment_count,
        SUM(tl.duration_minutes) as total_minutes,
        AVG(tl.duration_minutes) as avg_session_length
      FROM assignments a
      JOIN time_logs tl ON tl.assignment_id = a.id
      WHERE a.student_id = $1 AND tl.duration_minutes > 0
      GROUP BY a.subject
      ORDER BY total_minutes DESC
    `, [studentId]);

    // Find longest sessions (deep work - "loses track of time")
    const deepWorkSessions = await pool.query(`
      SELECT
        a.title,
        a.subject,
        tl.duration_minutes,
        tl.session_start
      FROM time_logs tl
      JOIN assignments a ON a.id = tl.assignment_id
      WHERE tl.student_id = $1 AND tl.duration_minutes > 60
      ORDER BY tl.duration_minutes DESC
      LIMIT 5
    `, [studentId]);

    // Calculate efficiency (sessions > 30 min vs total sessions)
    const efficiencyData = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE duration_minutes >= 30) as focused_sessions,
        COUNT(*) as total_sessions
      FROM time_logs
      WHERE student_id = $1 AND duration_minutes > 0
    `, [studentId]);

    const efficiency = efficiencyData.rows[0].total_sessions > 0
      ? Math.round((efficiencyData.rows[0].focused_sessions / efficiencyData.rows[0].total_sessions) * 100)
      : 0;

    res.json({
      subjects: subjectData.rows.map(row => ({
        name: row.subject || 'General',
        totalHours: (parseFloat(row.total_minutes) / 60).toFixed(1),
        assignmentCount: parseInt(row.assignment_count),
        avgSessionLength: parseFloat(row.avg_session_length).toFixed(0)
      })),
      deepWorkSessions: deepWorkSessions.rows.map(row => ({
        title: row.title,
        subject: row.subject || 'General',
        duration: `${Math.floor(row.duration_minutes / 60)}h ${row.duration_minutes % 60}m`,
        date: new Date(row.session_start).toLocaleDateString()
      })),
      focusEfficiency: efficiency,
      totalSubjects: subjectData.rows.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch academic DNA', details: error.message });
  }
});

// Leaderboard - weekly rankings
app.get('/leaderboard/weekly', async (req, res) => {
  try {
    const leaderboard = await pool.query(`
      SELECT
        s.id,
        s.codename,
        s.university,
        COALESCE(SUM(tl.duration_minutes), 0) / 60.0 as weekly_hours,
        COUNT(DISTINCT DATE(tl.session_start)) as active_days
      FROM students s
      LEFT JOIN time_logs tl ON tl.student_id = s.id
        AND tl.session_start >= DATE_TRUNC('week', CURRENT_DATE)
      GROUP BY s.id, s.codename, s.university
      ORDER BY weekly_hours DESC
      LIMIT 100
    `);

    res.json({
      leaderboard: leaderboard.rows.map((row, index) => ({
        rank: index + 1,
        codename: row.codename || `Student ${row.id}`,
        university: row.university || 'Unknown',
        weeklyHours: parseFloat(row.weekly_hours).toFixed(1),
        activeDays: parseInt(row.active_days)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch leaderboard', details: error.message });
  }
});

// Student rank
app.get('/student/:id/rank', async (req, res) => {
  const studentId = req.params.id;

  try {
    // Get student's weekly hours
    const studentHours = await pool.query(`
      SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as weekly_hours
      FROM time_logs
      WHERE student_id = $1
        AND session_start >= DATE_TRUNC('week', CURRENT_DATE)
    `, [studentId]);

    const myHours = parseFloat(studentHours.rows[0].weekly_hours);

    // Count students with more hours
    const rankResult = await pool.query(`
      SELECT COUNT(DISTINCT student_id) + 1 as rank
      FROM time_logs
      WHERE session_start >= DATE_TRUNC('week', CURRENT_DATE)
      GROUP BY student_id
      HAVING SUM(duration_minutes) / 60.0 > $1
    `, [myHours]);

    // Total active students this week
    const totalStudents = await pool.query(`
      SELECT COUNT(DISTINCT student_id) as total
      FROM time_logs
      WHERE session_start >= DATE_TRUNC('week', CURRENT_DATE)
    `);

    const rank = rankResult.rows.length > 0 ? parseInt(rankResult.rows[0].rank) : 1;
    const total = parseInt(totalStudents.rows[0].total) || 1;
    const percentile = Math.round(((total - rank + 1) / total) * 100);

    res.json({
      rank,
      totalStudents: total,
      percentile,
      weeklyHours: myHours.toFixed(1)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch rank', details: error.message });
  }
});

// Insights - comprehensive analytics
app.get('/student/:id/insights', async (req, res) => {
  const studentId = req.params.id;

  try {
    // Total study time
    const totalTime = await pool.query(`
      SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as total_hours
      FROM time_logs
      WHERE student_id = $1
    `, [studentId]);

    // Average session length
    const avgSession = await pool.query(`
      SELECT AVG(duration_minutes) as avg_minutes
      FROM time_logs
      WHERE student_id = $1 AND duration_minutes > 0
    `, [studentId]);

    // Current streak
    const streakData = await pool.query(`
      SELECT DATE(session_start) as study_date
      FROM time_logs
      WHERE student_id = $1 AND duration_minutes > 0
      GROUP BY DATE(session_start)
      ORDER BY study_date DESC
      LIMIT 30
    `, [studentId]);

    let currentStreak = 0;
    if (streakData.rows.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let checkDate = new Date(streakData.rows[0].study_date);

      for (let i = 0; i < streakData.rows.length; i++) {
        const studyDate = new Date(streakData.rows[i].study_date);
        studyDate.setHours(0, 0, 0, 0);

        const dayDiff = Math.floor((checkDate - studyDate) / (1000 * 60 * 60 * 24));

        if (dayDiff === 0) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }

    // Time by assignment type/subject
    const bySubject = await pool.query(`
      SELECT
        a.subject,
        SUM(tl.duration_minutes) / 60.0 as hours
      FROM time_logs tl
      JOIN assignments a ON a.id = tl.assignment_id
      WHERE tl.student_id = $1 AND tl.duration_minutes > 0
      GROUP BY a.subject
      ORDER BY hours DESC
      LIMIT 5
    `, [studentId]);

    // Recently completed work
    const recentWork = await pool.query(`
      SELECT
        a.title,
        a.subject,
        a.completed_at,
        SUM(tl.duration_minutes) / 60.0 as total_hours
      FROM assignments a
      LEFT JOIN time_logs tl ON tl.assignment_id = a.id
      WHERE a.student_id = $1 AND a.completed_at IS NOT NULL
      GROUP BY a.id, a.title, a.subject, a.completed_at
      ORDER BY a.completed_at DESC
      LIMIT 5
    `, [studentId]);

    res.json({
      totalStudyTime: parseFloat(totalTime.rows[0].total_hours).toFixed(1),
      averageSessionLength: parseFloat(avgSession.rows[0].avg_minutes || 0).toFixed(0),
      currentStreak,
      studyTimeBySubject: bySubject.rows.map(row => ({
        subject: row.subject || 'General',
        hours: parseFloat(row.hours).toFixed(1)
      })),
      recentlyCompleted: recentWork.rows.map(row => ({
        title: row.title,
        subject: row.subject || 'General',
        completedAt: new Date(row.completed_at).toLocaleDateString(),
        totalHours: parseFloat(row.total_hours || 0).toFixed(1)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch insights', details: error.message });
  }
});

// Update student profile (name, email, university)
app.put('/student/:id/profile-info', async (req, res) => {
  const studentId = req.params.id;
  const { name, email, university } = req.body;

  try {
    const result = await pool.query(`
      UPDATE students
      SET name = COALESCE($1, name),
          email = COALESCE($2, email),
          university = COALESCE($3, university)
      WHERE id = $4
      RETURNING id, name, email, university, codename
    `, [name, email, university, studentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      student: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile', details: error.message });
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
