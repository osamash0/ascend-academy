import { LunaAvatar } from '@/features/avatar/LunaAvatar';
import type { Loadout } from '@/features/avatar/types';
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
 * Luna is drawn by the app-wide avatar renderer (`features/avatar/LunaAvatar`,
 * pure SVG) from the viewer's loadout — the same face the rest of the product
 * shows via `UserAvatar`. This namespace is sealed from auth and data, so it
 * takes the loadout as a prop instead of looking it up.
 *
 * `initials` is genuinely the last resort. It is never wrong, but it is also
 * never a face, and a wall of two-letter squares is what a member list looks
 * like when nobody has set anything up yet.
 */

const SIZE = {
  xs: { box: 'h-5 w-5', text: 'text-[9px]', px: 20 },
  sm: { box: 'h-7 w-7', text: 'text-[10px]', px: 28 },
  md: { box: 'h-9 w-9', text: 'text-[12px]', px: 36 },
  lg: { box: 'h-11 w-11', text: 'text-[13px]', px: 44 },
  xl: { box: 'h-20 w-20', text: 'text-[24px]', px: 80 },
};

export interface AvatarProps {
  person: Person;
  size?: keyof typeof SIZE;
  /** The viewer's Luna loadout; defaults to Luna as she ships. */
  loadout?: Partial<Loadout>;
  /** True for the signed-in viewer, who gets Luna rather than initials. */
  isViewer?: boolean;
  className?: string;
}

export function Avatar({ person, size = 'md', loadout, isViewer, className }: AvatarProps) {
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
        // Decorative: the name is always rendered beside it, so announcing the
        // image would say the person's name twice. `alt=""` is the <img>
        // equivalent of the `aria-hidden` on the two branches below.
        alt=""
        aria-hidden
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
          'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.06]',
          className,
        )}
      >
        <LunaAvatar
          variant="head"
          size={s.px}
          animated={false}
          loadout={{ ...loadout, aura: 'aura-none', companion: 'companion-none' }}
          className="h-full w-full"
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
