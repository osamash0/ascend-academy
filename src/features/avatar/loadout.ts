/**
 * Loadout parsing — turns whatever is stored (the `profiles.luna_loadout`
 * jsonb, a localStorage fallback, or only the legacy suit/visor hex columns)
 * into a complete, valid Loadout.
 *
 * Stored data is never trusted: unknown ids, ids in the wrong slot, and —
 * when progress is supplied — items the student hasn't earned all fall back
 * to the default for that slot. That last rule is what keeps the locker
 * honest even though the column itself is a free-form jsonb.
 */
import { CATALOG, DEFAULT_LOADOUT, itemById } from './catalog';
import { isUnlocked } from './unlocks';
import { SLOTS, type AvatarProgress, type Loadout } from './types';

export function sanitizeLoadout(raw: unknown, progress?: AvatarProgress): Loadout {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LOADOUT };
  for (const slot of SLOTS) {
    const item = itemById(typeof src[slot] === 'string' ? (src[slot] as string) : undefined);
    if (!item || item.slot !== slot) continue;
    if (progress && !isUnlocked(item, progress)) continue;
    out[slot] = item.id;
  }
  return out;
}

/**
 * Students who customised Luna in onboarding only have the two legacy hex
 * columns. Map them onto the matching catalog items so nobody's Luna changes
 * colour the day the locker ships.
 */
export function loadoutFromLegacy(suitHex?: string | null, visorHex?: string | null): Partial<Loadout> {
  const match = (slot: 'suit' | 'visor', hex?: string | null) =>
    hex ? CATALOG.find((i) => i.slot === slot && i.color?.toLowerCase() === hex.toLowerCase())?.id : undefined;
  const out: Partial<Loadout> = {};
  const suit = match('suit', suitHex);
  const visor = match('visor', visorHex);
  if (suit) out.suit = suit;
  if (visor) out.visor = visor;
  return out;
}

/** Shallow equality across all slots. */
export function sameLoadout(a: Loadout, b: Loadout): boolean {
  return SLOTS.every((s) => a[s] === b[s]);
}

/** Pick a random unlocked item per slot — the locker's "surprise me" die. */
export function randomLoadout(progress: AvatarProgress, rand: () => number = Math.random): Loadout {
  const out = { ...DEFAULT_LOADOUT };
  for (const slot of SLOTS) {
    const pool = CATALOG.filter((i) => i.slot === slot && isUnlocked(i, progress));
    if (pool.length) out[slot] = pool[Math.floor(rand() * pool.length)].id;
  }
  return out;
}
