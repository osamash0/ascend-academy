/**
 * The handover still: your file stays on screen while the Lesson takes over.
 *
 * When the early reader hands over to the Lesson, the route changes and the
 * Lesson has to load before it can paint. Without this there is a black frame
 * in between. Instead, the pages you were looking at are copied (canvas to
 * canvas, at their place on screen) into a layer above the whole app, outside
 * React, so no route change or Suspense fallback can take it down. The Lesson
 * lifts it once it has painted the page you were on; it fades, and the two
 * read as one reader. It never takes a click, and it never outstays `HOLD_MS`.
 */

/** The longest the still stands in, whatever happens underneath. */
export const HOLD_MS = 8000;
/** The cross-fade to the Lesson. */
const FADE_MS = 220;

let veil: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Is the still up? */
export const curtainUp = (): boolean => veil !== null;

/** Hold the pages painted inside `from` on screen until `liftCurtain`. */
export function holdCurtain(from: Element | null | undefined): void {
  if (typeof document === 'undefined' || !from) return;
  dropNow();
  const el = document.createElement('div');
  el.dataset.readerCurtain = '';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '60',
    background: '#000',
    pointerEvents: 'none',
    transition: `opacity ${FADE_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
  });
  const vh = window.innerHeight;
  for (const c of from.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > vh) continue;
    const copy = document.createElement('canvas');
    copy.width = c.width;
    copy.height = c.height;
    try {
      copy.getContext('2d')?.drawImage(c, 0, 0);
    } catch {
      continue; // nothing to copy: black is still better than a flash
    }
    /* As it was seen: cut to the box it scrolls in, with its page's corners. */
    const box = clipOf(c, from);
    const clip = document.createElement('div');
    Object.assign(clip.style, {
      position: 'absolute',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      overflow: 'hidden',
    });
    Object.assign(copy.style, {
      position: 'absolute',
      left: `${r.left - box.left}px`,
      top: `${r.top - box.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      borderRadius: getComputedStyle(c.closest('[data-pdf-page]') ?? c).borderRadius,
    });
    clip.appendChild(copy);
    el.appendChild(clip);
  }
  document.body.appendChild(el);
  veil = el;
  timer = setTimeout(liftCurtain, HOLD_MS);
}

/** What of `c` was on screen: the window, cut by every box between it and `from` that cuts what it shows. */
function clipOf(c: Element, from: Element): { left: number; top: number; width: number; height: number } {
  let l = 0;
  let t = 0;
  let r = window.innerWidth;
  let b = window.innerHeight;
  for (let p = c.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (o.overflowY !== 'visible' || o.overflowX !== 'visible') {
      const box = p.getBoundingClientRect();
      l = Math.max(l, box.left);
      t = Math.max(t, box.top);
      r = Math.min(r, box.right);
      b = Math.min(b, box.bottom);
    }
    if (p === from) break;
  }
  return { left: l, top: t, width: Math.max(0, r - l), height: Math.max(0, b - t) };
}

/** The Lesson has painted (or will not): fade the still out. */
export function liftCurtain(): void {
  const el = veil;
  if (!el) return;
  veil = null;
  if (timer) clearTimeout(timer);
  timer = null;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), FADE_MS);
}

function dropNow(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  veil?.remove();
  veil = null;
}

/** Tests: take it down at once. */
export const __dropCurtain = dropNow;
