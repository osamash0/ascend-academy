/**
 * Unlock rules — pure functions from (item, progress) to "can I wear this,
 * and if not, how close am I?". No React, no Supabase: the Suit Locker, the
 * unlock toast and the tests all read the same answers.
 */
import { RANK_TIERS } from '@/lib/rank';
import { CATALOG } from './catalog';
import type { AvatarItem, AvatarProgress, Unlock } from './types';

export interface UnlockStatus {
  unlocked: boolean;
  /** 0..1 progress toward the unlock (1 when unlocked; badges are 0 or 1). */
  pct: number;
  /** Current / target in the unlock's own unit, for "1,240 / 1,500 XP" copy. */
  current: number;
  target: number;
}

function rankMin(tier: string): number {
  return RANK_TIERS.find((t) => t.name === tier)?.min ?? Number.POSITIVE_INFINITY;
}

export function unlockStatus(unlock: Unlock, p: AvatarProgress): UnlockStatus {
  const ratio = (current: number, target: number): UnlockStatus => {
    const c = Math.max(0, current);
    return { unlocked: c >= target, pct: target > 0 ? Math.min(1, c / target) : 1, current: c, target };
  };
  switch (unlock.kind) {
    case 'free':
      return { unlocked: true, pct: 1, current: 1, target: 1 };
    case 'rank':
      return ratio(p.xp, rankMin(unlock.tier));
    case 'level':
      return ratio(p.level, unlock.level);
    case 'streak':
      // Best streak, not current: gear is a record of what you did, and a
      // missed day should never strip Luna of something she earned.
      return ratio(Math.max(p.bestStreak, p.streak), unlock.days);
    case 'badge':
      return ratio(p.badges.has(unlock.key) ? 1 : 0, 1);
  }
}

export function isUnlocked(item: AvatarItem, p: AvatarProgress): boolean {
  return unlockStatus(item.unlock, p).unlocked;
}

export function unlockedIds(p: AvatarProgress): Set<string> {
  return new Set(CATALOG.filter((i) => isUnlocked(i, p)).map((i) => i.id));
}

/**
 * The locked items closest to opening, best first. Badges with no measurable
 * progress sort after anything with a real gauge, so the teaser always leads
 * with "380 XP to go" rather than an opaque "earn a badge".
 */
export function nextUnlocks(p: AvatarProgress, limit = 3): Array<{ item: AvatarItem; status: UnlockStatus }> {
  return CATALOG.filter((i) => i.unlock.kind !== 'free')
    .map((item) => ({ item, status: unlockStatus(item.unlock, p) }))
    .filter((x) => !x.status.unlocked)
    .sort((a, b) => {
      const ga = a.item.unlock.kind === 'badge' ? -1 : a.status.pct;
      const gb = b.item.unlock.kind === 'badge' ? -1 : b.status.pct;
      return gb - ga;
    })
    .slice(0, limit);
}

/** Items unlocked in `next` that were not in `prev` — drives the "new gear" toast. */
export function newlyUnlocked(prev: AvatarProgress, next: AvatarProgress): AvatarItem[] {
  return CATALOG.filter((i) => !isUnlocked(i, prev) && isUnlocked(i, next));
}

export const EMPTY_PROGRESS: AvatarProgress = { xp: 0, level: 1, streak: 0, bestStreak: 0, badges: new Set() };
