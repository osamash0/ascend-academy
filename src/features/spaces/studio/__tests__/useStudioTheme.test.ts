import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { THEME_KEY, useStudioTheme } from '../useStudioTheme';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('useStudioTheme', () => {
  it('is dark by default and remembers a toggle', () => {
    const { result } = renderHook(() => useStudioTheme());
    expect(result.current[0]).toBe('dark');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('a stored light theme wins on mount', () => {
    localStorage.setItem(THEME_KEY, 'light');
    expect(renderHook(() => useStudioTheme()).result.current[0]).toBe('light');
  });

  it('survives storage that throws', () => {
    // jsdom resolves localStorage past Storage.prototype, so block the whole object.
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(blocked as unknown as Storage);
    const { result } = renderHook(() => useStudioTheme());
    expect(result.current[0]).toBe('dark');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('light');
  });
});
