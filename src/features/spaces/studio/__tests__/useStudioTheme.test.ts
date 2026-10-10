import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { THEME_KEY, useStudioTheme } from '../useStudioTheme';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('useStudioTheme', () => {
  it('is light by default and remembers a toggle', () => {
    const { result } = renderHook(() => useStudioTheme());
    expect(result.current[0]).toBe('light');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('reads a stored dark theme on mount', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    expect(renderHook(() => useStudioTheme()).result.current[0]).toBe('dark');
  });

  it('survives storage that throws', () => {
    // jsdom resolves localStorage past Storage.prototype, so block the whole object.
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(blocked as unknown as Storage);
    const { result } = renderHook(() => useStudioTheme());
    expect(result.current[0]).toBe('light');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('dark');
  });
});
