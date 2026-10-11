import { LunaAvatar } from '@/features/avatar/LunaAvatar';
import type { Loadout } from '@/features/avatar/types';
import { useViewerLoadout } from '@/features/avatar/viewerLoadout';
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
 * **Everyone gets a Luna** (2026-10-10, Abi: "connect the owner avatar
 * system"). Before, only the viewer had one, so an Owner byline, a member list
 * and the community cards were walls of two-letter squares next to your own
 * astronaut. A person who has not personalised theirs gets a suit and visor
 * picked from their id — stable, so the same person is the same astronaut in
 * every place, and never purple (the brand is monochrome).
 *
 * `initials` remains only for a nameless edge case; it is never a face.
 */

/**
 * Free catalog items a person can be given before they choose their own —
 * never the purple-leaning ones (lavender, violet, mauve): the brand is
 * monochrome. Ids from `features/avatar/catalog`.
 */
const SUITS = ['suit-moonlight', 'suit-mint', 'suit-blush', 'suit-tide'];
const VISORS = ['visor-teal', 'visor-rose', 'visor-amber', 'visor-tide'];

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** The Luna a person has until they personalise one. Same id, same astronaut. */
export function lunaFor(id: string): Partial<Loadout> {
  const h = hash(id);
  return { suit: SUITS[h % SUITS.length], visor: VISORS[Math.floor(h / SUITS.length) % VISORS.length] };
}

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
  /** True for the signed-in viewer, whose Luna is their own loadout. */
  isViewer?: boolean;
  className?: string;
}

export function Avatar({ person, size = 'md', loadout, isViewer, className }: AvatarProps) {
  // The viewer wears their real Luna (filled by App from outside the sealed namespace).
  const viewerLoadout = useViewerLoadout();
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

  // 2. Luna — the viewer's own, or the one this person was given.
  if (person.name) {
    const lo = isViewer ? (loadout ?? viewerLoadout) : lunaFor(person.id);
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
          loadout={{ ...lo, aura: 'aura-none', companion: 'companion-none' }}
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
