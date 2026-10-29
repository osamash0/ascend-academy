import { useCallback, useState } from 'react';
import type { Landing, LandingAnswer } from '../landing/types';
import { landingFor } from '../mocks/landing';
import type { LoadState } from '../types';

/**
 * The data seam for the owner's door.
 *
 * Demo only for now: fixtures from `mocks/landing.ts`. Live will be
 * `GET /api/v1/v4/spaces/{id}/landing` and `POST …/questions/{id}/answer`
 * (spec §4 B4, §7) — the screen is written against this hook so that swap is
 * a change of body, not of shape.
 *
 * Answering is kept in component state so the demo's answer flow works end
 * to end: the question moves to answered, with the visibility the owner
 * chose, and stays that way for the life of the screen.
 */
export function useLanding(spaceId: string): {
  state: LoadState;
  landing: Landing | null;
  answer: (questionId: string, text: string, forEveryone: boolean) => void;
} {
  const [landing, setLanding] = useState<Landing | null>(() => landingFor(spaceId));

  const answer = useCallback((questionId: string, text: string, forEveryone: boolean) => {
    const reply: LandingAnswer = { text, forEveryone, at: new Date().toISOString() };
    setLanding((l) =>
      l ? { ...l, questions: l.questions.map((q) => (q.id === questionId ? { ...q, answer: reply } : q)) } : l,
    );
  }, []);

  return { state: landing ? 'ready' : 'empty', landing, answer };
}
