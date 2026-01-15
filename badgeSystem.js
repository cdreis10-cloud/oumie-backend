// Badge definitions with funny messages
const BADGES = {
  speed_demon: {
    name: 'Speed Demon',
    icon: '🚀',
    message: 'finished fast af. time to crack a cold one',
    checkCondition: (assignment, timeSpent) => {
      return timeSpent < assignment.estimated_hours * 0.7;
    }
  },
  early_bird: {
    name: 'Early Bird',
    icon: '🌅',
    message: 'done early? reward yourself with a beer run',
    checkCondition: (assignment, timeSpent) => {
      const daysEarly = (new Date(assignment.due_date) - new Date()) / (1000 * 60 * 60 * 24);
      return assignment.is_completed && daysEarly >= 2;
    }
  },
  night_owl: {
    name: 'Night Owl',
    icon: '🦉',
    message: "it's 3am. either go to bed or hit up your ex. your call",
    checkCondition: (sessionTime) => {
      const hour = new Date(sessionTime).getHours();
      return hour >= 2 && hour <= 5;
    }
  },
  power_session: {
    name: 'Power Session',
    icon: '⚡',
    message: '3 hours straight? go get blackout at the bars',
    checkCondition: (sessionDuration) => {
      return sessionDuration >= 3;
    }
  },
  first_assignment: {
    name: 'First Assignment',
    icon: '👑',
    message: 'first assignment done. shots?',
    checkCondition: (completedCount) => {
      return completedCount === 1;
    }
  },
  shane_gillis: {
    name: 'Distracted',
    icon: '📺',
    message: 'turn off beautiful dogs. we all love shane but you have to work',
    checkCondition: (sessionDuration) => {
      return sessionDuration < 0.2; // Less than 12 minutes
    }
  },
  touch_grass: {
    name: 'Touch Grass',
    icon: '🌱',
    message: 'that\'s enough for today. touch grass.',
    checkCondition: (totalHoursToday) => {
      return totalHoursToday >= 6;
    }
  }
};

// Award badge to student
async function awardBadge(pool, studentId, badgeType) {
  const badge = BADGES[badgeType];
  
  if (!badge) {
    console.error(`Badge type ${badgeType} not found`);
    return null;
  }

  try {
    const result = await pool.query(
      `INSERT INTO badges (student_id, badge_type, badge_name, badge_message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [studentId, badgeType, badge.name, badge.message]
    );

    return {
      ...result.rows[0],
      icon: badge.icon
    };
  } catch (error) {
    console.error('Error awarding badge:', error);
    return null;
  }
}

// Check if student already has this badge for this assignment
async function hasAssignmentBadge(pool, studentId, badgeType, assignmentId) {
  const result = await pool.query(
    `SELECT * FROM badges 
     WHERE student_id = $1 
     AND badge_type = $2 
     AND earned_at > (SELECT created_at FROM assignments WHERE id = $3)`,
    [studentId, badgeType, assignmentId]
  );
  
  return result.rows.length > 0;
}

module.exports = {
  BADGES,
  awardBadge,
  hasAssignmentBadge
};