/**
 * "Pick one for me" on the first-run name (I-01, Abi, 2026-10-24).
 *
 * Not everyone wants their real name on a study app that shows names in
 * Spaces and on leaderboards. A roll gives them a friendly alias instead —
 * Luna's world, so the words are from the sky. The names themselves live in
 * the locale files (`firstRun.name.aliases`), whole and per language, because
 * German adjectives agree with their noun ("Stiller Komet", "Helle Nova") and
 * cannot be glued together from two lists.
 */

/** How long each frame of the reel shows, in ms: quick, then settling. */
export const REEL_MS = [45, 55, 65, 80, 100, 125, 160] as const;

/** One alias from the list, never the one already showing. */
export function pickAlias(list: readonly string[], current: string, random: () => number = Math.random): string {
  const pool = list.filter((n) => n !== current);
  if (!pool.length) return list[0] ?? '';
  return pool[Math.floor(random() * pool.length) % pool.length];
}

/**
 * The reel: one name per frame, no frame repeating the one before it, ending
 * on the name it lands on. The last entry is the result.
 */
export function reel(list: readonly string[], current: string, random: () => number = Math.random): string[] {
  const frames: string[] = [];
  let shown = current;
  for (let i = 0; i < REEL_MS.length; i++) {
    shown = pickAlias(list, shown, random);
    frames.push(shown);
  }
  return frames;
}
