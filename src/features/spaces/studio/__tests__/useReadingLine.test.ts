import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReadingLine } from '../useReadingLine';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('useReadingLine', () => {
  it('reports the extracted block under the reading line on scroll, only when enabled', () => {
    document.body.innerHTML = '<main><div data-block-id="c-1" data-extracted="true"><p id="inner">x</p></div></main>';
    const inner = document.getElementById('inner')!;
    (document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = vi.fn(() => [inner]);
    const column = { current: document.querySelector('main') as HTMLElement };
    const onBlock = vi.fn();
    const { rerender } = renderHook(({ on }) => useReadingLine(on, column, onBlock), { initialProps: { on: false } });
    window.dispatchEvent(new Event('scroll'));
    expect(onBlock).not.toHaveBeenCalled();
    rerender({ on: true });
    window.dispatchEvent(new Event('scroll'));
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
    expect(onBlock).toHaveBeenCalledTimes(1);
    rerender({ on: false });
    window.dispatchEvent(new Event('scroll'));
    expect(onBlock).toHaveBeenCalledTimes(1);
    rerender({ on: true });
    unmount();
    window.dispatchEvent(new Event('scroll'));
    expect(onBlock).toHaveBeenCalledTimes(1);
  });
});
