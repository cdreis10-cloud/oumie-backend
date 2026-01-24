// Oumie Database Setup Script
// Run this to create all tables in your Render PostgreSQL database

const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://oumie_user:SUGn0dJhCm9pudef9qNHWVz7RJe5qSOA@dpg-d5m80dh4tr6s73cerevg-a.oregon-postgres.render.com/oumie';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function setupDatabase() {
    console.log('🚀 Starting database setup...\n');

    try {
        // Create students table
        console.log('Creating students table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS students (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                university VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Students table created');

        // Create student_profiles table
        console.log('Creating student_profiles table...');
        await pool.query(`
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
        `);
        console.log('✅ Student profiles table created');

        // Create assignments table
        console.log('Creating assignments table...');
        await pool.query(`
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
        `);
        console.log('✅ Assignments table created');

        // Create time_logs table
        console.log('Creating time_logs table...');
        await pool.query(`
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
        `);
        console.log('✅ Time logs table created');

        // Create assignment_type_seeds table
        console.log('Creating assignment_type_seeds table...');
        await pool.query(`
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
        `);
        console.log('✅ Assignment type seeds table created');

        // Create learning_patterns table
        console.log('Creating learning_patterns table...');
        await pool.query(`
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
        `);
        console.log('✅ Learning patterns table created');

        // Create notifications table
        console.log('Creating notifications table...');
        await pool.query(`
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
        `);
        console.log('✅ Notifications table created');

        // Create indexes
        console.log('\nCreating indexes...');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_assignments_student ON assignments(student_id);');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_assignments_due ON assignments(due_date);');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_learning_patterns_student ON learning_patterns(student_id);');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON notifications(scheduled_for);');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_time_logs_student ON time_logs(student_id);');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_time_logs_assignment ON time_logs(assignment_id);');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_time_logs_active ON time_logs(is_active);');
        console.log('✅ All indexes created');

        // Insert demo student
        console.log('\nInserting demo student...');
        await pool.query(`
            INSERT INTO students (name, email, university)
            VALUES ('Demo Student', 'demo@test.com', 'University of Montana')
            ON CONFLICT (email) DO NOTHING;
        `);
        console.log('✅ Demo student added');

        // Verify tables
        console.log('\n📋 Verifying tables...');
        const result = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `);

        console.log('\n✅ Tables created successfully:');
        result.rows.forEach(row => {
            console.log(`   - ${row.table_name}`);
        });

        console.log('\n🎉 Database setup complete!');

    } catch (error) {
        console.error('❌ Error setting up database:', error);
    } finally {
        await pool.end();
    }
}

setupDatabase();
