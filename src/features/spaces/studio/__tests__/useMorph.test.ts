import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MORPH_HOLD_MS, VIEW_KEY, useMorph } from '../useMorph';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); document.body.innerHTML = ''; });

const key = (type: 'keydown' | 'keyup', k: string, target: EventTarget = window, extra: KeyboardEventInit = {}) =>
  act(() => { target.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, ...extra })); });

describe('useMorph', () => {
  it('a tap switches and stays, and is remembered', () => {
    const before = vi.fn();
    const { result } = renderHook(() => useMorph({ onBeforeChange: before }));
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(100); });
    act(() => result.current.pressEnd());
    expect(result.current.view).toBe('original');
    expect(result.current.shown).toBe('original');
    expect(before).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(VIEW_KEY)).toBe('original');
  });

  it('a hold is a quick look that springs back', () => {
    const { result } = renderHook(() => useMorph());
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    expect(result.current.shown).toBe('original');
    expect(result.current.quickLook).toBe(true);
    expect(result.current.view).toBe('clean');
    act(() => result.current.pressEnd());
    expect(result.current.shown).toBe('clean');
  });

  it('cancelling a press (pointer left) springs back without switching', () => {
    const { result } = renderHook(() => useMorph());
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    act(() => result.current.pressCancel());
    expect(result.current.shown).toBe('clean');
    act(() => result.current.pressStart());
    act(() => result.current.pressCancel());
    expect(result.current.view).toBe('clean');
  });

  it('O taps and holds like the switch, and Escape returns to clean', () => {
    const { result } = renderHook(() => useMorph());
    key('keydown', 'o');
    key('keyup', 'o');
    expect(result.current.view).toBe('original');
    key('keydown', 'Escape');
    expect(result.current.view).toBe('clean');
  });

  it('ignores O while typing, with modifiers, and on repeat', () => {
    const { result } = renderHook(() => useMorph());
    const input = document.createElement('input');
    document.body.appendChild(input);
    key('keydown', 'o', input);
    key('keyup', 'o', input);
    key('keydown', 'o', window, { metaKey: true });
    key('keyup', 'o', window, { metaKey: true });
    expect(result.current.view).toBe('clean');
  });

  it('restores the remembered view and survives blocked storage', () => {
    localStorage.setItem(VIEW_KEY, 'original');
    expect(renderHook(() => useMorph()).result.current.view).toBe('original');
    // jsdom resolves localStorage.getItem past Storage.prototype, so block the whole object.
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(blocked as unknown as Storage);
    const { result } = renderHook(() => useMorph());
    expect(result.current.view).toBe('clean');
    act(() => result.current.setView('original'));
    expect(result.current.view).toBe('original');
  });
});
