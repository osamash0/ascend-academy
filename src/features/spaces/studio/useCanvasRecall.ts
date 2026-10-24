import { useEffect, useMemo, useRef } from 'react';
import { shelfActions } from '../data/useShelf';
import { shownAt, type Depth } from './depth';
import type { PageGroup } from './geometry';
import { pageProgress, stateOf, termKey, termsIn } from './recall';
import type { CanvasDoc, SourcePage } from './types';
import { useRecall } from './useRecall';

interface Options {
  materialId: string | undefined;
  /** The shelf item this canvas belongs to, while it opens as a canvas: its card shows "Recall k/n". */
  itemId: string | undefined;
  opensCanvas: boolean;
  doc: CanvasDoc | null;
  groups: PageGroup[];
  /** The pages the rail lists. */
  railGroups: PageGroup[];
  pages: SourcePage[];
  levels: Record<number, Depth>;
  /** Source is shown: Recall rests. */
  original: boolean;
  reduceMotion: boolean;
  onDepth(page: number, d: Depth, all: boolean): void;
}

/** The block a term key belongs to: `blockId:n`. */
const blockOf = (key: string) => key.slice(0, key.lastIndexOf(':'));

/** The blank of one term in Learn, found by its key (never by its label). */
function blankFor(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-view="clean"] button[data-term-key="${CSS.escape(key)}"]`);
}

/**
 * Recall on the canvas (Learn, deeper §2): key terms become blanks, in Learn
 * only, kept per Material.
 *
 * Two counts, on purpose. The rings (each page and the rail) count what each
 * page shows at its depth (§3.5): at Full or Page there are no terms. The
 * count of the Material ("Recall k/n" on its shelf card, the terms to try
 * again) is about the material, not the view, so it counts every summary term; Try
 * again opens a page back to Summary when the term it lands on is not shown.
 */
export function useCanvasRecall({
  materialId, itemId, opensCanvas, doc, groups, railGroups, pages, levels, original, reduceMotion, onDepth,
}: Options) {
  const recall = useRecall(materialId ?? '', !original);
  const on = recall.state.on && !original;

  /** Every summary term on the canvas, in reading order: the one list the counts and Try again share. */
  const summaryKeys = useMemo(
    () =>
      (doc?.blocks ?? []).flatMap((b) => (b.origin === 'summary' ? termsIn(b.markdown).map((_, i) => termKey(b.id, i)) : [])),
    [doc],
  );
  const knew = summaryKeys.filter((k) => stateOf(recall.state, k) === 'knew').length;
  const total = summaryKeys.length;
  const notYet = summaryKeys.filter((k) => stateOf(recall.state, k) === 'notYet');
  const anyMarked = summaryKeys.some((k) => stateOf(recall.state, k) !== 'blank');

  const canvasRecall = useMemo(
    () => (on ? { state: recall.state, onReveal: recall.reveal, onMark: recall.markTerm } : null),
    [on, recall.state, recall.reveal, recall.markTerm],
  );
  const railProgress = useMemo(
    // Only what each page shows at its depth counts (§3.5).
    () =>
      on
        ? new Map(railGroups.map((g) => [g.page, pageProgress(shownAt(g, levels[g.page] ?? 'summary', pages), recall.state)]))
        : null,
    [on, railGroups, recall.state, levels, pages],
  );

  /*
   * Recall flows back to the shelf, so "Recall k/n" on the cover is real. A page
   * where nothing was ever marked leaves the count on the shelf as it was.
   */
  const fedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!itemId || !opensCanvas || total === 0) return;
    if (fedFor.current !== itemId && !anyMarked) return;
    fedFor.current = itemId;
    shelfActions.setRecall(itemId, knew, total);
  }, [itemId, opensCanvas, knew, total, anyMarked]);

  const toggleRef = useRef<HTMLButtonElement>(null);
  /** The term Try again lands on, once it is a blank again. */
  const focusTerm = useRef<string | null>(null);
  const startOver = useRef(false);
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;
  useEffect(() => {
    if (startOver.current) {
      startOver.current = false;
      toggleRef.current?.focus();
    }
    const key = focusTerm.current;
    if (!key) return;
    focusTerm.current = null;
    const el = blankFor(key);
    if (!el) return;
    // Instant under reduced motion: the root of the app scrolls smoothly, so auto would glide.
    el.scrollIntoView?.({ block: 'center', behavior: reduceRef.current ? 'instant' : 'smooth' });
    el.focus({ preventScroll: true });
  }, [recall.state]);

  const onTryAgain = () => {
    const first = notYet[0] ?? null;
    if (first) {
      const id = blockOf(first);
      const g = groups.find((x) => x.blocks.some((b) => b.id === id));
      // Its page reads at a depth that hides it (Gist, Full, Page): open it back to Summary first.
      if (g && !shownAt(g, levels[g.page] ?? 'summary', pages).some((b) => b.id === id)) onDepth(g.page, 'summary', false);
    }
    focusTerm.current = first;
    recall.retry();
  };
  const onStartOver = () => {
    startOver.current = true;
    recall.reset();
  };

  return {
    /** Recall as stored: on/off (the toggle shows it even while Source rests it), marks, toggle. */
    stored: recall,
    /** Recall is showing: on, and in Learn. */
    on,
    canvasRecall,
    railProgress,
    total,
    notYet: notYet.length,
    anyMarked,
    toggleRef,
    onTryAgain,
    onStartOver,
  };
}
