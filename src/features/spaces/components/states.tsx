import { Compass, Plus, RotateCw, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Empty, loading and error surfaces.
 *
 * "Treat failure and emptiness as moments for direction, not mood." An empty
 * screen is an invitation to act; an error says what happened and how to fix
 * it, without apologising or being vague.
 */

/* ── Loading ────────────────────────────────────────────────────── */

/**
 * A skeleton mirrors the geometry it replaces, or it is worse than nothing.
 *
 * There used to be one skeleton for every screen, drawing 96px tiles — while
 * `SpaceTile` is 200px, so the rail jumped every time it loaded — and it was
 * also the loading state for Home, Library and a Space, three screens with no
 * tile rail at all, where it mirrored nothing. The doc comment claimed
 * "nothing shifts when the content lands"; everything shifted.
 *
 * Three shapes now, one per real layout. Picking the wrong one is still
 * possible, but it is now a visible mistake rather than the default.
 */
const bar = (cls: string) => `animate-pulse rounded-full bg-white/[0.05] ${cls}`;

/** The Spaces rail: 200px tiles, matching `SpaceTile`. */
export function SpacesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your Spaces" className="px-6 pt-8 lg:px-12">
      <div className={bar('mb-6 h-7 w-32 rounded-xl')} />
      <div className="mb-4 flex gap-2">
        <div className={bar('h-4 w-16')} />
        <div className={bar('h-4 w-20')} />
      </div>
      <div className="flex gap-5 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="shrink-0 space-y-3">
            <div className="h-[200px] w-[200px] animate-pulse rounded-2xl bg-white/[0.05]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A hero, then rows beneath it — Space, Lesson, Concept, Person.
 * The block sizes match the real headers so the title does not jump.
 */
export function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="mx-auto max-w-4xl px-6 pt-6 lg:px-8">
      <div className={bar('mb-8 h-5 w-24')} />
      <div className={bar('mb-4 h-3 w-40')} />
      <div className="mb-5 h-12 w-3/4 animate-pulse rounded-2xl bg-white/[0.05]" />
      <div className="mb-8 flex gap-3">
        <div className={bar('h-12 w-36')} />
        <div className={bar('h-12 w-28')} />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-white/[0.03]" />
        ))}
      </div>
    </div>
  );
}

/** A list of rows — Library, Social, Settings, the Studio screens. */
export function ListSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="mx-auto max-w-4xl px-6 pt-8 lg:px-8">
      <div className={bar('mb-3 h-7 w-40 rounded-xl')} />
      <div className={bar('mb-8 h-4 w-64')} />
      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.03]" />
        ))}
      </div>
    </div>
  );
}

/* ── Shell ──────────────────────────────────────────────────────── */

function Shell({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[52vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05] text-quiet">
        {icon}
      </div>
      <h2 className="mb-2 text-2xl font-bold tracking-tight">{title}</h2>
      <p className="mb-7 max-w-[42ch] text-[14.5px] leading-relaxed text-quiet">{body}</p>
      {children ? <div className="flex flex-wrap items-center justify-center gap-3">{children}</div> : null}
    </div>
  );
}

const PRIMARY =
  'console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 ' +
  'text-[14px] font-semibold text-slate-900 transition-transform hover:scale-[1.03]';
const SECONDARY =
  'console-focusable inline-flex h-12 items-center gap-2 rounded-full border border-white/12 ' +
  'bg-white/[0.04] px-6 text-[14px] font-bold text-foreground transition-colors hover:bg-white/[0.08]';

/* ── Empty ──────────────────────────────────────────────────────── */

/**
 * Every new account starts here. Two ways in, both plainly named.
 *
 * The handlers are **required**. They were optional, and the single call site
 * passed neither — so the state every new account lands in had two exits and
 * both did nothing, while a working create dialog sat 140 lines away in the
 * same file. Optional callbacks on a control that is always rendered are how
 * a dead end gets written without anyone deciding to write one.
 */
export function NoSpacesYet({
  onCreate,
  onJoin,
}: {
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <Shell
      icon={<Plus aria-hidden className="h-6 w-6" />}
      title="No Spaces yet"
      body="A Space is where you keep one subject — its material, its practice, and the people learning it with you."
      >
      <button type="button" onClick={onCreate} className={PRIMARY}>
        <Plus aria-hidden className="h-4 w-4" />
        Create your first Space
      </button>
      <button type="button" onClick={onJoin} className={SECONDARY}>
        Join with a code
      </button>
    </Shell>
  );
}

/** Discover with nothing in scope — usually a small or brand-new Universe. */
export function NothingToDiscover({
  scopeLabel,
  onWiden,
}: {
  scopeLabel: string;
  onWiden: () => void;
}) {
  return (
    <Shell
      icon={<Compass aria-hidden className="h-6 w-6" />}
      title={`No public Spaces in ${scopeLabel}`}
      body="Nobody has opened a Space here yet. Widen the search, or start one and let others join you."
    >
      <button type="button" onClick={onWiden} className={SECONDARY}>
        Search everywhere
      </button>
    </Shell>
  );
}

/* ── Error ──────────────────────────────────────────────────────── */

/**
 * Distinguishes a genuine failure from a legitimately empty list — otherwise a
 * failed fetch renders as "you have no Spaces", which is a lie.
 */
export function SpacesError({
  /** What failed to load. Defaults to Spaces, which is where this started. */
  what = 'your Spaces',
  onRetry = () => window.location.reload(),
}: {
  what?: string;
  onRetry?: () => void;
}) {
  return (
    <Shell
      icon={<TriangleAlert aria-hidden className="h-6 w-6 text-destructive" />}
      /*
        Naming what failed. This is now the error state for twelve screens, and
        "Couldn't load your Spaces" on a Lesson is a sentence about something
        the reader did not ask for.
      */
      title={`Couldn’t load ${what}`}
      body="The connection dropped on the way. Nothing of yours is lost."
    >
      <button type="button" onClick={onRetry} className={PRIMARY}>
        <RotateCw aria-hidden className="h-4 w-4" />
        Try again
      </button>
    </Shell>
  );
}

/* ── Not found ──────────────────────────────────────────────────── */

/**
 * A thing that is not there — as distinct from a thing that failed to load.
 *
 * Three screens used `SpacesError` for a bad id, so mistyping a Lesson URL
 * said "Couldn't load your Spaces. The connection dropped on the way", which
 * is a wrong diagnosis attached to a retry button that will never work. The
 * two states need different words because they need different actions.
 */
export function NotFound({
  what,
  backTo,
  backLabel,
}: {
  what: string;
  backTo: string;
  backLabel: string;
}) {
  return (
    <Shell
      icon={<Compass aria-hidden className="h-6 w-6" />}
      title={`That ${what} isn’t here`}
      body="It may have been removed, or the link may be wrong. Nothing of yours is affected."
    >
      <Link to={backTo} className={SECONDARY}>
        {backLabel}
      </Link>
    </Shell>
  );
}

/* ── Inline notice ──────────────────────────────────────────────── */

/** Quiet inline strip — used for archived Spaces and Owner-only signals. */
export function Notice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-[12.5px] leading-relaxed text-quiet', className)}>{children}</p>
  );
}
