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
 * **Everyone gets a Luna** (2026-10-10, Abi: "connect the owner avatar
 * system"). Before, only the viewer had one, so an Owner byline, a member list
 * and the community cards were walls of two-letter squares next to your own
 * astronaut. A person who has not personalised theirs gets a suit and visor
 * picked from their id — stable, so the same person is the same astronaut in
 * every place, and never purple (the brand is monochrome).
 *
 * `initials` remains only for a nameless edge case; it is never a face.
 */

/** Suits and visors a person can be given before they choose their own. */
const SUITS = ['#FFF8E7', '#E6E9EE', '#D8F3E6', '#DCEFF7', '#FBE3D2', '#F3E9C9', '#F7DCE3'];
const VISORS = ['#88B0B5', '#7FA7C9', '#9BB89A', '#C9A27F', '#8E9AAF'];

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/** The Luna a person has until they personalise one. Same id, same astronaut. */
export function lunaFor(id: string) {
  const h = hash(id);
  return { suitColor: SUITS[h % SUITS.length], visorTint: VISORS[Math.floor(h / SUITS.length) % VISORS.length] };
}

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
  /** True for the signed-in viewer, whose Luna is their own personalised one. */
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
    const suit = isViewer ? luna : { ...lunaFor(person.id), ...luna };
    return (
      <span
        aria-hidden
        className={cn(
          s.box,
          'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.08] ring-1 ring-white/10',
          className,
        )}
      >
        <LunaAstronaut
          variant="head"
          size={s.luna}
          phase="full"
          showShadow={false}
          animated={false}
          suitColor={suit?.suitColor}
          visorTint={suit?.visorTint}
          patchImage={suit?.patch}
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
