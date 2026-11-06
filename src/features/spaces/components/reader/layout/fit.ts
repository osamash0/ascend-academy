import type { LayoutGroup } from './classify';

/**
 * Type sizes for the Layout face, ported from the demo's `fit`
 * (`layout-demo/template.html`): one size per group per page, the largest
 * that lets the group's blocks fit their own boxes. Sizes are in `cqw` (page
 * widths), so the page scales like a PDF.
 *
 * A block that cannot fit even a little under the floor is not squeezed
 * further: it is marked `data-over` and the layer re-renders it as a window
 * (the page shows through as it is). Text is never cut.
 */
export const RANGE: Record<Exclude<LayoutGroup, 'fig'>, [number, number]> = {
  h: [1.6, 3.5],
  body: [1.05, 2.3],
  small: [0.9, 1.55],
  row: [0.8, 1.45],
};

/**
 * One block's own largest fitting size in [lo * 0.8, hi]: `hi` when that fits,
 * otherwise the best of eight halvings. 0 means it cannot fit even at `lo * 0.8`.
 */
export function ownSize(fits: (size: number) => boolean, lo: number, hi: number): number {
  if (fits(hi)) return hi;
  const floor = lo * 0.8;
  if (!fits(floor)) return 0;
  let a = floor;
  let b = hi;
  for (let i = 0; i < 8; i++) {
    const m = (a + b) / 2;
    if (fits(m)) a = m;
    else b = m;
  }
  return a;
}

/**
 * The size a group shares: the 15th percentile of its blocks' real sizes
 * (those that fit, and hold real text), clamped to the range. About 85% of
 * the blocks can take it, so one cramped fragment does not shrink the page.
 */
export function sharedSize(sizes: number[], lo: number, hi: number): number {
  const real = sizes.filter((s) => s > 0).sort((a, b) => a - b);
  if (!real.length) return lo;
  return Math.max(lo, Math.min(hi, real[Math.floor(real.length * 0.15)]));
}

const GROUPS = Object.keys(RANGE) as Array<keyof typeof RANGE>;

const fitsAt = (e: HTMLElement, s: number): boolean => {
  e.style.fontSize = `${s}cqw`;
  return e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1;
};

/**
 * Fits every block of the layer (`.ls-layout`): sets its `font-size` in `cqw`.
 * A block that fits no size is left `data-over="1"`; the caller turns those
 * into windows. Needs a laid-out element: never call it at width 0.
 */
export function fitLayer(el: HTMLElement): void {
  el.querySelectorAll<HTMLElement>('.blk').forEach((e) => {
    delete e.dataset.over;
  });
  for (const g of GROUPS) {
    const [lo, hi] = RANGE[g];
    const els = [...el.querySelectorAll<HTMLElement>(`.blk[data-group="${g}"]`)];
    if (!els.length) continue;
    const sizes = els.map((e) => ownSize((s) => fitsAt(e, s), lo, hi));
    const real = sizes.filter((s, i) => s > 0 && (els[i].textContent ?? '').trim().length > 3);
    const shared = sharedSize(real, lo, hi);
    els.forEach((e, i) => {
      if (sizes[i] >= shared) e.style.fontSize = `${shared}cqw`;
      else if (sizes[i] > 0) e.style.fontSize = `${sizes[i]}cqw`;
      else e.dataset.over = '1';
    });
  }
}
