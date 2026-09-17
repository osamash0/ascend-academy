import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Concept, MaterialPage } from '../../types';

/**
 * The Material, one page at a time.
 *
 * The second view of the *same* Lesson, not a file viewer parked beside one.
 * Every page names the Concept it covers, so the line under the pager can
 * hand you back to the passage that explains it — the reader moves between
 * the two views of an idea rather than between two unrelated things that
 * happen to share a Lesson id.
 *
 * Three decisions worth naming:
 *
 *   • **Paper against the dark ground.** The card is light while everything
 *     around it is not. The Material is a file somebody made elsewhere and it
 *     should not be able to pass for something this product wrote; the colour
 *     inversion says "this is the source" before any label does.
 *   • **The page is controlled, not owned.** This component holds no page
 *     state. The reader's other cross-view state — which view, which
 *     companion — already lives on the screen, and the tutor will need to
 *     paginate this view from the outside when it cites a page. Internal state
 *     would make that reachable only through a ref or a remount, which is a
 *     workaround for a decision rather than a design.
 *   • **The ends stop rather than wrap.** Page 12 of 12 followed by page 1 is
 *     a carousel, and a file is not a carousel — you would have no idea you
 *     had gone round. Disabled says where you are.
 */

interface Props {
  /** In file order, contiguous from 1. Never empty — the caller checks. */
  pages: MaterialPage[];
  /** This Lesson's Concepts, for naming the one a page belongs to. */
  concepts: Concept[];
  /** The page **number** showing, not an index — it is what a citation carries. */
  page: number;
  onPageChange: (page: number) => void;
  /**
   * Omitted when this Lesson has no text, and the omission is the point.
   *
   * Caught in the browser on `l-s-dbs-10`, which opens in the Material
   * precisely because nobody has written its prose: the sync line was a
   * button, it called back, `ReaderScreen` derived the view straight back to
   * `source` because there were no passages, and the press did nothing at all.
   * A control that says "go here" about a place that does not exist is the
   * dead end this view was built to remove, reintroduced one line lower.
   */
  onJumpToPassage?: (conceptId: string) => void;
}

export function SourceView({ pages, concepts, page, onPageChange, onJumpToPassage }: Props) {
  /*
   * Clamped rather than trusted. The page number arrives from a citation, a
   * pager and a Lesson change, and the first two can outlive the third — a
   * tutor chip citing page 9 of the Lesson you just left would otherwise blank
   * the card on the Lesson you are now on.
   */
  const found = pages.findIndex((p) => p.page === page);
  const i = found === -1 ? 0 : found;
  const current = pages[i];
  const concept = concepts.find((c) => c.id === current.conceptId);

  return (
    <>
      <div
        className={cn(
          'mx-auto flex min-h-[340px] w-full max-w-[760px] flex-col rounded-2xl',
          'bg-[#f4f5f9] px-7 py-8 shadow-[0_24px_60px_rgba(0,0,0,0.45)] sm:px-10 sm:py-11',
        )}
      >
        <h2 className="text-[clamp(19px,2.4vw,26px)] font-semibold leading-[1.25] text-slate-900">
          {current.title}
        </h2>
        <ul className="mt-6 list-disc space-y-3 pl-5 marker:text-slate-400">
          {current.bullets.map((b, n) => (
            <li key={n} className="text-[15px] leading-[1.6] text-slate-700">
              {b}
            </li>
          ))}
        </ul>
        {/* The number printed on the page itself, where a page number goes. */}
        <p className="mt-auto pt-10 text-[11px] text-slate-400">Page {current.page}</p>
      </div>

      <div className="mt-6 flex items-center justify-center gap-5">
        <button
          type="button"
          aria-label="Previous page"
          disabled={i === 0}
          onClick={() => onPageChange(pages[i - 1].page)}
          className="console-focusable flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.04] text-foreground transition-colors hover:bg-white/[0.08] disabled:cursor-default disabled:border-white/[0.05] disabled:text-quiet disabled:hover:bg-white/[0.04]"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
        {/*
          Tabular figures so the pager does not shuffle sideways between 9 / 12
          and 10 / 12. Proportional digits move the whole row by a pixel or two
          on every press, which reads as the control being unsure of itself.
        */}
        <span className="text-[13.5px] tabular-nums text-quiet">
          {current.page} / {pages.length}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={i === pages.length - 1}
          onClick={() => onPageChange(pages[i + 1].page)}
          className="console-focusable flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.04] text-foreground transition-colors hover:bg-white/[0.08] disabled:cursor-default disabled:border-white/[0.05] disabled:text-quiet disabled:hover:bg-white/[0.04]"
        >
          <ChevronRight aria-hidden className="h-4 w-4" />
        </button>
      </div>

      {/*
        The sync line, and the whole argument for this view being a *view*.

        Rendered at all only when the Concept resolves — naming an idea the
        Lesson does not have would be a caption about nothing. Rendered as a
        *button* only when there is a passage to land on: on a Lesson with no
        text the idea is still worth naming and there is nowhere to send you,
        so it stays a sentence. Same rule the tutor's citations will follow
        when the Material is gone.
      */}
      {concept && (
        <p className="mt-4 text-center text-[12.5px] text-faint">
          This page belongs to{' '}
          {onJumpToPassage ? (
            <button
              type="button"
              onClick={() => onJumpToPassage(concept.id)}
              className="console-focusable rounded px-1 py-0.5 font-medium text-secondary underline-offset-2 hover:underline"
            >
              {concept.name}
            </button>
          ) : (
            <span className="font-medium text-quiet">{concept.name}</span>
          )}
        </p>
      )}
    </>
  );
}
