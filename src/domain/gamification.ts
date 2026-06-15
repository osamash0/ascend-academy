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

// Badge definitions now live in the DB (`badge_definitions`, migration
// 20260616000000) as the single source of truth and are awarded server-side via
// the gamification engine — see src/services/gamificationService.ts. This module
// keeps only the pure level/XP math.

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
