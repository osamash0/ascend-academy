import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { NotebookPen, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Concept } from '../../types';

/**
 * The one piece of chrome the reader keeps.
 *
 * The reader used to carry its exit and its breadcrumb *inside* the article,
 * so both scrolled away with the first screenful. That is fine on a page you
 * skim and wrong on a page you sit inside for ten minutes: the way out of a
 * focus surface has to be where you left it. So the row came out of the
 * column and became a fixed bar, and everything the reader can summon —
 * the second view of the same Lesson, and the two companions — hangs off it
 * rather than floating over the prose.
 *
 * Three decisions worth naming:
 *
 *   • **The dots are a readout, not a control.** One dot per Concept, styled
 *     by the `progress` the engine already set. There is no click handler and
 *     there never will be: a dot you could press would be a way to mark an
 *     idea cleared, which is precisely the progression rule the reader
 *     refuses to invent (Doc 1 locks progression to XP the engine awards).
 *     Cleared or not cleared — never a percentage, because a percentage is a
 *     score and reading is not scored.
 *   • **The scroll bar is not progress.** Two pixels of gradient tracking how
 *     far down the document you are. It is `aria-hidden` and carries no label,
 *     because the moment it is called "progress" it is claiming that reading
 *     advanced something. It did not. It is a scrollbar with better manners.
 *   • **The toggle only exists when there is somewhere to go.** A segmented
 *     control with one working half is worse than no control, so `showToggle`
 *     is the caller's answer to "does this Lesson have both a text and a
 *     Material to read it against".
 *
 * Nothing here is Owner-only. Role never changes the reader — an Owner sees
 * exactly the bar a Member sees, and editing lives in Studio.
 */

export type ReaderView = 'read' | 'source';
export type RailTab = 'tutor' | 'notes';

interface Props {
  spaceName: string;
  lessonOrder: number;
  /** Where the exit goes — the Lesson this reader was opened from. */
  backTo: string;
  concepts: Concept[];
  view: ReaderView;
  onViewChange?: (v: ReaderView) => void;
  /** False while the Lesson has only one of the two views. */
  showToggle: boolean;
  railOpen: boolean;
  railTab: RailTab | null;
  onRailToggle: (tab: RailTab) => void;
}

/** Sentence case, one word each — the segment is a place, not an instruction. */
const VIEW_LABEL: Record<ReaderView, string> = {
  read: 'Read',
  source: 'Source',
};

const RAIL: { tab: RailTab; label: string; icon: typeof Sparkles }[] = [
  { tab: 'tutor', label: 'Tutor', icon: Sparkles },
  { tab: 'notes', label: 'Notes', icon: NotebookPen },
];

/**
 * How far down the page you are, and nothing else.
 *
 * Event-driven, not animated: there is nothing to ease, the bar simply *is*
 * the position. `scaleX` on a fixed-width strip so the only property that
 * changes is a transform — a `width` transition would re-lay-out a line of
 * the page on every scroll event.
 */
function ScrollProgress() {
  const [ratio, setRatio] = useState(0);

  useEffect(() => {
    const read = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setRatio(scrollable > 0 ? Math.min(1, Math.max(0, doc.scrollTop / scrollable)) : 0);
    };
    read();
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    /*
     * The third way the ratio can change, and the one `scroll` and `resize`
     * both miss: the *content* changing height under a viewport that did not
     * move. Flipping to the Material swaps the whole body of the reader for
     * something of a different length.
     *
     * Shrinking happens to self-correct — the browser clamps `scrollTop` to
     * the new height and that clamp fires `scroll`. Growing does not: read to
     * the bottom of a short view, switch to a long one, and the bar stays
     * full while you are a third of the way down. So the document element is
     * observed, and every height change is a reading whichever way it went.
     */
    const observer = new ResizeObserver(read);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
      observer.disconnect();
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px]">
      <div
        className="h-full origin-left bg-gradient-to-r from-primary to-secondary"
        style={{ transform: `scaleX(${ratio})` }}
      />
    </div>
  );
}

export function ReaderHeader({
  spaceName,
  lessonOrder,
  backTo,
  concepts,
  view,
  onViewChange,
  showToggle,
  railOpen,
  railTab,
  onRailToggle,
}: Props) {
  const cleared = concepts.filter((c) => c.progress === 'cleared').length;

  return (
    <>
      <ScrollProgress />
      <header className="fixed inset-x-0 top-0 z-40 h-14 border-b border-white/[0.07] bg-[#070b14]/85 backdrop-blur-md">
        {/*
          Two flexible side columns with the segment between them, rather than
          one absolutely-centred segment. The middle column is there only for
          the Lessons that have both a text and a Material; most have one, and
          the row is genuinely two columns then.

          Absolute centring puts the toggle on the viewport's midpoint, which
          is prettier at 1440px and overlaps a long Space name at 375px — and
          the overlap is invisible until somebody opens the one Space whose
          name is long. Equal side columns keep the segment near the middle and
          make collision impossible: the breadcrumb truncates instead. That the
          middle column comes and goes is also why the sides are `flex-1`
          rather than a fixed width — they close the gap themselves.
        */}
        <div className="mx-auto flex h-full items-center gap-3 px-4">

          {/* Where you are, and the way out — first in the tab order. */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link
              to={backTo}
              aria-label="Leave the reader"
              className="console-focusable flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <X aria-hidden className="h-4 w-4" />
            </Link>
            <p className="min-w-0 truncate text-[13px] text-quiet">
              {spaceName} · Lesson {lessonOrder}
            </p>
          </div>

          {showToggle && (
            <div
              role="tablist"
              aria-label="Reader view"
              className="flex shrink-0 items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5"
            >
              {(['read', 'source'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => onViewChange?.(v)}
                  className={cn(
                    'console-focusable h-8 rounded-full px-4 text-[13px] font-medium transition-colors',
                    view === v
                      ? 'bg-white/[0.10] text-foreground'
                      : 'text-quiet hover:text-foreground',
                  )}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-1 shrink-0 items-center justify-end gap-3">
            {/*
              A readout of what the engine already cleared. The group carries
              the sentence; the dots themselves are shape, and a screen reader
              that announced five of them would be reading punctuation.
            */}
            {concepts.length > 0 && (
              <div
                role="img"
                aria-label={`${cleared} of ${concepts.length} ideas cleared`}
                className="flex items-center gap-1.5"
              >
                {concepts.map((c) => (
                  <span
                    key={c.id}
                    aria-hidden
                    data-concept-dot
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      c.progress === 'cleared' ? 'bg-success' : 'bg-white/[0.18]',
                    )}
                  />
                ))}
              </div>
            )}

            {RAIL.map(({ tab, label, icon: Icon }) => {
              const pressed = railOpen && railTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  aria-label={label}
                  aria-pressed={pressed}
                  onClick={() => onRailToggle(tab)}
                  className={cn(
                    'console-focusable flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                    pressed
                      ? 'bg-white/[0.10] text-foreground'
                      : 'text-quiet hover:bg-white/[0.06] hover:text-foreground',
                  )}
                >
                  <Icon aria-hidden className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>
      </header>
    </>
  );
}
