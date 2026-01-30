/**
 * Student Status Detector
 * Automatically detects when students have likely graduated
 * Zero friction - runs entirely in background
 */

const ACADEMIC_KEYWORDS = [
  'essay', 'assignment', 'homework', 'exam', 'quiz', 'midterm', 'final',
  'chapter', 'reading', 'lab report', 'problem set', 'thesis', 'dissertation',
  'lecture', 'notes', 'study guide', 'textbook', 'syllabus', 'professor',
  'class', 'course', 'semester', 'grade', 'gpa', 'credit', 'major', 'minor'
];

const WORK_KEYWORDS = [
  'invoice', 'meeting', 'quarterly', 'q1', 'q2', 'q3', 'q4', 'client',
  'project plan', 'stakeholder', 'deliverable', 'sprint', 'standup',
  'performance review', 'pto', 'expense', 'budget', 'vendor', 'contract',
  'sales', 'revenue', 'forecast', 'pipeline', 'roi', 'kpi', 'metrics'
];

const LMS_DOMAINS = [
  'instructure.com', 'blackboard.com', 'moodle', 'brightspace',
  'schoology.com', 'canvas', 'd2l.com'
];

class StudentStatusDetector {

  constructor(db) {
    this.db = db;
  }

  /**
   * Analyze a student's recent activity and update their status
   * @param {number} studentId - The student ID to analyze
   * @returns {Object} Analysis result with signals and new status
   */
  async analyzeStudent(studentId) {
    const signals = {
      no_lms_activity: false,
      work_document_patterns: false,
      work_schedule_patterns: false,
      extended_inactivity: false,
      confidence_score: 100 // Start assuming they're a student
    };

    // Get student's recent activity (last 90 days)
    const recentLogs = await this.db.query(`
      SELECT * FROM time_logs
      WHERE student_id = $1
      AND created_at > NOW() - INTERVAL '90 days'
      ORDER BY created_at DESC
    `, [studentId]);

    if (recentLogs.rows.length === 0) {
      // No activity in 90 days
      signals.extended_inactivity = true;
      signals.confidence_score -= 40;
    } else {
      // Analyze the activity
      signals.no_lms_activity = this.checkLMSActivity(recentLogs.rows);
      signals.work_document_patterns = this.checkDocumentPatterns(recentLogs.rows);
      signals.work_schedule_patterns = this.checkSchedulePatterns(recentLogs.rows);

      // Reduce confidence for each signal
      if (signals.no_lms_activity) signals.confidence_score -= 25;
      if (signals.work_document_patterns) signals.confidence_score -= 20;
      if (signals.work_schedule_patterns) signals.confidence_score -= 15;
    }

    // Determine status based on confidence
    let newStatus = 'active';
    if (signals.confidence_score < 30) {
      newStatus = 'graduated_suspected';
    } else if (signals.confidence_score < 60) {
      newStatus = 'inactive';
    }

    // Update student record
    await this.db.query(`
      UPDATE students
      SET account_status = $1,
          status_confidence = $2,
          graduation_signals = $3,
          last_active = NOW()
      WHERE id = $4
    `, [newStatus, signals.confidence_score, JSON.stringify(signals), studentId]);

    return {
      studentId,
      signals,
      newStatus,
      confidenceScore: signals.confidence_score
    };
  }

  /**
   * Check if student has visited LMS in last 60 days
   * @param {Array} logs - Array of time log records
   * @returns {boolean} True if NO LMS activity detected
   */
  checkLMSActivity(logs) {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const hasLMS = logs.some(log => {
      if (new Date(log.created_at) < sixtyDaysAgo) return false;
      const site = (log.site_name || '').toLowerCase();
      return LMS_DOMAINS.some(domain => site.includes(domain));
    });

    return !hasLMS; // Returns true if NO lms activity
  }

