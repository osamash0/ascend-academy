import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { PlanStrip } from '../components/reader/luna/PlanStrip';
import { MoveMark } from '../components/reader/luna/MoveMark';
import { WrapCard } from '../components/reader/luna/WrapCard';
import { RevisitDeck } from '../components/reader/luna/RevisitDeck';
import { SessionColumn } from '../components/reader/luna/SessionColumn';
import { LUNA_SHEET_HEIGHT, LunaSheet } from '../components/reader/luna/LunaSheet';
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

  const lunaWith = (state: Partial<typeof initialLuna>, extra: Record<string, unknown> = {}) => ({
    state: { ...initialLuna, ...state },
    start: vi.fn(), send: vi.fn(), act: vi.fn(), answerCheck: vi.fn(), wrapUp: vi.fn(), keep: vi.fn(), practise: vi.fn(), close: vi.fn(),
    ...extra,
  });

  it('while the plan is drafted Luna is reading the Lesson; during turns she is thinking', () => {
    const { rerender } = render(
      <SessionColumn
        luna={lunaWith({ busy: true, planning: true, thread: [{ kind: 'learner', id: 'opener', text: 'I have an exam soon' }] }) as never}
        lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()}
      />,
    );
    expect(screen.getByText('I have an exam soon')).not.toBeNull();
    expect(screen.getByText('Luna is reading the Lesson…')).not.toBeNull();
    expect(screen.queryByText('Luna is thinking…')).toBeNull();
    expect(screen.queryByRole('button', { name: 'I have an exam soon' })).toBeNull();
    rerender(<SessionColumn luna={lunaWith({ sessionId: 's', busy: true }) as never} lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()} />);
    expect(screen.getByText('Luna is thinking…')).not.toBeNull();
    expect(screen.queryByText('Luna is reading the Lesson…')).toBeNull();
  });

  it('once a session exists you can always say you are done', () => {
    const wrapUp = vi.fn();
    const { rerender } = render(
      <SessionColumn luna={lunaWith({}, { wrapUp }) as never} lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Done for now' })).toBeNull();
    rerender(<SessionColumn luna={lunaWith({ sessionId: 's' }, { wrapUp }) as never} lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done for now' }));
    expect(wrapUp).toHaveBeenCalledTimes(1);
    rerender(
      <SessionColumn
        luna={lunaWith({ sessionId: 's', wrap: { covered: [], clicked: [], shaky: [] } }, { wrapUp }) as never}
        lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Done for now' })).toBeNull();
  });

  it('the plan can be changed: rename and remove open steps, then save in order', () => {
    const act = vi.fn();
    render(<SessionColumn luna={lunaWith({ sessionId: 's', plan }, { act }) as never} lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    const inputs = screen.getAllByRole('textbox', { name: /Step/ });
    expect(inputs.map((i) => (i as HTMLInputElement).value)).toEqual(['Check yourself', 'Spot a 2NF violation']);
    expect(inputs[0].getAttribute('maxlength')).toBe('60');
    fireEvent.change(inputs[1], { target: { value: 'Find a partial key' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove step' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(act).toHaveBeenCalledWith('edit_plan', { plan: [{ id: 's3', title: 'Find a partial key' }] });
    expect(screen.queryByRole('button', { name: 'Save plan' })).toBeNull();
  });

  it('cancelling a plan edit changes nothing', () => {
    const act = vi.fn();
    render(<SessionColumn luna={lunaWith({ sessionId: 's', plan }, { act }) as never} lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(act).not.toHaveBeenCalled();
    expect(screen.getByText('Check yourself')).not.toBeNull();
  });

  it('skip this step shows only while a step is current', () => {
    const skip = vi.fn();
    const { rerender } = render(<PlanStrip plan={plan} accepted onSkip={skip} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    expect(skip).toHaveBeenCalled();
    rerender(<PlanStrip plan={plan.map((s) => ({ ...s, status: s.status === 'current' ? ('done' as const) : s.status }))} accepted onSkip={skip} />);
    expect(screen.queryByRole('button', { name: 'Skip this step' })).toBeNull();
  });

  const col = (luna: ReturnType<typeof lunaWith>) => (
    <SessionColumn luna={luna as never} lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()} />
  );
  const said = { kind: 'luna' as const, id: 'a', md: 'Here is a plan.', blocks: [], check: null };

  it('between turns, continue moves the session on once the plan has started', () => {
    const act = vi.fn();
    render(col(lunaWith({ sessionId: 's', plan, thread: [said] }, { act })));
    expect(screen.queryByRole('button', { name: 'Looks good' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(act).toHaveBeenCalledWith('continue');
  });

  it('the sheet leaves the page at least 45% of a short screen', () => {
    expect(LUNA_SHEET_HEIGHT).toBe('min(55dvh, max(280px, 45dvh))');
  });

  it('continue stays hidden before the plan starts, while busy, with a check open, on a wrap offer, after the wrap, or with nothing left', () => {
    const check = { question: 'Which?', options: [{ text: 'One', correct: true, why: 'b' }] };
    const done = plan.map((s) => ({ ...s, status: 'done' as const }));
    const cases: Partial<typeof initialLuna>[] = [
      { sessionId: 's', plan: plan.map((s) => ({ ...s, status: 'todo' as const })), thread: [said] },
      { sessionId: 's', plan, thread: [said], busy: true },
      { sessionId: 's', plan, thread: [{ ...said, check }] },
      { sessionId: 's', plan, thread: [said], offerWrap: true },
      { sessionId: 's', plan, thread: [said], wrap: { covered: [], clicked: [], shaky: [] } },
      { sessionId: 's', plan: done, thread: [said] },
      { plan, thread: [said] },
    ];
    for (const state of cases) {
      const { unmount } = render(col(lunaWith(state)));
      expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
      unmount();
    }
  });

  it('on a narrow window Luna is a sheet; the column inside is its only close, Escape too', () => {
    const close = vi.fn();
    const { rerender } = render(<LunaSheet open label="Luna" onClose={close}><p>the column</p></LunaSheet>);
    const sheet = screen.getByRole('complementary', { name: 'Luna' });
    expect(sheet.hasAttribute('data-luna-sheet')).toBe(true);
    expect(screen.getByText('the column')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    rerender(<LunaSheet open={false} label="Luna" onClose={close}><p>the column</p></LunaSheet>);
    return waitFor(() => expect(screen.queryByText('the column')).toBeNull());
  });
});
