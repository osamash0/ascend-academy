/**
 * useAvatar — the signed-in student's Luna: progress, loadout, save.
 *
 * Progress comes from the auth profile (XP, level, streaks) plus earned badge
 * keys from `achievements`. The loadout lives in `profiles.luna_loadout`
 * (migration 20261010000100). Until that migration reaches an environment,
 * reads and writes degrade to localStorage + the legacy suit/visor columns —
 * the profile fetch in lib/auth.tsx deliberately does NOT select the new
 * column, so a missing column can never break sign-in.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { itemById } from './catalog';
import { loadoutFromLegacy, sanitizeLoadout } from './loadout';
import { deriveMood } from './mood';
import { EMPTY_PROGRESS } from './unlocks';
import type { AvatarProgress, Loadout } from './types';

const localKey = (userId: string) => `avatar:loadout:${userId}`;

function readLocal(userId: string): unknown {
  try {
    const raw = localStorage.getItem(localKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(userId: string, loadout: Loadout) {
  try {
    localStorage.setItem(localKey(userId), JSON.stringify(loadout));
  } catch {
    /* private mode — the legacy columns still carry suit + visor */
  }
}

/** Postgres "undefined column" or PostgREST "not in schema cache". */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || /luna_loadout/.test(error.message ?? ''));
}

export interface EarnedBadge {
  key: string;
  earnedAt: string | null;
}

export function useAvatarProgress() {
  const { user, profile } = useAuth();
  const userId = user?.id;

  // Prefix 'student-achievements' so GamificationProvider's invalidation refreshes us.
  const badgesQuery = useQuery({
    queryKey: ['student-achievements', 'avatar', userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<EarnedBadge[]> => {
      const { data, error } = await supabase
        .from('achievements')
        .select('badge_name, earned_at')
        .eq('user_id', userId!);
      if (error) throw error;
      return (data ?? []).map((r) => ({ key: r.badge_name, earnedAt: r.earned_at }));
    },
  });

  const progress: AvatarProgress = useMemo(() => {
    if (!profile) return EMPTY_PROGRESS;
    return {
      xp: profile.total_xp ?? 0,
      level: profile.current_level ?? 1,
      streak: profile.current_streak ?? 0,
      bestStreak: profile.best_streak ?? 0,
      badges: new Set((badgesQuery.data ?? []).map((b) => b.key)),
    };
  }, [profile, badgesQuery.data]);

  return { progress, badges: badgesQuery.data ?? [], ready: !!profile && !badgesQuery.isLoading };
}

export function useLoadout() {
  const { user, profile, refreshProfile } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { progress, badges, ready } = useAvatarProgress();

  const rawQuery = useQuery({
    queryKey: ['luna-loadout', userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<unknown> => {
      const { data, error } = await (supabase.from('profiles') as any)
        .select('luna_loadout')
        .eq('user_id', userId!)
        .maybeSingle();
      if (isMissingColumn(error)) return readLocal(userId!);
      if (error) throw error;
      const stored = data?.luna_loadout;
      return stored && Object.keys(stored).length ? stored : readLocal(userId!);
    },
  });

  const loadout = useMemo(() => {
    const legacy = loadoutFromLegacy(profile?.luna_suit_color, profile?.luna_visor_tint);
    const raw = { ...legacy, ...((rawQuery.data as object | null) ?? {}) };
    // Only clamp to unlocked once badges are known, or an earned badge item
    // would flash back to default on first paint.
    return sanitizeLoadout(raw, ready ? progress : undefined);
  }, [rawQuery.data, profile?.luna_suit_color, profile?.luna_visor_tint, progress, ready]);

  const save = useCallback(
    async (next: Loadout) => {
      if (!userId) return;
      const clean = sanitizeLoadout(next, progress);
      const legacy = {
        luna_suit_color: itemById(clean.suit)?.color ?? null,
        luna_visor_tint: itemById(clean.visor)?.color ?? null,
      };
      writeLocal(userId, clean);
      let { error } = await (supabase.from('profiles') as any)
        .update({ ...legacy, luna_loadout: clean })
        .eq('user_id', userId);
      if (isMissingColumn(error)) {
        ({ error } = await supabase.from('profiles').update(legacy).eq('user_id', userId));
      }
      if (error) throw error;
      queryClient.setQueryData(['luna-loadout', userId], clean);
      await refreshProfile();
    },
    [userId, progress, queryClient, refreshProfile],
  );

  return { loadout, progress, badges, mood: deriveMood(progress), save, ready: ready && !rawQuery.isLoading };
}
