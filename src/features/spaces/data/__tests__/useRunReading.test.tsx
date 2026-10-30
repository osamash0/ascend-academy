import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const readingFor = vi.fn();
vi.mock('../liveRepository', () => ({ loadLiveRepository: async () => ({ readingFor }) }));

import { followOf, useRunReading, useRunStatus } from '../useRunReading';

const reading = (over = {}) => ({
  pdfUrl: 'https://signed', pages: 10, pagesRead: 0, pagesReady: [], practiceReady: false,
  readable: false, stage: 'developing', lessonId: null, ...over,
});

beforeEach(() => {
  readingFor.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useRunReading', () => {
  it('asks nothing without a run, or for a file still on its way up', async () => {
    renderHook(() => useRunReading(null));
    renderHook(() => useRunReading('sending-1'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(readingFor).not.toHaveBeenCalled();
  });

  it('keeps asking while Luna is reading, and stops once she is done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    readingFor
      .mockResolvedValueOnce(reading({ pagesReady: [1] }))
      .mockResolvedValueOnce(reading({ stage: 'ready', pagesReady: [1, 2], readable: true }));
    const { result } = renderHook(() => useRunReading('run-1'));
    await waitFor(() => expect(result.current?.pagesReady).toEqual([1]));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await waitFor(() => expect(result.current?.stage).toBe('ready'));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(readingFor).toHaveBeenCalledTimes(2);
  });

  it('starts from the last answer heard for the run, at once', async () => {
    readingFor.mockResolvedValueOnce(reading({ pagesReady: [1, 2], readable: true }));
    const early = renderHook(() => useRunReading('run-heard'));
    await waitFor(() => expect(early.result.current?.pagesReady).toEqual([1, 2]));
    early.unmount();
    readingFor.mockReturnValue(new Promise(() => {}));
    const full = renderHook(() => useRunReading('run-heard'));
    expect(full.result.current?.pagesReady).toEqual([1, 2]);
  });

  it('says it gave up when the run is not yours', async () => {
    readingFor.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 404 }));
    const { result } = renderHook(() => useRunStatus('run-foreign'));
    expect(result.current).toEqual({ reading: null, gaveUp: false });
    await waitFor(() => expect(result.current.gaveUp).toBe(true));
    expect(result.current.reading).toBeNull();
  });
});

describe('followOf', () => {
  const r = (over = {}) => reading({ lessonId: 'L1', pagesReady: [1, 2, 3], ...over }) as never;

  it('no run: nothing to follow, nothing pending', () => {
    expect(followOf({ reading: null, gaveUp: false }, null, 'L1')).toEqual({ run: null, pending: false, follow: null });
    expect(followOf({ reading: null, gaveUp: false }, 'sending-1', 'L1').pending).toBe(false);
  });

  it('a run not heard from yet is pending, and read as a partial Lesson', () => {
    expect(followOf({ reading: null, gaveUp: false }, 'run-1', 'L1')).toEqual({
      run: null, pending: true, follow: { pagesReady: 0, done: false },
    });
  });

  it('a run whose reads gave up is no run', () => {
    expect(followOf({ reading: null, gaveUp: true }, 'run-1', 'L1')).toEqual({ run: null, pending: false, follow: null });
  });

  it('a run for another Lesson is not followed', () => {
    expect(followOf({ reading: r({ lessonId: 'L2' }), gaveUp: false }, 'run-1', 'L1')).toEqual({ run: null, pending: false, follow: null });
  });

  it('a run for this Lesson is followed until it is done', () => {
    expect(followOf({ reading: r(), gaveUp: false }, 'run-1', 'L1').follow).toEqual({ pagesReady: 3, done: false });
    expect(followOf({ reading: r({ stage: 'ready' }), gaveUp: false }, 'run-1', 'L1').follow).toEqual({ pagesReady: 3, done: true });
  });
});