  /**
   * Check if document titles suggest work vs academic
   * @param {Array} logs - Array of time log records
   * @returns {boolean} True if work patterns detected
   */
  checkDocumentPatterns(logs) {
    let academicCount = 0;
    let workCount = 0;

    logs.forEach(log => {
      const title = (log.assignment_title || '').toLowerCase();

      if (ACADEMIC_KEYWORDS.some(kw => title.includes(kw))) {
        academicCount++;
      }
      if (WORK_KEYWORDS.some(kw => title.includes(kw))) {
        workCount++;
      }
    });

    // If more work keywords than academic, likely graduated
    return workCount > academicCount && workCount >= 3;
  }

  /**
   * Check if activity patterns suggest 9-5 work schedule
   * @param {Array} logs - Array of time log records
   * @returns {boolean} True if work schedule detected
   */
  checkSchedulePatterns(logs) {
    let businessHours = 0; // 9am-5pm weekdays
    let studentHours = 0;  // evenings, weekends, late nights

    logs.forEach(log => {
      const date = new Date(log.created_at);
      const hour = date.getHours();
      const day = date.getDay(); // 0 = Sunday, 6 = Saturday

      const isWeekend = day === 0 || day === 6;
      const isEvening = hour >= 18 || hour < 9;
      const isLateNight = hour >= 22 || hour < 6;

      if (!isWeekend && hour >= 9 && hour < 17) {
        businessHours++;
      }
      if (isWeekend || isEvening || isLateNight) {
        studentHours++;
      }
    });

    // If 80%+ activity is during business hours, likely working
    const total = businessHours + studentHours;
    if (total < 10) return false; // Not enough data

    return (businessHours / total) > 0.8;
  }

  /**
   * Run detection for all active students (called by cron job)
   * @returns {Array} Array of students with status changes
   */
  async analyzeAllStudents() {
    const students = await this.db.query(`
      SELECT id FROM students WHERE account_status = 'active'
    `);

    const results = [];
    for (const student of students.rows) {
      try {
        const result = await this.analyzeStudent(student.id);
        if (result.newStatus !== 'active') {
          results.push(result);
          console.log(`[StatusDetector] Student ${student.id} changed to ${result.newStatus} (confidence: ${result.confidenceScore}%)`);
        }
      } catch (error) {
        console.error(`[StatusDetector] Error analyzing student ${student.id}:`, error.message);
      }
    }

    console.log(`[StatusDetector] Analyzed ${students.rows.length} students, ${results.length} status changes`);
    return results;
  }

  /**
   * Update last_lms_activity when student visits LMS
   * Call this from time tracking endpoint
   */
  async recordLMSActivity(studentId, siteName) {
    const isLMS = LMS_DOMAINS.some(domain =>
      siteName.toLowerCase().includes(domain)
    );

    if (isLMS) {
      await this.db.query(`
        UPDATE students
        SET last_lms_activity = NOW(),
            last_active = NOW()
        WHERE id = $1
      `, [studentId]);
    } else {
      await this.db.query(`
        UPDATE students
        SET last_active = NOW()
        WHERE id = $1
      `, [studentId]);
    }
  }

  /**
   * Get status summary for university dashboard
   * @param {number} universityId - The university ID
   * @returns {Object} Status breakdown
   */
  async getUniversityStatusSummary(universityId) {
    const result = await this.db.query(`
      SELECT
        account_status,
        COUNT(*) as count,
        AVG(status_confidence) as avg_confidence
      FROM students
      WHERE university_id = $1
      GROUP BY account_status
    `, [universityId]);

    const summary = {
      active: 0,
      graduated_suspected: 0,
      graduated_confirmed: 0,
      inactive: 0,
      dormant: 0,
      total: 0
    };

    result.rows.forEach(row => {
      summary[row.account_status] = parseInt(row.count);
      summary.total += parseInt(row.count);
    });

    return summary;
  }
}

module.exports = StudentStatusDetector;
