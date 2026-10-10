/**
 * Who someone *looks like* — one rule, used by every avatar in the app:
 *
 *   1. their own uploaded photo
 *   2. their Luna (loadout)
 *   3. initials — never wrong, never a face, the last resort
 *
 * Onboarding used to pre-select a DiceBear robot and save it as avatar_url,
 * so most students "had a photo" they never chose and Luna never showed.
 * Those third-party preset URLs are treated as *no photo* here, which gives
 * every one of those students their Luna back without touching their data
 * (and stops every page view pinging a third-party image host).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { loadoutFromLegacy, sanitizeLoadout } from './loadout';
import type { Loadout } from './types';

const PRESET_HOSTS = ['api.dicebear.com'];

/** A photo the person actually uploaded — not empty, not a legacy preset. */
export function isRealPhoto(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !PRESET_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

interface PublicLoadoutRow {
  user_id: string;
  luna_loadout: unknown;
  luna_suit_color: string | null;
  luna_visor_tint: string | null;
}

/**
 * Batched loader for other people's loadouts. Avatars on one screen ask
 * within the same tick; this collects their ids and makes a single
 * `get_luna_loadouts` call (migration 20261010010000). If that RPC isn't
 * deployed yet, it answers `null` for everyone and stops asking — those
 * people simply show initials, exactly as before.
 */
let pending = new Map<string, Array<(l: Loadout | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;
let rpcUnavailable = false;

async function flush() {
  const batch = pending;
  pending = new Map();
  timer = null;
  const ids = [...batch.keys()];
  let rows: PublicLoadoutRow[] = [];
  if (!rpcUnavailable) {
    const { data, error } = await (supabase.rpc as any)('get_luna_loadouts', { p_user_ids: ids });
    if (error) rpcUnavailable = true;
    else rows = (data ?? []) as PublicLoadoutRow[];
  }
  const byId = new Map(rows.map((r) => [r.user_id, r]));
  for (const [id, resolvers] of batch) {
    const r = byId.get(id);
    // No row (or no RPC): we don't know their Luna, so don't invent one.
    const loadout = r
      ? sanitizeLoadout({ ...loadoutFromLegacy(r.luna_suit_color, r.luna_visor_tint), ...((r.luna_loadout as object) ?? {}) })
      : null;
    resolvers.forEach((resolve) => resolve(loadout));
  }
}

function loadPublicLoadout(userId: string): Promise<Loadout | null> {
  return new Promise((resolve) => {
    const list = pending.get(userId) ?? [];
    list.push(resolve);
    pending.set(userId, list);
    if (!timer) timer = setTimeout(flush, 16);
  });
}

/** Another person's Luna, or null when unknown. Cached and batched. */
export function usePublicLoadout(userId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['luna-loadout-public', userId],
    enabled: !!userId && enabled,
    staleTime: 10 * 60_000,
    queryFn: () => loadPublicLoadout(userId!),
  });
}

/** Test seam: forget the batcher's state. */
export function __resetPublicLoadoutsForTests() {
  pending = new Map();
  if (timer) clearTimeout(timer);
  timer = null;
  rpcUnavailable = false;
}
