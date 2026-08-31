import { Link } from 'react-router-dom';
import { Check, FileWarning, Loader2, Lock, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { topicIcon } from '@/lib/topicIcon';
import type { Lesson, Space } from '../types';
import { AuthorLine, GroundingMarker, OriginBadge } from './badges';

/**
 * One Lesson in the path.
 *
 * A row, not a tile. The path is ordered and its order carries meaning, so it
 * reads top-to-bottom like a route — a grid of cover art would invite the eye
 * to jump, and Doc 1 fixes this order for a reason.
 *
 * Every row carries its author. In a Guided Space that is always the Owner or
 * an Editor; in an Open Space it may be any Member, and then the Origin badge
 * does the separating work inside the path itself.
 */

interface Props {
  lesson: Lesson;
  space: Space;
  isNext?: boolean;
}

export function LessonRow({ lesson, space, isNext }: Props) {
  const Icon = topicIcon(lesson.title, lesson.id);
  const done = lesson.progress === 'done';
  const unpublished = lesson.state !== 'published';
  const processing = lesson.state === 'processing';

  return (
    <article
      className={cn(
        'group relative flex items-start gap-4 rounded-2xl border px-5 py-5 transition-colors sm:px-6',
        isNext
          ? 'border-primary/35 bg-primary/[0.07]'
          : 'border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.05]',
      )}
    >
      {/* Order is the identity here — two Lessons in this Space share a title. */}
      <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl text-[14px] font-semibold tabular-nums',
            done
              ? 'bg-success/15 text-success'
              : isNext
                ? 'bg-primary/20 text-primary'
                : 'bg-white/[0.06] text-quiet',
          )}
        >
          {done ? <Check aria-hidden className="h-4 w-4" /> : lesson.order}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {isNext && (
            <span className="rounded-full bg-primary px-2.5 py-[3px] text-[11.5px] font-medium text-primary-foreground">
              Next
            </span>
          )}
          {/*
            Always. `badges.tsx` states the rule — "never optional where
            content appears — separation is the whole point, and a badge that
            sometimes shows is a badge nobody trusts" — and this line argued
            the opposite, gating it on Open mode because "in a Guided Space
            everything is Official by definition".
            
            That premise died with Abi's call of 2026-08-31: a promoted Lesson
            is Community origin inside a Guided Space. So the gate would have
            hidden the marker on exactly the Lesson that most needs it, in the
            Space where nothing else on the row tells you a Member wrote it.
          */}
          <OriginBadge origin={lesson.origin} />
          <GroundingMarker
            grounding={lesson.grounding}
            spaceGroundingEnabled={space.groundingEnabled}
          />
          {unpublished && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-[3px] text-[11.5px] font-medium text-quiet">
              {processing ? <Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin" /> : <Lock aria-hidden className="h-2.5 w-2.5" />}
              {processing ? 'Processing' : lesson.state === 'draft' ? 'Draft' : 'Needs review'}
            </span>
          )}
        </div>

        <h3 className="mt-2 text-[17px] font-semibold leading-relaxed text-foreground">
          {lesson.title}
        </h3>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <AuthorLine person={lesson.author} />
          {lesson.practiceCount > 0 && (
            <span className="text-[12.5px] text-faint tabular-nums">
              {lesson.practiceCount} practice questions
            </span>
          )}
          {lesson.contributionCount > 0 && (
            <span className="text-[12.5px] text-faint tabular-nums">
              {lesson.contributionCount} contributions
            </span>
          )}
          {/* Deleting a Material never breaks its Lesson (Doc 1, Objects 4). */}
          {lesson.material === null && lesson.state === 'published' && (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-faint">
              <FileWarning aria-hidden className="h-3.5 w-3.5" />
              Source file removed
            </span>
          )}
        </div>

        {lesson.percentComplete > 0 && lesson.percentComplete < 100 && (
          <div className="mt-3 h-1 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
              style={{ width: `${lesson.percentComplete}%` }}
            />
          </div>
        )}
      </div>

      <div className="hidden shrink-0 items-center self-center sm:flex">
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
            isNext ? 'bg-white text-slate-900' : 'bg-white/[0.06] text-quiet group-hover:bg-white/[0.12]',
          )}
        >
          {processing ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Play aria-hidden className="h-4 w-4 fill-current" />}
        </span>
      </div>

      {/* Whole row is the target, not just the play button. A link rather than
          a button so it is shareable, middle-clickable and deep-linkable —
          Doc 2 requires every key screen to be reachable by URL. */}
      <Link
        to={`/v4/space/${space.id}/lesson/${lesson.id}`}
        className="console-focusable absolute inset-0 rounded-2xl"
        aria-label={`Lesson ${lesson.order}. ${lesson.title}. By ${lesson.author.name}. ${lesson.percentComplete}% complete.`}
      >
        <span className="sr-only">Open</span>
      </Link>

      <Icon aria-hidden className="pointer-events-none absolute right-16 top-1/2 hidden h-14 w-14 -translate-y-1/2 text-decor lg:block" />
    </article>
  );
}
