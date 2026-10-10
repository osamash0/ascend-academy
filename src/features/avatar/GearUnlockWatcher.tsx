/**
 * Notices when learning unlocks new gear and lets Luna say so.
 *
 * The reveal is unexpected and names the learning behind it ("earned with a
 * 7-day streak") — rewards that inform rather than pay keep motivation
 * intrinsic (Deci, Koestner & Ryan 1999). It's a quiet toast, never a modal:
 * the level-up and badge popups already own the big moment.
 *
 * Seen unlocks are remembered per user/device. The first observation only
 * records a baseline, so existing students aren't greeted with forty toasts.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { StudentRoutes } from '@/lib/routes';
import { CATALOG } from './catalog';
import { itemName, unlockMemory } from './copy';
import { LunaAvatar } from './LunaAvatar';
import { useLoadout } from './useAvatar';
import { isUnlocked } from './unlocks';

const seenKey = (userId: string) => `avatar:seenUnlocks:${userId}`;

function readSeen(userId: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(seenKey(userId));
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function writeSeen(userId: string, ids: Iterable<string>) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify([...ids]));
  } catch {
    /* storage unavailable — worst case a reveal repeats next session */
  }
}

export function GearUnlockWatcher() {
  const { user, role } = useAuth();
  const { t, i18n } = useTranslation('avatar');
  const navigate = useNavigate();
  const { progress, badges, loadout, ready } = useLoadout();
  const userId = user?.id;

  useEffect(() => {
    if (!userId || role !== 'student' || !ready) return;
    const unlocked = CATALOG.filter((i) => i.unlock.kind !== 'free' && isUnlocked(i, progress));
    const seen = readSeen(userId);
    writeSeen(userId, unlocked.map((i) => i.id));
    if (!seen) return; // first visit on this device: baseline only

    const fresh = unlocked.filter((i) => !seen.has(i.id));
    if (!fresh.length) return;

    const star = fresh[fresh.length - 1];
    const dates = Object.fromEntries(badges.map((b) => [b.key, b.earnedAt]));
    // A beat after the level-up/badge popup, so the two don't talk over each other.
    const timer = window.setTimeout(() => {
      toast(fresh.length === 1 ? t('toast.title') : t('toast.titleMany', { count: fresh.length }), {
        description: `${itemName(t, star.id)} — ${unlockMemory(t, star, i18n.language, dates)}`,
        icon: (
          <span className="block h-10 w-10 overflow-hidden rounded-xl">
            <LunaAvatar loadout={{ ...loadout, [star.slot]: star.id }} variant="head" mood="celebrating" size={40} animated={false} />
          </span>
        ),
        action: { label: t('toast.action'), onClick: () => navigate(StudentRoutes.AVATAR) },
        duration: 9000,
      });
    }, 1800);
    return () => window.clearTimeout(timer);
    // `loadout`/`badges` only flavour the toast; progress is what triggers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, role, ready, progress]);

  return null;
}
