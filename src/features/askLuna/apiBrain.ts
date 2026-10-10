/**
 * The real brain: POST /api/v1/ask-luna (backend/api/v1/ask_luna.py).
 *
 * Same contract as scriptedBrain — returns the raw `{ parts }` turn, which
 * AskLuna validates with protocol.parseTurn before rendering anything. The
 * server validates too; this is the second fence, not the only one.
 */
import { apiClient } from '@/lib/apiClient';
import type { Brain, HistoryItem } from './AskLuna';

/** Thrown for failures Luna should explain kindly rather than as a glitch. */
export class LunaUnavailableError extends Error {
  constructor(readonly reason: 'budget' | 'rate' | 'down') {
    super(reason);
  }
}

export const apiBrain: Brain = async (question: string, _lang: string, history: HistoryItem[] = []) => {
  try {
    // The backend reads the saved profile language itself; `_lang` is unused on purpose.
    return await apiClient.post<unknown>('/api/v1/ask-luna', { question, history });
  } catch (e) {
    // Read the fields rather than `instanceof ApiError`, so this holds across module copies.
    const { status, detail } = (e ?? {}) as { status?: unknown; detail?: unknown };
    if (status === 429) throw new LunaUnavailableError(detail === 'ask_luna_budget' ? 'budget' : 'rate');
    if (status === 404 || (typeof status === 'number' && status >= 500)) throw new LunaUnavailableError('down');
    throw e;
  }
};
