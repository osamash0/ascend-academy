import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { recordMock, beaconMock } = vi.hoisted(() => ({ recordMock: vi.fn(), beaconMock: vi.fn() }));
vi.mock('../data/liveRepository', async (orig) => ({
  ...(await orig<typeof import('../data/liveRepository')>()),
  loadLiveRepository: async () => ({ recordReading: recordMock, recordReadingBeacon: beaconMock }),
}));

import { useReadingProgress } from '../data/reading';
import { currentSession } from '../data/readingSession';

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const at = (iso: string) => vi.setSystemTime(new Date(`2026-10-27T${iso}Z`));
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('10:00:00');
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  recordMock.mockReset().mockResolvedValue({ pagesRead: 1, percentComplete: 10 });
  beaconMock.mockReset().mockReturnValue(true);
});
afterEach(() => vi.useRealTimers());

describe('useReadingProgress', () => {
  it('reports the page left with its seconds, its session and the page now in view; the open page on close', async () => {
    const { rerender, unmount } = renderHook(({ page }) => useReadingProgress('lec-1', page, true), { initialProps: { page: 1 } });
    await flush();
    const session = currentSession('lec-1');
    expect(session).toBeTruthy();
    at('10:00:40');
    rerender({ page: 2 });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 1, 40, session, 2);
    at('10:01:10');
    unmount();
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 2, 30, session, undefined);
    expect(currentSession('lec-1')).toBeNull();
  });

  it('a new open is a new session', async () => {
    const first = renderHook(() => useReadingProgress('lec-1', 1, true));
    await flush();
    const a = currentSession('lec-1');
    first.unmount();
    const second = renderHook(() => useReadingProgress('lec-1', 1, true));
    await flush();
    expect(currentSession('lec-1')).not.toBe(a);
    second.unmount();
  });

  it('time the page is covered is not counted', async () => {
    const { rerender } = renderHook(({ page, covered }) => useReadingProgress('lec-1', page, true, covered), {
      initialProps: { page: 1, covered: false },
    });
    await flush();
    at('10:00:10');
    rerender({ page: 1, covered: true });
    at('10:00:40');
    rerender({ page: 1, covered: false });
    at('10:00:50');
    rerender({ page: 2, covered: false });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 1, 20, expect.any(String), 2);
  });

  it('time the tab is hidden is not counted', async () => {
    const { rerender } = renderHook(({ page }) => useReadingProgress('lec-1', page, true), { initialProps: { page: 1 } });
    await flush();
    at('10:00:05');
    visibility = 'hidden';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    at('10:05:05');
    visibility = 'visible';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    at('10:05:15');
    rerender({ page: 2 });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 1, 15, expect.any(String), 2);
  });

  it('closing the tab reports the open page as a beacon, once', async () => {
    const { unmount } = renderHook(() => useReadingProgress('lec-1', 4, true));
    await flush();
    at('10:00:25');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(beaconMock).toHaveBeenCalledWith('lec-1', 4, 25, expect.any(String));
    unmount();
    await flush();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('demo reading is never sent anywhere', async () => {
    const { rerender, unmount } = renderHook(({ page }) => useReadingProgress('lec-1', page, false), { initialProps: { page: 1 } });
    rerender({ page: 2 });
    unmount();
    await flush();
    expect(recordMock).not.toHaveBeenCalled();
    expect(beaconMock).not.toHaveBeenCalled();
  });

  it('a failed report does not throw into the reader', async () => {
    recordMock.mockRejectedValue(new Error('offline'));
    const { rerender } = renderHook(({ page }) => useReadingProgress('lec-1', page, true), { initialProps: { page: 1 } });
    await flush();
    rerender({ page: 2 });
    await flush();
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it('back from the page cache the open page is the one that was in view, from now', async () => {
    const { rerender, unmount } = renderHook(({ page }) => useReadingProgress('lec-1', page, true), { initialProps: { page: 1 } });
    await flush();
    at('10:00:30');
    rerender({ page: 3 });
    await flush();
    recordMock.mockClear();
    at('10:00:40');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(beaconMock).toHaveBeenCalledWith('lec-1', 3, 10, expect.any(String));
    at('10:10:00');
    act(() => void window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })));
    at('10:10:20');
    unmount();
    await flush();
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith('lec-1', 3, 20, expect.any(String), undefined);
  });

  it('turning the page while it is covered counts neither page for the time under the cover', async () => {
    const { rerender } = renderHook(({ page, covered }) => useReadingProgress('lec-1', page, true, covered), {
      initialProps: { page: 1, covered: false },
    });
    await flush();
    at('10:00:10');
    rerender({ page: 1, covered: true });
    at('10:00:40');
    rerender({ page: 2, covered: true });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 1, 10, expect.any(String), 2);
    at('10:01:00');
    rerender({ page: 2, covered: false });
    at('10:01:10');
    rerender({ page: 3, covered: false });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 2, 10, expect.any(String), 3);
  });

  it('leaves no listeners behind when the reader goes', async () => {
    const adds = vi.spyOn(window, 'addEventListener');
    const removes = vi.spyOn(window, 'removeEventListener');
    const docAdds = vi.spyOn(document, 'addEventListener');
    const docRemoves = vi.spyOn(document, 'removeEventListener');
    const mine = (calls: unknown[][]) => calls.filter(([t]) => ['pagehide', 'pageshow', 'visibilitychange'].includes(String(t)));
    for (let i = 0; i < 3; i++) {
      const h = renderHook(() => useReadingProgress('lec-1', 1, true));
      await flush();
      h.unmount();
    }
    expect(mine(adds.mock.calls).length + mine(docAdds.mock.calls).length).toBe(9);
    for (const [type, fn] of [...mine(adds.mock.calls), ...mine(docAdds.mock.calls)]) {
      expect([...removes.mock.calls, ...docRemoves.mock.calls].some(([t, f]) => t === type && f === fn)).toBe(true);
    }
    vi.restoreAllMocks();
  });
});
