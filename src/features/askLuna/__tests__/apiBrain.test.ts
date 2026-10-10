import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/apiErrors';

// A plain stub, not vi.fn(): the spy wrapper reports a mock's rejected promise
// as a test failure even when the code under test catches it.
const calls: unknown[][] = [];
let impl: (...a: unknown[]) => Promise<unknown> = async () => ({});
vi.mock('@/lib/apiClient', () => ({
  apiClient: {
    post: (...a: unknown[]) => {
      calls.push(a);
      return impl(...a);
    },
  },
}));

import { apiBrain, LunaUnavailableError } from '../apiBrain';
import { toHistory } from '../AskLuna';

describe('apiBrain', () => {
  beforeEach(() => {
    calls.length = 0;
    impl = async () => ({});
  });

  it('posts the question and history to the versioned endpoint', async () => {
    await apiBrain('What is a JOIN?', 'en', [{ role: 'user', content: 'hi' }]);
    expect(calls).toEqual([['/api/v1/ask-luna', { question: 'What is a JOIN?', history: [{ role: 'user', content: 'hi' }] }]]);
  });

  it.each([
    [429, 'ask_luna_budget', 'budget'],
    [429, 'Rate limit exceeded', 'rate'],
    [503, 'ask_luna_unavailable', 'down'],
    [404, undefined, 'down'], // flag off on the backend
  ] as const)('maps HTTP %i (%s) to a kind reason', async (status, detail, reason) => {
    impl = async () => {
      throw new ApiError('x', status, detail);
    };
    const err = (await apiBrain('q', 'en').catch((e: unknown) => e)) as LunaUnavailableError;
    expect(err).toBeInstanceOf(LunaUnavailableError);
    expect(err.reason).toBe(reason);
  });
});

describe('toHistory', () => {
  it('flattens widgets to a one-line outcome, never their props', () => {
    const h = toHistory([
      { id: 1, role: 'user', text: 'How does a LEFT JOIN work?' },
      {
        id: 2,
        role: 'luna',
        outcome: 'correct',
        parts: [
          { type: 'text', text: 'Predict it!' },
          {
            type: 'widget',
            component: 'ConceptCheck',
            props: { question: 'Which?', options: [{ text: 'a', correct: true, why: '' }, { text: 'b', correct: false, why: '' }], hint: 'h' },
          },
        ],
      },
    ]);
    expect(h).toEqual([
      { role: 'user', content: 'How does a LEFT JOIN work?' },
      { role: 'luna', content: 'Predict it! [widget ConceptCheck: solved it]' },
    ]);
  });

  it('keeps only the most recent messages', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: i, role: 'user' as const, text: `q${i}` }));
    expect(toHistory(many).map((m) => m.content)).toEqual(['q4', 'q5', 'q6', 'q7', 'q8', 'q9']);
  });
});
