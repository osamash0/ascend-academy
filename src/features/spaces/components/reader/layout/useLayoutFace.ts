import { useCallback, useState } from 'react';
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

const NONE: ReadonlyMap<number, boolean> = new Map();

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
  toggle(): void;
  /** The browser checks' verdict for a page; the latest one counts. */
  checked(page: number, pass: boolean): void;
  markFailed(page: number): void;
}

/**
 * The Layout switch on the Page face: whether it is on, and whether this page
 * has a Layout to switch to. A page held as `original`, or one failing the
 * browser checks, has none; the reader shows the original and says nothing.
 */
export function useLayoutFace(layouts: ReadonlyMap<number, LayoutPage>, page: number): LayoutFace {
  const [on, setOn] = useState(readOn);
  /* Failures belong to one Lesson's Layouts: a new map starts clean. */
  const [failed, setFailed] = useState<{ of: ReadonlyMap<number, LayoutPage>; pages: ReadonlyMap<number, boolean> }>(
    () => ({ of: layouts, pages: NONE }),
  );
  const pages = failed.of === layouts ? failed.pages : NONE;

  const here = layouts.get(page);
  const ready = FEATURES.layoutFace && here?.verdict === 'layout' ? here : null;
  const available = ready !== null && pages.get(page) !== true;

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    writeOn(next);
  }, [on]);

  const checked = useCallback(
    (p: number, pass: boolean) =>
      setFailed((prev) => {
        const base = prev.of === layouts ? prev.pages : NONE;
        if (prev.of === layouts && (base.get(p) === true) === !pass) return prev;
        return { of: layouts, pages: new Map(base).set(p, !pass) };
      }),
    [layouts],
  );
  const markFailed = useCallback((p: number) => checked(p, false), [checked]);

  return { on, available, ready, toggle, checked, markFailed };
}
