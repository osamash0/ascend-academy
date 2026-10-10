import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Peek's state machine — spec §4.1.
 *
 *   closed ──hover(mouse) 350ms──▶ open ──leave 600ms──▶ closed
 *                  open ──togglePin──▶ open(pinned) ──close()──▶ closed
 *
 * Touch never hovers: it arrives through `open()` from the page marker.
 * Once open, hovering another block switches at once — the outline glides
 * rather than the peek closing and reopening.
 */

export const PEEK_INTENT_MS = 350;
export const PEEK_GRACE_MS = 600;
export const PEEK_FOLLOW_MS = 150;

export type PeekState = { status: 'closed' } | { status: 'open'; blockId: string; pinned: boolean };

export interface PeekApi {
  state: PeekState;
  hoverBlock(blockId: string, pointerType: string): void;
  leaveBlock(): void;
  enterPeek(): void;
  leavePeek(): void;
  open(blockId: string): void;
  close(): void;
  togglePin(): void;
  follow(blockId: string): void;
}

const CLOSED: PeekState = { status: 'closed' };

export function usePeek(): PeekApi {
  const [state, setState] = useState<PeekState>(CLOSED);
  const stateRef = useRef(state);
  stateRef.current = state;
  const intent = useRef<ReturnType<typeof setTimeout>>();
  const grace = useRef<ReturnType<typeof setTimeout>>();
  const lastFollow = useRef(0);
  const followTimer = useRef<ReturnType<typeof setTimeout>>();
  const pendingFollow = useRef<string | null>(null);

  const clearFollow = useCallback(() => {
    clearTimeout(followTimer.current);
    followTimer.current = undefined;
    pendingFollow.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    clearTimeout(intent.current);
    clearTimeout(grace.current);
    clearFollow();
  }, [clearFollow]);
  useEffect(() => clearTimers, [clearTimers]);

  const set = useCallback((next: PeekState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Trailing edge of the follow throttle: applies the latest block that was
  // requested inside the window, re-checking that the peek is still pinned.
  const applyFollow = useCallback(() => {
    followTimer.current = undefined;
    const pending = pendingFollow.current;
    pendingFollow.current = null;
    const s = stateRef.current;
    if (pending === null || s.status !== 'open' || !s.pinned || s.blockId === pending) return;
    lastFollow.current = Date.now();
    set({ ...s, blockId: pending });
  }, [set]);

  const startGrace = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'open' || s.pinned) return;
    clearTimeout(grace.current);
    grace.current = setTimeout(() => set(CLOSED), PEEK_GRACE_MS);
  }, [set]);

  const open = useCallback((blockId: string) => {
    clearTimers();
    const s = stateRef.current;
    set({ status: 'open', blockId, pinned: s.status === 'open' ? s.pinned : false });
  }, [clearTimers, set]);

  const hoverBlock = useCallback((blockId: string, pointerType: string) => {
    if (pointerType !== 'mouse') return;
    clearTimeout(grace.current);
    if (stateRef.current.status === 'open') {
      open(blockId);
      return;
    }
    clearTimeout(intent.current);
    intent.current = setTimeout(() => open(blockId), PEEK_INTENT_MS);
  }, [open]);

  const leaveBlock = useCallback(() => {
    clearTimeout(intent.current);
    startGrace();
  }, [startGrace]);

  const enterPeek = useCallback(() => clearTimeout(grace.current), []);
  const leavePeek = startGrace;

  const close = useCallback(() => {
    clearTimers();
    set(CLOSED);
  }, [clearTimers, set]);

  const togglePin = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'open') return;
    clearTimeout(grace.current);
    clearFollow();
    lastFollow.current = Date.now();
    set({ ...s, pinned: !s.pinned });
    // Unpinning returns the peek to the normal grace-then-close lifecycle.
    if (s.pinned) startGrace();
  }, [clearFollow, set, startGrace]);

  const follow = useCallback((blockId: string) => {
    const s = stateRef.current;
    if (s.status !== 'open' || !s.pinned) return;
    const remaining = PEEK_FOLLOW_MS - (Date.now() - lastFollow.current);
    if (remaining > 0) {
      // Inside the window: remember the latest request and apply it at the trailing edge.
      pendingFollow.current = blockId;
      if (followTimer.current === undefined) {
        followTimer.current = setTimeout(applyFollow, remaining);
      }
      return;
    }
    if (s.blockId === blockId) return;
    lastFollow.current = Date.now();
    set({ ...s, blockId });
  }, [applyFollow, set]);

  return useMemo(
    () => ({ state, hoverBlock, leaveBlock, enterPeek, leavePeek, open, close, togglePin, follow }),
    [state, hoverBlock, leaveBlock, enterPeek, leavePeek, open, close, togglePin, follow],
  );
}
