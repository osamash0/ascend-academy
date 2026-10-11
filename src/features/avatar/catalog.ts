/**
 * The Suit Locker catalog — every piece of gear Luna can wear, and what earns it.
 *
 * Design rules this list follows:
 *  - Every slot has free items, so a brand-new student can make Luna theirs on
 *    day one. Earned items are flair, never a paywall on identity.
 *  - Unlocks point at things the product already measures (rank tiers from
 *    lib/rank.ts, levels, best streak, badge keys from the gamification engine
 *    migration 20260616000000). Nothing here invents a new metric.
 *  - Rarity tracks how far into the journey the unlock sits, so a Legend's
 *    halo reads as rare at a glance in a leaderboard.
 *
 * Display names live in i18n (`avatar:items.<id>`), keyed by the stable id.
 */
import type { AvatarItem, Loadout, Slot } from './types';

const free = { kind: 'free' } as const;

/** The single milestone that opens every home look. */
export const HOME_LOOK_UNLOCK = { kind: 'badge', key: 'First Steps' } as const;

export const CATALOG: readonly AvatarItem[] = [
  // ── Home look ───────────────────────────────────────────────────────────
  // Luna takes her helmet off and dresses like home. Every look shares ONE
  // unlock (finishing your first lecture): earned, but never ranking one
  // culture above another. The space suit stays the free default.
  { id: 'outfit-none', slot: 'outfit', unlock: free, rarity: 'common' },
  ...(['gulf', 'levant', 'turkiye', 'texas', 'lederhosen', 'dirndl', 'scotland', 'japan', 'india', 'westafrica'] as const).map(
    (look): AvatarItem => ({ id: `outfit-${look}`, slot: 'outfit', unlock: HOME_LOOK_UNLOCK, rarity: 'rare' }),
  ),

  // ── Suit ────────────────────────────────────────────────────────────────
  { id: 'suit-moonlight', slot: 'suit', unlock: free, rarity: 'common', color: '#FFF8E7' },
  { id: 'suit-lavender', slot: 'suit', unlock: free, rarity: 'common', color: '#E8E4F0' },
  { id: 'suit-mint', slot: 'suit', unlock: free, rarity: 'common', color: '#D5F2E3' },
  // Onboarding's Luna themes (Rose Orbit, Tidal) — free, so every onboarding choice maps to a catalog item.
  { id: 'suit-blush', slot: 'suit', unlock: free, rarity: 'common', color: '#F3D8D5' },
  { id: 'suit-tide', slot: 'suit', unlock: free, rarity: 'common', color: '#DCE9EA' },
  { id: 'suit-coral', slot: 'suit', unlock: { kind: 'level', level: 3 }, rarity: 'common', color: '#FFD3C7' },
  { id: 'suit-midnight', slot: 'suit', unlock: { kind: 'rank', tier: 'Learner' }, rarity: 'rare', color: '#2D2445' },
  { id: 'suit-solar', slot: 'suit', unlock: { kind: 'streak', days: 7 }, rarity: 'rare', color: '#FFD93D' },
  { id: 'suit-nebula', slot: 'suit', unlock: { kind: 'rank', tier: 'Expert' }, rarity: 'epic', color: '#8B7FD9', color2: '#4FD1C5' },
  { id: 'suit-aurora', slot: 'suit', unlock: { kind: 'rank', tier: 'Legend' }, rarity: 'legendary', color: '#F472B6', color2: '#60A5FA' },
  { id: 'suit-gilded', slot: 'suit', unlock: { kind: 'rank', tier: 'Immortal' }, rarity: 'legendary', color: '#FDE68A', color2: '#D97706' },

  // ── Visor ───────────────────────────────────────────────────────────────
  { id: 'visor-teal', slot: 'visor', unlock: free, rarity: 'common', color: '#88B0B5' },
  { id: 'visor-violet', slot: 'visor', unlock: free, rarity: 'common', color: '#6B5B95' },
  { id: 'visor-rose', slot: 'visor', unlock: free, rarity: 'common', color: '#E8A598' },
  // Onboarding's Starlight, Rose Orbit and Tidal visors.
  { id: 'visor-amber', slot: 'visor', unlock: free, rarity: 'common', color: '#D6A92A' },
  { id: 'visor-mauve', slot: 'visor', unlock: free, rarity: 'common', color: '#A76B83' },
  { id: 'visor-tide', slot: 'visor', unlock: free, rarity: 'common', color: '#5E8F99' },
  { id: 'visor-cyan', slot: 'visor', unlock: { kind: 'level', level: 5 }, rarity: 'rare', color: '#00D2D3' },
  { id: 'visor-gold', slot: 'visor', unlock: { kind: 'rank', tier: 'Scholar' }, rarity: 'rare', color: '#FFD93D' },
  { id: 'visor-prism', slot: 'visor', unlock: { kind: 'badge', key: 'Perfect Score' }, rarity: 'epic', color: '#F472B6', color2: '#22D3EE' },

  // ── Helmet gear ─────────────────────────────────────────────────────────
  { id: 'gear-none', slot: 'gear', unlock: free, rarity: 'common' },
  { id: 'gear-antenna', slot: 'gear', unlock: free, rarity: 'common' },
  { id: 'gear-bulb', slot: 'gear', unlock: { kind: 'badge', key: 'Quick Thinker' }, rarity: 'common' },
  { id: 'gear-headphones', slot: 'gear', unlock: { kind: 'badge', key: 'Bookworm' }, rarity: 'rare' },
  { id: 'gear-mortarboard', slot: 'gear', unlock: { kind: 'badge', key: 'Graduate' }, rarity: 'rare' },
  { id: 'gear-flame', slot: 'gear', unlock: { kind: 'streak', days: 7 }, rarity: 'rare' },
  { id: 'gear-laurel', slot: 'gear', unlock: { kind: 'rank', tier: 'Master' }, rarity: 'epic' },
  { id: 'gear-halo', slot: 'gear', unlock: { kind: 'rank', tier: 'Legend' }, rarity: 'legendary' },
  { id: 'gear-starcrown', slot: 'gear', unlock: { kind: 'rank', tier: 'Immortal' }, rarity: 'legendary' },

  // ── Chest patch ─────────────────────────────────────────────────────────
  { id: 'patch-star', slot: 'patch', unlock: free, rarity: 'common' },
  { id: 'patch-moon', slot: 'patch', unlock: free, rarity: 'common' },
  { id: 'patch-book', slot: 'patch', unlock: { kind: 'badge', key: 'First Steps' }, rarity: 'common' },
  { id: 'patch-flame', slot: 'patch', unlock: { kind: 'streak', days: 3 }, rarity: 'common' },
  { id: 'patch-bolt', slot: 'patch', unlock: { kind: 'badge', key: 'On Fire' }, rarity: 'rare' },
  { id: 'patch-check', slot: 'patch', unlock: { kind: 'badge', key: 'Perfect Score' }, rarity: 'rare' },
  { id: 'patch-question', slot: 'patch', unlock: { kind: 'badge', key: 'Inquisitive' }, rarity: 'rare' },
  { id: 'patch-heart', slot: 'patch', unlock: { kind: 'badge', key: 'Voice Heard' }, rarity: 'rare' },
  { id: 'patch-target', slot: 'patch', unlock: { kind: 'badge', key: 'Sharpshooter' }, rarity: 'epic' },
  { id: 'patch-trophy', slot: 'patch', unlock: { kind: 'badge', key: 'Course Conqueror' }, rarity: 'epic' },

  // ── Companion ───────────────────────────────────────────────────────────
  { id: 'companion-none', slot: 'companion', unlock: free, rarity: 'common' },
  { id: 'companion-comet', slot: 'companion', unlock: { kind: 'streak', days: 3 }, rarity: 'common' },
  { id: 'companion-byte', slot: 'companion', unlock: { kind: 'badge', key: 'First Quiz Completed' }, rarity: 'rare' },
  { id: 'companion-spark', slot: 'companion', unlock: { kind: 'badge', key: 'Unstoppable' }, rarity: 'rare' },
  { id: 'companion-minimoon', slot: 'companion', unlock: { kind: 'level', level: 10 }, rarity: 'epic' },
  { id: 'companion-owl', slot: 'companion', unlock: { kind: 'badge', key: 'Scholar' }, rarity: 'epic' },

  // ── Aura ────────────────────────────────────────────────────────────────
  { id: 'aura-none', slot: 'aura', unlock: free, rarity: 'common' },
  { id: 'aura-stardust', slot: 'aura', unlock: { kind: 'rank', tier: 'Learner' }, rarity: 'common' },
  { id: 'aura-rings', slot: 'aura', unlock: { kind: 'rank', tier: 'Expert' }, rarity: 'rare' },
  { id: 'aura-ember', slot: 'aura', unlock: { kind: 'streak', days: 30 }, rarity: 'epic' },
  { id: 'aura-nebula', slot: 'aura', unlock: { kind: 'rank', tier: 'Master' }, rarity: 'epic' },
  { id: 'aura-supernova', slot: 'aura', unlock: { kind: 'rank', tier: 'Immortal' }, rarity: 'legendary' },

  // ── Backdrop ────────────────────────────────────────────────────────────
  { id: 'backdrop-deepspace', slot: 'backdrop', unlock: free, rarity: 'common' },
  { id: 'backdrop-lunar', slot: 'backdrop', unlock: free, rarity: 'common' },
  { id: 'backdrop-aurora', slot: 'backdrop', unlock: { kind: 'streak', days: 7 }, rarity: 'rare' },
  { id: 'backdrop-observatory', slot: 'backdrop', unlock: { kind: 'level', level: 10 }, rarity: 'epic' },
  { id: 'backdrop-galaxy', slot: 'backdrop', unlock: { kind: 'rank', tier: 'Legend' }, rarity: 'legendary' },
];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

export function itemById(id: string | undefined | null): AvatarItem | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function itemsForSlot(slot: Slot): AvatarItem[] {
  return CATALOG.filter((i) => i.slot === slot);
}

/** Luna as she ships: the signature moonlight suit, teal visor, a star patch. */
export const DEFAULT_LOADOUT: Loadout = {
  outfit: 'outfit-none',
  suit: 'suit-moonlight',
  visor: 'visor-teal',
  gear: 'gear-none',
  patch: 'patch-star',
  companion: 'companion-none',
  aura: 'aura-none',
  backdrop: 'backdrop-deepspace',
};
