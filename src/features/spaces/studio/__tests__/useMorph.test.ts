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

  it('ignores O keydown with repeat', () => {
    const { result } = renderHook(() => useMorph());
    key('keydown', 'o', window, { repeat: true });
    key('keyup', 'o');
    expect(result.current.view).toBe('clean');
  });

  it('a keyup of O on a focused input still ends the press', () => {
    const { result } = renderHook(() => useMorph());
    const input = document.createElement('input');
    document.body.appendChild(input);
    key('keydown', 'o');
    key('keyup', 'o', input);
    expect(result.current.view).toBe('original');
    key('keydown', 'o');
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    expect(result.current.shown).toBe('clean');
    key('keyup', 'o', input);
    expect(result.current.shown).toBe('original');
    expect(result.current.quickLook).toBe(false);
  });

  it('holding O is a quick look that springs back', () => {
    const { result } = renderHook(() => useMorph());
    key('keydown', 'o');
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    expect(result.current.shown).toBe('original');
    key('keyup', 'o');
    expect(result.current.shown).toBe('clean');
    expect(result.current.view).toBe('clean');
  });

  it('window blur during a hold springs back and frees the press', () => {
    const { result } = renderHook(() => useMorph());
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(result.current.shown).toBe('clean');
    act(() => result.current.pressStart());
    act(() => result.current.pressEnd());
    expect(result.current.view).toBe('original');
  });

  it('a hidden tab cancels a hold', () => {
    const { result } = renderHook(() => useMorph());
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current.quickLook).toBe(false);
  });

  it('counts onBeforeChange per change of what is shown', () => {
    const before = vi.fn();
    const { result } = renderHook(() => useMorph({ onBeforeChange: before }));
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    expect(before).toHaveBeenCalledTimes(1);
    act(() => result.current.pressEnd());
    expect(before).toHaveBeenCalledTimes(2);
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    act(() => result.current.pressCancel());
    expect(before).toHaveBeenCalledTimes(4);
  });

  it('cancelling before the hold fires changes nothing', () => {
    const before = vi.fn();
    const { result } = renderHook(() => useMorph({ onBeforeChange: before }));
    act(() => result.current.pressStart());
    act(() => result.current.pressCancel());
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS * 2); });
    expect(before).not.toHaveBeenCalled();
    expect(result.current.quickLook).toBe(false);
  });

  it('Escape during a press or quick look leaves the committed view alone', () => {
    const { result } = renderHook(() => useMorph());
    act(() => result.current.setView('original'));
    act(() => result.current.pressStart());
    act(() => { vi.advanceTimersByTime(MORPH_HOLD_MS); });
    key('keydown', 'Escape');
    expect(result.current.view).toBe('original');
  });
});
