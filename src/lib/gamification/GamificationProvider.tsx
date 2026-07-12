import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { BadgeEarnedModal } from '@/components/BadgeEarnedModal';
import { LevelUpModal } from '@/components/LevelUpModal';
import { badgeLabel } from '@/lib/gamification/badgeLabel';
import {
  awardBadge as awardBadgeRpc,
  evaluateBadges,
  grantXp as grantXpRpc,
  type BadgeDefinition,
} from '@/services/gamificationService';

interface GamificationContextValue {
  /** Server-side sweep of state badges (debounced). Call after any meaningful action. */
  evaluate: () => void;
  /** Award an event badge by key (immediate). */
  awardBadge: (key: string) => Promise<void>;
  /** Add XP with a reason + optional one-time dedupe key. */
  grantXp: (xp: number, reason: string, dedupeKey?: string) => Promise<void>;
}

const GamificationContext = createContext<GamificationContextValue | undefined>(undefined);

type QueueItem =
  | { kind: 'badge'; name: string; description: string; icon: string }
  | { kind: 'level'; level: number };

const celebratedKey = (userId: string) => `gam:celebratedLevel:${userId}`;

/** Highest level we've already shown a popup for on this device, for this user. */
function readCelebrated(userId: string): number {
  try {
    const raw = localStorage.getItem(celebratedKey(userId));
    const n = raw == null ? NaN : Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeCelebrated(userId: string, level: number): void {
  try {
    localStorage.setItem(celebratedKey(userId), String(level));
  } catch {
    /* storage unavailable (private mode / quota) — popup falls back to per-session guard */
  }
}

/**
 * Owns the global reward UI. Mounted once near the app root so every feature
 * gets badge/level-up popups + cache invalidation for free by calling
 * `useGamification()`. Level-ups are detected from profile changes, so XP from
 * any source (quiz, lecture, bundled badge reward) surfaces a modal.
 */
export function GamificationProvider({ children }: { children: ReactNode }) {
  const { profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const lastLevelRef = useRef<number | null>(null);
  const celebratedUserRef = useRef<string | null>(null);
  const evalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect level-ups from any XP source by watching the profile's level.
  // Each level is celebrated at most once per user/device: the highest
  // celebrated level is persisted, so a transient/re-read of a lower level
  // (async fetch vs realtime vs refreshProfile ordering) can't re-fire a popup
  // for a level the user has already seen.
  const userId = profile?.user_id;
  useEffect(() => {
    const lvl = profile?.current_level;
    if (lvl == null || userId == null) return;

    // Re-baseline when the signed-in user changes (login as a different user).
    if (celebratedUserRef.current !== userId) {
      celebratedUserRef.current = userId;
      lastLevelRef.current = Math.max(lvl, readCelebrated(userId));
      return; // don't fire on first observation
    }

    const ceiling = Math.max(lastLevelRef.current ?? 0, readCelebrated(userId));
    if (lvl > ceiling) {
      setQueue(q => [...q, { kind: 'level', level: lvl }]);
      writeCelebrated(userId, lvl);
    }
    lastLevelRef.current = Math.max(lastLevelRef.current ?? 0, lvl);
  }, [profile?.current_level, userId]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['student-lectures'] });
    queryClient.invalidateQueries({ queryKey: ['student-courses'] });
    queryClient.invalidateQueries({ queryKey: ['student-progress'] });
    queryClient.invalidateQueries({ queryKey: ['student-achievements'] });
    queryClient.invalidateQueries({ queryKey: ['course-visits'] });
    queryClient.invalidateQueries({ queryKey: ['badge-catalog'] });
  }, [queryClient]);

  const onAwarded = useCallback(async (defs: BadgeDefinition[]) => {
    if (defs.length) {
      setQueue(q => [
        ...q,
        ...defs.map(d => ({ kind: 'badge' as const, icon: d.icon, ...badgeLabel(t, d) })),
      ]);
    }
    // Refresh first so the level-up effect sees the new total (incl. bundled XP).
    await refreshProfile();
    invalidate();
  }, [t, refreshProfile, invalidate]);

  const evaluate = useCallback(() => {
    if (evalTimer.current) clearTimeout(evalTimer.current);
    evalTimer.current = setTimeout(async () => {
      const defs = await evaluateBadges();
      await onAwarded(defs);
    }, 400);
  }, [onAwarded]);

  const awardBadge = useCallback(async (key: string) => {
    const def = await awardBadgeRpc(key);
    await onAwarded(def ? [def] : []);
  }, [onAwarded]);

  const grantXp = useCallback(async (xp: number, reason: string, dedupeKey?: string) => {
    await grantXpRpc(xp, reason, dedupeKey);
    await refreshProfile();
    invalidate();
  }, [refreshProfile, invalidate]);

  useEffect(() => () => { if (evalTimer.current) clearTimeout(evalTimer.current); }, []);

  const current = queue[0];
  const closeCurrent = useCallback(() => setQueue(q => q.slice(1)), []);

  useEffect(() => {
    if (!current) return;
    if (typeof window !== 'undefined') {
      if (current.kind === 'level') {
        window.dispatchEvent(new CustomEvent('fire-confetti'));
        window.dispatchEvent(new CustomEvent('play-sound', { detail: 'levelUp' }));
      } else if (current.kind === 'badge') {
        window.dispatchEvent(new CustomEvent('fire-confetti'));
        window.dispatchEvent(new CustomEvent('play-sound', { detail: 'success' }));
      }
    }
  }, [current]);

  const value = useMemo(
    () => ({ evaluate, awardBadge, grantXp }),
    [evaluate, awardBadge, grantXp],
  );

  return (
    <GamificationContext.Provider value={value}>
      {children}
      <BadgeEarnedModal
        isOpen={current?.kind === 'badge'}
        onClose={closeCurrent}
        badgeName={current?.kind === 'badge' ? current.name : ''}
        badgeDescription={current?.kind === 'badge' ? current.description : ''}
        badgeIcon={current?.kind === 'badge' ? current.icon : '🏆'}
      />
      <LevelUpModal
        isOpen={current?.kind === 'level'}
        onClose={closeCurrent}
        newLevel={current?.kind === 'level' ? current.level : 1}
      />
    </GamificationContext.Provider>
  );
}

export function useGamification(): GamificationContextValue {
  const ctx = useContext(GamificationContext);
  if (!ctx) throw new Error('useGamification must be used within a GamificationProvider');
  return ctx;
}
