import { useCallback, useReducer, useState } from 'react';
import { FEATURES } from '@/lib/featureFlags';
import type { LayoutPage, LayoutReady } from './types';

/** Where the switch is remembered, per learner on this device. */
export const LAYOUT_FACE_KEY = 'ls-layout-face';

function readOn(): boolean {
  try {
    return window.localStorage.getItem(LAYOUT_FACE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOn(on: boolean): void {
  try {
    window.localStorage.setItem(LAYOUT_FACE_KEY, on ? '1' : '0');
  } catch {
    /* Storage refused: the switch holds for this visit only. */
  }
}

export interface LayoutFace {
  /** The learner's switch, remembered. */
  on: boolean;
  /** The page can be shown re-set: the flag is on, the parser re-set it, and the browser checks have not failed it. */
  available: boolean;
  /**
   * The page to mount the layer for, whether or not it failed in the browser:
   * a failed layer stays mounted out of sight, so a later check (fonts
   * arriving) can pass it again. Null when there is nothing to mount.
   */
  ready: LayoutReady | null;
  /**
   * The switch was turned on just now, on this page: the layer enters with the
   * morph. A page turn ends it, so the next page shows re-set at once; so does
   * leaving the Page face or the Lesson. A Lesson opened with the switch left
   * on never enters either.
   */
  entering: boolean;
  toggle(): void;
  /** The browser checks' verdict for a page's Layout (the object the layer was given); the latest one counts. */
  checked(layout: LayoutReady, pass: boolean): void;
}

/**
 * The Layout switch on the Page face: whether it is on, and whether this page
 * has a Layout to switch to. A page held as `original`, or one failing the
 * browser checks, has none; the reader shows the original and says nothing.
 *
 * `face`: the Page face is the one showing. Leaving it ends an entrance.
 */
export function useLayoutFace(layouts: ReadonlyMap<number, LayoutPage>, page: number, face = true): LayoutFace {
  const [on, setOn] = useState(readOn);
  /*
   * The pages that failed in the browser, by their Layout object: the layer refits and re-checks
   * exactly when the object it is given changes, so a verdict belongs to that object. Another
   * Lesson (new objects) starts clean; the same object in a new map keeps its verdict.
   */
  const [failed] = useState(() => new WeakSet<LayoutReady>());
  const [, recount] = useReducer((n: number) => n + 1, 0);

  const here = layouts.get(page);
  const ready = FEATURES.layoutFace && here?.verdict === 'layout' ? here : null;
  const available = ready !== null && !failed.has(ready);

  /*
   * The Layout the switch was turned on at. A page turn ends the entrance (even back to that page),
   * and so do leaving the Page face and another Lesson: the morph is for the switch, not a return.
   */
  const [enterAt, setEnterAt] = useState<LayoutReady | null>(null);
  if (enterAt !== null && (enterAt !== ready || !face)) setEnterAt(null);
  const entering = on && face && enterAt !== null && enterAt === ready;

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    setEnterAt(next ? ready : null);
    writeOn(next);
  }, [on, ready]);

  const checked = useCallback(
    (layout: LayoutReady, pass: boolean) => {
      if (failed.has(layout) === !pass) return;
      if (pass) failed.delete(layout);
      else failed.add(layout);
      recount();
    },
    [failed],
  );

  return { on, available, ready, entering, toggle, checked };
}
