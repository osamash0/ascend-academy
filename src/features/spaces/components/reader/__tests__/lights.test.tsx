import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EarlyReading } from '../../../data/liveRepository';
import { bufferOf, RING_MS, useLights } from '../lights';

const run = (over: Partial<EarlyReading> = {}): EarlyReading => ({
  pdfUrl: 'u', pages: 20, pagesRead: 0, pagesReady: [], practiceReady: false, readable: true,
  stage: 'developing', lessonId: 'L1', ...over,
});
const opts = { total: 20, practiceCount: 0 };
afterEach(() => vi.useRealTimers());

describe('bufferOf', () => {
  it('is the run of written pages from page 1', () => {
    expect(bufferOf([])).toBe(0);
    expect(bufferOf([1, 2, 3, 5])).toBe(3);
    expect(bufferOf([2, 3])).toBe(0);
  });
});

describe('useLights', () => {
  it('without a run every face is on, as today', () => {
    const { result } = renderHook(() => useLights(null, 7, { total: 20, practiceCount: 3 }));
    expect(result.current).toMatchObject({ following: false, pageReady: true, practiceOn: true, lunaReady: true, buffer: 20, line: null });
  });

  it('while Luna reads, a page has faces only once she has written it', () => {
    const { result } = renderHook(() => useLights(run({ pagesReady: [1, 2] }), 5, opts));
    expect(result.current).toMatchObject({ following: true, pageReady: false, practiceOn: false, lunaReady: false, buffer: 2 });
  });

  it('says it once when the page you are on lights up, and rings for a while', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ r, p }) => useLights(r, p, opts), {
      initialProps: { r: run({ pagesReady: [1] }), p: 3 },
    });
    expect(result.current.line).toBeNull();
    rerender({ r: run({ pagesReady: [1, 2, 3] }), p: 3 });
    expect(result.current.line).toBe('explain');
    expect(result.current.ringing).toBe(true);
    act(() => { vi.advanceTimersByTime(RING_MS); });
    expect(result.current.line).toBeNull();
    expect(result.current.ringing).toBe(false);
    rerender({ r: run({ pagesReady: [1, 2, 3, 4] }), p: 4 });
    expect(result.current.line).toBeNull();
  });

  it('a page already lit when you arrive says nothing', () => {
    const { result } = renderHook(() => useLights(run({ pagesReady: [1, 2, 3] }), 3, opts));
    expect(result.current.line).toBeNull();
  });

  it('Practise arrives once, at the end', () => {
    const { result, rerender } = renderHook(({ r }) => useLights(r, 1, opts), {
      initialProps: { r: run({ pagesReady: [1] }) },
    });
    rerender({ r: run({ pagesReady: [1], practiceReady: true }) });
    expect(result.current.practiceOn).toBe(true);
    expect(result.current.line).toBe('practice');
  });

  it('a run that stops keeps what was read and says so once', () => {
    const { result } = renderHook(() => useLights(run({ pagesReady: [1, 2], stage: 'failed' }), 2, opts));
    expect(result.current).toMatchObject({ pageReady: true, line: 'stopped', lunaReady: false });
  });

  it('once Luna is done, everything is on', () => {
    const { result } = renderHook(() => useLights(run({ stage: 'ready', pagesReady: [1, 2], practiceReady: true }), 9, opts));
    expect(result.current).toMatchObject({ following: false, pageReady: true, practiceOn: true, lunaReady: true, buffer: 20 });
  });
});
