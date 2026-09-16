import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { gradientFor } from '@/components/console';
import { topicIcon } from '@/lib/topicIcon';
import type { Lesson } from '../types';

/**
 * Walk the path from inside a Lesson.
 *
 * Modelled on the PS Store's row behaviour: the neighbours **peek in from the
 * screen edges** rather than sitting in a centred bar, so the path feels like
 * something you are moving along rather than a list you left behind.
 *
 * It walks the *published* path only — `adjacentLessons` enforces that, because
 * a pager that stepped into a draft would leak unpublished work to anyone who
 * pressed the arrow key twice (Doc 1 rule 1).
 *
 * Gestures are declarative per motion.dev: `whileHover` pulls the card further
 * onto the screen, `whileTap` presses it. Both are transforms, so
 * `reducedMotion="user"` in Scene removes them and leaves the card static and
 * legible — which is the correct fallback, not a slower animation.
 */

interface Props {
  spaceId: string;
  prev: Lesson | null;
  next: Lesson | null;
  /**
   * A panel is occupying the right 384px of the window, so span the rest.
   *
   * The reader's companion rail, today. It is a prop rather than something
   * this component works out for itself because the pager cannot see what is
   * beside it: `fixed inset-x-0` means "the whole window", and the window is
   * the one thing that does not change when a panel opens over part of it.
   *
   * Measured, on the reader at 1016px with the rail out: the next card sat at
   * 664–904 against a rail starting at 632 — the whole card behind it, at
   * equal `z-30`, with nothing to click. Not a docking artefact either; it was
   * still inside the rail's rectangle with the dock switched off.
   *
   * `sm` because that is where the rail stops being the whole screen
   * (`ReaderRail` is `w-full sm:w-96`). Below it the panel covers everything
   * and there is nothing to make room from.
   */
  companionOpen?: boolean;
}

function PagerCard({
  lesson,
  spaceId,
  side,
}: {
  lesson: Lesson;
  spaceId: string;
  side: 'prev' | 'next';
}) {
  const navigate = useNavigate();
  const Icon = topicIcon(lesson.title, lesson.id);
  const isPrev = side === 'prev';

  return (
    <motion.button
      type="button"
      onClick={() => navigate(`/v4/space/${spaceId}/lesson/${lesson.id}`)}
      aria-label={`${isPrev ? 'Previous' : 'Next'} Lesson: ${lesson.order}. ${lesson.title}`}
      // Rest half off-screen; hover pulls it in. Tap presses it.
      initial={false}
      animate={{ x: 0 }}
      whileHover={{ x: isPrev ? 14 : -14 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        'console-focusable group pointer-events-auto flex items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.10] bg-[#0b1018]/85 p-2.5 backdrop-blur-md',
        'w-[15rem] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]',
        isPrev ? 'flex-row' : 'flex-row-reverse',
      )}
    >
      <span
        className={cn(
          'relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br',
          gradientFor(lesson.order),
        )}
      >
        <Icon aria-hidden className="h-5 w-5 text-white/60" />
      </span>

      <span className={cn('min-w-0 flex-1', isPrev ? 'text-left' : 'text-right')}>
        <span className="flex items-center gap-1 text-[12px] text-faint">
          {isPrev && <ChevronLeft aria-hidden className="h-3 w-3" />}
          <span className={cn('flex-1', !isPrev && 'text-right')}>
            Lesson {lesson.order}
          </span>
          {!isPrev && <ChevronRight aria-hidden className="h-3 w-3" />}
        </span>
        <span className="mt-0.5 block truncate text-[13.5px] font-semibold text-foreground">
          {lesson.title}
        </span>
      </span>
    </motion.button>
  );
}

export function LessonPager({ spaceId, prev, next, companionOpen = false }: Props) {
  const navigate = useNavigate();

  /**
   * ←/→ walk the path, matching the console navigation everywhere else.
   *
   * The listener is on `window`, so it has to decline wherever something
   * nearer the user already owns those keys. Exempting text fields was enough
   * when the only thing on the page was prose; it is not any more.
   *
   * A `role="tablist"` owns ←/→ by ARIA convention, and the reader now mounts
   * two of them — the Read/Source segment and the rail's companions — plus a
   * rail full of buttons. Every one of those is a `<button>`, so the old
   * tag check waved them through: pressing → with a companion tab focused
   * navigated to the next Lesson, which is a different route, which unmounts
   * the reader and takes the open tutor conversation with it. One keystroke,
   * on the key a keyboard user is most likely to try inside a tablist.
   *
   * This is ruling F6 — one key, one meaning, the control on screen owns it —
   * which was reasoned about page-vs-Lesson and missed tab-vs-Lesson. The
   * selector is written by role rather than by naming the reader's rail,
   * because the rule is general: a composite widget that uses arrows, a text
   * field, or a complementary landmark is a context this component is not in.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /*
       * `instanceof Element`, not a cast. A `keydown` dispatched at `document`
       * — which is how the rail's own Escape test fires, and how a real page
       * delivers a key pressed with nothing focused — has `document` as its
       * target, and `document` has no `closest`. The previous version read
       * `.tagName`, which is merely `undefined` there; `closest(...)` throws,
       * and a listener that throws takes the rest of the handler chain with
       * it. Two existing Escape tests caught that before it shipped.
       */
      const el = e.target instanceof Element ? e.target : null;
      if (
        el?.closest(
          'input, textarea, [contenteditable="true"], [role="tablist"], [role="listbox"], [role="menu"], [role="radiogroup"], aside',
        )
      )
        return;
      const target = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : null;
      if (!target) return;
      e.preventDefault();
      navigate(`/v4/space/${spaceId}/lesson/${target.id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, spaceId, navigate]);

  // Nothing either side — a one-Lesson Space has no path to walk.
  if (!prev && !next) return null;

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-6 z-30 flex items-center justify-between px-2 lg:px-4',
        /*
          Written out rather than composed. Tailwind scans source text, so a
          class built from a variable is a class it never generates — the DOM
          reads correctly and no rule exists behind it, which this namespace
          has already shipped once.
        */
        companionOpen && 'sm:right-96',
      )}
      aria-label="Lesson pager"
    >
      {/* Half off-screen at rest, so each card reads as the path continuing
          past the edge rather than a button parked on the content. */}
      <div className="-ml-28 lg:-ml-24">
        {prev && <PagerCard lesson={prev} spaceId={spaceId} side="prev" />}
      </div>
      <div className="-mr-28 lg:-mr-24">
        {next && <PagerCard lesson={next} spaceId={spaceId} side="next" />}
      </div>
    </div>
  );
}
