import { useCallback, useRef, useState } from 'react';
import { ASK_LATENCY_MS, SUGGESTED_QUESTIONS, findAnswer } from '../mocks/studio-answers';
import type { ScriptedAnswer } from '../mocks/studio-answers';

/** The next questions to offer on a canvas: the first not yet asked. Canvases are demo-only (live has no shelf files). */
export { nextSuggestions } from '../mocks/studio-answers';

/**
 * The ask seam (Living Learn spec §6.3). Mock now: a scripted answer after a
 * real wait. Wiring a model later replaces this hook's body and nothing above it.
 * `busy` means an earlier ask is still in flight; callers ignore it silently.
 */
export type AskResult = { kind: 'answer'; answer: ScriptedAnswer } | { kind: 'unknown' } | { kind: 'busy' };

export function useAsk(): { ask(question: string): Promise<AskResult>; answering: boolean; suggestions: string[] } {
  const [answering, setAnswering] = useState(false);
  const busy = useRef(false);
  const ask = useCallback((question: string): Promise<AskResult> => {
    if (busy.current) return Promise.resolve({ kind: 'busy' });
    busy.current = true;
    setAnswering(true);
    return new Promise((resolve) => {
      setTimeout(() => {
        busy.current = false;
        setAnswering(false);
        const answer = findAnswer(question);
        resolve(answer ? { kind: 'answer', answer } : { kind: 'unknown' });
      }, ASK_LATENCY_MS);
    });
  }, []);
  return { ask, answering, suggestions: SUGGESTED_QUESTIONS };
}
