import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeepPlace } from '../useKeepPlace';

let fire: () => void = () => {};
class FakeResizeObserver {
  constructor(cb: () => void) {
    fire = cb;
  }
  observe() {}
  disconnect() {}
}

const box = (height: number, bottom: number) =>
  ({ top: bottom - height, bottom, height, left: 0, right: 0, width: 0, x: 0, y: bottom - height, toJSON() {} }) as DOMRect;

describe('useKeepPlace', () => {
  let scrollBy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    scrollBy.mockRestore();
  });

  const setup = (enabled: boolean) => {
    const el = document.createElement('div');
    const rect = vi.fn(() => box(0, -200));
    el.getBoundingClientRect = rect;
    renderHook(() => useKeepPlace({ current: el }, enabled));
    return rect;
  };

  it('scrolls by exactly the growth while the answer grows above the viewport', () => {
    const rect = setup(true);
    rect.mockReturnValue(box(120, -80)); // old bottom: -80 - 120 = -200 ≤ 0
    fire();
    expect(scrollBy).toHaveBeenCalledWith(0, 120);
  });

  it('leaves the page alone when the answer is on screen', () => {
    const rect = setup(true);
    rect.mockReturnValue(box(120, 400)); // old bottom 280: you are looking at it
    fire();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    fire = () => {};
    const rect = setup(false);
    rect.mockReturnValue(box(120, -80));
    fire();
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
