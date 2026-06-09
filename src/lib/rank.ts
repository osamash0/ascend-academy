/**
 * Rank tiers — the single source of truth mapping total_xp → a visual tier.
 *
 * Ranks are a 7-tier OVERLAY on top of the existing unbounded
 * `level = floor(total_xp/100)+1`. They live on the avatar BORDER (see
 * components/RankRing.tsx + features/social/components/atoms.tsx).
 *
 * Visual language (subtle → alive):
 *   Newcomer/Learner  → thin static gradient ring, no glow
 *   Scholar/Expert/Master → richer gradient + soft STATIC glow (grows per tier)
 *   Legend/Immortal   → animated conic gradient + glow pulse (the only animated
 *                       tiers; keeps long leaderboard lists calm)
 *
 * Colours reuse the existing theme HSLs (primary 235, secondary/level 265-280,
 * accent 188, xp 45).
 */

export type RankTierName =
  | 'Newcomer' | 'Learner' | 'Scholar' | 'Expert' | 'Master' | 'Legend' | 'Immortal';

export interface RankTier {
  index: number;               // 0..6
  name: RankTierName;
  min: number;                 // inclusive lower XP bound
  ring: { from: string; to: string };
  glow: string | null;         // box-shadow colour, or null for no glow
  animated: boolean;           // conic rotation + glow pulse (top tiers only)
}

// Ordered low → high. Thresholds are the product spec.
export const RANK_TIERS: RankTier[] = [
  { index: 0, name: 'Newcomer', min: 0,     ring: { from: 'hsl(220 12% 55%)', to: 'hsl(220 12% 40%)' }, glow: null,                       animated: false },
  { index: 1, name: 'Learner',  min: 500,   ring: { from: 'hsl(158 65% 48%)', to: 'hsl(188 85% 55%)' }, glow: null,                       animated: false },
  { index: 2, name: 'Scholar',  min: 1500,  ring: { from: 'hsl(235 85% 65%)', to: 'hsl(188 85% 55%)' }, glow: 'hsl(235 85% 65% / 0.25)',  animated: false },
  { index: 3, name: 'Expert',   min: 3500,  ring: { from: 'hsl(265 55% 58%)', to: 'hsl(235 85% 65%)' }, glow: 'hsl(265 55% 58% / 0.30)',  animated: false },
  { index: 4, name: 'Master',   min: 7000,  ring: { from: 'hsl(280 80% 62%)', to: 'hsl(265 55% 58%)' }, glow: 'hsl(280 80% 62% / 0.35)',  animated: false },
  { index: 5, name: 'Legend',   min: 13000, ring: { from: 'hsl(45 95% 55%)',  to: 'hsl(280 80% 62%)' }, glow: 'hsl(45 95% 55% / 0.40)',   animated: true  },
  { index: 6, name: 'Immortal', min: 25000, ring: { from: 'hsl(45 95% 55%)',  to: 'hsl(188 85% 55%)' }, glow: 'hsl(45 95% 55% / 0.50)',   animated: true  },
];

/** Resolve the tier for a given total XP (clamps negatives to 0). */
export function rankForXp(totalXp: number | null | undefined): RankTier {
  const xp = Math.max(0, Math.trunc(totalXp ?? 0));
  let tier = RANK_TIERS[0];
  for (const t of RANK_TIERS) if (xp >= t.min) tier = t;
  return tier;
}

export interface RankProgress {
  tier: RankTier;
  next: RankTier | null;
  toNext: number;   // XP remaining to the next tier (0 at max)
  pct: number;      // 0..1 progress through the current tier
}

export function rankProgress(totalXp: number | null | undefined): RankProgress {
  const xp = Math.max(0, Math.trunc(totalXp ?? 0));
  const tier = rankForXp(xp);
  const next = RANK_TIERS[tier.index + 1] ?? null;
  if (!next) return { tier, next: null, toNext: 0, pct: 1 };
  const span = next.min - tier.min;
  return { tier, next, toNext: next.min - xp, pct: span > 0 ? (xp - tier.min) / span : 1 };
}
