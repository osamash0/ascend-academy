import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TeachBack } from '../reader/TeachBack';
import type { TeachBack as Reading } from '../../data/liveRepository';

const TEXT = 'You start with X and add every attribute an FD gives you. It always takes two rounds.';
const READING: Reading = {
  idea: 'Attribute closure',
  first: 31,
  last: 39,
  verdict: 'partial',
  points: [
    { point: 'Start from X and add C when B → C fires.', page: 34, covered: true },
    { point: 'Stop when nothing new is added.', page: 34, covered: false },
  ],
  wrong: [{ quote: 'It always takes two rounds', correction: 'It runs until nothing changes.', page: 34 }],
  next: 'Look again at when it stops.',
};

describe('teach it back', () => {
  it('reads the explanation and gives it back marked, with the missing point one press from its page', async () => {
    const read = vi.fn().mockResolvedValue(READING);
    const onResult = vi.fn();
    const onPage = vi.fn();
    render(
      <TeachBack idea={{ name: 'Attribute closure', first: 31, last: 39 }} read={read} onPage={onPage} onResult={onResult} onClose={() => {}} />,
    );
    const check = screen.getByRole('button', { name: /Check my explanation/ });
    expect(check).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Explain it in your own words/), { target: { value: TEXT } });
    fireEvent.click(check);
    await waitFor(() => expect(screen.getByText('Nearly there.')).toBeInTheDocument());
    expect(read).toHaveBeenCalledWith(TEXT);
    expect(onResult).toHaveBeenCalledWith(READING);
    /* The wrong claim is marked in the student's own text, and its correction is listed. */
    expect(screen.getByRole('button', { name: 'It always takes two rounds' })).toBeInTheDocument();
    expect(screen.getByText('It runs until nothing changes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Page 34' }));
    expect(onPage).toHaveBeenCalledWith(34);
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.getByLabelText(/Explain it in your own words/)).toHaveValue(TEXT);
  });
});
