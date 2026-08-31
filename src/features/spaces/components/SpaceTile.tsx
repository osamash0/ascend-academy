import { motion } from 'motion/react';
import { Archive, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { topicIcon } from '@/lib/topicIcon';
import { ClassificationChips } from './badges';
import { gradientFor } from '@/components/console';
import type { Space } from '../types';

/**
 * A Space as cover art.
 *
 * Modelled on the PS5 home rows: a large square tile where the art carries the
 * identity, the focused tile scales up and takes a light ring, and the name
 * sits *on* the art in a scrim plate at the bottom rather than floating
 * underneath it.
 *
 * The earlier version was a 96px app icon with a caption below — too small to
 * read as cover art, and it left the row looking like a settings screen rather
 * than a shelf. Spaces have no real key art, so the gradient plus the topic
 * icon *is* the art; the name therefore stays legible at all times instead of
 * appearing only on focus, which is a luxury a console can afford when the art
 * is a game everyone recognises.
 */

const SIZE = 200;

interface Props {
  space: Space;
  /** Position in the rail. Drives keyboard focus, never the art. */
  index: number;
  isActive: boolean;
  /** Dim the whole row while focus has dropped into the Lessons below. */
  isDimmed?: boolean;
  /**
   * Show what the Space is about.
   *
   * True on Discover, where you are deciding whether to join and the subject
   * is the thing you are deciding on; false in "Mine", where you already know
   * and it is furniture. `ClassificationChips` documents exactly this rule —
   * "right on a Discover card… inside a Space you visit every day it is
   * furniture" — and the Discover card was the one surface that never mounted
   * it, so the rule described a screen it did not reach.
   */
  showClassification?: boolean;
  onFocus: () => void;
  onOpen: () => void;
}

/** "1 member", not "1 members". Small, but it is the copy people actually read. */
const plural = (n: number, one: string, many = `${one}s`) =>
  // Grouped: a Discover card showed "1204 members", and four unbroken digits
  // read as an id rather than a count.
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function SpaceTile({
  space,
  index,
  isActive,
  isDimmed,
  showClassification = false,
  onFocus,
  onOpen,
}: Props) {
  const Icon = topicIcon(space.name, space.id);
  const owned = space.viewerRole === 'owner';
  const archived = space.state === 'archived';
  // A Space with no published Lessons and drafts queued is still ingesting.
  const processing = space.lessonCount === 0 && (space.draftsPending ?? 0) > 0;
  const complete = space.lessonCount > 0 && space.lessonsDone === space.lessonCount;

  return (
    <button
      type="button"
      data-active={isActive}
      onClick={onFocus}
      onDoubleClick={onOpen}
      aria-label={
        `${space.name}. ` +
        (owned ? 'You own this Space. ' : '') +
        (archived ? 'Archived. ' : '') +
        (processing ? 'Still processing. ' : `${space.viewerProgress}% complete. `) +
        `${space.memberCount} members.`
      }
      className="console-focusable shrink-0 rounded-2xl outline-none"
      style={{ width: SIZE }}
    >
      {/*
        No `layoutId` here, deliberately.
        
        A shared element morphing this tile into the Space screen's hero needs
        both halves alive in the same frame — and the route transition uses
        `AnimatePresence mode="wait"`, which unmounts the outgoing screen
        *before* mounting the incoming one. The two can never coexist, so the
        pair would render as ordinary divs while looking, in the source, like a
        working shared element. The spec anticipates this: "if layoutId isn't
        feasible across the router, fade only."
        
        Reinstating it means dropping `mode="wait"`, and then two full pages
        overlap at half opacity mid-fade, which reads as a glitch. Recorded as
        a trade rather than quietly left half-done.
      */}
      <motion.div
        animate={{
          scale: isActive ? 1 : 0.93,
          opacity: isActive ? 1 : isDimmed ? 0.45 : 0.78,
        }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        className={cn(
          'relative overflow-hidden rounded-2xl border bg-gradient-to-br',
          /*
             Keyed to the Space, not to where it happens to sit in the rail.
             The Space screen's hero shares this element via `layoutId` and
             cannot know the rail index — so an index-based gradient meant the
             tile morphed into a hero of a *different colour*, and the same
             Space changed colour when a row above it gained a member. A
             Space's art should be a property of the Space.
          */
          gradientFor(space.name.length),
          isActive
            ? 'border-white/45 shadow-[0_0_44px_-10px_rgba(255,255,255,0.4)] ring-1 ring-white/25'
            : 'border-white/10',
          // Archived reads as set aside, not broken or disabled.
          archived && 'saturate-[0.35]',
        )}
        style={{ height: SIZE }}
      >
        {/* Grid texture, matching the Lesson tiles so the two read as one set. */}
        <div className="absolute inset-0 bg-[size:22px_22px] bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,rgba(255,255,255,0)_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,rgba(255,255,255,0)_1px)]" />

        {/* The art: the topic icon, large and faint, plus the Space's code. */}
        <div aria-hidden className="absolute inset-0 flex items-center justify-center">
          {processing ? (
            <Loader2 aria-hidden className="h-10 w-10 animate-spin text-white/70" />
          ) : (
            <Icon aria-hidden className="h-16 w-16 text-white/25" />
          )}
        </div>
        <span
          aria-hidden
          className="absolute left-4 top-3.5 text-[15px] font-semibold tracking-wide text-label"
        >
          {space.shortCode}
        </span>

        {processing && <div className="absolute inset-0 animate-pulse bg-white/[0.06]" />}

        {/* Corner marker — one at a time, so it always means something. */}
        {archived ? (
          <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/65 px-2 py-[3px] text-[11px] font-medium text-white">
            <Archive aria-hidden className="h-3 w-3" />
            Archived
          </span>
        ) : complete ? (
          <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-success/90 px-2 py-[3px] text-[11px] font-medium text-white">
            <Check aria-hidden className="h-3 w-3" />
            Done
          </span>
        ) : space.newSinceLastVisit > 0 ? (
          /* Labelled, never a bare number — "2 new" says what is new. */
          <span className="absolute right-3 top-3 rounded-full bg-primary px-2 py-[3px] text-[11px] font-medium text-primary-foreground tabular-nums">
            {space.newSinceLastVisit} new
          </span>
        ) : null}

        {/* Title plate — the name lives on the art, as it does on a console. */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-4 pt-12">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-white">
            {space.name}
          </h3>
          <p className="mt-0.5 truncate text-[12.5px] text-quiet">
            {owned
              ? `${plural(space.draftsPending ?? 0, 'draft')} · ${plural(space.memberCount, 'member')}`
              : showClassification
                ? `${plural(space.memberCount, 'member')} · ${plural(space.starCount, 'star')}`
                : `${space.viewerProgress}% · ${plural(space.memberCount, 'member')}`}
          </p>
          {/* Capped at two, most specific first — the cap lives in the
              component's default, not here. */}
          {showClassification && <ClassificationChips space={space} className="mt-2" />}
        </div>

        {space.viewerProgress > 0 && space.viewerProgress < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-primary to-secondary"
              style={{ width: `${space.viewerProgress}%` }}
            />
          </div>
        )}
      </motion.div>
    </button>
  );
}
