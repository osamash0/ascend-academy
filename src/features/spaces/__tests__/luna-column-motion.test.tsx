import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@/i18n';
import { SessionColumn } from '../components/reader/luna/SessionColumn';
import { initialLuna } from '../data/useLunaSession';

vi.mock('motion/react', async (orig) => ({
  ...(await orig<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));

describe('Luna column motion', () => {
  it('follows the conversation without smooth scrolling when motion is reduced', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const luna = {
      state: { ...initialLuna, sessionId: 's', thread: [{ kind: 'learner' as const, id: 'a', text: 'hi' }] },
      start: vi.fn(), send: vi.fn(), act: vi.fn(), answerCheck: vi.fn(), wrapUp: vi.fn(), keep: vi.fn(), practise: vi.fn(), close: vi.fn(),
    };
    render(<SessionColumn luna={luna as never} lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()} />);
    expect(scroll).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });
  });
});
