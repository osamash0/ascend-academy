/**
 * Luna's mood — derived from the student's rhythm, never picked from a menu.
 *
 * This is the part that makes the avatar *yours* in a way a colour can't:
 * a seven-day streak and Luna is blazing; a fresh account and she's curious;
 * a lapsed streak and she's waiting — looking up, a little dimmer, never sad
 * and never scolding (Calm Competence voice, docs/BRAND_VOICE.md).
 */
import type { AvatarProgress, Mood } from './types';

export function deriveMood(p: AvatarProgress): Mood {
  if (p.streak >= 7) return 'blazing';
  if (p.streak >= 1) return 'bright';
  if (p.xp === 0 && p.bestStreak === 0) return 'curious';
  return 'waiting';
}

/**
 * Moon phase (0 = full, 100 = dark) per mood. "Waiting" only dims to a
 * gibbous — the face stays warm; the point is a gentle nudge, not a penalty.
 */
export function moodPhase(mood: Mood): number {
  switch (mood) {
    case 'waiting':
      return 22;
    case 'focused':
    case 'thinking':
      return 8;
    default:
      return 0;
  }
}
