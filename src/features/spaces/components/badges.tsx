import { BookOpen, Check, Link2, Lock, Quote, Star, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Grounding, Origin, Person, Space, SpaceMode, Visibility } from '../types';

/**
 * The markers that carry the foundation's rules onto the screen.
 *
 * Two things ride on content and both are always visible where they apply:
 * Origin (Official / Community) and Grounding (grounded / not grounded).
 * Grounding is dormant by default — see `GroundingMarker`.
 */

// Calm by default: sentence case, medium weight, no shouty tracking. These
// markers must be *noticed*, not *announced* — Doc 1 calls them "quiet
// markers, not warnings", and a wall of uppercase reads as an alarm.
const CHIP =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] ' +
  'text-[11.5px] font-medium whitespace-nowrap';

/* ── Origin ─────────────────────────────────────────────────────── */

/**
 * Official or Community. Never optional where content appears — separation is
 * the whole point, and a badge that sometimes shows is a badge nobody trusts.
 * Colour alone never carries this: the word is always present.
 */
export function OriginBadge({ origin, className }: { origin: Origin; className?: string }) {
  const official = origin === 'official';
  return (
    <span
      className={cn(
        CHIP,
        official
          ? 'bg-origin-official/12 text-origin-official'
          : 'bg-origin-community/12 text-origin-community',
        className,
      )}
    >
      {official ? 'Official' : 'Community'}
    </span>
  );
}

/* ── Grounding ──────────────────────────────────────────────────── */

/**
 * Dormant by default.
 *
 * When the Space has grounding switched off, this renders **nothing at all** —
 * not a neutral marker, not a placeholder. "A marker on everything would be a
 * marker on nothing; the label only exists where there is a truth to trace to."
 *
 * Truth-set Lessons are the reference itself and carry no marker either — pass
 * `isTruthSet` for those.
 */
export function GroundingMarker({
  grounding,
  spaceGroundingEnabled,
  isTruthSet = false,
  className,
}: {
  grounding: Grounding;
  spaceGroundingEnabled: boolean;
  isTruthSet?: boolean;
  className?: string;
}) {
  if (!spaceGroundingEnabled || isTruthSet) return null;

  // Internally nullable: null means the check has not run. Once grounding is
  // on, the UI treats null as not grounded.
  const grounded = grounding === 'grounded';

  return (
    <span
      className={cn(
        CHIP,
        grounded
          ? 'bg-grounded/12 text-grounded'
          : 'bg-white/[0.06] text-not-grounded',
        className,
      )}
      // Says nothing about correctness — quality judgment stays human.
      title={
        grounded
          ? 'Traces back to this Space’s source material.'
          : 'No supporting passage found. Not a judgement of correctness.'
      }
    >
      {grounded ? <Quote aria-hidden className="h-2.5 w-2.5" /> : null}
      {grounded ? 'Grounded' : 'Not grounded'}
    </span>
  );
}

/* ── Space mode ─────────────────────────────────────────────────── */

/** Guided or Open — who may publish Lessons into the path. */
export function ModeBadge({ mode, className }: { mode: SpaceMode; className?: string }) {
  const guided = mode === 'guided';
  return (
    <span
      className={cn(
        CHIP,
        guided ? 'bg-mode-guided/12 text-mode-guided' : 'bg-mode-open/12 text-mode-open',
        className,
      )}
      title={
        guided
          ? 'Only the Owner and Editors publish into the path.'
          : 'Every Member can publish Lessons into the path.'
      }
    >
      {guided ? 'Guided' : 'Open'}
    </span>
  );
}

/* ── Visibility ─────────────────────────────────────────────────── */

const VISIBILITY: Record<Visibility, { label: string; icon: typeof Lock }> = {
  private: { label: 'Private', icon: Lock },
  invite: { label: 'Invite', icon: Link2 },
  public: { label: 'Public', icon: Users },
};

export function VisibilityBadge({ visibility, className }: { visibility: Visibility; className?: string }) {
  const { label, icon: Icon } = VISIBILITY[visibility];
  return (
    <span className={cn(CHIP, 'bg-white/[0.06] text-label', className)}>
      <Icon aria-hidden className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

/* ── Endorsed ───────────────────────────────────────────────────── */

/** Owner marked it good. Stays community-authored, stays in its section. */
export function EndorsedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(CHIP, 'bg-success/12 text-success', className)}
      title="Endorsed by the Owner. Still community-authored."
    >
      <Check aria-hidden className="h-2.5 w-2.5" />
      Endorsed
    </span>
  );
}

