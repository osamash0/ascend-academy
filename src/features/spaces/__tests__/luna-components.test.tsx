import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { PlanStrip } from '../components/reader/luna/PlanStrip';
import { MoveMark } from '../components/reader/luna/MoveMark';
import { WrapCard } from '../components/reader/luna/WrapCard';
import type { PlanStep } from '../data/lunaSession';

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
});
