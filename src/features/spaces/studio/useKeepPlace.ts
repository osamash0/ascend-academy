import { useEffect } from 'react';

/**
 * Your view never moves on its own (Living Learn spec §4.4). While `ref`
 * grows above the top of the viewport, scroll by exactly the growth, on the
 * same frame, so the words you are reading stay put. The column sets
 * `overflow-anchor: none` so the browser's own anchoring never doubles it.
 */
export function useKeepPlace(ref: React.RefObject<HTMLElement>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    let last = el.getBoundingClientRect().height;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const delta = r.height - last;
      last = r.height;
      if (delta !== 0 && r.bottom - delta <= 0) window.scrollBy(0, delta);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);
}
