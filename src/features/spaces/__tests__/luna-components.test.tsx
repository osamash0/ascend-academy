import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { PlanStrip } from '../components/reader/luna/PlanStrip';
import { MoveMark } from '../components/reader/luna/MoveMark';
import { WrapCard } from '../components/reader/luna/WrapCard';
import { RevisitDeck } from '../components/reader/luna/RevisitDeck';
import { SessionColumn } from '../components/reader/luna/SessionColumn';
import { initialLuna } from '../data/useLunaSession';
import { lunaApi, type PlanStep } from '../data/lunaSession';

vi.mock('../data/lunaSession', async (orig) => ({
  ...(await orig<typeof import('../data/lunaSession')>()),
  lunaApi: { due: vi.fn(), grade: vi.fn() },
}));

Element.prototype.scrollIntoView = vi.fn();

const plan: PlanStep[] = [
  { id: 's1', kind: 'look', title: 'What an FD says', target: { lecture_id: 'l', page: 4 }, status: 'done' },
  { id: 's2', kind: 'check', title: 'Check yourself', target: { lecture_id: 'l', page: 4 }, status: 'current' },
  { id: 's3', kind: 'explain', title: 'Spot a 2NF violation', target: { lecture_id: 'l', page: 5 }, status: 'todo' },
];

describe('Luna column parts', () => {
  it('the plan strip marks the current step and offers accept before the plan starts', () => {
    const accept = vi.fn();
    const { rerender } = render(<PlanStrip plan={plan.map((s) => ({ ...s, status: 'todo' as const }))} accepted={false} onAccept={accept} />);
    fireEvent.click(screen.getByRole('button', { name: 'Looks good' }));
    expect(accept).toHaveBeenCalled();
    rerender(<PlanStrip plan={plan} accepted />);
    expect(screen.getByText('Check yourself').closest('[aria-current="step"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Looks good' })).toBeNull();
  });

  it('a move mark takes you back to where Luna went', () => {
    const go = vi.fn();
    render(<MoveMark move={{ lecture_id: 'l', page: 12, spot: 'agree on X' }} onGo={go} />);
    fireEvent.click(screen.getByRole('button', { name: /page 12/ }));
    expect(go).toHaveBeenCalledWith('l', 12, 'agree on X');
  });

  it('the wrap card links each point to its page and offers keep and practice', () => {
    const open = vi.fn();
    const keep = vi.fn();
    render(
      <WrapCard
        wrap={{
          covered: [{ text: 'Functional dependencies', lecture_id: 'l', page: 4 }],
          clicked: [],
          shaky: [{ text: 'Partial keys', lecture_id: null, page: null }],
        }}
        kept={false}
        practiceAdded={null}
        onKeep={keep}
        onPractise={vi.fn()}
        onOpenPage={open}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Functional dependencies/ }));
    expect(open).toHaveBeenCalledWith('l', 4);
    expect(screen.getByText('Partial keys').closest('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep summary' }));
    expect(keep).toHaveBeenCalled();
    expect(screen.queryByText('Clicked')).toBeNull();
  });

  it('the revisit deck stays quiet when nothing is due', async () => {
    vi.mocked(lunaApi.due).mockResolvedValue({ cards: [], total: 0 });
    const { container } = render(<RevisitDeck lectureId="l" onDone={vi.fn()} />);
    await waitFor(() => expect(lunaApi.due).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });

  it('the revisit deck grades a card once however fast you press', async () => {
    vi.mocked(lunaApi.due).mockResolvedValue({
      cards: [{ card_id: 'c1', lecture_id: 'l', front: { question: 'Q?', options: ['a', 'b'], page: 1 }, back: { correct: 0, why: ['x', 'y'] } }],
      total: 1,
    });
    let release: () => void = () => undefined;
    vi.mocked(lunaApi.grade).mockImplementation(() => new Promise((res) => { release = () => res({ card_id: 'c1', due_at: '' }); }));
    const done = vi.fn();
    render(<RevisitDeck lectureId="l" onDone={done} />);
    fireEvent.click(await screen.findByRole('button', { name: /^a/ }));
    const good = screen.getByRole('button', { name: 'Got it' });
    fireEvent.click(good);
    fireEvent.click(good);
    fireEvent.click(screen.getByRole('button', { name: 'Again' }));
    expect(lunaApi.grade).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(lunaApi.grade).toHaveBeenCalledTimes(1);
  });

  it('a check in the column is answered once and reported', () => {
    const answerCheck = vi.fn();
    const luna = {
      state: {
        ...initialLuna,
        sessionId: 's',
        thread: [{
          kind: 'luna' as const, id: 'a', md: 'Try this', blocks: [],
          check: { question: 'Which?', options: [{ text: 'One', correct: true, why: 'because' }, { text: 'Two', correct: false, why: 'no' }] },
        }],
      },
      start: vi.fn(), send: vi.fn(), act: vi.fn(), answerCheck, wrapUp: vi.fn(), keep: vi.fn(), practise: vi.fn(), close: vi.fn(),
    };
    render(<SessionColumn luna={luna as never} lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Two/ }));
    fireEvent.click(screen.getByRole('button', { name: /^One/ }));
    expect(answerCheck).toHaveBeenCalledTimes(1);
    expect(answerCheck).toHaveBeenCalledWith('Which?', false);
    expect(screen.getByText('Not quite.')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Two/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
