import { useState, useEffect, useCallback } from 'react';

/**
 * PDF ingestion mode for the upload pipeline (Task #58).
 *
 * - 'ai'        — full AI parsing (default; unchanged behavior).
 * - 'on_demand' — deterministic PyMuPDF + heuristics extraction. No
 *                 LLM is called during import; titles/summaries/quizzes
 *                 are generated per slide later from the editor UI.
 */
export type ParsingMode = 'ai' | 'on_demand';

const STORAGE_KEY = 'ascend-parsing-mode';
const EVENT_NAME = 'ascend-parsing-mode-change';
const VALID: ReadonlyArray<ParsingMode> = ['ai', 'on_demand'];

function isValid(value: string | null): value is ParsingMode {
  return value !== null && (VALID as ReadonlyArray<string>).includes(value);
}

function readInitial(): ParsingMode {
  if (typeof window === 'undefined') return 'ai';
  const stored = localStorage.getItem(STORAGE_KEY);
  return isValid(stored) ? stored : 'ai';
}

/**
 * Reactive parsing-mode hook. All instances stay in sync because the
 * setter dispatches a window event that every other instance listens
 * to — without this, two components calling `useParsingMode()` would
 * each carry their own React state and a toggle in one would not be
 * observed by the other (e.g. the upload page vs the upload hook).
 */
export function useParsingMode() {
  const [parsingMode, setParsingModeState] = useState<ParsingMode>(readInitial);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<ParsingMode>).detail;
      if (isValid(next)) setParsingModeState(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isValid(e.newValue)) {
        setParsingModeState(e.newValue);
      }
    };
    window.addEventListener(EVENT_NAME, onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setParsingMode = useCallback((mode: ParsingMode) => {
    setParsingModeState(mode);
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // storage may be disabled in private browsing
    }
    window.dispatchEvent(new CustomEvent<ParsingMode>(EVENT_NAME, { detail: mode }));
  }, []);

  return { parsingMode, setParsingMode };
}
