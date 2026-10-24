import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { inDialog, isTyping, menuOpen } from './keys';
import { mark, reset as resetAll, retry as retryAll, stateOf, type RecallState, type TermState } from './recall';

const OFF: RecallState = { on: false, terms: {} };
const storageKey = (id: string) => `studio:recall:${id}`;
const TERM_STATES: readonly string[] = ['blank', 'seen', 'knew', 'notYet'];

/** Your Recall for one page of your Library, as you left it in this browser. */
function load(id: string): RecallState {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return OFF;
    const parsed = JSON.parse(raw) as Partial<RecallState> | null;
    const terms: Record<string, TermState> = {};
    if (parsed && typeof parsed.terms === 'object' && parsed.terms) {
      for (const [k, v] of Object.entries(parsed.terms)) if (TERM_STATES.includes(v as string)) terms[k] = v as TermState;
    }
    return { on: parsed?.on === true, terms };
  } catch {
    return OFF;
  }
}

function save(id: string, s: RecallState) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(s));
  } catch {
    // A per-viewer convenience: without storage, Recall simply lasts this visit.
  }
}

/**
 * Recall mode for one canvas (spec §2.2–2.3): on/off and what you remember
 * of each key term, kept per Material in this browser. `R` toggles it, with
 * the same guards as `S`; while `enabled` is false (Source) it stays as it is.
 */
export function useRecall(canvasId: string, enabled: boolean) {
  const [held, setHeld] = useState(() => ({ id: canvasId, state: load(canvasId) }));
  // Another Material: its own Recall, read during render so no frame shows the old one.
  let current = held;
  if (held.id !== canvasId) {
    current = { id: canvasId, state: load(canvasId) };
    setHeld(current);
  }
  const state = current.state;

  const loaded = useRef(true);
  useEffect(() => {
    // The first run is what storage already holds.
    if (loaded.current) {
      loaded.current = false;
      return;
    }
    save(held.id, held.state);
  }, [held]);

  const update = useCallback((f: (s: RecallState) => RecallState) => {
    setHeld((h) => ({ id: h.id, state: f(h.state) }));
  }, []);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const toggle = useCallback(() => {
    if (enabledRef.current) update((s) => ({ ...s, on: !s.on }));
  }, [update]);
  const reveal = useCallback(
    (key: string) => update((s) => (stateOf(s, key) === 'blank' ? mark(s, key, 'seen') : s)),
    [update],
  );
  const markTerm = useCallback((key: string, t: 'knew' | 'notYet') => update((s) => mark(s, key, t)), [update]);
  const retry = useCallback(() => update(retryAll), [update]);
  const reset = useCallback(() => update(resetAll), [update]);

  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || inDialog(e.target) || menuOpen(e.target)) return;
      toggleRef.current();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [enabled]);

  return useMemo(
    () => ({ state, toggle, reveal, markTerm, retry, reset }),
    [state, toggle, reveal, markTerm, retry, reset],
  );
}
