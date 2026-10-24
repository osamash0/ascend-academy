import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReadingLine } from '../useReadingLine';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

/** One animation frame. */
const frame = () => vi.advanceTimersByTime(20);

describe('useReadingLine', () => {
  it('reports the extracted block under the reading line on scroll, only when enabled', () => {
    document.body.innerHTML = '<main><div data-block-id="c-1" data-extracted="true"><p id="inner">x</p></div></main>';
    const inner = document.getElementById('inner')!;
    (document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = vi.fn(() => [inner]);
    const column = { current: document.querySelector('main') as HTMLElement };
    const onBlock = vi.fn();
    const { rerender } = renderHook(({ on }) => useReadingLine(on, column, onBlock), { initialProps: { on: false } });
    window.dispatchEvent(new Event('scroll'));
    frame();
    expect(onBlock).not.toHaveBeenCalled();
    rerender({ on: true });
    window.dispatchEvent(new Event('scroll'));
    frame();
    expect(onBlock).toHaveBeenCalledWith('c-1');
  });

  it('stops reporting once disabled again, and after unmount', () => {
    document.body.innerHTML = '<main><div data-block-id="c-1" data-extracted="true"><p id="inner">x</p></div></main>';
    const inner = document.getElementById('inner')!;
    (document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = vi.fn(() => [inner]);
    const column = { current: document.querySelector('main') as HTMLElement };
    const onBlock = vi.fn();
    const { rerender, unmount } = renderHook(({ on }) => useReadingLine(on, column, onBlock), { initialProps: { on: true } });
    window.dispatchEvent(new Event('scroll'));
    frame();
    expect(onBlock).toHaveBeenCalledTimes(1);
    rerender({ on: false });
    window.dispatchEvent(new Event('scroll'));
    frame();
    expect(onBlock).toHaveBeenCalledTimes(1);
    rerender({ on: true });
    unmount();
    window.dispatchEvent(new Event('scroll'));
    frame();
    expect(onBlock).toHaveBeenCalledTimes(1);
  });

  it('does one hit-test per frame however many scroll events arrive, and none after unmount', () => {
    document.body.innerHTML = '<main><div data-block-id="c-1" data-extracted="true"><p id="inner">x</p></div></main>';
    const inner = document.getElementById('inner')!;
    const spy = vi.fn(() => [inner]);
    (document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = spy;
    const column = { current: document.querySelector('main') as HTMLElement };
    const { unmount } = renderHook(() => useReadingLine(true, column, vi.fn()));
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('scroll'));
    frame();
    expect(spy).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('scroll'));
    unmount();
    frame();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
