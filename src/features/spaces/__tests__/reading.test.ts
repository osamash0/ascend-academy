import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { recordMock } = vi.hoisted(() => ({ recordMock: vi.fn() }));
vi.mock('../data/liveRepository', async (orig) => ({
  ...(await orig<typeof import('../data/liveRepository')>()),
  loadLiveRepository: async () => ({ recordReading: recordMock }),
}));

import { useReadingProgress } from '../data/reading';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));
  recordMock.mockReset().mockResolvedValue({ pagesRead: 1, percentComplete: 10 });
});
afterEach(() => vi.useRealTimers());

describe('useReadingProgress', () => {
  it('reports the page left, with how long it was open, and the open page on close', async () => {
    const { rerender, unmount } = renderHook(({ page }) => useReadingProgress('lec-1', page, true), {
      initialProps: { page: 1 },
    });
    vi.setSystemTime(new Date('2026-10-11T10:00:40Z'));
    rerender({ page: 2 });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 1, 40);

    vi.setSystemTime(new Date('2026-10-11T10:01:10Z'));
    unmount();
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 2, 30);
    expect(recordMock).toHaveBeenCalledTimes(2);
  });

  it('demo reading is never sent anywhere', async () => {
    const { rerender, unmount } = renderHook(({ page }) => useReadingProgress('lec-1', page, false), {
      initialProps: { page: 1 },
    });
    rerender({ page: 2 });
    unmount();
    await flush();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('a failed report does not throw into the reader', async () => {
    recordMock.mockRejectedValue(new Error('offline'));
    const { rerender } = renderHook(({ page }) => useReadingProgress('lec-1', page, true), {
      initialProps: { page: 1 },
    });
    rerender({ page: 2 });
    await flush();
    expect(recordMock).toHaveBeenCalledTimes(1);
  });
});
