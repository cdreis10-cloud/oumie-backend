// Debug script to check time_logs and stats
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/oumie',
  ssl: process.env.DATABASE_URL?.includes('render.com') ? {
    rejectUnauthorized: false
  } : false
});

async function debugStats() {
  try {
    console.log('🔍 Debugging Time Tracking Stats\n');

    // Check all students
    const students = await pool.query('SELECT id, name, email FROM students ORDER BY id');
    console.log(`📊 Total Students: ${students.rows.length}\n`);

    for (const student of students.rows) {
      console.log(`\n👤 Student #${student.id}: ${student.name} (${student.email})`);
      console.log('─'.repeat(60));

      // Check time_logs for this student
      const timeLogs = await pool.query(`
        SELECT
          id,
          assignment_id,
          session_start,
          session_end,
          duration_minutes,
          is_active,
          url,
          activity_type
        FROM time_logs
        WHERE student_id = $1
        ORDER BY session_start DESC
        LIMIT 10
      `, [student.id]);

      console.log(`📝 Time Logs: ${timeLogs.rows.length} entries`);

      if (timeLogs.rows.length > 0) {
        console.log('\nRecent Sessions:');
        timeLogs.rows.forEach((log, i) => {
          console.log(`  ${i + 1}. Assignment ID: ${log.assignment_id || 'None'}`);
          console.log(`     Start: ${log.session_start}`);
          console.log(`     End: ${log.session_end || 'Still active'}`);
          console.log(`     Duration: ${log.duration_minutes || 0} minutes`);
          console.log(`     Active: ${log.is_active}`);
          console.log(`     URL: ${log.url ? log.url.substring(0, 50) + '...' : 'None'}`);
          console.log('');
        });
      }

      // Calculate today's hours
      const todayStats = await pool.query(`
        SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as hours
        FROM time_logs
        WHERE student_id = $1
          AND DATE(session_start) = CURRENT_DATE
      `, [student.id]);

      // Calculate week's hours
      const weekStats = await pool.query(`
        SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as hours
        FROM time_logs
        WHERE student_id = $1
          AND session_start >= DATE_TRUNC('week', CURRENT_DATE)
      `, [student.id]);

      console.log('📈 Stats:');
      console.log(`   Today: ${parseFloat(todayStats.rows[0].hours).toFixed(2)} hours`);
      console.log(`   This Week: ${parseFloat(weekStats.rows[0].hours).toFixed(2)} hours`);

      // Check for active sessions
      const activeSessions = await pool.query(`
        SELECT COUNT(*) as count
        FROM time_logs
        WHERE student_id = $1 AND is_active = true
      `, [student.id]);

      if (parseInt(activeSessions.rows[0].count) > 0) {
        console.log(`   ⚠️  ${activeSessions.rows[0].count} active session(s) not ended`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🔍 Summary:');

    // Total time logs
    const totalLogs = await pool.query('SELECT COUNT(*) as count FROM time_logs');
    console.log(`   Total time logs: ${totalLogs.rows[0].count}`);

    // Active sessions
    const activeSessions = await pool.query('SELECT COUNT(*) as count FROM time_logs WHERE is_active = true');
    console.log(`   Active sessions: ${activeSessions.rows[0].count}`);

    // Sessions with duration
    const withDuration = await pool.query('SELECT COUNT(*) as count FROM time_logs WHERE duration_minutes > 0');
    console.log(`   Sessions with duration: ${withDuration.rows[0].count}`);

    // Sessions without duration
    const withoutDuration = await pool.query('SELECT COUNT(*) as count FROM time_logs WHERE duration_minutes IS NULL OR duration_minutes = 0');
    console.log(`   Sessions without duration: ${withoutDuration.rows[0].count}`);

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

debugStats();
