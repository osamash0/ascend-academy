import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { pickAnchorPage } from './geometry';
import { inDialog, isTyping } from './keys';
import type { CanvasView } from './useMorph';

/** After a turn, scroll events are the turn's own; they settle this long after the last one. */
const SETTLE_MS = 150;

export interface PageNav {
  /** The page you are on (or null when the canvas has no pages). */
  current: number | null;
  /** 0-based position of `current` in `pages`. */
  index: number;
  go(page: number): void;
  step(delta: -1 | 1): void;
}

/** The page's section in the view on screen; notes above page 1 have only a clean one. */
function sectionFor(view: CanvasView, page: number): HTMLElement | null {
  const any = `[data-page-anchor="${page}"]`;
  return (document.querySelector(`[data-view="${view}"]${any}`) ?? document.querySelector(any)) as HTMLElement | null;
}

/**
 * Where you are, page by page, and the turn — the rail, the pager and ← →.
 *
 * The page you are on is the one that fills most of the screen (the same
 * rule Morph anchors to), checked once per frame while you scroll. A turn
 * sets it at once and scrolls there; the scroll that follows is ignored
 * until it settles, so a short page you turned to stays "current" even when
 * its taller neighbour ends up filling more of the screen.
 */
export function usePageNav(pages: number[], view: CanvasView): PageNav {
  const [picked, setPicked] = useState<number | null>(null);
  const current = picked !== null && pages.includes(picked) ? picked : (pages[0] ?? null);
  const reduce = useReducedMotion();
  const quietUntil = useRef(0);

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const rects = Array.from(document.querySelectorAll<HTMLElement>(`[data-view="${view}"][data-page-anchor]`)).map(
        (el) => {
          const r = el.getBoundingClientRect();
          return { page: Number(el.dataset.pageAnchor), top: r.top, bottom: r.bottom };
        },
      );
      const p = pickAnchorPage(rects, window.innerHeight);
      if (p !== null) setPicked(p);
    };
    const onScroll = () => {
      const now = performance.now();
      if (now < quietUntil.current) {
        quietUntil.current = now + SETTLE_MS;
        return;
      }
      if (!frame) frame = requestAnimationFrame(check);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [view]);

  const go = useCallback(
    (page: number) => {
      setPicked(page);
      quietUntil.current = performance.now() + 4 * SETTLE_MS;
      sectionFor(view, page)?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    },
    [view, reduce],
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

  return { current, index, go, step };
}
