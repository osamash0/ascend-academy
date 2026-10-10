/**
 * Luna avatar system — shared types.
 *
 * The avatar is a *loadout*: one item per slot, every item earned through
 * learning. There is no currency anywhere in this module (Doc 1, rule 7 — XP
 * and Ranks carry all progression), so an item is either unlocked by
 * something the student actually did, or it is visibly locked with the exact
 * step that opens it.
 */
import type { RankTierName } from '@/lib/rank';

export type Slot = 'suit' | 'visor' | 'gear' | 'patch' | 'companion' | 'aura' | 'backdrop';

export const SLOTS: readonly Slot[] = ['suit', 'visor', 'gear', 'patch', 'companion', 'aura', 'backdrop'];

/** How an item is earned. `streak` reads the *best* streak — a lapse never takes gear away. */
export type Unlock =
  | { kind: 'free' }
  | { kind: 'rank'; tier: RankTierName }
  | { kind: 'level'; level: number }
  | { kind: 'streak'; days: number }
  | { kind: 'badge'; key: string };

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface AvatarItem {
  id: string;
  slot: Slot;
  unlock: Unlock;
  rarity: Rarity;
  /**
   * Slot-specific paint. Suit/visor: `color` (+ optional `color2` for a
   * gradient). Everything else is drawn by id in `art/`.
   */
  color?: string;
  color2?: string;
}

/** One chosen item id per slot. */
export type Loadout = Record<Slot, string>;

/** Everything the unlock rules are allowed to look at. */
export interface AvatarProgress {
  xp: number;
  level: number;
  streak: number;
  bestStreak: number;
  badges: ReadonlySet<string>;
}

/**
 * Luna's mood is *derived*, never chosen: it mirrors the student's rhythm.
 * The vocabulary is deliberately warm — a lapsed streak makes Luna wait for
 * you, it never makes her sad at you.
 */
export type Mood = 'curious' | 'bright' | 'blazing' | 'waiting' | 'celebrating' | 'focused' | 'thinking';
