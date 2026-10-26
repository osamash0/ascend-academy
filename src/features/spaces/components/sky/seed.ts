/**
 * Deterministic numbers from a string, for the night sky.
 *
 * A Space's planet and the stars behind a screen must look the same on every
 * render and every visit — "same Space = same planet always", the rule the old
 * cover gradients followed. An id is the one thing about a Space that does not
 * move, so everything here is keyed on a string and nothing on a list index.
 */

/** A plain 31-multiplier string hash: deterministic and readable, not cryptographic. */
export const hashString = (s: string): number => {
  let hash = 0;
  for (const ch of s) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
};

/** mulberry32 — a tiny seeded PRNG. Returns a function yielding [0, 1). */
export const seededRandom = (seed: string): (() => number) => {
  let a = hashString(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Planet bodies: four neutral grey-blues, close enough to read as one family
 * on the black stage. Not a palette to tell Spaces apart — the name does that —
 * just enough variation that a row of planets is not a row of clones.
 */
export const PLANET_TONES = ['#1b2232', '#232a36', '#1f2530', '#262b33'] as const;

export const toneFor = (seed: string): string => PLANET_TONES[hashString(seed) % PLANET_TONES.length];
