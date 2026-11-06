import { MOTION_EASE } from '../../MotionRoot';

/**
 * The Layout face's entrance: the layer fades in, and each block rises a few
 * pixels into place, one after another in reading order. Composite only
 * (opacity and transform), no blur.
 *
 * It runs on the Web Animations API and only after the layer has passed its
 * checks: the checks measure the blocks, and a block halfway through its rise
 * is not where it will rest. A later check (fonts arriving) first `settle`s
 * the morph, so it always measures the layer at rest.
 *
 * Reduced motion is the caller's to honour: it simply never calls `morphIn`.
 */
export const MORPH = { fade: 240, rise: 4, stagger: 12, cap: 180 } as const;

const EASE = `cubic-bezier(${MOTION_EASE.join(', ')})`;

/** A block's delay in ms, by its place in reading order. */
export const delayOf = (i: number): number => Math.min(i * MORPH.stagger, MORPH.cap);

const running = new WeakMap<HTMLElement, Animation[]>();

/** Starts the morph on a layer (`.ls-layout`). The blocks are its `.blk` children, in reading order. */
export function morphIn(el: HTMLElement): void {
  if (typeof el.animate !== 'function') return;
  settle(el);
  const timing = { duration: MORPH.fade, easing: EASE, fill: 'backwards' as const };
  const out = [el.animate([{ opacity: 0 }, { opacity: 1 }], timing)];
  el.querySelectorAll<HTMLElement>('.blk').forEach((b, i) => {
    out.push(
      b.animate([{ transform: `translateY(${MORPH.rise}px)` }, { transform: 'none' }], { ...timing, delay: delayOf(i) }),
    );
  });
  running.set(el, out);
}

/** Ends a running morph on the spot: everything at rest. */
export function settle(el: HTMLElement): void {
  const list = running.get(el);
  if (!list) return;
  running.delete(el);
  for (const a of list) if (a.playState !== 'finished') a.finish();
}
