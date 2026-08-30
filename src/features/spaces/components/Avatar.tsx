import { LunaAstronaut } from '../../../../learnstation-luna';
import { cn } from '@/lib/utils';
import type { Person } from '../types';

/**
 * One person, one avatar, everywhere.
 *
 * Falls back in a fixed order — **uploaded image → Luna → initials** — so a
 * person looks the same in the top bar, on a byline and in a member list. Two
 * call sites drawing their own initials is how the same person ends up with
 * two faces.
 *
 * Luna is the product's existing astronaut (`learnstation-luna`), personalised
 * by `profiles.luna_suit_color / luna_visor_tint / luna_patch` — all fields the
 * auth profile already carries. Nothing new is invented here: the old product
 * renders exactly this in its ProfileChip, and this imports it by the same
 * path rather than building a second avatar system.
 *
 * `initials` is genuinely the last resort. It is never wrong, but it is also
 * never a face, and a wall of two-letter squares is what a member list looks
 * like when nobody has set anything up yet.
 */

const SIZE = {
  xs: { box: 'h-5 w-5', text: 'text-[9px]', luna: 'xs' as const },
  sm: { box: 'h-7 w-7', text: 'text-[10px]', luna: 'xs' as const },
  md: { box: 'h-9 w-9', text: 'text-[12px]', luna: 'xs' as const },
  lg: { box: 'h-11 w-11', text: 'text-[13px]', luna: 'sm' as const },
  xl: { box: 'h-20 w-20', text: 'text-[24px]', luna: 'md' as const },
};

export interface AvatarProps {
  person: Person;
  size?: keyof typeof SIZE;
  /** Luna personalisation, straight off the auth profile. */
  luna?: { suitColor?: string; visorTint?: string; patch?: string };
  /** True for the signed-in viewer, who gets Luna rather than initials. */
  isViewer?: boolean;
  className?: string;
}

export function Avatar({ person, size = 'md', luna, isViewer, className }: AvatarProps) {
  const s = SIZE[size];

  const initials = person.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');

  // 1. A real picture always wins.
  if (person.avatarUrl) {
    return (
      <img
        src={person.avatarUrl}
        alt=""
        className={cn(s.box, 'shrink-0 rounded-full object-cover', className)}
      />
    );
  }

  // 2. Luna, for whoever has personalised one. Today that is the viewer.
  if (isViewer) {
    return (
      <span
        aria-hidden
        className={cn(
          s.box,
          'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-secondary',
          className,
        )}
      >
        <LunaAstronaut
          variant="head"
          size={s.luna}
          phase="full"
          showShadow={false}
          animated={false}
          suitColor={luna?.suitColor}
          visorTint={luna?.visorTint}
          patchImage={luna?.patch}
        />
      </span>
    );
  }

  // 3. Initials. Never wrong, never a face.
  return (
    <span
      aria-hidden
      className={cn(
        s.box,
        s.text,
        'flex shrink-0 items-center justify-center rounded-full bg-white/10 font-semibold text-quiet',
        className,
      )}
    >
      {initials}
    </span>
  );
}

/**
 * Rank ring — the earned border around the viewer's avatar.
 *
 * A conic sweep showing progress through the current Rank, which is the only
 * progression Doc 1 allows. Deliberately re-created here rather than importing
 * the old product's `RankRing`: that one reads the live profile and belongs to
 * a namespace this one must not touch.
 */
export function RankRing({
  progress,
  className,
  children,
}: {
  /** 0–100 through the current Rank. */
  progress: number;
  className?: string;
  children: React.ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, progress));
  return (
    <span
      className={cn('relative inline-flex items-center justify-center', className)}
      // The ring *is* the gauge — same idea as the map's concept ring.
      style={{
        background: `conic-gradient(hsl(var(--primary)) ${pct * 3.6}deg, rgba(255,255,255,0.10) 0deg)`,
        borderRadius: '9999px',
        padding: 3,
      }}
    >
      <span className="flex items-center justify-center rounded-full bg-[#0b1018] p-0.5">
        {children}
      </span>
    </span>
  );
}
