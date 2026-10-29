import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const readingFor = vi.fn();
vi.mock('../liveRepository', () => ({ loadLiveRepository: async () => ({ readingFor }) }));

import { useRunReading } from '../useRunReading';

const reading = (over = {}) => ({
  pdfUrl: 'https://signed', pages: 10, pagesRead: 0, pagesReady: [], practiceReady: false,
  readable: false, stage: 'developing', lessonId: null, ...over,
});

beforeEach(() => readingFor.mockReset());
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
});
