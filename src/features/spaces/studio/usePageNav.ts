import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { pickAnchorPage } from './geometry';
import { inDialog, isTyping } from './keys';
import { READING_LINE } from './useReadingLine';
import type { CanvasView } from './useMorph';

/** After a turn, scroll events are the turn's own; they settle this long after the last one. */
export const SETTLE_MS = 150;

export interface PageNav {
  /** The page you are on — always one of `pages`, or null when there are none. */
  current: number | null;
  /** 0-based position of `current` in `pages`. */
  index: number;
  /** What the counter says: never 0 — notes above page 1 count as the page after them. */
  counter: number | null;
  /** The last numbered page. */
  last: number | null;
  go(page: number): void;
  step(delta: -1 | 1): void;
}

function sectionFor(view: CanvasView, page: number): HTMLElement | null {
  return document.querySelector(`[data-view="${view}"][data-page-anchor="${page}"]`);
}

/** `page` if it is real here, else the next real one after it, else the last. */
function nearest(pages: number[], page: number | null): number | null {
  if (pages.length === 0) return null;
  if (page === null) return pages[0];
  if (pages.includes(page)) return page;
  return pages.find((p) => p > page) ?? pages[pages.length - 1];
}

/**
 * Where you are, page by page, and the turn — the rail, the pager and ← →.
 *
 * `pages` are the pages that have a section in the view on screen, in
 * order: notes above page 1 have no original, so in Original they are not
 * a stop. Every turn lands on one of them.
 *
 * The page you are on is the one that fills most of the screen (the same
 * rule Morph anchors to), checked once per frame while you scroll. A turn
 * sets it at once and scrolls there; the scroll that follows is the turn's
 * own and is ignored until it settles, so a short page you turned to stays
 * "current" even when its taller neighbour fills more of the screen. When it
 * settles, one check runs — unless the page you turned to still sits at the
 * top, a scroll of your own during the turn is picked up.
 */
export function usePageNav(pages: number[], view: CanvasView): PageNav {
  const [picked, setPicked] = useState<number | null>(null);
  const current = nearest(pages, picked);
  const reduce = useReducedMotion();
  const turning = useRef<{ page: number; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const settleRef = useRef<(delay: number) => void>(() => {});

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const rects = Array.from(document.querySelectorAll(`[data-view="${view}"][data-page-anchor]`)).map((el) => {
        const r = el.getBoundingClientRect();
        return { page: Number((el as HTMLElement).dataset.pageAnchor), top: r.top, bottom: r.bottom };
      });
      const p = pickAnchorPage(rects, window.innerHeight);
      if (p !== null) setPicked(p);
    };
    const settled = () => {
      const t = turning.current;
      turning.current = null;
      if (!t) return;
      const r = sectionFor(view, t.page)?.getBoundingClientRect();
      const stillThere = !!r && r.bottom > 0 && r.top < window.innerHeight * READING_LINE;
      if (!stillThere) check();
    };
    settleRef.current = (delay) => {
      const t = turning.current;
      if (!t) return;
      clearTimeout(t.timer);
      t.timer = setTimeout(settled, delay);
    };
    const onScroll = () => {
      if (turning.current) {
        settleRef.current(SETTLE_MS);
        return;
      }
      if (!frame) frame = requestAnimationFrame(check);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      if (turning.current) clearTimeout(turning.current.timer);
      turning.current = null;
    };
  }, [view]);

  const go = useCallback(
    (page: number) => {
      const target = nearest(pages, page);
      if (target === null) return;
      setPicked(target);
      if (turning.current) clearTimeout(turning.current.timer);
      turning.current = { page: target };
      settleRef.current(4 * SETTLE_MS);
      sectionFor(view, target)?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    },
    [pages, view, reduce],
  );

  const index = current === null ? -1 : pages.indexOf(current);
  const step = useCallback(
    (delta: -1 | 1) => {
      const next = pages[index + delta];
      if (next !== undefined) go(next);
    },
    [pages, index, go],
  );

  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTyping(e.target) || inDialog(e.target)) return;
      e.preventDefault();
      stepRef.current(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const numbered = pages.filter((p) => p > 0);
  const counter = current === null ? null : current > 0 ? current : (numbered[0] ?? null);
  const last = numbered.length ? numbered[numbered.length - 1] : null;
  return { current, index, counter, last, go, step };
}
