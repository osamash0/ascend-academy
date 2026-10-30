import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFullscreen } from '../useFullscreen';

describe('useFullscreen', () => {
  it('asks the document for full screen, and follows the browser’s answer', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: request, configurable: true });
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.supported).toBe(true);
    act(() => result.current.toggle());
    expect(request).toHaveBeenCalled();
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    act(() => void document.dispatchEvent(new Event('fullscreenchange')));
    expect(result.current.full).toBe(true);
  });
});
