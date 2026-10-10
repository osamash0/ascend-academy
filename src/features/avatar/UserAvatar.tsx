/**
 * UserAvatar — the one way to draw a person anywhere in the app.
 *
 * photo → their Luna → initials (rules in identity.ts). The signed-in viewer
 * always gets their live loadout (including unsaved-to-DB fallbacks); other
 * people's Luna is fetched in one batched call per screen.
 *
 * Small avatars stay calm: no aura or orbiting companion under 64px, and
 * nothing animates unless asked — a leaderboard of fifty people should read
 * as fifty faces, not fifty light shows.
 */
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { LunaAvatar } from './LunaAvatar';
import { initialsOf, isRealPhoto, usePublicLoadout } from './identity';
import { useLoadout } from './useAvatar';
import type { Loadout, Mood } from './types';

export interface UserAvatarProps {
  /** Whose face this is. Omit only for a nameless placeholder. */
  userId?: string | null;
  name?: string | null;
  /** Pre-computed initials, when the caller already has them. */
  initials?: string;
  avatarUrl?: string | null;
  /** Use this loadout instead of looking one up (e.g. a live preview). */
  loadout?: Partial<Loadout> | null;
  /** Rendered size in px. */
  size?: number;
  shape?: 'circle' | 'rounded';
  mood?: Mood;
  animated?: boolean;
  className?: string;
}

function calmFor(size: number, loadout: Partial<Loadout>): Partial<Loadout> {
  return size < 64 ? { ...loadout, aura: 'aura-none', companion: 'companion-none' } : loadout;
}

function Frame({ size, shape, className, children }: { size: number; shape: 'circle' | 'rounded'; className?: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-white/[0.06]', shape === 'circle' ? 'rounded-full' : 'rounded-[28%]', className)}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

function Initials({ name, initials, size }: { name?: string | null; initials?: string; size: number }) {
  return (
    <span className="select-none font-semibold text-white/75" style={{ fontSize: Math.max(9, size * 0.36) }}>
      {initials || initialsOf(name)}
    </span>
  );
}

function ViewerLuna({ size, mood, animated }: { size: number; mood?: Mood; animated: boolean }) {
  const { loadout, mood: liveMood } = useLoadout();
  return <LunaAvatar loadout={calmFor(size, loadout)} mood={mood ?? liveMood} variant="head" size={size} animated={animated} className="h-full w-full" />;
}

function OtherLuna({ userId, size, mood, animated, fallback }: { userId: string; size: number; mood?: Mood; animated: boolean; fallback: React.ReactNode }) {
  const { data: loadout } = usePublicLoadout(userId);
  if (!loadout) return <>{fallback}</>;
  return <LunaAvatar loadout={calmFor(size, loadout)} mood={mood ?? 'bright'} variant="head" size={size} animated={animated} className="h-full w-full" />;
}

export function UserAvatar({ userId, name, initials, avatarUrl, loadout, size = 40, shape = 'circle', mood, animated = false, className }: UserAvatarProps) {
  const { user } = useAuth();
  const isViewer = !!userId && userId === user?.id;

  const fallback = <Initials name={name} initials={initials} size={size} />;
  let face: React.ReactNode;
  if (isRealPhoto(avatarUrl)) {
    face = <img src={avatarUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />;
  } else if (loadout) {
    face = <LunaAvatar loadout={calmFor(size, loadout)} mood={mood ?? 'bright'} variant="head" size={size} animated={animated} className="h-full w-full" />;
  } else if (isViewer) {
    face = <ViewerLuna size={size} mood={mood} animated={animated} />;
  } else if (userId) {
    face = <OtherLuna userId={userId} size={size} mood={mood} animated={animated} fallback={fallback} />;
  } else {
    face = fallback;
  }

  return (
    <Frame size={size} shape={shape} className={className}>
      {face}
    </Frame>
  );
}

export default UserAvatar;
