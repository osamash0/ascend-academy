import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const flags = vi.hoisted(() => ({ layoutFace: true }));
vi.mock('@/lib/featureFlags', () => ({ FEATURES: flags }));

import { LAYOUT_FACE_KEY, useLayoutFace } from '../useLayoutFace';
import type { LayoutPage, LayoutReady } from '../types';

const ready = (page: number): LayoutReady => ({ page, verdict: 'layout', reasons: [], blocks: [], paths: [], version: 1 });
const layouts = (...pages: LayoutPage[]) => new Map<number, LayoutPage>(pages.map((p) => [p.page, p]));

beforeEach(() => {
  flags.layoutFace = true;
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLayoutFace: when the page can be shown re-set', () => {
  it('is available on a page the parser re-set, with the flag on', () => {
    const { result } = renderHook(() => useLayoutFace(layouts(ready(2)), 2));
    expect(result.current.available).toBe(true);
    expect(result.current.ready).toEqual(ready(2));
  });

  it('is not available with the flag off', () => {
    flags.layoutFace = false;
    const { result } = renderHook(() => useLayoutFace(layouts(ready(2)), 2));
    expect(result.current.available).toBe(false);
    expect(result.current.ready).toBeNull();
  });

  it('is not available on a page held as original, or one with no Layout', () => {
    const map = layouts(ready(2), { page: 3, verdict: 'original', reasons: ['3 of 40 words missing'], version: 1 });
    expect(renderHook(() => useLayoutFace(map, 3)).result.current.available).toBe(false);
    expect(renderHook(() => useLayoutFace(map, 3)).result.current.ready).toBeNull();
    expect(renderHook(() => useLayoutFace(map, 4)).result.current.available).toBe(false);
  });

  it('is not available on a page that failed in the browser, and the latest check wins', () => {
    const map = layouts(ready(2), ready(3));
    const { result, rerender } = renderHook(({ page }) => useLayoutFace(map, page), { initialProps: { page: 2 } });
    act(() => result.current.checked(2, false));
    expect(result.current.available).toBe(false);
    /* Still mountable: a later check (fonts arriving) may pass it again. */
    expect(result.current.ready).toEqual(ready(2));
    rerender({ page: 3 });
    expect(result.current.available).toBe(true);
    rerender({ page: 2 });
    act(() => result.current.checked(2, true));
    expect(result.current.available).toBe(true);
    act(() => result.current.checked(2, false));
    expect(result.current.available).toBe(false);
  });

  it('forgets the failures of another Lesson', () => {
    const { result, rerender } = renderHook(({ map }) => useLayoutFace(map, 2), {
      initialProps: { map: layouts(ready(2)) },
    });
    act(() => result.current.checked(2, false));
    expect(result.current.available).toBe(false);
    rerender({ map: layouts(ready(2)) });
    expect(result.current.available).toBe(true);
  });
});

describe('useLayoutFace: the morph is for switching on, not for turning pages', () => {
  it('enters on the page where the switch was turned on', () => {
    const map = layouts(ready(1), ready(2));
    const { result } = renderHook(() => useLayoutFace(map, 1));
    expect(result.current.entering).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.entering).toBe(true);
  });

  it('does not enter after a page turn, nor on coming back to that page', () => {
    const map = layouts(ready(1), ready(2));
    const { result, rerender } = renderHook(({ page }) => useLayoutFace(map, page), { initialProps: { page: 1 } });
    act(() => result.current.toggle());
    rerender({ page: 2 });
    expect(result.current.entering).toBe(false);
    rerender({ page: 1 });
    expect(result.current.entering).toBe(false);
  });

  it('does not enter when the Lesson opens with the switch left on, nor once it is off', () => {
    window.localStorage.setItem(LAYOUT_FACE_KEY, '1');
    const { result } = renderHook(() => useLayoutFace(layouts(ready(1)), 1));
    expect(result.current.on).toBe(true);
    expect(result.current.entering).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.entering).toBe(false);
  });
});

describe('useLayoutFace: the switch is remembered', () => {
  it('starts off', () => {
    const { result } = renderHook(() => useLayoutFace(layouts(ready(1)), 1));
    expect(result.current.on).toBe(false);
  });

  it('toggles, and keeps the choice in localStorage', () => {
    const map = layouts(ready(1));
    const { result } = renderHook(() => useLayoutFace(map, 1));
    act(() => result.current.toggle());
    expect(result.current.on).toBe(true);
    expect(window.localStorage.getItem(LAYOUT_FACE_KEY)).toBe('1');
    expect(renderHook(() => useLayoutFace(map, 1)).result.current.on).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.on).toBe(false);
    expect(window.localStorage.getItem(LAYOUT_FACE_KEY)).toBe('0');
  });

  it('still toggles when storage refuses, for this visit only', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(() => useLayoutFace(layouts(ready(1)), 1));
    expect(result.current.on).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.on).toBe(true);
  });
});
