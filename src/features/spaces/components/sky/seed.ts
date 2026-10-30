/**
 * Deterministic numbers from a string, for the night sky.
 *
 * The stars behind a screen must look the same on every
 * render and every visit. An id is the one thing about a Space that does not
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
