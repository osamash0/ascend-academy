import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useIdle } from '../reader/useIdle';
import { BreakNudge, useReadingCare } from '../reader/ReadingCare';

afterEach(() => vi.useRealTimers());

describe('a long reading session', () => {
  it('goes quiet when nothing moves, and wakes at the first touch', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdle(true, 2800));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('pointermove'));
    });
    expect(result.current).toBe(false);
  });

  it('never goes quiet while it is not allowed to', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdle(false, 2800));
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(false);
  });

  it('offers a break only after twenty-five minutes of someone actually reading', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReadingCare(1, true));
    /* Away: no input for half an hour, so the clock does not run past the first 90 s. */
    act(() => vi.advanceTimersByTime(30 * 60_000));
    expect(result.current.due).toBe(false);
    /* Present: a touch every minute. */
    for (let m = 0; m < 26; m++) {
      act(() => {
        window.dispatchEvent(new Event('keydown'));
        vi.advanceTimersByTime(60_000);
      });
    }
    expect(result.current.due).toBe(true);
    act(() => result.current.snooze());
    expect(result.current.due).toBe(false);
  });

  it('says how long, and offers the break and a check of what stuck', () => {
    const care = { due: true, minutes: 26, pages: 14, snooze: () => {}, resting: false, rest: () => {}, back: () => {} };
    render(
      <MemoryRouter>
        <BreakNudge care={care} checkHref="/v4/space/c/rehearse?lectures=l" />
      </MemoryRouter>,
    );
    expect(screen.getByText('26 minutes · 14 pages')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take 5 minutes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check what stuck' })).toHaveAttribute('href', '/v4/space/c/rehearse?lectures=l');
  });
});
