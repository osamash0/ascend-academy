/**
 * The words around an item: its name, how to earn it, and — once earned —
 * the little memory of how it was earned. Shared by the locker and the
 * unlock reveal so both always tell the same story.
 */
import type { TFunction } from 'i18next';
import type { UnlockStatus } from './unlocks';
import type { AvatarItem } from './types';

function humanize(id: string) {
  const s = id.split('-').slice(1).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function itemName(t: TFunction, id: string): string {
  return t(`avatar:items.${id}`, { defaultValue: humanize(id) });
}

export function unlockHint(t: TFunction, item: AvatarItem, st: UnlockStatus): string {
  const u = item.unlock;
  switch (u.kind) {
    case 'rank':
      return t('avatar:hint.rank', { tier: u.tier, current: st.current.toLocaleString(), target: st.target.toLocaleString() });
    case 'level':
      return t('avatar:hint.level', { level: u.level });
    case 'streak':
      return t('avatar:hint.streak', { days: u.days });
    case 'badge':
      return t('avatar:hint.badge', { badge: u.key });
    default:
      return '';
  }
}

export function unlockMemory(t: TFunction, item: AvatarItem, lang: string, badgeDates: Record<string, string | null | undefined> = {}): string {
  const u = item.unlock;
  switch (u.kind) {
    case 'free':
      return t('avatar:memory.free');
    case 'rank':
      return t('avatar:memory.rank', { tier: u.tier });
    case 'level':
      return t('avatar:memory.level', { level: u.level });
    case 'streak':
      return t('avatar:memory.streak', { days: u.days });
    case 'badge': {
      const at = badgeDates[u.key];
      const date = at ? new Date(at).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
      return date ? t('avatar:memory.badgeOn', { badge: u.key, date }) : t('avatar:memory.badge', { badge: u.key });
    }
  }
}
