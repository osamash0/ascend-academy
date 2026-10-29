import { StrictMode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const readingFor = vi.fn();
vi.mock('../liveRepository', () => ({ loadLiveRepository: async () => ({ readingFor }) }));
/* The link to the file on this device; one per File, owned by the uploads store. */
const localUrlFor = vi.fn();
vi.mock('../uploads', () => ({ localUrlFor: (id: string) => localUrlFor(id) }));

import { useEarlyReading } from '../useEarlyReading';

beforeEach(() => {
  readingFor.mockReset();
  localUrlFor.mockReset();
  URL.revokeObjectURL = vi.fn();
});

describe('useEarlyReading', () => {
  it('does not ask the server about a file still on its way up (sending-*)', async () => {
    localUrlFor.mockReturnValue('blob:local');
    const { result } = renderHook(() => useEarlyReading('sending-1'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(readingFor).not.toHaveBeenCalled();
    expect(result.current.reading).toBeNull();
    expect(result.current.url).toBe('blob:local');
  });

  it('reads the file on this device before the server link', async () => {
    localUrlFor.mockReturnValue('blob:local');
    readingFor.mockResolvedValue({ pdfUrl: 'https://signed', pages: 10, pagesRead: 2, pagesReady: [], practiceReady: false, readable: false, stage: 'developing', lessonId: null });
    const { result } = renderHook(() => useEarlyReading('run-1'));
    expect(result.current.url).toBe('blob:local');
    await waitFor(() => expect(result.current.reading?.pagesRead).toBe(2));
  });

  it('falls back to the signed link when the file is not on this device', async () => {
    localUrlFor.mockReturnValue(null);
    readingFor.mockResolvedValue({ pdfUrl: 'https://signed', pages: 10, pagesRead: 0, pagesReady: [], practiceReady: false, readable: false, stage: 'developing', lessonId: null });
    const { result } = renderHook(() => useEarlyReading('run-1'));
    await waitFor(() => expect(result.current.url).toBe('https://signed'));
  });

  it('stops polling once the stage is ready; unmounting leaves the file’s link to its owner', async () => {
    vi.useFakeTimers();
    try {
      localUrlFor.mockReturnValue('blob:local');
      readingFor
        .mockResolvedValueOnce({ pdfUrl: null, pages: 4, pagesRead: 1, pagesReady: [], practiceReady: false, readable: false, stage: 'developing', lessonId: null })
        .mockResolvedValue({ pdfUrl: null, pages: 4, pagesRead: 4, pagesReady: [], practiceReady: false, readable: false, stage: 'ready', lessonId: 'l1' });
      const { result, unmount } = renderHook(() => useEarlyReading('run-1'));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(readingFor).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.reading?.stage).toBe('ready');
      expect(readingFor).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      expect(readingFor).toHaveBeenCalledTimes(2);
      unmount();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the same link under StrictMode', async () => {
    localUrlFor.mockReturnValue('blob:local');
    readingFor.mockResolvedValue({ pdfUrl: null, pages: 4, pagesRead: 1, pagesReady: [], practiceReady: false, readable: false, stage: 'ready', lessonId: 'l1' });
    const { result } = renderHook(() => useEarlyReading('run-1'), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.url).not.toBeNull());
    const live = result.current.url;
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(live);
  });

  it('stops after a 404 and caps transient retries', async () => {
    vi.useFakeTimers();
    try {
      localUrlFor.mockReturnValue(null);
      readingFor.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }));
      renderHook(() => useEarlyReading('run-1'));
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(readingFor).toHaveBeenCalledTimes(1);
      readingFor.mockReset();
      readingFor.mockRejectedValue(new Error('offline'));
      renderHook(() => useEarlyReading('run-2'));
      await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
      expect(readingFor).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });
});
