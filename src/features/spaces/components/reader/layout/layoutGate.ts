/**
 * The browser checks of the Layout face: the parts of the demo's `gate`
 * (`layout-demo/template.html`) that need real layout. The server already
 * checked words, accents, pictures and diagrams; these only judge what was
 * drawn: type on type, type too small, strokes through type, type under a
 * window, and how much of the page's text became windows.
 *
 * The measuring functions take plain rects, so they test without layout; the
 * DOM wrapper `checkLayer` only collects rects and adds the reasons up.
 */

/** The part of a `DOMRect` the checks read. */
export interface DOMRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** A line of type, tagged with the index of the block it belongs to. */
export type Line = [number, DOMRectLike];

const overlap = (a: DOMRectLike, b: DOMRectLike): number => {
  const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return ix > 0 && iy > 0 ? ix * iy : 0;
};

const area = (r: DOMRectLike): number => r.width * r.height;

/** Pairs of lines from two different blocks drawn on top of each other (over a quarter of the smaller line). */
export function collisions(lines: Line[]): number {
  let n = 0;
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      if (lines[a][0] === lines[b][0]) continue;
      const p = lines[a][1];
      const q = lines[b][1];
      if (overlap(p, q) > 0.25 * Math.min(area(p), area(q))) n++;
    }
  }
  return n;
}

/** Blocks set smaller than 0.8% of the page width (about 9 px on a phone-width page). */
export function tinyBlocks(sizesCqw: number[]): number {
  return sizesCqw.filter((s) => s < 0.8).length;
}

/** Re-inked horizontal strokes that run through the middle of a line of type, not along its edge. */
export function struck(strokes: DOMRectLike[], lines: Line[]): number {
  let n = 0;
  for (const q of strokes.filter((r) => r.height < 4 && r.width > 6)) {
    const through = lines.some(
      ([, l]) =>
        q.top > l.top + l.height * 0.3 &&
        q.bottom < l.bottom - l.height * 0.3 &&
        Math.min(q.right, l.right) - Math.max(q.left, l.left) > 6,
    );
    if (through) n++;
  }
  return n;
}

/**
 * Rects (lines, or whole blocks) that lie on a window by more than `share` of
 * their own area. A window shows the page as it is, so one over a block's
 * place repeats that block's words.
 */
export function underWindow(windows: DOMRectLike[], rects: DOMRectLike[], share = 0.3): number {
  return rects.filter((l) => windows.some((w) => overlap(w, l) > share * area(l))).length;
}

/** How much of the page's text area is windows, from 0 to 1. */
export function cropShare(windowAreas: number[], textAreas: number[]): number {
  const text = textAreas.reduce((s, a) => s + a, 0);
  if (!text) return 0;
  return Math.min(1, windowAreas.reduce((s, a) => s + a, 0) / text);
}

const SHARE_LIMIT = 0.35;

/** Lines of type, read text node by node. A sub- or superscript reaches into the line above by design and is not a line. */
function linesOf(blocks: HTMLElement[]): Line[] {
  const out: Line[] = [];
  blocks.forEach((e, i) => {
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement?.closest('sub, sup')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) if (q.width > 2 && q.height > 2) out.push([i, q]);
    }
  });
  return out;
}

/** The browser checks on a fitted layer (`.ls-layout`). Fails when any reason is given. */
export function checkLayer(el: HTMLElement): { pass: boolean; reasons: string[] } {
  const set = [...el.querySelectorAll<HTMLElement>('.blk:not([data-group="fig"])')];
  const holes = [...el.querySelectorAll<HTMLElement>('.blk[data-group="fig"]')].map((e) => e.getBoundingClientRect());
  const lines = linesOf(set);
  const boxes = set.map((e) => e.getBoundingClientRect());

  const tiny = tinyBlocks(
    set.filter((e) => (e.textContent ?? '').trim()).map((e) => parseFloat(e.style.fontSize || '9')),
  );
  const strokes = [...el.querySelectorAll('svg.reink path')].map((e) => e.getBoundingClientRect());
  const windowAreas = [...el.querySelectorAll<HTMLElement>('.blk[data-kind="window"]')].map((e) =>
    area(e.getBoundingClientRect()),
  );
  const textAreas = [...el.querySelectorAll<HTMLElement>('.blk:not([data-kind="fig"])')].map((e) =>
    area(e.getBoundingClientRect()),
  );

  const crossed = struck(strokes, lines);
  const under = underWindow(holes, lines.map(([, l]) => l)) + underWindow(holes, boxes, 0.2);
  const collided = collisions(lines);
  const share = cropShare(windowAreas, textAreas);

  const reasons: string[] = [];
  if (crossed) reasons.push(`${crossed} strokes cross type`);
  if (under) reasons.push(`${under} lines under a window`);
  if (collided) reasons.push(`${collided} lines collide`);
  if (share > SHARE_LIMIT) reasons.push(`${Math.round(share * 100)}% of the text is windows`);
  if (tiny) reasons.push(`${tiny} blocks too small`);
  return { pass: reasons.length === 0, reasons };
}
