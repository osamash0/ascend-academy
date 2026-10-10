import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAsk } from '../../data/useAsk';
import { ASK_LATENCY_MS } from '../../mocks/studio-answers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useAsk', () => {
  it('answers a scripted question after a real wait, one at a time', async () => {
    const { result } = renderHook(() => useAsk());
    let p!: Promise<unknown>;
    act(() => { p = result.current.ask('Why does repeated data cause problems?'); });
    expect(result.current.answering).toBe(true);
    await act(async () => { vi.advanceTimersByTime(ASK_LATENCY_MS); });
    await expect(p).resolves.toMatchObject({ kind: 'answer', answer: { anchorId: 's-p5-2' } });
    expect(result.current.answering).toBe(false);
  });
  it('says so honestly when it has no answer', async () => {
    const { result } = renderHook(() => useAsk());
    let p!: Promise<unknown>;
    act(() => { p = result.current.ask('Tell me a joke'); });
    await act(async () => { vi.advanceTimersByTime(ASK_LATENCY_MS); });
    await expect(p).resolves.toEqual({ kind: 'unknown' });
  });
});
