import { useEffect, useState } from 'react';

/**
 * True once nobody has touched anything for `ms`.
 *
 * Any pointer move, key, wheel, touch or focus change wakes it at once. While
 * `enabled` is false it is always awake — the reader only goes quiet on the
 * plain slide, never with a panel open or words selected.
 */
export function useIdle(enabled: boolean, ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let timer = window.setTimeout(() => setIdle(true), ms);
    const wake = () => {
      window.clearTimeout(timer);
      setIdle(false);
      timer = window.setTimeout(() => setIdle(true), ms);
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [enabled, ms]);
  return idle;
}
