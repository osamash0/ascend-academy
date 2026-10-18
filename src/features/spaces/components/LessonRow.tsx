import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, FileWarning, Loader2, Lock, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
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

const NEXT = 'var(--stage-accent, hsl(var(--primary)))';

export function LessonRow({ lesson, space, isNext }: Props) {
  const { t } = useTranslation('v4Space');
  const done = lesson.progress === 'done';
  const unpublished = lesson.state !== 'published';
  const processing = lesson.state === 'processing';

  return (
    <article
      className={cn(
        'group relative flex items-start gap-4 rounded-2xl border px-5 py-5 transition-colors sm:px-6',
        !isNext && 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.16] hover:bg-white/[0.05]',
      )}
      /* The next Lesson is lit in the room's own colour, not a fixed brand
         colour — on a stage the only colour is the subject's. */
      style={
        isNext
          ? {
              borderColor: `color-mix(in srgb, ${NEXT} 40%, transparent)`,
              background: `color-mix(in srgb, ${NEXT} 8%, transparent)`,
            }
          : undefined
      }
    >
      {/* Order is the identity here — two Lessons in this Space share a title. */}
      <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl text-[14px] font-semibold tabular-nums',
            done
              ? 'bg-success/15 text-success'
              : isNext
                ? ''
                : 'bg-white/[0.06] text-quiet',
          )}
          style={isNext && !done ? { background: `color-mix(in srgb, ${NEXT} 22%, transparent)`, color: NEXT } : undefined}
        >
          {done ? <Check aria-hidden className="h-4 w-4" /> : lesson.order}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
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
              {processing
                ? t('demo.lessonRow.processing')
                : lesson.state === 'draft'
                  ? t('demo.lessonRow.draft')
                  : t('demo.lessonRow.needsReview')}
            </span>
          )}
        </div>

        <h3 className="mt-2 text-[17px] font-semibold leading-relaxed text-foreground">
          {lesson.title}
        </h3>

        {/*
          Less at one look (Abi, 2026-10-10). The byline shows only when it
          says something: a Lesson by someone other than the Owner. In a
          Guided Space ten rows of the Owner's name were ten copies of the
          masthead. Practice and contribution counts live on the Lesson.
        */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {lesson.author.id !== space.owner.id && <AuthorLine person={lesson.author} />}
          {/* Deleting a Material never breaks its Lesson (Doc 1, Objects 4). */}
          {lesson.material === null && lesson.state === 'published' && (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-faint">
              <FileWarning aria-hidden className="h-3.5 w-3.5" />
              {t('demo.lessonRow.sourceRemoved')}
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
        aria-label={t('demo.lessonRow.label', {
          order: lesson.order,
          title: lesson.title,
          author: lesson.author.name,
          percent: lesson.percentComplete,
        })}
      >
        <span className="sr-only">{t('demo.lessonRow.open')}</span>
      </Link>

    </article>
  );
}
