import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The Clean | Original switch — spec §4.2. One control, two gestures:
 *   tap (< 250ms)  → switch and stay
 *   hold (≥ 250ms) → quick look; springs back on release
 * The `O` key behaves exactly like the switch. `Escape` returns to clean.
 */

export type CanvasView = 'clean' | 'original';
export const MORPH_HOLD_MS = 250;
export const VIEW_KEY = 'learnstation:studio-view';

export interface MorphApi {
  view: CanvasView;
  shown: CanvasView;
  quickLook: boolean;
  setView(v: CanvasView): void;
  pressStart(): void;
  pressEnd(): void;
  pressCancel(): void;
}

const other = (v: CanvasView): CanvasView => (v === 'clean' ? 'original' : 'clean');

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function useMorph(opts: { onBeforeChange?: () => void } = {}): MorphApi {
  const before = useRef(opts.onBeforeChange);
  before.current = opts.onBeforeChange;

  const [view, setViewState] = useState<CanvasView>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'original' ? 'original' : 'clean';
    } catch {
      return 'clean';
    }
  });
  const [quickLook, setQuickLook] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const hold = useRef<ReturnType<typeof setTimeout>>();
  const pressing = useRef(false);
  const held = useRef(false);

  const setView = useCallback((v: CanvasView) => {
    if (v === viewRef.current) return;
    before.current?.();
    viewRef.current = v;
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered — still switched */
    }
  }, []);

  const pressStart = useCallback(() => {
    if (pressing.current) return;
    pressing.current = true;
    held.current = false;
    clearTimeout(hold.current);
    hold.current = setTimeout(() => {
      held.current = true;
      before.current?.();
      setQuickLook(true);
    }, MORPH_HOLD_MS);
  }, []);

  const pressEnd = useCallback(() => {
    if (!pressing.current) return;
    pressing.current = false;
    clearTimeout(hold.current);
    if (held.current) {
      held.current = false;
      before.current?.();
      setQuickLook(false);
    } else {
      setView(other(viewRef.current));
    }
  }, [setView]);

  const pressCancel = useCallback(() => {
    if (!pressing.current) return;
    pressing.current = false;
    clearTimeout(hold.current);
    if (held.current) {
      held.current = false;
      before.current?.();
      setQuickLook(false);
    }
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewRef.current === 'original' && !pressing.current) {
        setView('clean');
        return;
      }
      if ((e.key === 'o' || e.key === 'O') && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        pressStart();
      }
    };
    const up = (e: KeyboardEvent) => {
      // Any O release ends an active press, wherever focus has moved since keydown.
      if (e.key === 'o' || e.key === 'O') pressEnd();
    };
    const cancel = () => pressCancel();
    const hide = () => {
      if (document.hidden) pressCancel();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', hide);
      clearTimeout(hold.current);
    };
  }, [pressStart, pressEnd, pressCancel, setView]);

  const shown = quickLook ? other(view) : view;
  return useMemo(
    () => ({ view, shown, quickLook, setView, pressStart, pressEnd, pressCancel }),
    [view, shown, quickLook, setView, pressStart, pressEnd, pressCancel],
  );
}