/* ── Classification chips ───────────────────────────────────────── */

/**
 * Grouping is metadata resolved at read time, never folders. Chips tap to
 * filter; there is no container to click into.
 *
 * Two axes that never touch: the Universe answers *who owns it*, the Domain
 * answers *what it's about*. A Space can sit in Marburg and be Computer
 * Science, or sit nowhere and still be Computer Science.
 *
 * **Classification helps you choose, not once you have chosen.** Showing all
 * four labels — Faculty, Department, Domain, Subject — is right on a Discover
 * card, where you are deciding whether to join. Inside a Space you visit every
 * day it is furniture: you already know what it is, and it crowds out the one
 * thing you came for. So the axes are ordered most-specific first and capped;
 * `max={0}` hides them entirely.
 *
 * The full classification still exists on the object — this is a display
 * decision, not a data one. It belongs in the Space's About/settings, where
 * someone editing it can see all of it at once.
 */
export function ClassificationChips({
  space,
  max = 2,
  className,
}: {
  space: Space;
  /** How many to show, most specific first. 0 hides them. */
  max?: number;
  className?: string;
}) {
  const levels = space.universe?.levels ?? [];
  const chips = [
    // Most specific first: the Subject says more than the Domain, and the
    // deepest Universe level says more than the shallowest.
    ...(space.classification.subject ? [space.classification.subject] : []),
    ...(levels.length ? [levels[levels.length - 1].value] : []),
    space.classification.domain,
    ...levels.slice(0, -1).map((l) => l.value),
  ].slice(0, max);

  if (!chips.length) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {chips.map((c) => (
        <span
          key={c}
          className="rounded-full border border-white/10 px-3 py-[3px] text-[12px] font-normal text-quiet"
        >
          {c}
        </span>
      ))}
    </div>
  );
}

/* ── Author ─────────────────────────────────────────────────────── */

/**
 * Name and avatar, always. Anonymous content is not allowed, and credit stays
 * even if its author leaves the Space.
 */
export function AuthorLine({
  person,
  prefix,
  className,
}: {
  person: Person;
  prefix?: string;
  className?: string;
}) {
  const initials = person.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');

  return (
    <span className={cn('inline-flex items-center gap-2 text-[13px] text-quiet', className)}>
      {person.avatarUrl ? (
        <img src={person.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[9px] font-black text-quiet"
        >
          {initials}
        </span>
      )}
      {prefix ? <span className="text-faint">{prefix}</span> : null}
      <span className="font-semibold">{person.name}</span>
    </span>
  );
}

/* ── Star ───────────────────────────────────────────────────────── */

/**
 * Stars belong to whole Spaces. GitHub-style, unlimited, ranks Discover.
 * A Star never touches a contribution — that is what Like is for.
 * You cannot star your own Space.
 */
export function StarButton({
  count,
  starred,
  disabled = false,
  onToggle,
  className,
}: {
  count: number;
  starred: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={starred}
      aria-label={
        disabled
          ? `${count} stars. You can’t star your own Space.`
          : starred
            ? `Starred. ${count} stars. Tap to remove.`
            : `Star this Space. ${count} stars.`
      }
      title={disabled ? 'You can’t star your own Space.' : undefined}
      className={cn(
        'console-focusable inline-flex h-9 items-center gap-2 rounded-full border px-3.5',
        'text-[13px] font-bold tabular-nums transition-colors',
        starred
          ? 'border-star/40 bg-star/12 text-star'
          : 'border-white/12 bg-white/[0.04] text-quiet hover:bg-white/[0.08]',
        disabled && 'cursor-not-allowed opacity-45 hover:bg-white/[0.04]',
        className,
      )}
    >
      <Star aria-hidden className={cn('h-3.5 w-3.5', starred && 'fill-star')} />
      {count.toLocaleString()}
    </button>
  );
}

/* ── Lesson count ───────────────────────────────────────────────── */

export function LessonCount({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] text-quiet tabular-nums', className)}>
      <BookOpen aria-hidden className="h-3.5 w-3.5" />
      {count} {count === 1 ? 'Lesson' : 'Lessons'}
    </span>
  );
}
