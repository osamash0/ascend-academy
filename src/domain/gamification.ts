/**
 * Gamification domain — pure, framework-free business rules.
 * No React imports, no Supabase imports, no side effects.
 * All state changes are performed by callers via the returned values.
 */

/** XP awarded per correct quiz answer. */
export const XP_PER_CORRECT_ANSWER = 10;

/** Level threshold: every 100 XP = 1 level. */
export const XP_PER_LEVEL = 100;

/**
 * Calculate the level a user should be at given their total XP.
 * Level starts at 1.
 */
export function calculateLevel(totalXp: number): number {
  return Math.floor(totalXp / XP_PER_LEVEL) + 1;
}

/**
 * Returns XP earned for a quiz score (0–100 percentage).
 * Full marks on a 10-question quiz = 100 XP.
 */
export function calculateQuizXp(correctAnswers: number): number {
  return correctAnswers * XP_PER_CORRECT_ANSWER;
}

/**
 * Determine whether a user has leveled up.
 * Returns the new level and whether a level-up event occurred.
 */
export function checkLevelUp(
  previousTotalXp: number,
  xpGained: number,
): { newLevel: number; leveledUp: boolean } {
  const oldLevel = calculateLevel(previousTotalXp);
  const newLevel = calculateLevel(previousTotalXp + xpGained);
  return { newLevel, leveledUp: newLevel > oldLevel };
}

// ─── Badge definitions ───────────────────────────────────────────────────────

export interface BadgeDefinition {
  name: string;
  description: string;
  icon: string;
  /** Returns true when the badge should be awarded given the current state. */
  condition: (state: GamificationState) => boolean;
}

export interface GamificationState {
  currentLevel: number;
  totalXp: number;
  lecturesCompleted: number;
  totalCorrectAnswers: number;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    name: 'Level 5 Scholar',
    description: 'Reached level 5!',
    icon: '⭐',
    condition: s => s.currentLevel >= 5,
  },
  {
    name: 'Level 10 Expert',
    description: 'Reached level 10!',
    icon: '🏆',
    condition: s => s.currentLevel >= 10,
  },
  {
    name: 'First Lecture',
    description: 'Completed your first lecture!',
    icon: '📚',
    condition: s => s.lecturesCompleted >= 1,
  },
  {
    name: 'Quiz Master',
    description: 'Answered 50 questions correctly!',
    icon: '🎯',
    condition: s => s.totalCorrectAnswers >= 50,
  },
];

/**
 * Returns the badge definitions that should now be awarded given the new state,
 * filtering out any already earned badge names.
 */
export function getNewlyEarnedBadges(
  state: GamificationState,
  alreadyEarnedNames: Set<string>,
): BadgeDefinition[] {
  return BADGE_DEFINITIONS.filter(
    badge => !alreadyEarnedNames.has(badge.name) && badge.condition(state),
  );
}

/**
 * Returns XP required to reach the next level from the current total XP.
 */
export function xpToNextLevel(totalXp: number): number {
  const currentLevel = calculateLevel(totalXp);
  const nextLevelThreshold = currentLevel * XP_PER_LEVEL;
  return nextLevelThreshold - totalXp;
}

/**
 * Returns XP progress within the current level as a 0–100 percentage.
 */
export function levelProgressPercent(totalXp: number): number {
  return totalXp % XP_PER_LEVEL;
}
