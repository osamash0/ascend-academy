import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PEEK_FOLLOW_MS, PEEK_GRACE_MS, PEEK_INTENT_MS, usePeek } from '../usePeek';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = () => renderHook(() => usePeek());
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('usePeek', () => {
  it('opens after the pointer rests, not before', () => {
    const { result } = setup();
    act(() => result.current.hoverBlock('a', 'mouse'));
    tick(PEEK_INTENT_MS - 1);
    expect(result.current.state.status).toBe('closed');
    tick(1);
    expect(result.current.state).toEqual({ status: 'open', blockId: 'a', pinned: false });
  });

  it('ignores touch and pen hover', () => {
    const { result } = setup();
    act(() => result.current.hoverBlock('a', 'touch'));
    tick(PEEK_INTENT_MS * 2);
    expect(result.current.state.status).toBe('closed');
  });

  it('cancels when the pointer leaves before the delay', () => {
    const { result } = setup();
    act(() => result.current.hoverBlock('a', 'mouse'));
    tick(200);
    act(() => result.current.leaveBlock());
    tick(PEEK_INTENT_MS);
    expect(result.current.state.status).toBe('closed');
  });

  it('switches immediately once open', () => {
    const { result } = setup();
    act(() => result.current.open('a'));
    act(() => result.current.hoverBlock('b', 'mouse'));
    expect(result.current.state).toMatchObject({ blockId: 'b' });
  });

  it('stays open through the grace period and into the peek', () => {
    const { result } = setup();
    act(() => result.current.open('a'));
    act(() => result.current.leaveBlock());
    tick(PEEK_GRACE_MS - 1);
    act(() => result.current.enterPeek());
    tick(PEEK_GRACE_MS * 2);
    expect(result.current.state.status).toBe('open');
    act(() => result.current.leavePeek());
    tick(PEEK_GRACE_MS);
    expect(result.current.state.status).toBe('closed');
  });

  it('does not close a pinned peek on leave; close() does', () => {
    const { result } = setup();
    act(() => result.current.open('a'));
    act(() => result.current.togglePin());
    act(() => result.current.leaveBlock());
    tick(PEEK_GRACE_MS * 2);
    expect(result.current.state).toEqual({ status: 'open', blockId: 'a', pinned: true });
    act(() => result.current.close());
    expect(result.current.state.status).toBe('closed');
  });

  it('follows the reading line only when pinned, throttled', () => {
    const { result } = setup();
    act(() => result.current.open('a'));
    act(() => result.current.follow('b'));
    expect(result.current.state).toMatchObject({ blockId: 'a' });
    act(() => result.current.togglePin());
    tick(PEEK_FOLLOW_MS);
    act(() => result.current.follow('b'));
    expect(result.current.state).toMatchObject({ blockId: 'b' });
    act(() => result.current.follow('c'));
    expect(result.current.state).toMatchObject({ blockId: 'b' });
    tick(PEEK_FOLLOW_MS);
    act(() => result.current.follow('c'));
    expect(result.current.state).toMatchObject({ blockId: 'c' });
  });

  it('keeps its methods stable across renders', () => {
    const { result, rerender } = setup();
    const first = result.current.close;
    rerender();
    expect(result.current.close).toBe(first);
  });
});
