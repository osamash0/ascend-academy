import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { THEME_KEY, useStudioTheme } from '../useStudioTheme';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('useStudioTheme', () => {
  it('is light by default and remembers a toggle', () => {
    const { result } = renderHook(() => useStudioTheme());
    expect(result.current[0]).toBe('light');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useStudioTheme());
    expect(result.current[0]).toBe('light');
    act(() => result.current[1]());
    expect(result.current[0]).toBe('dark');
  });
});
