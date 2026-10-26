import { StrictMode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const readingFor = vi.fn();
vi.mock('../liveRepository', () => ({ loadLiveRepository: async () => ({ readingFor }) }));
const localFileFor = vi.fn();
vi.mock('../uploads', () => ({ localFileFor: (id: string) => localFileFor(id) }));

import { useEarlyReading } from '../useEarlyReading';

beforeEach(() => {
  readingFor.mockReset();
  localFileFor.mockReset();
});

describe('useEarlyReading', () => {
  it('reads the file on this device before the server link', async () => {
    localFileFor.mockReturnValue(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }));
    readingFor.mockResolvedValue({ pdfUrl: 'https://signed', pages: 10, pagesRead: 2, stage: 'developing', lessonId: null });
    URL.createObjectURL = vi.fn(() => 'blob:local');
    URL.revokeObjectURL = vi.fn();
    const { result } = renderHook(() => useEarlyReading('run-1'));
    expect(result.current.url).toBe('blob:local');
    await waitFor(() => expect(result.current.reading?.pagesRead).toBe(2));
  });

  it('falls back to the signed link when the file is not on this device', async () => {
    localFileFor.mockReturnValue(null);
    readingFor.mockResolvedValue({ pdfUrl: 'https://signed', pages: 10, pagesRead: 0, stage: 'developing', lessonId: null });
    const { result } = renderHook(() => useEarlyReading('run-1'));
    await waitFor(() => expect(result.current.url).toBe('https://signed'));
  });

  it('stops polling once the stage is ready, and revokes the object URL on unmount', async () => {
    vi.useFakeTimers();
    try {
      localFileFor.mockReturnValue(new File(['%PDF'], 'a.pdf'));
      URL.createObjectURL = vi.fn(() => 'blob:local');
      URL.revokeObjectURL = vi.fn();
      readingFor
        .mockResolvedValueOnce({ pdfUrl: null, pages: 4, pagesRead: 1, stage: 'developing', lessonId: null })
        .mockResolvedValue({ pdfUrl: null, pages: 4, pagesRead: 4, stage: 'ready', lessonId: 'l1' });
      const { result, unmount } = renderHook(() => useEarlyReading('run-1'));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(readingFor).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.reading?.stage).toBe('ready');
      expect(readingFor).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      expect(readingFor).toHaveBeenCalledTimes(2);
      unmount();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a live object URL under StrictMode', async () => {
    localFileFor.mockReturnValue(new File(['%PDF'], 'a.pdf'));
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:local-${++n}`);
    URL.revokeObjectURL = vi.fn();
    readingFor.mockResolvedValue({ pdfUrl: null, pages: 4, pagesRead: 1, stage: 'ready', lessonId: 'l1' });
    const { result } = renderHook(() => useEarlyReading('run-1'), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.url).not.toBeNull());
    const live = result.current.url;
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(live);
  });

  it('stops after a 404 and caps transient retries', async () => {
    vi.useFakeTimers();
    try {
      localFileFor.mockReturnValue(null);
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
