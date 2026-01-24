const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrate() {
  try {
    console.log('Adding leaderboard fields to students table...');

    await pool.query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS codename VARCHAR(50) UNIQUE,
      ADD COLUMN IF NOT EXISTS university_domain VARCHAR(100),
      ADD COLUMN IF NOT EXISTS show_on_leaderboard BOOLEAN DEFAULT true;
    `);

    console.log('✅ Columns added');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_students_leaderboard ON students(show_on_leaderboard, university_domain);
      CREATE INDEX IF NOT EXISTS idx_students_codename ON students(codename);
    `);

    console.log('✅ Indexes created');

    // Update demo student with a codename
    await pool.query(`
      UPDATE students
      SET codename = 'StudyNinja',
          university_domain = 'umontana.edu',
          show_on_leaderboard = true
      WHERE id = 1;
    `);

    console.log('✅ Demo student updated');
    console.log('🎉 Migration complete!');

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    pool.end();
  }
}

migrate();
