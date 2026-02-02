// Production Database Migration Script
// Run this with: node migrate-production.js "YOUR_RENDER_DATABASE_URL"

const { Pool } = require('pg');
const fs = require('fs');

// Get DATABASE_URL from command line argument
const DATABASE_URL = process.argv[2];

if (!DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL is required');
  console.error('');
  console.error('Usage:');
  console.error('  node migrate-production.js "postgresql://user:pass@host:port/db"');
  console.error('');
  console.error('Get your DATABASE_URL from:');
  console.error('  1. Go to https://dashboard.render.com');
  console.error('  2. Click on your oumie-backend service');
  console.error('  3. Go to "Environment" tab');
  console.error('  4. Find DATABASE_URL (click the eye icon to reveal)');
  console.error('  5. Copy the full URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigration() {
  try {
    console.log('🔄 Connecting to production database...');

    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Connected successfully!');
    console.log('');

    console.log('📝 Running migration...');

    // Read migration file
    const sql = fs.readFileSync('./migrations/add-password-field.sql', 'utf8');

    // Execute migration
    await pool.query(sql);

    console.log('✅ Migration completed successfully!');
    console.log('');

    // Verify columns were added
    console.log('🔍 Verifying new columns...');
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'students'
      AND column_name IN ('password_hash', 'codename', 'last_login', 'refresh_token', 'email_verified')
      ORDER BY column_name;
    `);

    console.log('');
    console.log('✅ Verified columns:');
    console.log('┌─────────────────┬──────────────────────┬─────────────┐');
    console.log('│ Column Name     │ Data Type            │ Nullable    │');
    console.log('├─────────────────┼──────────────────────┼─────────────┤');

    result.rows.forEach(row => {
      console.log(`│ ${row.column_name.padEnd(15)} │ ${row.data_type.padEnd(20)} │ ${row.is_nullable.padEnd(11)} │`);
    });

    console.log('└─────────────────┴──────────────────────┴─────────────┘');
    console.log('');

    // Count existing students
    const countResult = await pool.query('SELECT COUNT(*) as count FROM students');
    console.log(`📊 Total students in database: ${countResult.rows[0].count}`);

    if (parseInt(countResult.rows[0].count) > 0) {
      console.log('');
      console.log('⚠️  Note: Existing students do not have passwords set.');
      console.log('   They will need to create new accounts.');
    }

    console.log('');
    console.log('🎉 Production database is ready!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Redeploy your backend on Render');
    console.log('  2. Add JWT_SECRET and JWT_REFRESH_SECRET to Render environment');
    console.log('  3. Test authentication at https://oumie-dashboard.vercel.app/signup');

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed!');
    console.error('');
    console.error('Error:', error.message);
    console.error('');

    if (error.message.includes('password authentication failed')) {
      console.error('💡 Tip: Make sure you copied the complete DATABASE_URL including password');
    } else if (error.message.includes('does not exist')) {
      console.error('💡 Tip: The database or table might not exist');
    } else if (error.message.includes('ENOTFOUND')) {
      console.error('💡 Tip: Check your internet connection and the database host');
    }

    await pool.end();
    process.exit(1);
  }
}

runMigration();
