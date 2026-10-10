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

  const clearTimers = () => {
    clearTimeout(intent.current);
    clearTimeout(grace.current);
  };
  useEffect(() => clearTimers, []);

  const set = (next: PeekState) => {
    stateRef.current = next;
    setState(next);
  };

  const startGrace = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'open' || s.pinned) return;
    clearTimeout(grace.current);
    grace.current = setTimeout(() => set(CLOSED), PEEK_GRACE_MS);
  }, []);

  const open = useCallback((blockId: string) => {
    clearTimers();
    const s = stateRef.current;
    set({ status: 'open', blockId, pinned: s.status === 'open' ? s.pinned : false });
  }, []);

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
  }, []);

  const togglePin = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'open') return;
    clearTimeout(grace.current);
    lastFollow.current = Date.now();
    set({ ...s, pinned: !s.pinned });
  }, []);

  const follow = useCallback((blockId: string) => {
    const s = stateRef.current;
    if (s.status !== 'open' || !s.pinned || s.blockId === blockId) return;
    const now = Date.now();
    if (now - lastFollow.current < PEEK_FOLLOW_MS) return;
    lastFollow.current = now;
    set({ ...s, blockId });
  }, []);

  return useMemo(
    () => ({ state, hoverBlock, leaveBlock, enterPeek, leavePeek, open, close, togglePin, follow }),
    [state, hoverBlock, leaveBlock, enterPeek, leavePeek, open, close, togglePin, follow],
  );
}
